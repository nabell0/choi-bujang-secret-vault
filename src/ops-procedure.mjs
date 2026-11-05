// 1~11단계 확인 절차. 기대 문구만 있고, 허용·거부는 응답을 받은 뒤에만 붙입니다.
// 보내지 않은 시험은 untested입니다. 응답 본문·메모 내용·토큰은 결과에 넣지 않습니다.

const NOTE = '/api/notes/b4000000-0000-4000-8000-000000000001';
const NOTICE = '/api/notices/c8000000-0000-4000-8000-000000000001';
const RESTORE = '/api/restore/notes/b4000000-0000-4000-8000-000000000001';

const check = (id, step, role, label, expected, extra = {}) => Object.freeze({
  id, step, role, label, expected, send: false, order: 0, method: 'GET', path: null, forged: false, ...extra,
});

export const PROCEDURE = Object.freeze([
  check('s1-home', 1, 'allow', '첫 화면', 'GET / 가 200으로 열림', { send: true, order: 10, path: '/' }),
  check('s1-data', 1, 'deny', '공개 메모 파일', 'GET /data.json 이 404', { send: true, order: 11, path: '/data.json' }),
  check('s2-nosniff', 2, 'allow', '응답 머리글', '첫 화면이 200이고 X-Content-Type-Options: nosniff', { send: true, order: 12, path: '/' }),
  check('s3-list', 3, 'deny', '무인증 메모 목록', '토큰 없는 GET /api/notes 가 401 또는 403', { send: true, order: 1, path: '/api/notes' }),
  check('s3-create', 3, 'deny', '무인증 메모 추가', '토큰 없는 POST /api/notes 가 401 또는 403', { send: false, method: 'POST', path: '/api/notes' }),
  check('s3-forged', 3, 'deny', '위조 서명 토큰', '위조 토큰의 GET /api/notes 가 401', { send: true, order: 14, path: '/api/notes', forged: true }),
  check('s3-own-list', 3, 'allow', '로그인 뒤 내 메모 목록', '로그인한 계정의 GET /api/notes 가 200', { send: false }),
  check('s3-expired', 3, 'deny', '만료 토큰', '만료된 로그인 토큰이 401', { send: false }),
  check('s3-other-service', 3, 'deny', '다른 서비스 토큰', '다른 서비스 토큰이 401', { send: false }),
  check('s4-read', 4, 'deny', '무인증 타인 메모 조회', '토큰 없는 GET /api/notes/:id 가 401 또는 403', { send: true, order: 2, path: NOTE }),
  check('s4-update', 4, 'deny', '서명 없는 메모 수정', '토큰·서명 없는 PUT /api/notes/:id 가 401 또는 403', { send: false, method: 'PUT', path: NOTE }),
  check('s4-delete', 4, 'deny', '무인증 메모 삭제', '토큰 없는 DELETE /api/notes/:id 가 401 또는 403', { send: false, method: 'DELETE', path: NOTE }),
  check('s4-own-read', 4, 'allow', '내 메모 읽기', '소유자의 GET /api/notes/:id 가 200', { send: false }),
  check('s4-other-read', 4, 'deny', '다른 계정으로 타인 메모 조회', 'A가 B 메모를 읽으면 403', { send: false }),
  check('s4-other-update', 4, 'deny', '다른 계정으로 타인 메모 수정', 'A가 B 메모를 고치면 403', { send: false }),
  check('s4-other-delete', 4, 'deny', '다른 계정으로 타인 메모 삭제', 'A가 B 메모를 지우면 403', { send: false }),
  check('s4-owner-change', 4, 'deny', '소유자 바꿔 쓰기', '본문의 다른 owner_id 가 403', { send: false }),
  check('s5-aleph', 5, 'allow', '배포 식별 파일', 'GET /aleph.json 이 200', { send: true, order: 16, path: '/aleph.json' }),
  check('s5-index', 5, 'allow', '화면 파일', 'GET /index.html 이 200', { send: true, order: 17, path: '/index.html' }),
  check('s5-original-read', 5, 'deny', '원본 API 직접 읽기', '공개 키로 원본 자료 API GET 이 거부됨', { send: false }),
  check('s5-original-update', 5, 'deny', '원본 API 직접 수정', '공개 키로 원본 자료 API PATCH 가 거부됨', { send: false }),
  check('s5-original-token', 5, 'deny', '시험 계정으로 원본 API', '시험 계정 토큰의 원본 API 호출이 거부됨', { send: false }),
  check('s6-unregistered', 6, 'deny', '미등록 기기', '미등록 기기의 자료 읽기가 device_not_registered', { send: false }),
  check('s7-stepup', 7, 'deny', '이상 접속', '복합 이상 접속이 재확인 전 step_up_required', { send: false }),
  check('s8-notice-read', 8, 'allow', '로그인 뒤 공지 읽기', '로그인한 GET /api/notices 가 200', { send: false }),
  check('s8-notice-write', 8, 'deny', '무인증 공지 수정', '토큰 없는 PUT /api/notices/:id 가 401 또는 403', { send: false, method: 'PUT', path: NOTICE }),
  check('s8-admin-write', 8, 'deny', '무인증 공지 관리', '토큰 없는 PUT /api/admin/notices/:id 가 401 또는 403', { send: false, method: 'PUT', path: `/api/admin/notices/${NOTICE.split('/').pop()}` }),
  check('s8-materials', 8, 'deny', '무인증 강사 자료', '토큰 없는 GET /api/materials 가 401 또는 403', { send: true, order: 20, path: '/api/materials' }),
  check('s8-student-notice', 8, 'deny', '학생의 공지 수정', '학생 토큰의 공지 수정이 403', { send: false }),
  check('s9-revoke', 9, 'deny', '회수 집행', 'burst_read 회수 뒤 접근이 막힘', { send: false }),
  check('s10-restore', 10, 'deny', '무인증 복구', '토큰 없는 POST /api/restore/notes/:id 가 401', { send: false, method: 'POST', path: RESTORE }),
  check('s10-owner-restore', 10, 'allow', '소유자 복구', '소유자의 복구가 200', { send: false }),
  check('s11-challenge', 11, 'deny', '무인증 기기 질문', '토큰 없는 GET /api/device/challenge 가 401', { send: true, order: 21, path: '/api/device/challenge' }),
  check('s11-signed', 11, 'allow', '승인 기기의 서명 요청', '등록·승인된 기기의 서명한 읽기가 200', { send: false }),
  check('s11-tamper', 11, 'deny', '서명 뒤 변조', '서명 뒤 경로·본문 변경이 403', { send: false }),
]);

