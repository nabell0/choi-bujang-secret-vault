import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// 침해 전에 검증한 안전 정책 사본과 현재 시험 정책의 차이를 보여 주고, --restore로 그 버전에 되돌립니다.
// 되돌리는 범위는 정책 파일 두 개와 aleph.config.json의 allowedRoutes뿐입니다. API·다른 설정·Git 이력·DB·배포는
// 바꾸지 않습니다. 사본은 --create로 새로 만들 때만 쓰고, 있으면 덮어쓰지 않습니다.
const root = resolve(import.meta.dirname, '..');
const SCHEMA = 'aleph.policy-snapshot.v1';
const SNAPSHOT_KEYS = ['policy', 'policySha256', 'schema', 'sourceCommit', 'version'];
const POLICY_KEYS = ['allowedRoutes', 'files', 'resources', 'ruleIds'];
const POLICY_FILES = ['src/decider.mjs', 'src/detect.mjs'];
const CONFIG_FILE = 'aleph.config.json';
const DEFAULT_SNAPSHOT = join(root, 'policy', 'safe-policy.json');
// 감사 기록은 한 줄씩 덧붙이기만 하고 지우거나 고쳐 쓰지 않습니다.
const RESTORE_LOG = join(root, 'policy', 'restore-log.jsonl');
const BACKUP_DIR = join(root, 'artifacts', 'policy-restore');

class PolicyStop extends Error {}
const stop = message => { throw new PolicyStop(message); };
const git = (...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
});
const gitOk = (...args) => { try { git(...args); return true; } catch { return false; } };

// Git은 LF, Windows 작업 폴더는 CRLF로 둘 수 있어 줄바꿈을 맞춘 뒤 해시합니다.
const lf = text => text.replace(/\r\n/gu, '\n');
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const isHex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(value);
const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');

// 정책 = 판정기 규칙 이름·자원 구역, 설정의 허용 경로, 정책 파일의 내용 해시.
async function buildPolicy(read) {
  const deciderSource = read('src/decider.mjs');
  const decider = await import(`data:text/javascript;base64,${Buffer.from(deciderSource, 'utf8').toString('base64')}`);
  if (!isStringList(decider.RULE_IDS)) stop('src/decider.mjs의 RULE_IDS를 읽을 수 없습니다.');
  const config = JSON.parse(read('aleph.config.json'));
  return {
    ruleIds: [...decider.RULE_IDS],
    resources: JSON.parse(JSON.stringify(decider.RESOURCES ?? {})),
    allowedRoutes: isStringList(config.allowedRoutes) ? [...config.allowedRoutes] : [],
    files: Object.fromEntries(POLICY_FILES.map(path => [path, sha256(lf(read(path)))])),
  };
}

const readAtCommit = commit => path => {
  try { return git('show', `${commit}:${path}`); } catch { return stop(`커밋 ${commit.slice(0, 7)}에 ${path}가 없습니다.`); }
};
const readWorkingTree = path => readFileSync(join(root, path), 'utf8');

function resolveCommit(ref) {
  if (typeof ref !== 'string' || !/^[0-9a-f]{7,40}$/u.test(ref)) stop('커밋 번호(16진수 7~40자)를 적어 주세요.');
  if (!gitOk('cat-file', '-e', `${ref}^{commit}`)) stop(`커밋 ${ref}를 이 저장소에서 찾을 수 없습니다.`);
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  if (!gitOk('merge-base', '--is-ancestor', commit, 'HEAD')) stop(`커밋 ${commit.slice(0, 7)}가 현재 HEAD의 이력에 없습니다.`);
  return commit;
}

