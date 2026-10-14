// 11단계 기기 승인. 기기 키는 기기의 인증 장치(패스키) 안에 있고 서버에는 공개키만 등록부에 올라갑니다.
// 등록은 'pending'만 만들며, 승인은 Supabase SQL Editor에서만 합니다(supabase/step11-devices.sql).
// 승인된 기기가 패스키로 묶은 요청 서명 키로 메서드·경로·본문 해시에 서명해야 보호 자료 API가 열립니다.
// 개인키·로그인 토큰·서명 원문·메모 내용은 저장하거나 로그에 남기지 않습니다.
import { createHash, createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import { decide, resourceForApiRoute } from './decider.mjs';
import { dbFailure, deviceTable, sendError } from './notes-server.mjs';

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const SIGNATURE_SKEW_MS = 60 * 1000;
const ES256 = -7;
const SIGNED_REQUEST = 'aleph.device-request.v1';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const B64URL = /^[A-Za-z0-9_-]+$/u;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/u;
const DEVICE_ID = /^[0-9a-f]{16}$/u;

const sha256 = data => createHash('sha256').update(data).digest();
const sha256Hex = data => createHash('sha256').update(data).digest('hex');
const b64url = buffer => Buffer.from(buffer).toString('base64url');
const fromB64url = (value, max = 4096) => (typeof value === 'string' && value.length <= max && B64URL.test(value)
  ? Buffer.from(value, 'base64url') : null);
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// 질문·기기 확인 결과에 붙이는 서버 서명. 서버 전용 키에서 용도를 나눠 만든 값이며 밖으로 나가지 않습니다.
const serverKey = () => createHmac('sha256', process.env.SUPABASE_SECRET_KEY ?? '').update('aleph-device-v1').digest();
function seal(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac('sha256', serverKey()).update(body).digest())}`;
}
function open(token, kind, userId) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  if (!sameText(mac, b64url(createHmac('sha256', serverKey()).update(body).digest()))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (payload?.k !== kind || payload.u !== userId || !Number.isSafeInteger(payload.exp) || payload.exp <= Date.now()) return null;
  return payload;
}

// 패스키 질문을 받아도 되는 앱 주소: 설정의 공개 주소와 이 배포의 Vercel 주소뿐입니다.
function allowedOrigins() {
  const origins = new Set([new URL(config.publicAppUrl).origin]);
  for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = process.env[name];
    if (typeof host === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/iu.test(host)) origins.add(`https://${host.toLowerCase()}`);
  }
  return origins;
}

function readClientData(encoded, type, expectedChallenge) {
  const raw = fromB64url(encoded);
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw.toString('utf8')); } catch { return null; }
  if (data?.type !== type || data.crossOrigin === true || !allowedOrigins().has(data.origin)
      || !sameText(data.challenge, expectedChallenge)) return null;
  return { raw, origin: data.origin };
}

// 요청 서명 키(브라우저 메모리의 내보낼 수 없는 키)의 공개 JWK. RFC 7638 순서로 지문을 만듭니다.
function readSessionKey(jwk) {
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk
      || !fromB64url(jwk.x, 64) || !fromB64url(jwk.y, 64)) return null;
  const key = { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
  try { createPublicKey({ key, format: 'jwk' }); } catch { return null; }
  return { key, thumbprint: b64url(sha256(JSON.stringify(key))) };
}

const readBody = request => {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
};

const ownDevices = userId => deviceTable().select('device_id, credential_id, status, created_at')
  .eq('owner_id', userId).order('created_at');

// GET /api/device/challenge: 2분짜리 일회용 질문과 이 계정의 등록 기기 목록(확인 코드·상태).
export async function deviceChallenge(login, response) {
  const userId = login.userId.toLowerCase();
  const { data, error } = await ownDevices(userId);
  if (error) return dbFailure(response, error, 'DEVICE_REGISTRY_UNAVAILABLE');
  const challenge = seal({ k: 'challenge', u: userId, n: b64url(randomBytes(18)), exp: Date.now() + CHALLENGE_TTL_MS });
  return response.status(200).json({
    challenge,
    devices: data.map(row => ({ deviceId: row.device_id, credentialId: row.credential_id, status: row.status })),
  });
}

