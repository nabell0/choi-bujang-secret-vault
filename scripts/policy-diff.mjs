import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 가상 시험 정책(policy/test-policy.json)과 침해 전에 검증한 안전 사본(policy/safe-policy.json)을 비교하고,
// --restore --service <이름> --confirm일 때만 그 서비스 하나의 규칙을 사본 값으로 되돌립니다.
// 쓰는 파일은 시험 정책 하나뿐입니다. 운영 판정기 src/decider.mjs·src/detect.mjs, 설정, DB, 배포는 읽지도 쓰지도 않습니다.
const root = resolve(import.meta.dirname, '..');
const TEST_SCHEMA = 'aleph.test-policy.v1';
const SAFE_SCHEMA = 'aleph.safe-policy.v1';
const MANIFEST_SCHEMA = 'aleph.safe-policy-manifest.v1';

class PolicyStop extends Error {}
const stop = message => { throw new PolicyStop(message); };

// Windows 작업 폴더는 CRLF일 수 있어 줄바꿈을 LF로 맞춘 뒤 해시합니다.
const lf = text => text.replace(/\r\n/gu, '\n');
const sha256 = text => createHash('sha256').update(lf(text), 'utf8').digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const same = (a, b) => canonical(a) === canonical(b);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const shown = path => relative(root, path) || path;

export function defaultPaths() {
  return {
    policy: resolve(root, 'policy', 'test-policy.json'),
    safe: resolve(root, 'policy', 'safe-policy.json'),
    manifest: resolve(root, 'policy', 'safe-policy.manifest.json'),
  };
}

const readText = (path, missing) => (existsSync(path) ? readFileSync(path, 'utf8') : stop(missing));
const parse = (text, label) => { try { return JSON.parse(text); } catch { return stop(`${label}이 JSON이 아닙니다.`); } };

// 사본은 따로 적어 둔 기록(manifest)의 SHA-256·버전과 모두 맞아야 씁니다.
function loadSafe(paths) {
  const manifest = parse(readText(paths.manifest, `사본 기록(${shown(paths.manifest)})을 읽지 못했습니다.`), '사본 기록');
  if (!isRecord(manifest) || manifest.schema !== MANIFEST_SCHEMA || !/^[0-9a-f]{64}$/u.test(manifest.sha256 ?? '')) {
    stop('사본 기록의 형식이 맞지 않습니다.');
  }
  const text = readText(paths.safe, `안전 정책 사본(${shown(paths.safe)})이 없습니다.`);
  const actual = sha256(text);
  if (actual !== manifest.sha256) stop('안전 정책 사본의 SHA-256이 기록과 다릅니다(사본 검증 실패).');
  const safe = parse(text, '안전 정책 사본');
  if (!isRecord(safe) || safe.schema !== SAFE_SCHEMA || !isRecord(safe.services)) stop('안전 정책 사본의 형식이 맞지 않습니다.');
  if (safe.revision !== manifest.revision || safe.verifiedAt !== manifest.verifiedAt) {
    stop('안전 정책 사본의 버전·검증 시각이 기록과 다릅니다.');
  }
  return { safe, sha: actual };
}

function loadTest(paths) {
  const text = readText(paths.policy, `시험 정책(${shown(paths.policy)})이 없습니다.`);
  const policy = parse(text, '시험 정책');
  if (!isRecord(policy) || policy.schema !== TEST_SCHEMA || !isRecord(policy.services) || !Array.isArray(policy.audit)
      || !Number.isInteger(policy.revision)) stop('시험 정책의 형식이 맞지 않습니다.');
  return { policy, text, sha: sha256(text) };
}

// 서비스 하나의 규칙 항목별 차이: 지금 값 → 사본 값.
function ruleChanges(current = {}, safe = {}) {
  return [...new Set([...Object.keys(current), ...Object.keys(safe)])]
    .filter(key => !same(current[key], safe[key]))
    .map(key => ({ key, from: current[key] ?? null, to: safe[key] ?? null }));
}

// 가상 요청 하나를 메모 규칙으로 판단합니다. 실제 API의 소유자 검사(api/notes/[id].js)와는 따로입니다.
export function noteReadDecision(rules, { route, requester, owner }) {
  if (!isRecord(rules) || !Array.isArray(rules.routes) || !rules.routes.includes(route)) return 'deny';
  if (rules.ownerOnly !== false && requester !== owner) return 'deny';
  return 'allow';
}

const show = value => JSON.stringify(value);
const decisionLines = rules => [
  `  B의 A 메모 읽기(GET /notes/:id): ${noteReadDecision(rules, { route: 'GET /notes/:id', requester: 'B', owner: 'A' }) === 'allow' ? '허용' : '거부'}`,
  `  A의 자기 메모 읽기(GET /notes/:id): ${noteReadDecision(rules, { route: 'GET /notes/:id', requester: 'A', owner: 'A' }) === 'allow' ? '허용' : '거부'}`,
  `  메모 목록(GET /notes): ${noteReadDecision(rules, { route: 'GET /notes', requester: 'A', owner: 'A' }) === 'allow' ? '허용' : '거부'}`,
];

function compare(safe, policy) {
  const lines = [];
  for (const service of Object.keys(policy.services)) {
    if (!(service in safe.services)) { lines.push(`  ${service}: 사본에 없는 서비스 (되돌리지 않고 그대로 둠)`); continue; }
    const changes = ruleChanges(policy.services[service], safe.services[service]);
    if (!changes.length) { lines.push(`  ${service}: 사본과 같음`); continue; }
    lines.push(`  ${service}: ${changes.length}개 항목이 사본과 다름`);
    for (const { key, from, to } of changes) lines.push(`    ${key}: ${show(from)} → ${show(to)}`);
  }
  for (const service of Object.keys(safe.services)) {
    if (!(service in policy.services)) lines.push(`  ${service}: 시험 정책에서 빠짐 (복원하면 사본 값으로 다시 생김)`);
  }
  return lines;
}

