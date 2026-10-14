import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mock } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

// 로그인 검사와 DB만 가짜로 바꾸고 실제 api/device/[action].js, api/notes.js, api/notes/[id].js, src/decider.mjs를 부릅니다.
// 기기의 인증 장치(패스키)와 브라우저 메모리의 요청 서명 키는 시험용 키로 흉내 냅니다. 실제 계정·토큰·메모는 쓰지 않습니다.
// 로컬 연습이며 배포 확인이나 심판 판정이 아닙니다.
const USER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const USER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const NOTE_A = 'a4000000-0000-4000-8000-00000000000a';
const LOGINS = { 'Bearer fake-login-a': USER_A, 'Bearer fake-login-b': USER_B };
const A = 'Bearer fake-login-a';
const B = 'Bearer fake-login-b';

const db = {
  notes: [{ id: NOTE_A, owner_id: USER_A, title: 'A 시험 메모', content: 'A 시험 내용', created_at: '1', seq: 1 }],
  device_registrations: [],
};

function fakeQuery(table) {
  const state = { op: 'select', filters: [], value: null };
  const matches = row => state.filters.every(([key, value]) => String(row[key]) === String(value));
  const run = () => {
    if (state.op === 'insert') {
      const row = { ...state.value };
      if (table === 'device_registrations') {
        if (db[table].some(item => item.device_id === row.device_id || item.credential_id === row.credential_id)) {
          return { data: null, error: { code: '23505' } };
        }
        Object.assign(row, { status: 'pending', created_at: new Date().toISOString(), decided_at: null });
      }
      db[table].push(row);
      return { data: [{ ...row }], error: null };
    }
    const rows = db[table].filter(matches);
    if (state.op === 'update') rows.forEach(row => Object.assign(row, state.value));
    if (state.op === 'delete') db[table] = db[table].filter(row => !rows.includes(row));
    return { data: rows.map(row => ({ ...row })), error: null };
  };
  const builder = {
    select: () => builder, limit: () => builder, order: () => builder,
    eq: (key, value) => { state.filters.push([key, value]); return builder; },
    insert: value => { state.op = 'insert'; state.value = value; return builder; },
    update: value => { state.op = 'update'; state.value = value; return builder; },
    delete: () => { state.op = 'delete'; return builder; },
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

const config = (await import('../aleph.config.json', { with: { type: 'json' } })).default;
const { default: deviceApi } = await import(new URL('../api/device/[action].js', import.meta.url).href);
const { default: notesApi } = await import(new URL('../api/notes.js', import.meta.url).href);
const { default: noteApi } = await import(new URL('../api/notes/[id].js', import.meta.url).href);
const { decide, RULE_IDS } = await import(new URL('../src/decider.mjs', import.meta.url).href);
const { fixtureRequests } = await import(new URL('./fixture-7.mjs', import.meta.url).href);

const ORIGIN = new URL(config.publicAppUrl).origin;
const sha256 = data => createHash('sha256').update(data).digest();
const b64url = data => Buffer.from(data).toString('base64url');

async function call(handler, { method = 'GET', url, query = {}, login, headers = {}, body }) {
  const response = {
    statusCode: 0, body: undefined, headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  const text = body === undefined ? '' : JSON.stringify(body);
  await handler({ method, url, query, body: body === undefined ? undefined : JSON.parse(text),
    headers: { ...(login ? { authorization: login } : {}), ...(text ? { 'content-length': String(Buffer.byteLength(text)) } : {}), ...headers } }, response);
  return response;
}
const device = (action, method, login, body) => call(deviceApi, { method, url: `/api/device/${action}`, query: { action }, login, body });

// 기기의 인증 장치를 흉내 낸 패스키 하나.
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey, spki: publicKey.export({ type: 'spki', format: 'der' }), credentialId: b64url(randomBytes(32)) };
}
const clientData = (type, challenge, origin = ORIGIN) => b64url(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

async function requestApproval(login, passkey, extra = {}) {
  const { body: { challenge } } = await device('challenge', 'GET', login);
  return device('request', 'POST', login, {
    challenge, credentialId: passkey.credentialId, publicKey: b64url(passkey.spki), algorithm: -7,
    clientDataJSON: clientData('webauthn.create', b64url(sha256(challenge))), ...extra,
  });
}

// 브라우저 메모리의 요청 서명 키를 만들고 패스키로 묶어 기기 확인 결과를 받습니다.
async function verifyThisDevice(login, passkey, { signWith = passkey.privateKey } = {}) {
  const { body: { challenge } } = await device('challenge', 'GET', login);
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const { crv, kty, x, y } = keys.publicKey.export({ format: 'jwk' });
  const thumbprint = b64url(sha256(JSON.stringify({ crv, kty, x, y })));
  const data = clientData('webauthn.get', b64url(sha256(`${challenge}.${thumbprint}`)));
  const authData = Buffer.concat([sha256(new URL(ORIGIN).hostname), Buffer.from([0x05, 0, 0, 0, 1])]);
  const signature = sign('sha256', Buffer.concat([authData, sha256(Buffer.from(data, 'base64url'))]), signWith);
  const response = await device('verify', 'POST', login, {
    challenge, credentialId: passkey.credentialId, authenticatorData: b64url(authData), clientDataJSON: data,
    signature: b64url(signature), sessionKey: { kty, crv, x, y },
  });
  return { response, session: response.body?.session, signingKey: keys.privateKey };
}

// 화면이 보호 요청마다 붙이는 서명 머리글. 서명은 메서드·경로·본문 해시·시각·일회용 값에 대한 것입니다.
function signedHeaders(proof, method, path, body, { signedAt = new Date().toISOString() } = {}) {
  const nonce = b64url(randomBytes(18));
  const bodyHash = createHash('sha256').update(body === undefined ? '' : JSON.stringify(body)).digest('hex');
  const message = ['aleph.device-request.v1', method, path, bodyHash, signedAt, nonce].join('\n');
  const signature = sign('sha256', Buffer.from(message), { key: proof.signingKey, dsaEncoding: 'ieee-p1363' });
  return { 'x-aleph-device-session': proof.session, 'x-aleph-signature': b64url(signature),
    'x-aleph-signed-at': signedAt, 'x-aleph-nonce': nonce };
}
const approve = deviceId => Object.assign(db.device_registrations.find(row => row.device_id === deviceId), { status: 'approved' });
const noteOf = id => db.notes.find(row => row.id === id);

const passkeyA = authenticator();
let deviceIdA;
let proofA;
const validResponse = (request, response) => response && Object.keys(response).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
  && response.schema === 'aleph.decision.v1' && response.requestId === request?.requestId
  && ['allow', 'deny', 'step_up'].includes(response.decision) && /^[a-z][a-z0-9_]{0,63}$/u.test(response.reasonCode)
  && Array.isArray(response.ruleIds) && response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id));