function checkShape(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || Object.keys(snapshot).sort().join(',') !== SNAPSHOT_KEYS.join(',')) stop('사본의 항목 이름이 형식과 다릅니다.');
  if (snapshot.schema !== SCHEMA) stop(`사본 형식이 ${SCHEMA}가 아닙니다.`);
  if (typeof snapshot.version !== 'string' || !snapshot.version.trim() || snapshot.version.length > 120) {
    stop('사본의 version이 비었거나 너무 깁니다.');
  }
  if (!isHex(snapshot.sourceCommit, 40)) stop('사본의 sourceCommit이 40자리 커밋 번호가 아닙니다.');
  if (!isHex(snapshot.policySha256, 64)) stop('사본의 policySha256이 64자리 SHA-256이 아닙니다.');
  const { policy } = snapshot;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
      || Object.keys(policy).sort().join(',') !== POLICY_KEYS.join(',')
      || !isStringList(policy.ruleIds) || !isStringList(policy.allowedRoutes)
      || !policy.resources || typeof policy.resources !== 'object' || Array.isArray(policy.resources)
      || !policy.files || Object.keys(policy.files).sort().join(',') !== [...POLICY_FILES].sort().join(',')
      || !Object.values(policy.files).every(value => isHex(value, 64))) stop('사본의 policy 내용이 형식과 다릅니다.');
}

async function verifySnapshot(path) {
  const shown = relative(root, path) || path;
  if (!existsSync(path)) stop(`안전 정책 사본(${shown})이 없습니다.`);
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(path, 'utf8')); } catch { stop(`안전 정책 사본(${shown})이 JSON이 아닙니다.`); }
  checkShape(snapshot);
  if (sha256(canonical(snapshot.policy)) !== snapshot.policySha256) stop('사본의 policy 해시가 policySha256과 다릅니다.');
  const commit = resolveCommit(snapshot.sourceCommit);
  const original = await buildPolicy(readAtCommit(commit));
  if (canonical(original) !== canonical(snapshot.policy)) {
    stop(`사본 내용이 커밋 ${commit.slice(0, 7)}의 실제 정책과 다릅니다.`);
  }
  return { snapshot, shown };
}

const listDiff = (before, after) => ({
  added: after.filter(item => !before.includes(item)),
  removed: before.filter(item => !after.includes(item)),
});

function policyDiff(safe, current, commit) {
  const lines = [];
  const rules = listDiff(safe.ruleIds, current.ruleIds);
  for (const id of rules.added) lines.push(`  + 현재에만 있는 규칙 (복원하면 빠짐): ${id}`);
  for (const id of rules.removed) lines.push(`  - 사본에만 있는 규칙 (복원하면 돌아옴): ${id}`);
  const routes = listDiff(safe.allowedRoutes, current.allowedRoutes);
  for (const route of routes.added) lines.push(`  + 현재에만 있는 허용 경로 (복원하면 빠짐): ${route}`);
  for (const route of routes.removed) lines.push(`  - 사본에만 있는 허용 경로 (복원하면 돌아옴): ${route}`);
  for (const id of new Set([...Object.keys(safe.resources), ...Object.keys(current.resources)])) {
    if (!(id in safe.resources)) lines.push(`  + 현재에만 있는 자원 (복원하면 빠짐): ${id}`);
    else if (!(id in current.resources)) lines.push(`  - 사본에만 있는 자원 (복원하면 돌아옴): ${id}`);
    else if (canonical(safe.resources[id]) !== canonical(current.resources[id])) {
      lines.push(`  ~ 구역·경로가 다른 자원 (복원하면 사본 값으로): ${id}`);
    }
  }
  for (const path of POLICY_FILES) {
    if (safe.files[path] === current.files[path]) continue;
    const [added = '?', removed = '?'] = git('diff', '--numstat', commit, '--', path).trim().split(/\s+/u);
    lines.push(`  ~ 사본과 다른 정책 파일 (복원하면 사본 내용으로): ${path} (사본 대비 +${added} -${removed}줄)`);
  }
  return lines;
}

