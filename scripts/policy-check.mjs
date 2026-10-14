import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { RULE_IDS } from '../src/decider.mjs';
import { noteReadDecision } from './policy-diff.mjs';

// policy/의 세 파일을 임시 폴더에 복사해 침해 상태의 시험 정책으로 비교·복원을 실행합니다.
// 저장소의 시험 정책·운영 판정기는 바꾸지 않습니다. 로컬 연습이며 심판 판정이 아닙니다.
const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts', 'policy-diff.mjs');
const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const operational = ['src/decider.mjs', 'src/detect.mjs', 'aleph.config.json'].map(path => join(root, path));
const operationalBefore = operational.map(fileHash);

const safe = JSON.parse(readFileSync(join(root, 'policy', 'safe-policy.json'), 'utf8'));
const breached = JSON.parse(readFileSync(join(root, 'policy', 'test-policy.json'), 'utf8'));
breached.services.notes = {
  ...safe.services.notes, methods: ['GET', 'DELETE'], routes: ['GET /notes', 'GET /notes/:id', 'DELETE /notes/:id'],
  ownerOnly: false, listAll: true,
};

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-check-'));
  const paths = { policy: join(dir, 'test-policy.json'), safe: join(dir, 'safe-policy.json'), manifest: join(dir, 'manifest.json') };
  writeFileSync(paths.policy, `${JSON.stringify(breached, null, 2)}\n`, 'utf8');
  copyFileSync(join(root, 'policy', 'safe-policy.json'), paths.safe);
  copyFileSync(join(root, 'policy', 'safe-policy.manifest.json'), paths.manifest);
  return { dir, paths };
}

function run(paths, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [script, '--policy', paths.policy, '--safe', paths.safe,
      '--manifest', paths.manifest, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const withWorkspace = check => () => {
  const { dir, paths } = workspace();
  try { return check(paths); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const stopsWithoutWriting = (prepare, ...args) => withWorkspace(paths => {
  prepare(paths);
  const before = readFileSync(paths.policy, 'utf8');
  const r = run(paths, '--restore', ...args);
  return r.code === 1 && r.out.includes('복원을 중단합니다') && readFileSync(paths.policy, 'utf8') === before;
});

const checks = [
  ['안전 사본의 규칙 이름이 모두 판정기 RULE_IDS 안에 있고, 메모·공지 허용 경로가 aleph.config.json과 같음', () => {
    const ruleIds = Object.values(safe.services).map(rules => rules.ruleId).filter(Boolean);
    const config = read(join(root, 'aleph.config.json'));
    const routes = [...safe.services.notes.routes, ...safe.services.notices.routes].map(route => route.replace(' /', ' /api/'));
    return ruleIds.every(id => RULE_IDS.includes(id)) && isDeepStrictEqual([...routes].sort(), [...config.allowedRoutes].sort());
  }],
  ['policy:diff는 복원할 버전과 notes의 바뀔 항목을 보여 주고 아무것도 쓰지 않음', withWorkspace(paths => {
    const before = readFileSync(paths.policy, 'utf8');
    const r = run(paths);
    return r.code === 0 && r.out.includes('복원할 버전: revision 9') && r.out.includes('notes: 4개 항목이 사본과 다름')
      && r.out.includes('noteRestore: 사본에 없는 서비스') && readFileSync(paths.policy, 'utf8') === before;
  })],
  ['--confirm 없는 policy:restore는 미리보기만 함', withWorkspace(paths => {
    const before = readFileSync(paths.policy, 'utf8');
    const r = run(paths, '--restore', '--service', 'notes');
    return r.code === 0 && r.out.includes('미리보기만 했고') && readFileSync(paths.policy, 'utf8') === before;
  })],
  ['notes만 사본 값으로 복원: 다른 서비스 규칙·이전 감사 이력 그대로, 감사 한 줄 추가, B의 A 메모 거부·A 자기 메모 허용', withWorkspace(paths => {
    const before = read(paths.policy);
    const r = run(paths, '--restore', '--service', 'notes', '--confirm');
    const after = read(paths.policy);
    const last = after.audit.at(-1);
    const othersKept = Object.keys(before.services).filter(name => name !== 'notes')
      .every(name => isDeepStrictEqual(after.services[name], before.services[name]));
    return r.code === 0 && isDeepStrictEqual(after.services.notes, safe.services.notes) && othersKept
      && after.audit.length === before.audit.length + 1 && isDeepStrictEqual(after.audit.slice(0, -1), before.audit)
      && last.action === 'policy_restored' && last.service === 'notes' && last.changes.length === 4
      && noteReadDecision(after.services.notes, { route: 'GET /notes/:id', requester: 'B', owner: 'A' }) === 'deny'
      && noteReadDecision(after.services.notes, { route: 'GET /notes/:id', requester: 'A', owner: 'A' }) === 'allow'
      && noteReadDecision(after.services.notes, { route: 'GET /notes', requester: 'A', owner: 'A' }) === 'deny';
  })],
  ['복원을 다시 실행하면 바꿀 것이 없어 감사 이력도 그대로', withWorkspace(paths => {
    run(paths, '--restore', '--service', 'notes', '--confirm');
    const before = readFileSync(paths.policy, 'utf8');
    const r = run(paths, '--restore', '--service', 'notes', '--confirm');
    return r.code === 0 && r.out.includes('이미 사본과 같아') && readFileSync(paths.policy, 'utf8') === before;
  })],
  ['사본 기록이 없으면 중단, 시험 정책 그대로', stopsWithoutWriting(paths => rmSync(paths.manifest), '--service', 'notes', '--confirm')],
  ['사본 파일이 없으면 중단, 시험 정책 그대로', stopsWithoutWriting(paths => rmSync(paths.safe), '--service', 'notes', '--confirm')],
  ['사본 내용이 바뀌어 SHA-256이 기록과 다르면 중단, 시험 정책 그대로', stopsWithoutWriting(paths => {
    const copy = read(paths.safe);
    copy.services.notes.ownerOnly = false;
    writeFileSync(paths.safe, `${JSON.stringify(copy, null, 2)}\n`, 'utf8');
  }, '--service', 'notes', '--confirm')],
  ['사본에 없는 서비스나 서비스 미지정은 중단, 시험 정책 그대로', () => stopsWithoutWriting(() => {}, '--service', 'noteRestore', '--confirm')()
    && stopsWithoutWriting(() => {}, '--confirm')()],
  ['운영 판정기 src/decider.mjs·src/detect.mjs와 aleph.config.json은 바뀌지 않음', () => isDeepStrictEqual(operational.map(fileHash), operationalBefore)],
];

let failed = false;
for (const [name, check] of checks) {
  let passed = false;
  try { passed = check(); } catch { passed = false; }
  failed ||= !passed;
  process.stdout.write(`${passed ? '통과' : '확인 필요'} · ${name}\n`);
}
process.stdout.write('임시 폴더의 가상 시험 정책으로 한 로컬 연습이며 심판 판정이 아닙니다.\n');
if (failed) process.exitCode = 1;
