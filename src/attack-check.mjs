// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 1 && config.step !== 3) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (config.step === 3) return runStep3Checks(app, config);
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

async function probe(app, path, { method = 'GET', authorization, body } = {}) {
  try {
    const headers = {};
    if (authorization) headers.Authorization = authorization;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL(path, app), {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    const json = (response.headers.get('content-type') ?? '').includes('application/json');
    let data = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON bodies (404 pages, HTML) carry no notes or error code.
    }
    const noteCount = Array.isArray(data) ? data.length : Array.isArray(data?.notes) ? data.notes.length : 0;
    return { status: response.status, json, errorCode: typeof data?.error === 'string' ? data.error : null,
      noteCount, nosniff: response.headers.get('x-content-type-options') };
  } catch {
    return null;
  }
}

const base64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

// Well-formed, but not signed by the student's Supabase project.
function forgedToken(issuer) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'ES256', typ: 'JWT', kid: 'forged' }),
    base64url({ iss: issuer, aud: 'authenticated', role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000000', iat: now, exp: now + 600 }),
    base64url('forged-signature'),
  ].join('.');
}

async function runStep3Checks(app, config) {
  const [list, create, forged, firstPage, identity] = await Promise.all([
    probe(app, '/api/notes'),
    probe(app, '/api/notes', { method: 'POST', body: { title: '비로그인 추가 시도', body: '거부되어야 함' } }),
    probe(app, '/api/notes', { authorization: `Bearer ${forgedToken(config.identityProvider?.issuer)}` }),
    probe(app, '/'),
    probe(app, '/aleph.json'),
  ]);
  const describe = result => (result
    ? `HTTP ${result.status}, JSON ${result.json ? '예' : '아니오'}, 오류 ${result.errorCode ?? '없음'}, 메모 ${result.noteCount}건`
    : '요청 실패');
  const notRun = '미실행: 학생 Supabase 프로젝트의 서명 키 없이는 이 토큰을 만들 수 없어 보내지 않음';
  return [
    { attackId: 'anonymous_note_list', expected: '토큰 없는 GET /api/notes가 401 또는 403 JSON 오류로 거부되고 메모 0건',
      observed: `토큰 없는 GET /api/notes: ${describe(list)}` },
    { attackId: 'anonymous_note_create', expected: '토큰 없는 POST /api/notes가 401 또는 403 JSON 오류로 거부됨',
      observed: `토큰 없는 POST /api/notes: ${describe(create)}` },
    { attackId: 'forged_signature_token', expected: '서명이 위조된 토큰의 GET /api/notes가 401 JSON 오류로 거부됨',
      observed: `위조 서명 토큰 GET /api/notes: ${describe(forged)}` },
    { attackId: 'expired_token', expected: '만료된 로그인 토큰이 401로 거부됨', observed: notRun },
    { attackId: 'other_service_token', expected: '다른 서비스용으로 발급된 로그인 토큰이 401로 거부됨', observed: notRun },
    { attackId: 'first_page_nosniff_header', expected: '첫 화면 응답에 X-Content-Type-Options: nosniff',
      observed: firstPage ? `첫 화면 HTTP ${firstPage.status}, X-Content-Type-Options: ${firstPage.nosniff ?? '없음'}` : '첫 화면 요청 실패' },
    { attackId: 'aleph_json_available', expected: '배포 주소의 /aleph.json이 200으로 열림',
      observed: identity ? `/aleph.json HTTP ${identity.status}` : '/aleph.json 요청 실패' },
  ];
}
