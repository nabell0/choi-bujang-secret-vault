// 탈환 작전실 서버 기록. 화면은 이 기록의 수치만 그대로 보여 줍니다.
// 메모 제목·본문·내용 해시는 넣지 않습니다. 호출하지 않은 항목은 count를 null, status를 untested로 둡니다.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RULE_IDS } from './decider.mjs';
import { DETECT_BURST_LIMIT, DETECT_WINDOW_MS } from './detect.mjs';

const root = resolve(import.meta.dirname, '..');
const FORBIDDEN_KEYS = new Set([
  'body', 'content', 'title', 'password', 'token', 'secret', 'authorization', 'email', 'content_sha256',
]);

const readJson = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));

const untested = () => ({ status: 'untested', count: null });

function assertRedacted(value, path = 'record') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRedacted(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`작전실 기록에 메모·비밀 필드가 있습니다: ${path}.${key}`);
    assertRedacted(child, `${path}.${key}`);
  }
}

function countUntested(record) {
  const slots = [
    record.decider.liveDecideCalls,
    record.detect.recordedEvents,
    record.recovery.enforced,
    record.restore.noteBackupRows,
    ...record.apiProbes,
  ];
  return slots.filter(item => item.status === 'untested').length;
}

export async function buildOpsRecord() {
  const policy = await readJson('policy/test-policy.json');
  const safe = await readJson('policy/safe-policy.json');
  const manifest = await readJson('policy/safe-policy.manifest.json');
  if (!Number.isInteger(policy.revision) || !Number.isInteger(safe.revision)
      || safe.revision !== manifest.revision || !Array.isArray(policy.audit)) {
    throw new Error('정책 개정 번호를 읽지 못했습니다.');
  }
  if (!Number.isInteger(DETECT_BURST_LIMIT) || DETECT_WINDOW_MS % 60000 !== 0) {
    throw new Error('탐지 기준값이 분 단위 정수가 아닙니다.');
  }

  const rules = RULE_IDS.map(id => ({ id, source: 'server-record', status: 'recorded' }));
  const audit = policy.audit.map(row => ({
    action: row.action,
    service: row.service,
    fromRevision: row.fromRevision ?? null,
    toRevision: row.toRevision ?? null,
    safeRevision: row.safeRevision ?? null,
  }));
  const apiProbes = [
    ['notes-list', 'GET', '/api/notes'],
    ['notices-list', 'GET', '/api/notices'],
    ['materials-list', 'GET', '/api/materials'],
    ['device-challenge', 'GET', '/api/device/challenge'],
    ['note-restore', 'POST', '/api/restore/notes/00000000-0000-4000-8000-000000000000'],
  ].map(([id, method, path]) => ({ id, method, path, status: 'untested', httpStatus: null, error: null }));

  const record = {
    schema: 'aleph.ops-room.v1',
    redacted: true,
    decider: {
      source: 'server-record',
      ruleCount: rules.length,
      rules,
      liveDecideCalls: untested(),
    },
    detect: {
      source: 'server-record',
      windowMinutes: DETECT_WINDOW_MS / 60000,
      burstLimit: DETECT_BURST_LIMIT,
      recordedEvents: untested(),
      proposalAction: 'propose_revocation',
      proposalReasonCode: 'burst_read',
    },
    recovery: {
      source: 'server-record',
      enforced: untested(),
      proposalReasonCode: 'burst_read',
    },
    restore: {
      source: 'server-record',
      policyRevision: policy.revision,
      safeRevision: safe.revision,
      auditCount: audit.length,
      policyRestoredCount: audit.filter(row => row.action === 'policy_restored').length,
      audit,
      noteBackupRows: untested(),
    },
    apiProbes,
  };
  record.counts = {
    rules: record.decider.ruleCount,
    audit: record.restore.auditCount,
    policyRestored: record.restore.policyRestoredCount,
    apiProbes: record.apiProbes.length,
    untested: countUntested(record),
  };
  if (record.counts.rules !== record.decider.rules.length
      || record.counts.audit !== record.restore.audit.length
      || record.counts.policyRestored !== record.restore.audit.filter(row => row.action === 'policy_restored').length
      || record.counts.apiProbes !== record.apiProbes.length
      || record.counts.untested !== countUntested(record)) {
    throw new Error('작전실 수치와 기록이 다릅니다.');
  }
  assertRedacted(record);
  return record;
}