async function createSnapshot(ref, path) {
  if (existsSync(path)) stop(`${relative(root, path)}가 이미 있습니다. 검증한 사본은 덮어쓰지 않습니다.`);
  const commit = resolveCommit(ref);
  const policy = await buildPolicy(readAtCommit(commit));
  const version = git('log', '-1', '--format=%s', commit).trim().slice(0, 120) || commit.slice(0, 7);
  const snapshot = { schema: SCHEMA, version, sourceCommit: commit, policy, policySha256: sha256(canonical(policy)) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`안전 정책 사본 생성: ${relative(root, path)}\n버전: ${version} (커밋 ${commit.slice(0, 7)})\n`
    + `규칙 ${policy.ruleIds.length}개 · 허용 경로 ${policy.allowedRoutes.length}개 · 정책 해시 ${snapshot.policySha256.slice(0, 12)}\n`);
}

async function showDiff(path) {
  const { snapshot, shown } = await verifySnapshot(path);
  const current = await buildPolicy(readWorkingTree);
  const head = git('rev-parse', '--short', 'HEAD').trim();
  const lines = policyDiff(snapshot.policy, current, snapshot.sourceCommit);
  process.stdout.write([
    `안전 정책 사본 검증 통과: ${shown}`,
    `복원할 버전: ${snapshot.version} (커밋 ${snapshot.sourceCommit.slice(0, 7)}, 정책 해시 ${snapshot.policySha256.slice(0, 12)})`,
    `현재 시험 정책: 작업 폴더 (HEAD ${head}, 커밋하지 않은 변경 포함)`,
    lines.length ? `변경 범위 ${lines.length}건:` : '변경 범위: 차이 없음. 복원할 것이 없습니다.',
    ...lines,
    lines.length ? `파일 내용은 git diff ${snapshot.sourceCommit.slice(0, 7)} -- src/decider.mjs src/detect.mjs 로 볼 수 있습니다.` : null,
    '이 명령은 비교만 하며 파일·DB·배포·운영 정책을 바꾸지 않았습니다.',
  ].filter(Boolean).join('\n') + '\n');
}

const restoreTargets = (safe, current) => [
  ...POLICY_FILES.filter(path => safe.files[path] !== current.files[path]),
  ...(canonical(safe.allowedRoutes) !== canonical(current.allowedRoutes) ? [CONFIG_FILE] : []),
];
const describeTarget = (path, commit) => (path === CONFIG_FILE
  ? `  ${CONFIG_FILE}: allowedRoutes만 사본 값으로 (다른 설정 항목은 그대로)`
  : `  ${path}: 파일 전체를 커밋 ${commit.slice(0, 7)}의 내용으로`);
const KEPT = '그대로 두는 것: api/ 서버 함수와 메모 소유자 검사, aleph.config.json의 다른 항목, Git 이력, '
  + 'policy/restore-log.jsonl의 기존 기록, DB·배포';
// 작업 폴더 파일의 줄바꿈(CRLF/LF)을 유지해 Git에 내용 없는 변경이 생기지 않게 합니다.
const withEolOf = (text, existing) => (existing.includes('\r\n') ? lf(text).replace(/\n/gu, '\r\n') : lf(text));