// POST /api/device/request: 새 패스키의 공개키를 'pending'으로만 올립니다. 본문의 status 같은 값은 읽지 않습니다.
export async function requestDevice(login, request, response) {
  const userId = login.userId.toLowerCase();
  const body = readBody(request);
  const challenge = open(body?.challenge, 'challenge', userId);
  if (!challenge) return sendError(response, 400, 'DEVICE_CHALLENGE_INVALID', '질문이 만료되었습니다. 다시 시도해 주세요.');
  const clientData = readClientData(body.clientDataJSON, 'webauthn.create', b64url(sha256(body.challenge)));
  const credentialId = typeof body.credentialId === 'string' && /^[A-Za-z0-9_-]{16,1024}$/u.test(body.credentialId)
    ? body.credentialId : null;
  const spki = fromB64url(body.publicKey, 1024);
  let publicKey = null;
  try { publicKey = spki && createPublicKey({ key: spki, format: 'der', type: 'spki' }); } catch { publicKey = null; }
  if (!clientData || !credentialId || body.algorithm !== ES256 || publicKey?.asymmetricKeyType !== 'ec'
      || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    return sendError(response, 400, 'DEVICE_REQUEST_INVALID', '기기 승인 요청 형식이 맞지 않습니다.');
  }
  const deviceId = sha256Hex(credentialId).slice(0, 16);
  const { error } = await deviceTable()
    .insert({ device_id: deviceId, owner_id: userId, credential_id: credentialId, public_key_spki: b64url(spki) });
  if (error?.code === '23505') {
    const { data, error: readError } = await deviceTable().select('owner_id, status').eq('device_id', deviceId).limit(1);
    if (readError) return dbFailure(response, readError, 'DEVICE_REGISTRY_UNAVAILABLE');
    if (data[0]?.owner_id !== userId) return sendError(response, 409, 'DEVICE_TAKEN');
    // 승인 요청 응답은 승인 상태를 알려 주지 않습니다. 승인 여부는 /api/device/verify의 서버 확인으로만 받습니다.
    return response.status(409).json({ error: 'DEVICE_ALREADY_REQUESTED', deviceId,
      message: '이 기기는 이미 승인을 요청했습니다. 「승인 상태 확인」을 눌러 주세요.' });
  }
  if (error) return dbFailure(response, error, 'DEVICE_REGISTRY_UNAVAILABLE');
  return response.status(201).json({ deviceId, status: 'pending' });
}

