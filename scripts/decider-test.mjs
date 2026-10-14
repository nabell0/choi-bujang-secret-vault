import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fixtureRequests } from './fixture-7.mjs';

const RESPONSE_KEYS = 'decision,reasonCode,requestId,ruleIds,schema';

function validResponse(request, response, ruleIds) {
  return response && typeof response === 'object' && !Array.isArray(response)
    && Object.keys(response).sort().join(',') === RESPONSE_KEYS
    && response.schema === 'aleph.decision.v1'
    && response.requestId === request.requestId
    && ['allow', 'deny', 'step_up'].includes(response.decision)
    && typeof response.reasonCode === 'string'
    && /^[a-z][a-z0-9_]{0,63}$/u.test(response.reasonCode)
    && Array.isArray(response.ruleIds) && response.ruleIds.length > 0
    && response.ruleIds.every(id => ruleIds.includes(id));
}

// Local practice only. The class engine and the server judge validate live requests separately.
export async function checkDecider({ decide, ruleIds, proposeRevocation }) {
  if (typeof decide !== 'function' || !Array.isArray(ruleIds)
      || !ruleIds.includes('device_registered')) {
    throw new Error('6단계 device_registered 규칙을 먼저 구현하고 RULE_IDS에 적어 주세요.');
  }
  const { normal, suspicious } = fixtureRequests();
  const checks = [
    { name: '등록 기기의 정상 요청', request: normal, decision: 'allow' },
    { name: '미등록 기기의 가상 요청', request: { ...normal, requestId: randomUUID(),
      deviceRegistered: false }, decision: 'deny', reasonCode: 'device_not_registered' },
  ];
  if (ruleIds.includes('step_up_required')) {
    checks.push(
      { name: '복합 이상 접속', request: suspicious, decision: 'step_up',
        reasonCode: 'step_up_required' },
      { name: '다시 확인한 복합 이상 접속', request: { ...suspicious,
        requestId: randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } },
      decision: 'allow' },
    );
  }
  const results = [];
  for (const item of checks) {
    const response = await decide(item.request);
    const valid = validResponse(item.request, response, ruleIds)
      && response.decision === item.decision
      && (!item.reasonCode || response.reasonCode === item.reasonCode);
    results.push({ name: item.name, passed: valid });
  }
  if (typeof proposeRevocation === 'function') {
    const proposal = await proposeRevocation(suspicious);
    results.push({ name: '의심 사건의 기기 회수 제안', passed: Boolean(proposal)
      && Object.keys(proposal).sort().join(',') === 'action,deviceId,reasonCode,ruleIds'
      && proposal.action === 'propose_revocation' && proposal.deviceId === suspicious.deviceId
      && /^[a-z][a-z0-9_]{0,63}$/u.test(proposal.reasonCode)
      && Array.isArray(proposal.ruleIds) && proposal.ruleIds.length > 0
      && proposal.ruleIds.every(id => ruleIds.includes(id)) });
    results.push({ name: '정상 사건은 회수 제안 없음',
      passed: isDeepStrictEqual(await proposeRevocation(normal), { action: 'observe' }) });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { decide, RULE_IDS, proposeRevocation } = await import('../src/decider.mjs');
    const results = await checkDecider({ decide, ruleIds: RULE_IDS, proposeRevocation });
    for (const item of results) process.stdout.write(`${item.passed ? '통과' : '확인 필요'} · ${item.name}\n`);
    process.stdout.write('이 명령은 가상 요청으로 연습하며 심판 통과 증거가 아닙니다.\n');
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`판정기 연습 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