async function previewRestore(path) {
  const { snapshot, shown } = await verifySnapshot(path);
  const current = await buildPolicy(readWorkingTree);
  const lines = policyDiff(snapshot.policy, current, snapshot.sourceCommit);
  const targets = restoreTargets(snapshot.policy, current);
  const out = [
    `안전 정책 사본 검증 통과: ${shown}`,
    `복원할 버전: ${snapshot.version} (커밋 ${snapshot.sourceCommit.slice(0, 7)}, 정책 해시 ${snapshot.policySha256.slice(0, 12)})`,
  ];
  if (!targets.length) {
    out.push('바뀔 항목: 없음. 현재 시험 정책이 사본과 같아 복원할 것이 없습니다.');
  } else {
    out.push(`바뀔 항목 ${lines.length}건:`, ...lines, '바뀔 파일:', ...targets.map(item => describeTarget(item, snapshot.sourceCommit)),
      KEPT, `미리보기만 했고 아무것도 바꾸지 않았습니다. 적용하려면: npm run policy:restore -- --apply ${snapshot.policySha256.slice(0, 12)}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

async function applyRestore(path, confirm) {
  const { snapshot } = await verifySnapshot(path);
  if (confirm !== snapshot.policySha256.slice(0, 12)) {
    stop('확인 값이 사본의 정책 해시 앞 12자리와 다릅니다. 먼저 npm run policy:restore로 바뀔 항목을 확인해 주세요.');
  }
  const before = await buildPolicy(readWorkingTree);
  const lines = policyDiff(snapshot.policy, before, snapshot.sourceCommit);
  const targets = restoreTargets(snapshot.policy, before);
  if (!targets.length) {
    process.stdout.write('바뀔 항목이 없어 복원하지 않았습니다.\n');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const backup = join(BACKUP_DIR, stamp);
  const fromCommit = readAtCommit(snapshot.sourceCommit);
  for (const file of targets) {
    const existing = readWorkingTree(file);
    mkdirSync(dirname(join(backup, file)), { recursive: true });
    writeFileSync(join(backup, file), existing, { encoding: 'utf8', flag: 'wx' });
    const restored = file === CONFIG_FILE
      ? `${JSON.stringify({ ...JSON.parse(existing), allowedRoutes: [...snapshot.policy.allowedRoutes] }, null, 2)}\n`
      : fromCommit(file);
    writeFileSync(join(root, file), withEolOf(restored, existing), 'utf8');
  }
  const after = await buildPolicy(readWorkingTree);
  const verified = canonical(after) === canonical(snapshot.policy);
  mkdirSync(dirname(RESTORE_LOG), { recursive: true });
  appendFileSync(RESTORE_LOG, `${JSON.stringify({
    at: new Date().toISOString(), result: verified ? 'restored' : 'verify_failed',
    version: snapshot.version, sourceCommit: snapshot.sourceCommit, policySha256: snapshot.policySha256,
    head: git('rev-parse', 'HEAD').trim(), files: targets, changes: lines.map(line => line.trim()),
  })}\n`, 'utf8');
  const kept = relative(root, backup);
  if (!verified) stop(`복원 뒤 정책이 사본과 다릅니다. 복원 전 파일은 ${kept}에 있습니다.`);
  process.stdout.write([
    `복원 완료: ${snapshot.version} (커밋 ${snapshot.sourceCommit.slice(0, 7)}) · 복원 뒤 정책이 사본과 같음을 확인했습니다.`,
    '바뀐 파일:', ...targets.map(item => describeTarget(item, snapshot.sourceCommit)),
    KEPT,
    `복원 전 파일: ${kept} (Git 제외) · 감사 기록: ${relative(root, RESTORE_LOG)}에 한 줄 추가`,
    '다음으로 npm run decider:test, npm run detect:test, npm run owner:check를 실행해 규칙과 소유자 검사를 확인하세요.',
  ].join('\n') + '\n');
}

try {
  const args = process.argv.slice(2);
  const at = args.indexOf('--snapshot');
  const path = at >= 0 && args[at + 1] ? resolve(args[at + 1]) : DEFAULT_SNAPSHOT;
  const create = args.indexOf('--create');
  const apply = args.indexOf('--apply');
  if (create >= 0) await createSnapshot(args[create + 1], path);
  else if (apply >= 0) await applyRestore(path, args[apply + 1]);
  else if (args.includes('--restore')) await previewRestore(path);
  else await showDiff(path);
} catch (error) {
  const message = error instanceof PolicyStop ? error.message : '정책을 읽는 중 예상하지 못한 오류가 났습니다.';
  process.stderr.write(`중단: ${message}\n비교·복원을 여기서 멈췄습니다.\n`);
  process.exitCode = 1;
}
