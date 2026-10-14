import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mock } from 'node:test';

// 로그인 검사와 DB만 가짜로 바꾸고 실제 api/restore/notes/[id].js를 부릅니다. 복원 대상은 B 시험 메모 한 건뿐입니다.
// 실제 계정·토큰·메모는 쓰지 않습니다. 로컬 연습이며 배포 확인이나 심판 판정이 아닙니다.
const USER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const USER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const NOTE_B = 'b4000000-0000-4000-8000-000000000001';
const NOTE_A1 = 'a4000000-0000-4000-8000-000000000001';
const NOTE_A2 = 'a4000000-0000-4000-8000-000000000002';
const LOGINS = { 'Bearer fake-login-a': USER_A, 'Bearer fake-login-b': USER_B };
// SQL과 따로 쓴 같은 식: SHA-256("<제목 UTF-8 바이트 수>:<제목><내용>")
const hash = (title, content) => createHash('sha256')
  .update(`${Buffer.byteLength(title, 'utf8')}:${title}${content}`, 'utf8').digest('hex');

const note = (id, owner, title, content) => ({ id, owner_id: owner, title, content });
const db = {
  notes: [
    note(NOTE_A1, USER_A, 'A 시험 메모 1', 'A 시험 내용 1'),
    note(NOTE_A2, USER_A, 'A 시험 메모 2', 'A 시험 내용 2'),
    note(NOTE_B, USER_B, 'B 시험 메모', 'B 계정의 시험 내용'),
  ],
  notes_backup: [],
  note_restore_audit: [],
};
db.notes_backup = db.notes.map(row => ({ ...row, content_sha256: hash(row.title, row.content) }));

function fakeQuery(table) {
  const state = { op: 'select', filters: [], value: null };
  const rows = () => db[table].filter(row => state.filters.every(([key, value]) => String(row[key]) === String(value)));
  const run = () => {
    if (state.op === 'insert') { db[table].push({ ...state.value }); return { data: [{ ...state.value }], error: null }; }
    if (state.op === 'upsert') {
      const at = db[table].findIndex(row => row.id === state.value.id);
      const next = { ...(at >= 0 ? db[table][at] : {}), ...state.value };
      if (at >= 0) db[table][at] = next; else db[table].push(next);
      return { data: [{ ...next }], error: null };
    }
    return { data: rows().map(row => ({ ...row })), error: null };
  };
  const builder = {
    select: () => builder, limit: () => builder, order: () => builder,
    eq: (key, value) => { state.filters.push([key, value]); return builder; },
    insert: value => { state.op = 'insert'; state.value = value; return builder; },
    upsert: value => { state.op = 'upsert'; state.value = value; return builder; },
    then: (resolve, reject) => { try { resolve(run()); } catch (error) { reject(error); } },
  };
  return builder;
}

mock.module(import.meta.resolve('@supabase/supabase-js'), {
  namedExports: { createClient: () => ({ from: table => fakeQuery(table) }) },
});
mock.module(new URL('../src/verify-login.mjs', import.meta.url).href, {
  namedExports: {
    createLoginVerifier: () => async authorization => (LOGINS[authorization]
      ? { kind: 'student', userId: LOGINS[authorization] } : null),
  },
});
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SECRET_KEY = 'fake-server-key-for-local-check';
const { default: handler } = await import(new URL('../api/restore/notes/[id].js', import.meta.url).href);

async function call({ method = 'POST', id = NOTE_B, login, body, query = {} }) {
  const response = {
    statusCode: 0, body: undefined, headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method, query: { ...query, id }, body, headers: login ? { authorization: login } : {} }, response);
  return response;
}

const A = 'Bearer fake-login-a';
const B = 'Bearer fake-login-b';
const copyOfB = { ...db.notes_backup.find(row => row.id === NOTE_B) };
const others = () => db.notes.filter(row => row.id !== NOTE_B).map(row => ({ ...row }));
const noteB = () => db.notes.find(row => row.id === NOTE_B);
const matchesCopy = row => Boolean(row) && row.id === copyOfB.id && row.owner_id === copyOfB.owner_id
  && hash(row.title, row.content) === copyOfB.content_sha256;