const base64url = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

function forgedToken() {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url('{"alg":"ES256","typ":"JWT","kid":"forged"}'),
    base64url(JSON.stringify({
      iss: 'https://example.invalid/auth/v1', aud: 'authenticated', role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000000', iat: now, exp: now + 600,
    })),
    base64url('forged-signature'),
  ].join('.');
}

export function verdictFromStatus(status) {
  if (!Number.isInteger(status)) return 'untested';
  if (status >= 200 && status < 300) return 'allow';
  if (status === 401 || status === 403 || status === 404 || status === 405) return 'deny';
  return 'untested';
}

async function readMeasurement(response) {
  const type = response.headers.get('content-type') ?? '';
  let error = null;
  let noteCount = null;
  if (type.includes('json')) {
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string'
        && /^[A-Z0-9_]{1,64}$/u.test(data.error)) error = data.error;
    if (Array.isArray(data)) noteCount = data.length;
    else if (Array.isArray(data?.notes)) noteCount = data.notes.length;
  } else {
    await response.text();
  }
  const nosniff = response.headers.get('x-content-type-options');
  return {
    httpStatus: response.status,
    error,
    noteCount,
    nosniff: nosniff === 'nosniff' ? 'nosniff' : null,
    checkedAt: new Date().toISOString(),
  };
}

export function formatActual(row) {
  if (row.observed === 'not_run') return 'not_run';
  if (row.verdict === 'untested' || !Number.isInteger(row.httpStatus)) return '미실행';
  const parts = [`HTTP ${row.httpStatus}`];
  if (row.error) parts.push(row.error);
  if (Number.isInteger(row.noteCount)) parts.push(`메모 ${row.noteCount}건`);
  if (row.nosniff) parts.push(row.nosniff);
  return parts.join(' · ');
}

export function tally(rows) {
  return {
    allow: rows.filter(row => row.verdict === 'allow').length,
    deny: rows.filter(row => row.verdict === 'deny').length,
    untested: rows.filter(row => row.verdict === 'untested').length,
  };
}

export async function runProcedure(base) {
  const rows = PROCEDURE.map(item => ({
    id: item.id, step: item.step, role: item.role, label: item.label, expected: item.expected,
    verdict: 'untested', httpStatus: null, error: null, noteCount: null, nosniff: null,
    requestId: null, checkedAt: null,
    observed: item.method === 'GET' || item.method === 'HEAD' ? null : 'not_run',
  }));
  const byId = new Map(rows.map(row => [row.id, row]));
  const queue = PROCEDURE.filter(item => item.send && (item.method === 'GET' || item.method === 'HEAD'))
    .slice().sort((a, b) => a.order - b.order);
  for (const item of queue) {
    const requestId = crypto.randomUUID();
    try {
      const headers = { 'x-request-id': requestId };
      if (item.forged) headers.authorization = `Bearer ${forgedToken()}`;
      const response = await fetch(new URL(item.path, base), {
        method: item.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'error', cache: 'no-store',
      });
      const measured = await readMeasurement(response);
      const verdict = verdictFromStatus(measured.httpStatus);
      if (verdict === 'untested') continue;
      Object.assign(byId.get(item.id), measured, { verdict, requestId });
    } catch {
      // 응답이 없으면 이 행은 미실행으로 남깁니다.
    }
  }
  return rows;
}
