import { mock } from 'node:test';

// 로그인 검사와 DB만 가짜로 바꾸고 실제 api/notes/[id].js와 src/decider.mjs를 부릅니다.
// 실제 계정·토큰·메모는 쓰지 않습니다. 로컬 연습이며 배포 확인이나 심판 판정이 아닙니다.
const USER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const USER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const NOTE_A = 'a4000000-0000-4000-8000-00000000000a';
const NOTE_B = 'b4000000-0000-4000-8000-000000000001';
const LOGINS = { 'Bearer fake-login-a': USER_A, 'Bearer fake-login-b': USER_B };

const notes = new Map([
  [NOTE_A, { id: NOTE_A, title: 'A 시험 메모', content: 'A 시험 내용', owner_id: USER_A }],
  [NOTE_B, { id: NOTE_B, title: 'B 시험 메모', content: 'B 시험 내용', owner_id: USER_B }],
]);

function fakeQuery() {
  const state = { op: 'select', filters: [], patch: null };
  const run = () => {
    const rows = [...notes.values()].filter(row => state.filters.every(([key, value]) => String(row[key]) === String(value)));
    if (state.op === 'update') rows.forEach(row => Object.assign(row, state.patch));
    if (state.op === 'delete') rows.forEach(row => notes.delete(row.id));
    return { data: rows.map(row => ({ ...row })), error: null };
  };
  const builder = {
    select: () => builder, limit: () => builder, order: () => builder,
    eq: (key, value) => { state.filters.push([key, value]); return builder; },
    update: patch => { state.op = 'update'; state.patch = patch; return builder; },
    delete: () => { state.op = 'delete'; return builder; },
    then: (resolve, reject) => { try { resolve(run()); } catch (error) { reject(error); } },
  };
  return builder;
}

mock.module(import.meta.resolve('@supabase/supabase-js'), {
  namedExports: { createClient: () => ({ from: () => fakeQuery() }) },
});
mock.module(new URL('../src/verify-login.mjs', import.meta.url).href, {
  namedExports: {
    createLoginVerifier: () => async authorization => (LOGINS[authorization]
      ? { kind: 'student', userId: LOGINS[authorization] } : null),
  },
});
// 11단계 기기 확인은 scripts/device-check.mjs가 따로 시험합니다. 여기서는 승인된 기기로 두고 소유자 검사만 봅니다.
mock.module(new URL('../src/device-auth.mjs', import.meta.url).href, {
  namedExports: { requireApprovedDevice: async () => true },
});
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SECRET_KEY = 'fake-server-key-for-local-check';

const { default: handler } = await import(new URL('../api/notes/[id].js', import.meta.url).href);
const { decide } = await import(new URL('../src/decider.mjs', import.meta.url).href);
const { fixtureRequests } = await import(new URL('./fixture-7.mjs', import.meta.url).href);

async function call({ method = 'GET', id, login, headers = {}, query = {}, body }) {
  const response = {
    statusCode: 0, body: undefined, headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method, query: { ...query, id }, body,
    headers: { ...(login ? { authorization: login } : {}), ...headers } }, response);
  return response;
}

const A = 'Bearer fake-login-a';
const B = 'Bearer fake-login-b';
const forged = { 'x-user-id': USER_A, 'x-role': 'instructor', 'x-owner-id': USER_A };
const checks = [
  ['A의 정상 요청: 자기 메모 읽기 200', async () => {
    const r = await call({ id: NOTE_A, login: A });
    return r.statusCode === 200 && r.body?.id === NOTE_A && r.headers['x-aleph-resource']?.startsWith('notes.own');
  }],
  ['B의 A 메모 읽기 403 NOT_NOTE_OWNER', async () => {
    const r = await call({ id: NOTE_A, login: B });
    return r.statusCode === 403 && r.body?.error === 'NOT_NOTE_OWNER' && !('title' in r.body);
  }],
  ['B가 헤더·쿼리의 role·owner_id를 위조해도 A 메모 읽기 403', async () => {
    const r = await call({ id: NOTE_A, login: B, headers: forged, query: { owner_id: USER_A, role: 'instructor' } });
    return r.statusCode === 403 && !('title' in r.body);
  }],
  ['B의 A 메모 수정 403, A 메모 그대로', async () => {
    const r = await call({ method: 'PUT', id: NOTE_A, login: B, body: { title: 'B가 바꿈', body: 'B가 바꿈' } });
    return r.statusCode === 403 && notes.get(NOTE_A).title === 'A 시험 메모';
  }],
  ['B가 본문에 A의 owner_id를 넣은 수정 403', async () => {
    const r = await call({ method: 'PUT', id: NOTE_A, login: B, body: { title: 'x', body: 'y', owner_id: USER_A } });
    return r.statusCode === 403 && notes.get(NOTE_A).owner_id === USER_A;
  }],
  ['B의 A 메모 삭제 403, A 메모 남아 있음', async () => {
    const r = await call({ method: 'DELETE', id: NOTE_A, login: B });
    return r.statusCode === 403 && notes.has(NOTE_A);
  }],
  ['A의 정상 요청: 자기 메모 수정 200', async () => {
    const r = await call({ method: 'PUT', id: NOTE_A, login: A, body: { title: 'A 시험 메모', body: 'A가 고침' } });
    return r.statusCode === 200 && notes.get(NOTE_A).owner_id === USER_A;
  }],
  ['토큰 없는 요청 401 LOGIN_REQUIRED', async () => {
    const r = await call({ id: NOTE_A });
    return r.statusCode === 401 && r.body?.error === 'LOGIN_REQUIRED';
  }],
  ['판정기: A의 정상 메모 단건 요청 allow', async () => (await decide(fixtureRequests().normal)).decision === 'allow'],
];

let failed = false;
for (const [name, check] of checks) {
  let passed = false;
  try { passed = await check(); } catch { passed = false; }
  failed ||= !passed;
  process.stdout.write(`${passed ? '통과' : '확인 필요'} · ${name}\n`);
}
process.stdout.write('로그인 검사와 DB를 가짜로 바꾼 로컬 연습이며 배포 확인이나 심판 판정이 아닙니다.\n');
if (failed) process.exitCode = 1;
