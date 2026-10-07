// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 3, 4, 5].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  if (config.step === 4) return runStep4Checks(app, config);
  if (config.step === 5) return runStep5Checks(app, config);
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

// Fixed id of B's public test note from supabase/step4-owners.sql.
const B_TEST_NOTE = '/api/notes/b4000000-0000-4000-8000-000000000001';

async function runStep4Checks(app, config) {
  const loginChecks = await runStep3Checks(app, config);
  const [read, update, remove] = await Promise.all([
    probe(app, B_TEST_NOTE),
    probe(app, B_TEST_NOTE, { method: 'PUT', body: { title: '비로그인 수정 시도', body: '거부되어야 함' } }),
    probe(app, B_TEST_NOTE, { method: 'DELETE' }),
  ]);
  const describe = result => (result
    ? `HTTP ${result.status}, JSON ${result.json ? '예' : '아니오'}, 오류 ${result.errorCode ?? '없음'}`
    : '요청 실패');
  const notRun = '미실행: A·B 계정의 실제 로그인 토큰이 필요해 이 점검에서는 보내지 않음(비밀번호·토큰을 기록하지 않음)';
  return [
    ...loginChecks,
    { attackId: 'anonymous_note_read_by_id', expected: '토큰 없는 GET /api/notes/:id가 401 또는 403 JSON 오류로 거부됨',
      observed: `토큰 없는 GET /api/notes/:id(B 시험 메모): ${describe(read)}` },
    { attackId: 'anonymous_note_update', expected: '토큰 없는 PUT /api/notes/:id가 401 또는 403 JSON 오류로 거부됨',
      observed: `토큰 없는 PUT /api/notes/:id(B 시험 메모): ${describe(update)}` },
    { attackId: 'anonymous_note_delete', expected: '토큰 없는 DELETE /api/notes/:id가 401 또는 403 JSON 오류로 거부됨',
      observed: `토큰 없는 DELETE /api/notes/:id(B 시험 메모): ${describe(remove)}` },
    { attackId: 'other_user_note_read', expected: 'A가 B 메모 ID로 GET하면 403 JSON 오류로 거부됨', observed: notRun },
    { attackId: 'other_user_note_update', expected: 'A가 B 메모 ID로 PUT하면 403 JSON 오류로 거부되고 B 메모가 그대로임', observed: notRun },
    { attackId: 'other_user_note_delete', expected: 'A가 B 메모 ID로 DELETE하면 403 JSON 오류로 거부되고 B 메모가 남음', observed: notRun },
    { attackId: 'owner_change', expected: '본문에 상대 owner_id를 넣은 POST·PUT이 403 JSON 오류로 거부됨', observed: notRun },
  ];
}

// The public key is fetched at runtime only to send the probe; it is never stored or reported.
async function runtimePublicKey(app) {
  try {
    const response = await fetch(new URL('/api/auth-config', app), {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    const key = response.ok ? (await response.json())?.publishableKey : null;
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

async function directOriginal(config, key, method, search, body) {
  try {
    const url = new URL(config.originalApiUrl);
    url.search = search;
    const response = await fetch(url, {
      method, headers: { apikey: key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      // Empty bodies (e.g. 204) carry no rows or error code.
    }
    return { status: response.status, code: typeof data?.code === 'string' ? data.code : null,
      rows: Array.isArray(data) ? data.length : null };
  } catch {
    return null;
  }
}

async function runStep5Checks(app, config) {
  const earlier = await runStep4Checks(app, config);
  const key = await runtimePublicKey(app);
  const [read, update, pages] = await Promise.all([
    key ? directOriginal(config, key, 'GET', '?select=id') : null,
    key ? directOriginal(config, key, 'PATCH', '?id=eq.00000000-0000-4000-8000-000000000000', { title: '직접 수정 시도' }) : null,
    Promise.all(['/', '/index.html'].map(async path => {
      try {
        const response = await fetch(new URL(path, app), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        return await response.text();
      } catch {
        return null;
      }
    })),
  ]);
  const describe = result => (result
    ? `HTTP ${result.status}, 오류 코드 ${result.code ?? '없음'}, 받은 행 ${result.rows ?? '없음'}`
    : '요청 실패');
  const noKey = '미실행: /api/auth-config에서 공개 키를 받지 못해 보내지 않음';
  const fetched = pages.filter(text => typeof text === 'string');
  const keyHits = fetched.filter(text => /sb_publishable_|sb_secret_|eyJ[\w-]{10,}\.eyJ[\w-]{10,}/u.test(text)).length;
  const markerHits = fetched.filter(text => text.includes(config.sampleMarker)).length;
  return [
    ...earlier,
    { attackId: 'original_api_direct_read', expected: '공개 키로 원본 자료 API를 직접 GET하면 권한 오류로 거부되고 메모 0건',
      observed: key ? `원본 API 직접 GET(공개 키, 토큰 없음): ${describe(read)}` : noKey },
    { attackId: 'original_api_direct_update', expected: '공개 키로 원본 자료 API를 직접 PATCH하면 권한 오류로 거부됨(없는 ID로만 시도)',
      observed: key ? `원본 API 직접 PATCH(공개 키, 토큰 없음, 없는 ID): ${describe(update)}` : noKey },
    { attackId: 'original_api_test_account_token', expected: '공개 키와 시험 계정 토큰으로 원본 자료 API를 직접 부르면 권한 오류로 거부됨',
      observed: '미실행: 시험 계정의 실제 로그인 토큰이 필요해 보내지 않음(비밀번호·토큰을 기록하지 않음)' },
    { attackId: 'static_files_key_marker_search', expected: '첫 화면과 index.html에 Supabase 키 형태 문자열과 시드 표식이 없음',
      observed: `정적 파일 ${fetched.length}/2개 받음, 키 형태 문자열 포함 ${keyHits}개, 시드 표식 포함 ${markerHits}개` },
  ];
}