// POST /api/device/verify: 패스키 서명을 등록부의 공개키로 검증하고, 'approved'인 기기에만 30분짜리 기기 확인 결과를 줍니다.
export async function verifyDevice(login, request, response) {
  const userId = login.userId.toLowerCase();
  const body = readBody(request);
  const notVerified = () => sendError(response, 401, 'DEVICE_NOT_VERIFIED', '이 기기를 확인하지 못했습니다.');
  if (!open(body?.challenge, 'challenge', userId)) {
    return sendError(response, 400, 'DEVICE_CHALLENGE_INVALID', '질문이 만료되었습니다. 다시 시도해 주세요.');
  }
  const sessionKey = readSessionKey(body.sessionKey);
  if (!sessionKey) return notVerified();
  const clientData = readClientData(body.clientDataJSON, 'webauthn.get',
    b64url(sha256(`${body.challenge}.${sessionKey.thumbprint}`)));
  const authData = fromB64url(body.authenticatorData, 1024);
  const signature = fromB64url(body.signature, 512);
  if (!clientData || !authData || authData.length < 37 || !signature
      || !authData.subarray(0, 32).equals(sha256(new URL(clientData.origin).hostname)) || !(authData[32] & 0x01)
      || typeof body.credentialId !== 'string' || !/^[A-Za-z0-9_-]{16,1024}$/u.test(body.credentialId)) return notVerified();

  const { data, error } = await deviceTable().select('device_id, owner_id, public_key_spki, status')
    .eq('credential_id', body.credentialId).eq('owner_id', userId).limit(1);
  if (error) return dbFailure(response, error, 'DEVICE_REGISTRY_UNAVAILABLE');
  const row = data[0];
  if (!row || row.owner_id !== userId) return notVerified();
  let valid = false;
  try {
    const key = createPublicKey({ key: Buffer.from(row.public_key_spki, 'base64url'), format: 'der', type: 'spki' });
    valid = verify('sha256', Buffer.concat([authData, sha256(clientData.raw)]), key, signature);
  } catch { valid = false; }
  if (!valid) return notVerified();
  if (row.status === 'pending') {
    return response.status(403).json({ error: 'DEVICE_PENDING', deviceId: row.device_id, status: 'pending' });
  }
  if (row.status !== 'approved') {
    return response.status(403).json({ error: 'DEVICE_REVOKED', deviceId: row.device_id, status: row.status });
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const session = seal({ k: 'session', u: userId, d: row.device_id, x: sessionKey.key.x, y: sessionKey.key.y, exp: expiresAt });
  return response.status(200).json({ deviceId: row.device_id, status: 'approved', session,
    expiresAt: new Date(expiresAt).toISOString() });
}

const header = (request, name) => {
  const value = request.headers?.[name];
  return typeof value === 'string' ? value : null;
};

// 서명에 넣는 본문: 본문이 없으면 빈 문자열, 있으면 받은 JSON을 다시 직렬화한 값(브라우저의 JSON.stringify와 같음).
function signedBody(request) {
  const length = Number(header(request, 'content-length') ?? 0);
  const body = request.body;
  if (body === undefined || body === null || body === '' || (!length && !header(request, 'transfer-encoding'))) return '';
  if (typeof body === 'string') {
    try { return JSON.stringify(JSON.parse(body)); } catch { return body; }
  }
  return JSON.stringify(body);
}

// 판정기 계약(docs/DECIDER_REQUEST.md)의 18개 이름만 채워 보냅니다. 서명·등록부를 서버가 확인한 결과만 넣습니다.
function decisionRequest({ method, apiPath, pathname, search, userId, deviceId, registered }) {
  const resource = resourceForApiRoute(method, apiPath);
  const query = search.startsWith('?') ? search.slice(1) : search;
  return {
    schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'class_app', projectId: 'project_app',
    subjectId: `subject_${sha256Hex(userId).slice(0, 32)}`, deviceId,
    service: resource ? resourceService(resource.id) : 'unknown', method,
    path: pathname.replace(/^\/api(?=\/)/u, ''), route: `${method} ${apiPath.replace(/^\/api(?=\/)/u, '')}`,
    queryLength: query.length, querySha256: query ? sha256Hex(query) : EMPTY_SHA256,
    at: new Date().toISOString(), policyRevision: config.step, deviceRegistered: registered,
    stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
    signals: { source: 'none', region: 'unknown', network: 'unknown', hour: null },
  };
}
const resourceService = id => ({ 'notes.own': 'notes', 'notices.class': 'notices', 'notices.admin': 'notices_admin' }[id] ?? 'unknown');

// 보호 자료 API가 로그인 확인 다음, 자료를 읽거나 쓰기 전에 부릅니다. false면 JSON 오류를 이미 보냈습니다.
export async function requireApprovedDevice(request, response, login, apiPath) {
  const refuse = (error, message) => { sendError(response, 403, error, message); return false; };
  const userId = login.userId.toLowerCase();
  let target;
  try { target = new URL(request.url ?? '', 'https://app.invalid'); } catch { target = new URL('https://app.invalid/'); }
  // 기기 확인 결과·요청 서명이 없거나 서버가 봉한 값이 아니면 등록 기기가 아닌 것으로 판정기에 묻고 거부합니다.
  // 화면 표시·설치 여부·요청 머리글의 다른 값은 근거로 쓰지 않습니다.
  const judgeDevice = async (deviceId, registered) => decide(decisionRequest({
    method: String(request.method).toUpperCase(), apiPath, pathname: target.pathname, search: target.search,
    userId, deviceId, registered,
  }));
  const notRegistered = async deviceId => {
    await judgeDevice(deviceId ?? sha256Hex('none').slice(0, 16), false);
    return refuse('device_not_registered', '서버가 이 기기를 등록·승인된 기기로 확인하지 않았습니다.');
  };
  const session = header(request, 'x-aleph-device-session');
  const signature = header(request, 'x-aleph-signature');
  const signedAt = header(request, 'x-aleph-signed-at');
  const nonce = header(request, 'x-aleph-nonce');
  const device = session ? open(session, 'session', userId) : null;
  if (!device || !DEVICE_ID.test(device.d ?? '') || !signature || !signedAt || !nonce) {
    return notRegistered(device && DEVICE_ID.test(device.d ?? '') ? device.d : null);
  }
  const at = Date.parse(signedAt);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > SIGNATURE_SKEW_MS || !NONCE.test(nonce)) {
    return refuse('DEVICE_SIGNATURE_EXPIRED', '요청 서명 시각이 맞지 않습니다.');
  }
  const signatureBytes = fromB64url(signature, 256);
  let valid = false;
  if (signatureBytes) {
    const message = [SIGNED_REQUEST, String(request.method).toUpperCase(), `${target.pathname}${target.search}`,
      sha256Hex(signedBody(request)), signedAt, nonce].join('\n');
    try {
      const key = createPublicKey({ key: { crv: 'P-256', kty: 'EC', x: device.x, y: device.y }, format: 'jwk' });
      valid = verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, signatureBytes);
    } catch { valid = false; }
  }
  if (!valid) return refuse('DEVICE_SIGNATURE_INVALID', '요청 서명이 실제 요청 경로·본문과 맞지 않습니다.');

  const { data, error } = await deviceTable().select('status').eq('device_id', device.d).eq('owner_id', userId).limit(1);
  if (error) { dbFailure(response, error, 'DEVICE_REGISTRY_UNAVAILABLE'); return false; }
  const decision = await judgeDevice(device.d, data[0]?.status === 'approved');
  if (decision.decision === 'deny' && ['device_not_registered', 'starter_not_ready'].includes(decision.reasonCode)) {
    return refuse('device_not_registered', '서버가 이 기기를 등록·승인된 기기로 확인하지 않았습니다.');
  }
  return true;
}