const header = (safe, sha, paths) => [
  `안전 정책 사본 검증: SHA-256 일치 (${shown(paths.safe)}, ${sha.slice(0, 12)})`,
  `복원할 버전: revision ${safe.revision} · 검증 시각 ${safe.verifiedAt} · 기준 커밋 ${String(safe.sourceCommit).slice(0, 7)}`,
];

export function showDiff(paths = defaultPaths()) {
  const { safe, sha } = loadSafe(paths);
  const { policy } = loadTest(paths);
  return [
    ...header(safe, sha, paths),
    `지금의 시험 정책: ${shown(paths.policy)} (revision ${policy.revision}, 감사 이력 ${policy.audit.length}줄)`,
    '서비스별 규칙:', ...compare(safe, policy),
    '지금 메모 규칙으로 판단한 가상 요청:', ...decisionLines(policy.services.notes),
    '비교만 했습니다. 시험 정책·운영 판정기·설정·DB·배포를 바꾸지 않았습니다.',
  ];
}

export function restoreService(service, confirm, paths = defaultPaths()) {
  if (typeof service !== 'string' || !service) stop('--service <서비스 이름>으로 되돌릴 서비스 하나를 지정해 주세요.');
  const first = loadSafe(paths);
  const firstTest = loadTest(paths);
  if (!(service in first.safe.services)) stop(`안전 정책 사본에 ${service} 서비스가 없습니다. 되돌릴 기준이 없어 중단합니다.`);
  const changes = ruleChanges(firstTest.policy.services[service], first.safe.services[service]);
  const kept = Object.keys(firstTest.policy.services).filter(name => name !== service);
  const out = [
    ...header(first.safe, first.sha, paths),
    `되돌릴 서비스: ${service} (${changes.length}개 항목)`,
    ...changes.map(({ key, from, to }) => `  ${key}: ${show(from)} → ${show(to)}`),
    `그대로 둘 서비스: ${kept.join(', ') || '없음'} · 감사 이력 ${firstTest.policy.audit.length}줄 보존`,
  ];
  if (!changes.length) return [...out, `${service} 규칙이 이미 사본과 같아 아무것도 바꾸지 않았습니다.`];
  if (!confirm) return [...out, `미리보기만 했고 아무것도 바꾸지 않았습니다. 되돌리려면: npm run policy:restore -- --service ${service} --confirm`];

  // 쓰기 직전에 사본과 시험 정책을 다시 읽어, 미리보기 때와 같을 때만 씁니다.
  const again = loadSafe(paths);
  const now = loadTest(paths);
  if (again.sha !== first.sha || now.sha !== firstTest.sha) stop('미리보기 뒤 사본이나 시험 정책이 바뀌었습니다. 복원을 중단합니다.');

  const before = now.policy;
  const entry = {
    at: new Date().toISOString(), action: 'policy_restored', service,
    fromRevision: before.revision, toRevision: before.revision + 1,
    safeRevision: again.safe.revision, safeSha256: again.sha, changes,
  };
  const next = {
    ...before, revision: before.revision + 1,
    services: { ...before.services, [service]: clone(again.safe.services[service]) },
    audit: [...before.audit, entry],
  };
  const body = `${JSON.stringify(next, null, 2)}\n`;
  writeFileSync(paths.policy, now.text.includes('\r\n') ? body.replace(/\n/gu, '\r\n') : body, 'utf8');

  const after = loadTest(paths).policy;
  const othersKept = Object.keys(before.services).filter(name => name !== service)
    .every(name => same(after.services[name], before.services[name]));
  const verified = same(after.services[service], again.safe.services[service]) && othersKept
    && after.audit.length === before.audit.length + 1 && same(after.audit.slice(0, before.audit.length), before.audit);
  if (!verified) {
    writeFileSync(paths.policy, now.text, 'utf8');
    stop('복원 뒤 확인에 실패해 시험 정책을 복원 전 내용으로 되돌렸습니다.');
  }
  return [
    ...out,
    `복원 완료: ${service} 규칙이 사본(revision ${again.safe.revision})과 같습니다. 시험 정책 revision ${before.revision} → ${after.revision}`,
    `확인: 다른 서비스 규칙 그대로 · 이전 감사 이력 ${before.audit.length}줄 그대로 · 감사 이력 한 줄(policy_restored) 추가`,
    ...(service === 'notes' ? ['복원 뒤 메모 규칙으로 판단한 가상 요청:', ...decisionLines(after.services.notes)] : []),
    `쓴 파일: ${shown(paths.policy)} 하나. 운영 판정기 src/decider.mjs·src/detect.mjs, 설정, DB, 배포는 건드리지 않았습니다.`,
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const option = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? resolve(args[at + 1]) : fallback; };
    const defaults = defaultPaths();
    const paths = { policy: option('--policy', defaults.policy), safe: option('--safe', defaults.safe), manifest: option('--manifest', defaults.manifest) };
    const at = args.indexOf('--service');
    const service = at >= 0 ? args[at + 1] : undefined;
    const lines = args.includes('--restore') ? restoreService(service, args.includes('--confirm'), paths) : showDiff(paths);
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (error) {
    const message = error instanceof PolicyStop ? error.message : '정책을 읽는 중 예상하지 못한 오류가 났습니다.';
    process.stderr.write(`중단: ${message}\n복원을 중단합니다. 시험 정책은 바뀌지 않았습니다.\n`);
    process.exitCode = 1;
  }
}