const checks = [
  ['토큰 없는 기기 질문·메모 목록 401 LOGIN_REQUIRED', async () => {
    const [challenge, list] = await Promise.all([device('challenge', 'GET'), call(notesApi, { url: '/api/notes' })]);
    return challenge.statusCode === 401 && list.statusCode === 401 && list.body?.error === 'LOGIN_REQUIRED';
  }],
  ['설치형 앱 서명 없이 보호 요청: 로그인만 한 A의 메모 목록 403 device_not_registered(판정기), 메모 없음', async () => {
    const r = await call(notesApi, { url: '/api/notes', login: A });
    return r.statusCode === 403 && r.body?.error === 'device_not_registered' && !Array.isArray(r.body);
  }],
  ['설치·승인 표시만 붙인 보호 요청(가짜 머리글): 403 device_not_registered, 메모 없음', async () => {
    const r = await call(notesApi, { url: '/api/notes', login: A, headers: {
      'x-app-installed': 'true', 'x-device-approved': 'true', 'x-device-session': 'approved',
      'x-aleph-device-session': 'approved', 'x-aleph-signature': 'badge', 'x-aleph-signed-at': new Date().toISOString(),
      'x-aleph-nonce': 'badgebadgebadgebadge' } });
    return r.statusCode === 403 && r.body?.error === 'device_not_registered' && !Array.isArray(r.body);
  }],
  ['승인 요청은 pending만 만듦: 본문에 status approved를 넣어도 pending', async () => {
    const r = await requestApproval(A, passkeyA, { status: 'approved' });
    deviceIdA = r.body?.deviceId;
    return r.statusCode === 201 && r.body.status === 'pending' && /^[0-9a-f]{16}$/u.test(deviceIdA)
      && db.device_registrations.length === 1 && db.device_registrations[0].status === 'pending';
  }],
  ['승인 대기 기기는 서명이 맞아도 403 DEVICE_PENDING, 기기 확인 결과 없음', async () => {
    const { response } = await verifyThisDevice(A, passkeyA);
    return response.statusCode === 403 && response.body?.error === 'DEVICE_PENDING' && !response.body.session;
  }],
  ['다른 앱 주소에서 만든 승인 요청은 400', async () => {
    const { body: { challenge } } = await device('challenge', 'GET', A);
    const other = authenticator();
    const r = await device('request', 'POST', A, { challenge, credentialId: other.credentialId, publicKey: b64url(other.spki),
      algorithm: -7, clientDataJSON: clientData('webauthn.create', b64url(sha256(challenge)), 'https://evil.example') });
    return r.statusCode === 400 && db.device_registrations.length === 1;
  }],
  ['등록부에서 승인한 뒤(SQL Editor 대역) 확인하면 30분짜리 기기 확인 결과', async () => {
    approve(deviceIdA);
    proofA = await verifyThisDevice(A, passkeyA);
    return proofA.response.statusCode === 200 && proofA.response.body.status === 'approved' && typeof proofA.session === 'string';
  }],
  ['승인된 기기가 승인 요청 단추를 다시 눌러도 409, 응답에 승인 상태·기기 확인 결과 없음', async () => {
    const r = await requestApproval(A, passkeyA);
    return r.statusCode === 409 && r.body?.error === 'DEVICE_ALREADY_REQUESTED'
      && !('status' in r.body) && !r.body.session && db.device_registrations.length === 1;
  }],
  ['다른 키로 서명한 패스키 응답은 401 DEVICE_NOT_VERIFIED', async () => {
    const { response } = await verifyThisDevice(A, passkeyA, { signWith: authenticator().privateKey });
    return response.statusCode === 401 && response.body?.error === 'DEVICE_NOT_VERIFIED';
  }],
  ['승인된 기기의 정상 요청: 서명한 메모 목록 200, 메모 한 건 200', async () => {
    const list = await call(notesApi, { url: '/api/notes', login: A, headers: signedHeaders(proofA, 'GET', '/api/notes') });
    const path = `/api/notes/${NOTE_A}`;
    const one = await call(noteApi, { url: path, query: { id: NOTE_A }, login: A, headers: signedHeaders(proofA, 'GET', path) });
    return list.statusCode === 200 && Array.isArray(list.body) && list.body[0]?.id === NOTE_A
      && one.statusCode === 200 && one.body?.id === NOTE_A;
  }],
  ['서명 뒤 요청 경로를 변경: /api/notes에 한 서명으로 메모 한 건 요청 403 DEVICE_SIGNATURE_INVALID', async () => {
    const r = await call(noteApi, { url: `/api/notes/${NOTE_A}`, query: { id: NOTE_A }, login: A,
      headers: signedHeaders(proofA, 'GET', '/api/notes') });
    return r.statusCode === 403 && r.body?.error === 'DEVICE_SIGNATURE_INVALID' && !('title' in r.body);
  }],
  ['서명 뒤 수정 본문을 변경: 403 DEVICE_SIGNATURE_INVALID, 메모 그대로', async () => {
    const path = `/api/notes/${NOTE_A}`;
    const before = { ...noteOf(NOTE_A) };
    const headers = signedHeaders(proofA, 'PUT', path, { title: 'A 시험 메모', body: '서명한 본문' });
    const r = await call(noteApi, { method: 'PUT', url: path, query: { id: NOTE_A }, login: A, headers,
      body: { title: 'A 시험 메모', body: '바꿔치기한 본문' } });
    return r.statusCode === 403 && r.body?.error === 'DEVICE_SIGNATURE_INVALID' && isDeepStrictEqual(noteOf(NOTE_A), before);
  }],
  ['서명한 본문 그대로의 수정은 200', async () => {
    const path = `/api/notes/${NOTE_A}`;
    const body = { title: 'A 시험 메모', body: '서명한 본문' };
    const r = await call(noteApi, { method: 'PUT', url: path, query: { id: NOTE_A }, login: A,
      headers: signedHeaders(proofA, 'PUT', path, body), body });
    return r.statusCode === 200 && noteOf(NOTE_A).content === '서명한 본문';
  }],
  ['서명 뒤 메서드를 바꾼 삭제 요청 403, 메모 남아 있음', async () => {
    const path = `/api/notes/${NOTE_A}`;
    const r = await call(noteApi, { method: 'DELETE', url: path, query: { id: NOTE_A }, login: A,
      headers: signedHeaders(proofA, 'GET', path) });
    return r.statusCode === 403 && Boolean(noteOf(NOTE_A));
  }],
  ['B가 A의 기기 확인 결과·서명으로 요청 403 device_not_registered', async () => {
    const r = await call(notesApi, { url: '/api/notes', login: B, headers: signedHeaders(proofA, 'GET', '/api/notes') });
    return r.statusCode === 403 && r.body?.error === 'device_not_registered';
  }],
  ['2분 전에 만든 서명 403 DEVICE_SIGNATURE_EXPIRED', async () => {
    const r = await call(notesApi, { url: '/api/notes', login: A,
      headers: signedHeaders(proofA, 'GET', '/api/notes', undefined, { signedAt: new Date(Date.now() - 120000).toISOString() }) });
    return r.statusCode === 403 && r.body?.error === 'DEVICE_SIGNATURE_EXPIRED';
  }],
  ['위조한 기기 확인 결과 403 device_not_registered', async () => {
    const [body, mac] = proofA.session.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = `${b64url(JSON.stringify({ ...payload, exp: Date.now() + 3600000 }))}.${mac}`;
    const r = await call(notesApi, { url: '/api/notes', login: A, headers: signedHeaders({ ...proofA, session: forged }, 'GET', '/api/notes') });
    return r.statusCode === 403 && r.body?.error === 'device_not_registered';
  }],
  ['등록부에서 승인을 거두면 다음 요청부터 403(판정기 device_not_registered)', async () => {
    db.device_registrations[0].status = 'revoked';
    const r = await call(notesApi, { url: '/api/notes', login: A, headers: signedHeaders(proofA, 'GET', '/api/notes') });
    db.device_registrations[0].status = 'approved';
    return r.statusCode === 403 && r.body?.error === 'device_not_registered';
  }],
  ['판정기: 정상 요청 allow, 미등록 deny, 경로 모양이 다른 요청·쿼리 지문이 맞지 않는 요청 거부, ruleIds 모두 RULE_IDS 안', async () => {
    const { normal } = fixtureRequests();
    const cases = [
      [normal, 'allow'],
      [{ ...normal, requestId: crypto.randomUUID(), deviceRegistered: false }, 'deny'],
      [{ ...normal, requestId: crypto.randomUUID(), path: '/notices/demo' }, 'deny'],
      [{ ...normal, requestId: crypto.randomUUID(), method: 'PUT' }, 'deny'],
      [{ ...normal, requestId: crypto.randomUUID(), querySha256: 'f'.repeat(64) }, 'deny'],
      [{ ...normal, requestId: crypto.randomUUID(), queryLength: 3 }, 'deny'],
      [{ ...normal, requestId: crypto.randomUUID(), role: 'instructor' }, 'deny'],
    ];
    for (const [request, decision] of cases) {
      const response = await decide(request);
      if (!validResponse(request, response) || response.decision !== decision) return false;
    }
    return true;
  }],
];

let failed = false;
for (const [name, check] of checks) {
  let passed = false;
  try { passed = await check(); } catch { passed = false; }
  failed ||= !passed;
  process.stdout.write(`${passed ? '통과' : '확인 필요'} · ${name}\n`);
}
process.stdout.write('로그인 검사와 DB, 인증 장치를 가짜로 바꾼 로컬 연습이며 배포 확인이나 심판 판정이 아닙니다.\n');
if (failed) process.exitCode = 1;