const tamperB = () => Object.assign(noteB(), { title: '변조된 제목', content: '변조된 내용' });
const deleteB = () => { db.notes = db.notes.filter(row => row.id !== NOTE_B); };

const checks = [
  ['B 메모를 변조한 뒤 B가 복원: 200, ID·소유자·내용 해시가 사본과 같음, 다른 메모 그대로', async () => {
    tamperB();
    const before = others();
    const auditBefore = db.note_restore_audit.length;
    const r = await call({ login: B });
    return r.statusCode === 200 && r.body?.contentSha256 === copyOfB.content_sha256 && matchesCopy(noteB())
      && isDeepStrictEqual(others(), before) && db.note_restore_audit.length === auditBefore + 1
      && db.note_restore_audit.at(-1).result === 'restored';
  }],
  ['B 메모를 삭제한 뒤 B가 복원: 같은 ID로 다시 생김, 다른 메모 그대로', async () => {
    deleteB();
    const before = others();
    const r = await call({ login: B });
    return r.statusCode === 200 && matchesCopy(noteB()) && isDeepStrictEqual(others(), before);
  }],
  ['A가 B 메모 복원 시도: 403 NOT_NOTE_OWNER, 메모 바뀌지 않음', async () => {
    tamperB();
    const snapshot = db.notes.map(row => ({ ...row }));
    const r = await call({ login: A });
    return r.statusCode === 403 && r.body?.error === 'NOT_NOTE_OWNER' && isDeepStrictEqual(db.notes, snapshot)
      && db.note_restore_audit.at(-1).result === 'denied_not_owner';
  }],
  ['B가 본문·쿼리에 A의 owner_id를 넣어도 B 사본으로만 복원', async () => {
    const r = await call({ login: B, body: { owner_id: USER_A }, query: { owner_id: USER_A } });
    return r.statusCode === 200 && matchesCopy(noteB()) && noteB().owner_id === USER_B;
  }],
  ['B가 A 메모 복원 시도: 403, A 메모 그대로', async () => {
    const before = others();
    const r = await call({ login: B, id: NOTE_A1 });
    return r.statusCode === 403 && isDeepStrictEqual(others(), before);
  }],
  ['사본 해시가 맞지 않으면 409 BACKUP_VERIFY_FAILED, 메모 바뀌지 않음', async () => {
    tamperB();
    const copy = db.notes_backup.find(row => row.id === NOTE_B);
    const original = copy.content;
    copy.content = '사본까지 변조';
    const snapshot = db.notes.map(row => ({ ...row }));
    const r = await call({ login: B });
    copy.content = original;
    return r.statusCode === 409 && r.body?.error === 'BACKUP_VERIFY_FAILED' && isDeepStrictEqual(db.notes, snapshot);
  }],
  ['감사 기록은 덧붙기만 하고 앞의 기록은 그대로', async () => {
    const earlier = db.note_restore_audit.map(row => ({ ...row }));
    await call({ login: B });
    return db.note_restore_audit.length === earlier.length + 1
      && isDeepStrictEqual(db.note_restore_audit.slice(0, earlier.length), earlier)
      && db.note_restore_audit.every(row => !('title' in row) && !('content' in row));
  }],
  ['사본은 복원 뒤에도 그대로', async () => isDeepStrictEqual(db.notes_backup.find(row => row.id === NOTE_B), copyOfB)],
  ['토큰 없는 요청 401, GET 405, UUID 아닌 ID 400, 사본 없는 ID 404', async () => {
    const results = await Promise.all([
      call({}), call({ method: 'GET', login: B }), call({ login: B, id: 'export' }),
      call({ login: B, id: 'b4000000-0000-4000-8000-0000000000ff' }),
    ]);
    return results.map(r => r.statusCode).join(',') === '401,405,400,404';
  }],
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
