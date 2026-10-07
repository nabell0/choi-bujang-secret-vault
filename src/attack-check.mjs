// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 1 && config.step !== 2) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  if (config.step === 2) return runStep2Checks(app);
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

async function anonymousGet(app, path) {
  try {
    const response = await fetch(new URL(path, app), {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    let noteCount = 0;
    try {
      const data = await response.json();
      if (Array.isArray(data?.notes)) noteCount = data.notes.length;
    } catch {
      // Non-JSON bodies (404 pages, HTML) carry no notes.
    }
    return { status: response.status, noteCount, nosniff: response.headers.get('x-content-type-options') };
  } catch {
    return null;
  }
}

async function runStep2Checks(app) {
  const [staticFile, api, firstPage] = await Promise.all([
    anonymousGet(app, '/data.json'), anonymousGet(app, '/api/notes'), anonymousGet(app, '/'),
  ]);
  const describe = result => (result ? `HTTP ${result.status}, 메모 ${result.noteCount}건` : '요청 실패');
  return [
    { attackId: 'anonymous_static_note_read', expected: '비로그인 /data.json 요청이 404로 거부되고 메모 0건',
      observed: `비로그인 /data.json 요청: ${describe(staticFile)}` },
    { attackId: 'anonymous_api_note_read', expected: '남은 약점 기록: 3단계 로그인 전까지 비로그인 /api/notes에 메모가 응답됨',
      observed: `비로그인 /api/notes 요청: ${describe(api)}` },
    { attackId: 'first_page_nosniff_header', expected: '첫 화면 응답에 X-Content-Type-Options: nosniff',
      observed: firstPage ? `첫 화면 HTTP ${firstPage.status}, X-Content-Type-Options: ${firstPage.nosniff ?? '없음'}` : '첫 화면 요청 실패' },
  ];
}
