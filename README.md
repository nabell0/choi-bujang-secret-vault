# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 `aleph.config.json`의 현재 단계에 맞는 점검을 실제 배포 주소에 보내고 그 결과만 기록합니다.

## 2단계: 자료를 코드 밖으로 옮겼습니다

가상 메모 네 건은 이제 저장소가 아니라 학습용 Supabase `notes` 테이블에 있습니다. 테이블은 RLS가 켜져 있고 `anon`·`authenticated`에는 읽기 권한이 없습니다(4단계 RLS SQL이 `authenticated`에 본인 행 권한을 줬다가, 5단계 SQL이 다시 모두 거둡니다). 테이블을 만드는 SQL(`supabase/*.local.sql`)은 메모 본문이 들어 있어 Git에 올리지 않습니다.

화면은 `/api/notes` 서버 함수를 거쳐 메모를 읽습니다. 함수는 Vercel 프로젝트 **Settings → Environment Variables**에 학생이 직접 넣은 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`만 사용하며, 키는 브라우저 파일·응답·로그에 나오지 않습니다. 정적 파일 `/data.json`은 더 이상 만들지 않아 404가 됩니다. 모든 응답에는 `X-Content-Type-Options: nosniff` 헤더가 붙습니다(`vercel.json`).

## 3단계: 진짜 로그인을 붙였습니다

- 첫 화면에서 Supabase Auth 이메일·비밀번호로 로그인·로그아웃합니다. 화면 코드에는 공개용 Project URL과 publishable key만 있습니다.
- 자료 API는 틀의 `src/verify-login.mjs`(`createLoginVerifier`)로 요청의 `Authorization: Bearer` 토큰을 검사합니다. 사용자 ID는 검사를 통과한 토큰에서만 가져오고, 브라우저가 보낸 `userId`·`role`·`owner_id`는 쓰지 않습니다. 발급자 정보는 `aleph.config.json`의 `identityProvider`에 있습니다.
- 토큰이 없거나 검사에 실패하면 모든 경로가 자료 없이 `401`과 JSON 오류(`LOGIN_REQUIRED`, `INVALID_LOGIN_TOKEN`)를 돌려줍니다.
- 경로(`allowedRoutes`): `GET·POST /api/notes`(내 메모 배열, 추가 → `{id}`), `GET·PUT·DELETE /api/notes/:id`(한 건 `{id,title,body}`, 수정, 삭제 → 204, 지운 뒤 GET은 404). 추가할 때 서버가 확인한 사용자 ID를 `owner_id`로 저장합니다.
- 테이블 변경은 `supabase/step3-notes-crud.sql`을 SQL Editor에서 한 번 실행해 적용합니다(메모 ID를 UUID로 바꾸고 제목 중복 금지를 풂). 배포 전에 실행해야 합니다.

3단계까지는 소유자 검사가 없어, 로그인한 B가 A 메모의 ID를 알면 그 메모를 읽고 고치고 지울 수 있었습니다. 4단계에서 막았습니다.

## 4단계: 로그인해도 내 자료만 보이게 했습니다

- `/api/notes/:id`의 GET·PUT·DELETE는 DB 조회 조건에 `owner_id = 검증된 사용자 ID`를 넣어 본인 메모만 다룹니다. 남의 메모면 `403 NOT_NOTE_OWNER`, 없는 메모면 `404 NOTE_NOT_FOUND`(JSON)입니다.
- 수정은 기존 행과 저장된 새 행의 소유자가 모두 본인일 때만 성공합니다. POST·PUT 본문에 다른 사람의 `owner_id`가 있으면 `403 OWNER_CHANGE_FORBIDDEN`입니다. 추가할 때 소유자는 항상 검증된 ID이고, URL·본문의 `owner_id`는 쓰지 않습니다.
- 로그인 없는 요청의 `401` JSON 거부, `nosniff` 헤더, 빌드가 만드는 `/aleph.json`은 그대로입니다.
- `allowedRoutes`는 메서드와 경로로 적습니다: `GET /api/notes`, `POST /api/notes`, `GET /api/notes/:id`, `PUT /api/notes/:id`, `DELETE /api/notes/:id`.
- 학습 DB SQL은 SQL Editor에서 이 순서로 실행합니다. 이메일은 SQL Editor에서만 넣고 파일에 적지 않습니다.
  1. `supabase/step4-owners.sql`: 기존 가상 메모 네 건을 A 소유로 연결하고, B 소유 시험 메모(`b4000000-0000-4000-8000-000000000001`)를 만듭니다.
  2. `supabase/step4-rls.sql`: `notes`의 권한을 모두 회수한 뒤 `authenticated`에만 SELECT·INSERT·UPDATE·DELETE를 주고, 네 정책 모두 `auth.uid() = owner_id`일 때만 허용합니다. 적용 전후 권한 대조표가 나옵니다.

**남은 약점(4단계 시점):** 앱 API는 RLS를 건너뛰는 서버 전용 키로 DB에 접근하므로, A/B 분리는 API의 소유자 검사에 달려 있습니다. 4단계 RLS SQL을 적용하면 로그인 토큰과 공개 키로 원본 자료 API에서 자기 행을 직접 다룰 수 있는 길이 열립니다. 5단계에서 닫습니다.

## 5단계: 자료 요청을 서버 한곳으로 모았습니다

- 브라우저는 메모를 Supabase에서 직접 읽거나 고치지 않습니다. 메모 읽기·추가·수정·삭제는 모두 `/api/notes` 서버 함수를 거치고, 브라우저가 Supabase SDK로 부르는 것은 로그인·로그아웃(`client.auth`)뿐입니다.
- 화면 파일에 Supabase Project URL과 공개 키를 적지 않습니다. 화면은 `GET /api/auth-config`에서 Vercel 환경변수 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`를 런타임에 받아 로그인 SDK를 시작합니다. 이 함수는 비밀 키(`sb_secret_…`, `service_role`)가 잘못 들어 있으면 보내지 않습니다. 공개 키는 여전히 런타임에 브라우저로 전달되므로 비밀은 아니며, 정적 파일·브라우저 묶음에서 검색되지 않게 한 것입니다.
- `supabase/step5-revoke-direct.sql`: `notes` 테이블(과 그 번호 시퀀스)에서 `PUBLIC`·`anon`·`authenticated`의 직접 권한을 모두 거둡니다. RLS와 4단계 본인 행 정책은 남겨 둡니다. 적용 전후 권한 대조표(역할 4개 × 권한 7개)가 나오며, 서버 함수가 쓰는 `service_role`은 그대로여야 합니다.
- 원본 자료 API 주소는 `aleph.config.json`의 `originalApiUrl`(`https://kcxnmaxipzlxdxwvpupv.supabase.co/rest/v1/notes`)입니다. 위 SQL 적용 뒤에는 공개 키로 직접 불러도 `permission denied`로 거부되어야 합니다.
- 빌드는 `aleph.config.json`의 `allowedRoutes`와 `originalApiUrl`을 `/aleph.json`에도 기록합니다. 경로가 비었거나 `메서드 /api/경로` 형식이 아니면, 또는 `originalApiUrl`이 쿼리·`#`·`@`·공백 없는 `https` 주소가 아니면 빌드가 실패합니다.
- Vercel **Settings → Environment Variables**에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`가 있어야 합니다. 값은 학생이 그 화면에 직접 넣습니다.

**남은 약점:** 요청 횟수 제한이 없습니다. 공개 키는 `/api/auth-config`로 누구나 받을 수 있으므로, 원본 자료 API 보호는 DB 권한 회수에 달려 있습니다. 옛 커밋과 옛 배포에는 화면 코드에 적었던 공개 키가 남아 있습니다.

### 다시 실행하는 방법

```powershell
npm ci
npm run build -- --local
npm run test:r5
npm run bundle
```

`npm run bundle`은 커밋되지 않은 파일이 없고, Git에서 제외된 `bundle-notes.json`(이번 단계 설명)이 있을 때만 `artifacts/submission.json`을 만듭니다. 공격 점검은 `aleph.config.json`의 `publicAppUrl`에 실제로 요청을 보낸 결과만 기록하며 심판 판정이 아닙니다. 학생 프로젝트의 서명 키가 필요한 만료·다른 서비스 토큰 점검과, A·B·시험 계정의 실제 로그인 토큰이 필요한 타인 메모 접근·소유자 변경·원본 API 토큰 직접 호출 점검은 미실행으로 남깁니다. 원본 API 직접 점검은 배포의 `/api/auth-config`에서 공개 키를 받아 요청만 보내고, 키는 기록하지 않습니다. `npm run test:package`의 함수 기준표 시험은 `api/notes.js`가 추가되어 실패합니다.

## 6단계: 등록한 기기만 자료실에 들어옵니다

- `src/decider.mjs`의 `device_registered` 규칙은 판정 요청의 `deviceRegistered`가 정확히 `true`인 읽기(`GET`) 요청만 `allow`(`approved`)합니다. `false`이거나 값이 없거나 다른 값이면 `deny`·`device_not_registered`입니다. 등록 기기의 읽기 아닌 요청은 기존 `starter.deny`로 거부됩니다.
- 판정기는 [docs/DECIDER_REQUEST.md](docs/DECIDER_REQUEST.md) 계약의 `requestId`·`deviceRegistered`·`method`만 읽습니다. 자료실 API(`api/`), 헤더, 환경변수는 바뀌지 않았습니다.
- 따로 설치할 접속 프로그램은 없습니다. 미등록 기기로 실제 접속하는 공격은 심판이 맡습니다.
- `npm run bundle`의 `src/attack-check.mjs`는 6단계에서 5단계까지의 실제 요청 점검을 그대로 보내고, 미등록 기기 접속(`unregistered_device_access`)은 미실행으로 기록합니다.

### 확인 순서

1. `npm ci`로 의존성을 설치합니다.
2. `npm run decider:test`를 실행합니다.
3. 출력에 `통과 · 등록 기기의 정상 요청`과 `통과 · 미등록 기기의 가상 요청`이 모두 있어야 합니다. 두 번째 줄은 `deviceRegistered: false` 요청이 `deny`·`device_not_registered`로 거부됐다는 뜻입니다. `확인 필요`가 하나라도 나오면 실패입니다.

이 시험은 가상 요청으로 하는 로컬 연습이며 심판 판정이나 실제 기기 접속 증거가 아닙니다. 2026-10-14 로컬 실행에서는 두 줄 모두 통과했습니다.

## 7단계: 평소와 다른 접속은 다시 확인합니다

- 판정기는 계약의 `signals`·`recentEvents`·`stepUp`만 읽습니다. 계약 18개 이름 밖의 값(브라우저 헤더, `role`, `identity`, `device` 등)이 붙거나 형식이 틀린 요청은 `starter.deny`로 거부합니다. `signals.source`가 `none`이면 지역·네트워크·시각을 모르는 값(`null`)으로 두고, `judge_fixture`가 아닌 다른 출처의 값은 버립니다. 모르는 값은 정상값으로 채우지 않습니다. `recentEvents`의 사건 이름(`kind`)은 비어 있지 않은 64자 이하 문자열이면 받습니다.
- 이상 징후는 새벽 0~5시(`anomaly.off_hours`), `usual`이 아닌 네트워크(`anomaly.new_network`), `local`이 아닌 지역(`anomaly.region_change`), 최근 10분 사건 합계 10건 이상(`anomaly.activity_burst`)입니다. 두 가지 이상 겹치면 `step_up`·`step_up_required`로 추가 확인을 요구하고, 걸린 징후 이름을 `ruleIds`에 사유로 남깁니다. 지역 급변 하나로는 막지 않으며, 이 규칙은 영구 차단(`deny`)을 하지 않습니다.
- 6단계 `device_registered` 규칙이 먼저 적용됩니다. 미등록이면 이상 징후와 관계없이 `device_not_registered`입니다.

### 재로그인 계약 확인 (2026-10-14)

- **있는 것:** `docs/DECIDER_REQUEST.md`의 판정 요청에 `stepUp: {verified, authAgeSeconds}`가 있습니다. 엔진이 추가 본인 확인 완료 여부와 그 뒤 지난 시간(0~900초)을 넣어 보냅니다. 판정기는 확인 전(`verified: false`)에는 복합 이상 요청을 `step_up`으로 막고, 새 로그인 뒤 엔진이 `verified: true`로 다시 보낸 요청을 다시 판정해 읽기는 `allow`합니다.
- **없는 것:** 엔진이 이 판정으로 배포의 `/api/notes` 자료 접근을 실제로 막는 연결은 이 저장소에 없습니다. 자료 API는 판정기를 부르지 않고, 로그인 토큰 검사(`src/verify-login.mjs`)에도 재로그인 시각 계약이 없습니다. 계약상 실제 경로의 `signals`는 `source: "none"`이라 지역·시각·네트워크 징후가 생기지 않습니다.
- 그래서 **실제 자료 차단은 미실행**입니다. 가상 사건 규칙만 시험했습니다. 시험과 기록에 로그인 토큰 원문을 넣지 않습니다.

### 확인 순서

1. `npm ci`로 의존성을 설치합니다.
2. `npm run decider:test`를 실행합니다. `통과` 네 줄(등록 기기의 정상 요청, 미등록 기기의 가상 요청, 복합 이상 접속, 다시 확인한 복합 이상 접속)이 나와야 합니다. 세 번째 줄은 확인 전 요청이 `step_up`·`step_up_required`로 막혔다는 뜻이고, 네 번째 줄은 재로그인 뒤 같은 요청이 `allow`라는 뜻입니다. `확인 필요`가 하나라도 나오면 실패입니다.
3. `npm run fixture:7`을 실행합니다. `정상 사건: allow`, `복합 이상 사건: step_up`이 나와야 합니다.

2026-10-14 로컬 실행에서 두 명령 모두 통과했습니다. 가상 요청 연습이며 심판 판정이나 실제 접속 차단 증거가 아닙니다. 같은 날 저장소를 새로 받아 `npm install`을 실행했을 때 의존성(`@supabase/supabase-js@2.117.2`, `jose@6.2.12`) 설치 오류가 없었습니다. `npm run bundle`의 `src/attack-check.mjs`는 7단계에서 6단계까지의 실제 요청 점검을 그대로 보내고, 복합 이상 접속의 실제 차단(`anomalous_access_step_up`)은 미실행으로 기록합니다.

## 8단계: 자료마다 갈 수 있는 구역을 나눕니다

- **자원 ID:** `src/decider.mjs`의 `RESOURCES` 한 곳에 정합니다. 내 메모 `notes.own`(personal), 반 공지 `notices.class`(class), 강사 자료 `materials.instructor`(instructor), 공지 관리 `notices.admin`(admin), 로그인 설정 `app.auth_config`(public)입니다. 판정기는 엔진 요청의 `service`·`route`로, 서버는 같은 경로의 `/api` 주소로 같은 ID를 찾고, 서버 응답에는 `X-Aleph-Resource: notes.own; zone=personal` 같은 헤더가 붙습니다.
- **판정기 구역 규칙:** 메모는 `GET /notes/:id`만 허용하고 ID 없는 `/notes`는 `note_id_required`로 거부합니다(`zone.notes_single_item`). 반 공지는 `GET /notices`, `GET /notices/:id`만 허용하고 쓰기는 `notice_write_denied`입니다(`zone.notices_read_only`). 강사 자료는 모두 `instructor_zone_denied`(`zone.instructor_materials`), 그 밖의 서비스는 `route_not_allowed`(`zone.default_deny`)입니다. `:id` 칸은 UUID로 좁히지 않지만 한 칸짜리 이름이어야 하고 `export`·`all`·`search`·`admin` 같은 기능 이름은 받지 않습니다. 경로 모양이 칸 수까지 정확히 같아야 하고, 쿼리가 붙은 요청은 허용하지 않습니다. 6·7단계 규칙(기기 등록, 입력 검사, 복합 이상 `step_up`)은 그대로이며, 구역에서 거부되는 요청은 재로그인을 요구하지 않고 바로 거부합니다.
- **`allowedRoutes`:** 판정기가 허용하는 `GET /api/notes/:id`, `GET /api/notices`, `GET /api/notices/:id`만 적습니다.
- **서버 API의 다시 대조:** 사용자 ID는 검증된 로그인 토큰에서만 꺼내고, 본문·헤더·쿼리·화면의 `role`·`owner_id`는 쓰지 않습니다. 메모는 지금처럼 `owner_id = 검증된 사용자 ID`로만 다룹니다(남의 메모 `403 NOT_NOTE_OWNER`). `GET /api/notices`·`/api/notices/:id`는 로그인한 누구나 읽고, 같은 경로의 쓰기는 강사를 포함해 `403 NOTICE_READ_ONLY`입니다. 공지 수정·삭제는 별도 관리 경로 `PUT·DELETE /api/admin/notices/:id`에서만 하며, Vercel 환경변수 `INSTRUCTOR_USER_IDS`에 있는 학생 프로젝트 로그인만 강사로 봅니다(그 밖에는 `403 INSTRUCTOR_ONLY`, 비어 있으면 아무도 강사가 아님). 판정기는 이 관리 경로를 허용하지 않습니다. `/api/materials`·`/api/materials/:id`는 누구에게나 `403 MATERIALS_ZONE_FORBIDDEN`입니다. 토큰이 없으면 모두 `401 LOGIN_REQUIRED`이고 거부는 모두 `{ "error": "..." }` JSON입니다.
- **학습 DB:** `supabase/step8-notices.sql`을 SQL Editor에서 실행해 `notices` 테이블과 시험용 가상 공지 한 건(`c8000000-0000-4000-8000-000000000001`)을 만듭니다. `anon`·`authenticated`·PUBLIC 권한은 모두 거두고 `service_role`만 씁니다. 실행하지 않으면 `GET /api/notices`가 `502 NOTICES_UNAVAILABLE`입니다.

### 확인 순서

1. `npm ci`로 의존성을 설치합니다.
2. `npm run decider:test`를 실행합니다. `통과` 네 줄이 나와야 합니다. 첫 줄의 정상 요청은 자기 메모 단건 경로(`GET /notes/:id`)입니다.
3. `npm run fixture:7`을 실행합니다. `정상 사건: allow`, `복합 이상 사건: step_up`이 나와야 합니다.
4. 배포 뒤 로그인하지 않은 브라우저에서 `/api/notices`, `/api/materials`를 열면 `401` `LOGIN_REQUIRED` JSON이어야 합니다.

2026-10-14 로컬 확인 기록: 위 2·3번이 통과했습니다. 판정기에 가상 요청 29건을 넣어 메모 단건·공지 읽기만 허용되고 메모 목록·공지 쓰기·강사 자료·알 수 없는 경로·`export` 같은 예약어 경로·쿼리 붙은 요청이 거부됨을 확인했습니다. 로그인 검사와 DB를 가짜로 바꾼 로컬 시험에서 서버 API에 직접 요청 24건을 보내, 위조한 `role`·`owner_id` 헤더·본문·쿼리로도 남의 메모와 강사 자료가 나오지 않고 학생과 심판 로그인의 공지 수정이 403으로 막힘을 확인했습니다. 이 기록은 가상 요청과 로컬 시험이며 심판 판정이나 배포 확인이 아닙니다. 학습 DB SQL 실행과 `INSTRUCTOR_USER_IDS` 설정은 이 기록에서 확인되지 않았습니다.

**남은 약점:** 판정기는 엔진을 거치는 요청에만 적용됩니다. 배포된 서버의 `GET /api/notes` 목록과 메모 추가·수정·삭제는 화면이 쓰므로 남아 있으며(본인 메모만), `allowedRoutes`와 판정기에서는 거부 대상입니다. `npm run bundle`의 `src/attack-check.mjs`는 8단계에서 토큰 없는 공지 수정·관리 경로·강사 자료 요청을 실제로 보내고, 학생 계정 토큰이 필요한 공지 수정 점검은 미실행으로 남깁니다. 묶음의 직접 점검 최대 20개에 맞추려고, 같은 이유로 미실행인 이전 점검(만료·다른 서비스 토큰, 타인 메모 접근·소유자 변경)은 `login_token_variants`, `other_user_note_access` 두 항목으로 합쳤습니다.

## 9단계: 도플갱어를 찾고 권한을 거둡니다

- **입력 정리:** 판정기는 계약의 가명 사용자 `subjectId`(공백·제어 문자 없는 1~256자), 기기 `deviceId`(16자리 소문자 16진수), 요청 종류(`service`·`method`·`route`·`path`·`queryLength`), 판정 근거(`deviceRegistered`·`stepUp`·`recentEvents`·`signals`)만 읽습니다. `classId`·`projectId`·`querySha256`·`at`·`policyRevision`은 이름만 확인합니다. 형식이 틀리거나 `role`·`identity`·`device` 같은 이름이 붙으면 `starter.deny`입니다. 판정기는 입력을 로그나 응답으로 내보내지 않습니다.
- **의심 규칙 `suspect.network_burst`:** 평소와 다른 네트워크(`anomaly.new_network`)와 최근 10분 다량 조회(`anomaly.activity_burst`)가 함께 있을 때만 의심으로 표시하고 `step_up`·`step_up_required`로 재확인을 요구합니다. 지역·시각 하나만으로는 표시하지 않고, 정상 사건은 그대로 `allow`입니다. 계약과 시험 코드에 이 규칙의 ID가 정해져 있지 않아 기존 이름 방식으로 정했습니다. 6~8단계 규칙은 그대로입니다.
- **회수 제안 `proposeRevocation(request)`:** `decide()`의 응답 다섯 항목과 판정은 바꾸지 않고, `src/decider.mjs`가 따로 내보내는 함수입니다. 등록 기기에서 온 의심 사건이고 아직 재확인 전일 때만 `{ action: 'propose_revocation', reasonCode: 'burst_read', deviceId, ruleIds: ['suspect.network_burst'] }`를 돌려줍니다. 대상은 엔진이 확인한 기기 하나뿐입니다. 그 밖에는 `{ action: 'observe' }`입니다. 이유 코드는 `docs/DETECT_EVENTS.md`의 회수 제안 코드를 따랐습니다. 회수 API, DB, 기기 권한은 건드리지 않으며, 실제 회수와 시간 측정은 심판이 확인합니다.
- **탐지 함수 `src/detect.mjs`:** [docs/DETECT_EVENTS.md](docs/DETECT_EVENTS.md) 계약대로, 같은 `identity.sub`의 `GET` 사건이 어느 10분 구간에서든 120건을 넘을 때만 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject }`를 돌려줍니다. 정확히 120건, 다른 사용자끼리 합친 경우, 10분 밖으로 흩어진 경우는 `{ action: 'observe' }`입니다. `GET`이 아니거나 시각·`sub`가 없는 사건은 세지 않습니다. 사건 내용을 기록하지 않고 회수를 집행하지도 않습니다.
- `aleph.config.json`의 `step`은 9입니다. Vercel 빌드가 이 값을 `/aleph.json`의 `step`에 그대로 씁니다.

### 확인 순서

1. `npm ci`로 의존성을 설치합니다.
2. `npm run decider:test`를 실행합니다. `통과` 여섯 줄이 나와야 합니다. 다섯째 줄 `의심 사건의 기기 회수 제안`은 의심 사건이 기기 하나와 이유 코드가 있는 제안을 냈다는 뜻이고, 여섯째 줄 `정상 사건은 회수 제안 없음`은 정상 사건이 `observe`라는 뜻입니다.
3. `npm run fixture:7`을 실행합니다. `정상 사건: allow`, `복합 이상 사건: step_up`이 나와야 합니다.
4. `npm run detect:test`를 실행합니다. `통과` 여섯 줄이 나와야 합니다. `10분 안에 121건`과 `폭주 조회 200건`은 회수 제안이 나왔다는 뜻이고, 나머지 네 줄은 `observe`라는 뜻입니다.

2026-10-14 로컬 확인 기록: 위 2·3·4번이 통과했습니다. 탐지 함수는 시험에 없는 경우(`POST` 121건, 시각이 깨진 사건, `sub` 없는 사건, 순서가 섞인 사건, 다른 사용자만 넘은 경우)도 따로 확인했습니다. 가상 요청 18건(정상, 의심, 신호 하나뿐인 사건, 재확인한 의심, 미등록, 출처 불명, `role` 덧붙임, 구역 밖 경로, 빈 요청 등)에서 `decide()` 응답이 모두 다섯 항목 형식이고 `ruleIds`가 `RULE_IDS` 안에 있었습니다. 회수 제안은 의심 사건 두 건에서만 나왔습니다. `package.json`·`package-lock.json`만 새 폴더에 옮겨 `npm ci`를 실행했을 때 설치 오류가 없었습니다. 가상 요청 연습이며 심판 판정이나 실제 회수 증거가 아닙니다.

**남은 약점:** 판정기와 탐지 함수의 회수 제안은 반환값일 뿐이고, 운영 반 엔진이 사건을 전달하고 제안을 받아 집행하는 연결은 이 저장소에 없습니다. 실제 경로의 `signals`는 `source: "none"`이라 실제 접속에서는 판정기의 의심 표시가 생기지 않습니다. `npm run bundle`의 `src/attack-check.mjs`는 9단계에서 8단계까지의 실제 요청 점검을 그대로 보내고, 도플갱어 기기 회수(`doppelganger_device_revocation`)는 미실행으로 기록합니다. 직접 점검 최대 20개에 맞추려고, 같은 이유(실제 계정 토큰 필요)로 미실행인 타인 메모 접근과 원본 API 토큰 직접 호출 점검은 `account_token_access` 한 항목으로 합쳤습니다.

## 10단계: 백업에서 자료실을 되살립니다

### 메모 한 건 복구 서비스

- **복구 서비스와 경로:** `POST /api/restore/notes/:id` (`api/restore/notes/[id].js`). `aleph.config.json`의 `restoreRoute`에 같은 값을 적었고, `npm run bundle`이 이 값을 제출 묶음의 `restoreRoute`로 싣습니다. 본문은 필요 없고 읽지도 않습니다.
- **비공개 사본:** Supabase의 `public.notes_backup`에 메모 ID·소유자·제목·내용·내용 해시를 둡니다. 공개 키·로그인 토큰의 직접 권한은 없고, 서버 함수(`service_role`)는 사본을 읽기만 합니다. 메모 본문은 DB에만 있고 Git·제출 묶음에 들어가지 않습니다.
- **복원 전 검증:** 검증된 로그인 ID가 사본의 `owner_id`와 같아야 하고(아니면 `403 NOT_NOTE_OWNER`), 사본의 ID가 경로의 ID와 같고, 사본의 제목·내용으로 다시 계산한 해시가 저장된 `content_sha256`과 같아야 합니다(아니면 `409 BACKUP_VERIFY_FAILED`). 사본이 없으면 `404 BACKUP_NOT_FOUND`, 토큰이 없으면 `401`, `POST`가 아니면 `405`입니다. 요청의 `owner_id`·`role`은 쓰지 않습니다.
- **복원:** 그 ID 한 건만 사본 값으로 덮어쓰거나(변조) 다시 만들고(삭제), 저장된 행의 ID·소유자·내용 해시가 사본과 같은지 다시 확인한 뒤 `200 { id, restored: true, contentSha256 }`을 돌려줍니다. 다른 메모와 사본은 바꾸지 않습니다.
- **감사 기록:** 시도마다 `public.note_restore_audit`에 메모 ID·요청자 ID·결과·해시 한 줄을 덧붙입니다(제목·내용 없음). 서버 함수는 이 테이블에 추가·조회만 할 수 있고 고치거나 지울 권한이 없습니다.
- **덮어쓰기 전 상태 기록:** 복원 직전 메모 상태를 먼저 감사 기록에 남깁니다. 변조됐으면 `tampered_before_restore`와 변조된 내용의 해시, 삭제됐으면 `missing_before_restore`, 사본과 같으면 `intact_before_restore`입니다. 이 기록을 남기지 못하면 메모를 바꾸지 않고 `502 RESTORE_AUDIT_FAILED`입니다. 복원 뒤 `restored` 줄을 하나 더 남기고, 응답의 `audit`에 `previousState`·`previousSha256`·남긴 결과 두 개를 돌려줍니다.
- 내용 해시 = SHA-256(`<제목의 UTF-8 바이트 수>:<제목><내용>`)입니다. SQL과 `src/notes-server.mjs`의 `noteContentSha256`이 같은 식을 씁니다.

**준비 (침해 전에 한 번):** `supabase/step10-note-backup.sql`을 SQL Editor에서 실행합니다. 실행하는 순간의 메모를 사본으로 뜨므로 B 시험 메모(`b4000000-0000-4000-8000-000000000001`)가 정상일 때 실행해야 합니다. 마지막 확인에서 `b_test_backed_up = true`, `b_test_matches_now = true`여야 합니다. 다시 실행해도 이미 뜬 사본은 덮어쓰지 않습니다.

**심판 시험 흐름:** B 시험 메모가 변조·삭제된 뒤, B 계정으로 로그인한 토큰을 `Authorization: Bearer`에 넣어 `POST /api/restore/notes/b4000000-0000-4000-8000-000000000001`을 부르면 `200`이고 메모의 ID·소유자·내용 해시가 사본과 같아집니다. A 토큰으로 같은 경로를 부르면 `403`이고 아무것도 바뀌지 않습니다.

### 정책 사본 비교와 되돌리기

- `npm run policy:diff`: `policy/safe-policy.json`(커밋 `aae1ff8`에서 뜬 판정기 규칙·자원 구역·허용 경로·정책 파일 해시)을 검증한 뒤 현재 시험 정책과의 차이만 보여 줍니다. 사본이 없거나 형식·해시·커밋 내용 대조에 실패하면 즉시 중단합니다.
- `npm run policy:restore`: 같은 검증 뒤 복원할 버전과 바뀔 항목·파일을 미리 보여 주고 아무것도 바꾸지 않습니다. `npm run policy:restore -- --apply <정책 해시 앞 12자리>`로 실행해야 `src/decider.mjs`·`src/detect.mjs`와 `aleph.config.json`의 `allowedRoutes`만 사본 내용으로 되돌립니다. API·다른 설정·Git 이력은 그대로이고, 복원 전 파일은 `artifacts/policy-restore/`(Git 제외)에, 감사 기록은 `policy/restore-log.jsonl`에 한 줄씩 덧붙습니다.

### 확인 순서

1. `npm ci`로 의존성을 설치합니다.
2. `npm run restore:check`를 실행합니다. `통과` 열두 줄이 나와야 합니다. 첫 세 줄은 B 메모를 변조·삭제한 뒤 B가 복원하면 ID·소유자·내용 해시가 사본과 같고 다른 메모가 그대로이며, 덮어쓰기 전 변조·삭제 상태가 감사 기록에 먼저 남는다는 뜻입니다.
3. `npm run owner:check`를 실행합니다. `통과` 아홉 줄이 나와야 하고, B의 A 메모 읽기·수정·삭제는 403, A의 정상 요청은 200입니다.
4. `npm run policy:diff`와 `npm run policy:restore`를 실행합니다. 지금은 `차이 없음`, `바뀔 항목: 없음`이 나와야 합니다.
5. `npm run decider:test`, `npm run detect:test`가 각각 `통과` 여섯 줄이어야 합니다.

2026-10-14 로컬 확인 기록: 위 2~5번이 통과했습니다. 2·3번은 로그인 검사와 DB를 가짜로 바꾼 시험으로, 사본이 변조되면 409로 멈추고, A가 B 메모를 복원하려 하면 403이며, 감사 기록은 덧붙기만 함을 확인했습니다. 정책 되돌리기는 임시 복제본에서 판정기·탐지 함수·허용 경로를 일부러 바꾼 뒤 적용해, 복원 뒤 위 시험이 모두 통과하고 다른 설정이 그대로임을 확인했습니다. 가상 요청·로컬 시험이며 배포 확인이나 심판 판정이 아닙니다. `supabase/step10-note-backup.sql`은 학생이 Supabase SQL Editor에서 실행했다고 알려 왔습니다(결과 화면의 `b_test_backed_up`·`b_test_matches_now` 값은 이 기록에서 직접 보지 않았습니다). 배포된 복구 경로를 실제 B 계정으로 부른 기록은 아직 없습니다.

### 복구 뒤 1~9단계 다시 확인 순서

정책을 되돌리거나 메모를 복구한 직후, 아래 순서로 이전 단계의 정상 요청이 그대로 되고 금지 요청이 다시 거부되는지 봅니다.

1. **정책이 돌아왔는지:** `npm run policy:diff` → `변경 범위: 차이 없음`. 차이가 나오면 `npm run policy:restore`로 미리 보고 `-- --apply <해시 12자리>`로 되돌린 뒤 다시 실행합니다.
2. **판정기(6~9단계):** `npm run decider:test`(통과 6줄), `npm run fixture:7`(`allow`, `step_up`), `npm run detect:test`(통과 6줄).
3. **서버 API(3·4·10단계):** `npm run owner:check`(통과 9줄), `npm run restore:check`(통과 12줄).
4. **배포 파일(1·2·5단계):** 아래 「가상 메모 노출 확인 절차」 2번 명령 → `/`·`/index.html`·`/aleph.json`은 `200 memo=False`, `/data.json`은 `404`. 같은 응답에 `X-Content-Type-Options: nosniff`가 있어야 합니다.
5. **배포 API(3~5·8·10단계):** 커밋·배포 뒤 `npm run bundle` → `artifacts/submission.json`의 `attackAttempts`에서 토큰 없는 요청은 401 JSON, 원본 API 직접 요청은 401 `42501`, 정적 파일의 키 형태 문자열·시드 표식은 0개여야 합니다. 직접 보내지 못한 점검은 `미실행`으로 남습니다.

| 단계 | 정상 요청 (유지) | 금지 요청 (다시 거부) | 2026-10-14 결과 |
| --- | --- | --- | --- |
| 1 | 첫 화면 `/` 200 | `/data.json`·정적 파일의 메모 | 배포(`c039e3d`)에 실제 요청: `/data.json` 404, 정적 파일 3개 메모 없음 |
| 2 | 모든 응답 `nosniff` | — | 배포 응답 3개에 `nosniff`, `vercel.json`의 `/(.*)` 헤더 그대로 |
| 3 | A 로그인 후 메모 목록 | 토큰 없는 GET·POST `/api/notes`, 위조 서명 토큰 | 배포에 실제 요청: 401 `LOGIN_REQUIRED`·`INVALID_LOGIN_TOKEN`. 만료·다른 서비스 토큰은 **미실행**. A 로그인 정상 요청은 배포에서 **미실행** |
| 4 | A의 자기 메모 읽기·수정 | 토큰 없는 `/api/notes/:id`, B의 A 메모 읽기·수정·삭제, 본문 `owner_id` | 배포에 실제 요청: 토큰 없는 GET·PUT·DELETE 401. 타인 메모 거부와 A 정상 요청은 로컬 가짜 DB(`owner:check`)에서만 확인, 실제 A·B 계정은 **미실행** |
| 5 | 서버 함수로만 메모 처리 | 공개 키로 원본 API 직접 GET·PATCH, 정적 파일의 키 | 배포에 실제 요청: 원본 API 401 `42501`, 정적 파일 키 형태 0개. 시험 계정 토큰으로 원본 API 호출은 **미실행** |
| 6 | 등록 기기의 메모 단건 `allow` | 미등록 기기 `device_not_registered` | 가상 요청(`decider:test`)만 통과. 배포 미등록 기기 접속은 **미실행**(심판 담당) |
| 7 | 정상 사건 `allow` | 복합 이상 사건 `step_up` | 가상 요청(`decider:test`, `fixture:7`)만 통과. 배포 경로 차단은 **미실행** |
| 8 | 메모 단건·공지 읽기 `allow` | 메모 목록·공지 쓰기·강사 자료·`export`·쿼리 붙은 요청 | 가상 요청 20건 형식 검사 통과. 배포에 실제 요청: 토큰 없는 공지 수정·관리 경로·강사 자료 401. 학생 토큰 공지 수정은 **미실행** |
| 9 | 정상 사건 `observe` | 의심 사건 `burst_read` 회수 제안 | 가상 요청(`decider:test`, `detect:test`)만 통과. 실제 회수는 **미실행**(심판 담당) |
| 10 | B가 자기 메모 복원 200 | 토큰 없는 복원, A의 B 메모 복원 | 로컬 가짜 DB(`restore:check`)만 통과. 배포에 실제 보낸 토큰 없는 복원은 401 `LOGIN_REQUIRED`. 실제 B 계정 복원은 **미실행** |

2026-10-14 점검 기록(10단계 저장점 `c039e3d` 배포 기준):
- `aleph.config.json`의 `step`은 10입니다. 배포된 `/aleph.json`이 `step: 10`, 커밋 `c039e3d`이고, 기존 `allowedRoutes` 세 개와 `originalApiUrl`이 그대로 실립니다.
- `npm run bundle`의 직접 점검 20개 중 15개를 배포에 실제로 보냈고 모두 위 표대로 거부·정상이었습니다. 나머지 5개는 미실행입니다.
- 판정기는 계약의 요청 이름만 읽습니다. `role`·`identity`·`device`를 붙인 요청과 빈 요청을 포함한 가상 요청 20건 모두 응답이 다섯 항목 형식이었고, `ruleIds`는 모두 `RULE_IDS` 안에 있었습니다. `allowedRoutes` 세 경로는 판정기에서 `allow`, 복구 경로는 `zone.default_deny`였습니다.
- `public/`에는 `index.html`만 있고 `data.json`이 없으며, Supabase 키 형태 문자열과 시드 표식은 0개입니다.
- 저장소를 새로 받아 `npm install`을 실행했을 때 오류와 취약점 경고가 없었고 `package-lock.json`이 바뀌지 않았습니다.
- 가상 요청과 로컬 시험, 학생이 보낸 배포 요청 기록은 심판 판정이 아닙니다.

**공격 점검:** `npm run bundle`의 `src/attack-check.mjs`는 10단계에서 9단계까지의 실제 요청 점검에 토큰 없는 `POST /api/restore/notes/:id`(B 시험 메모, `anonymous_note_restore`)를 더 보냅니다. 직접 점검 최대 20개에 맞추려고, 같은 이유(실제 계정 토큰 필요)로 미실행인 계정 토큰 점검과 학생 공지 수정 점검을 `account_token_access` 한 항목으로 합쳤습니다.

**남은 약점:** 복구 경로는 판정기의 허용 경로(`allowedRoutes`)에 넣지 않았고 판정기 규칙도 바꾸지 않았습니다. 엔진을 거치는 요청이라면 판정기의 `zone.default_deny`로 거부됩니다. 사본은 SQL을 실행한 시점의 메모만 담으므로, 그 뒤에 만든 메모나 사본 전에 이미 변조된 메모는 되살릴 수 없습니다. 서버 함수는 이제 11개로 Vercel Hobby 한도(12개)에 가깝습니다.

## 가상 메모 노출 확인 절차

검색어는 메모 본문·제목 일부입니다. `[가]`처럼 한 글자를 괄호로 감싼 정규식을 써서 이 README 자체는 검색에 걸리지 않게 합니다. Windows의 Git 기본 정규식은 이런 한글 괄호식을 놓치므로 `git grep`에는 반드시 `-P`를 붙이세요. 화면 확인 때는 `supabase/*.local.sql`의 `content` 값을 그대로 검색하세요.

1. **GitHub 최신 파일** — 푸시한 뒤 실행합니다. 정상이면 아무것도 출력되지 않습니다.

   ```powershell
   git fetch origin
   git grep -n -P -e "실습용 [가]상" -e "아침 [리]추얼" -e "훈련 [행]정" origin/main
   ```

   GitHub 웹에서도 비로그인 창으로 `data.json`, `public/data.json`이 없는지 확인합니다.

2. **현재 배포 파일** — `<배포 주소>`에 Vercel Production 주소를 넣습니다. 정상이면 `/`, `/index.html`, `/aleph.json`은 `200 memo=False`, `/data.json`은 `404`입니다. `/data.json`이 `200`이면 실패입니다.

   ```powershell
   $app = 'https://<배포 주소>'
   foreach ($p in '/', '/index.html', '/data.json', '/aleph.json') { try { $r = Invoke-WebRequest "$app$p" -UseBasicParsing; "$p $($r.StatusCode) memo=$([bool]($r.Content -match '실습용 [가]상|아침 [리]추얼|훈련 [행]정'))" } catch { "$p $([int]$_.Exception.Response.StatusCode)" } }
   ```

   브라우저에서는 `/`에서 **Ctrl+U**(페이지 소스)를 열고 메모 문장을 **Ctrl+F**로 찾습니다. 화면 카드에는 메모가 보이지만, 그것은 `/api/notes` 응답이며 정적 파일에는 없어야 합니다.

3. **과거 노출** — 아래 명령에 커밋 번호가 나오면 옛 공개 커밋에 메모가 남아 있는 것입니다. Vercel **Deployments** 목록의 옛 배포 고유 주소에 `/data.json`을 붙여 열어 보고, 메모가 보이면 옛 배포도 남아 있는 것입니다.

   ```powershell
   git grep -c -P -e "실습용 [가]상" -e "아침 [리]추얼" -e "훈련 [행]정" (git rev-list origin/main)
   ```

옛 공개 커밋이나 옛 배포가 남아 있는 한 과거 노출은 해소되지 않았습니다. 최신 파일 검색이 0건이어도 "노출 해소"로 기록하지 마세요. 그 기간에 이미 복제·캐시된 사본도 되돌릴 수 없습니다.

### 확인 기록 (2026-10-07, 4단계 저장점 배포 `d51e699` 기준)

**검색 결과**

- GitHub 최신 파일(`origin/main`): 메모 문장 0건입니다(1번 명령).
- 현재 배포 파일(`https://choi-bujang-secret-vault-gamma.vercel.app`): `/data.json`은 404, `/`·`/index.html`·`/aleph.json`은 200이고 메모 문장이 없습니다. 첫 화면에 `X-Content-Type-Options: nosniff`가 있습니다.
- GitHub 비로그인 조회: 저장소 API가 404입니다. 저장소가 비공개이거나 비로그인 접근이 막힌 상태로 보입니다. 1단계 조건은 Public 저장소입니다.
- 과거 노출: 해소되지 않음. 3번 명령에서 `d5b10a0`의 `data.json` 4줄과 `public/data.json` 4줄이 나오고, 1단계 배포를 삭제한 기록도 없습니다.

**공개 API의 남은 약점**

- 2단계의 "비로그인으로 `/api/notes`를 읽을 수 있음"은 3단계에서 막았습니다. 배포에서 토큰 없는 GET·POST `/api/notes`와 GET·PUT·DELETE `/api/notes/:id`가 모두 401 JSON(`LOGIN_REQUIRED`)으로 거부되는 것을 확인했습니다.
- 3단계의 소유자 검사 부재는 4단계 코드에서 고쳤습니다. 로컬 가짜 DB 시험에서는 상대 메모 접근과 소유자 변경이 403으로 거부됐지만, 실제 A·B 계정으로 배포를 확인한 기록은 아직 없습니다.
- 학습 DB SQL(3·4·5단계)을 실제로 실행했는지는 이 기록에 확인되지 않았습니다. 5단계 원본 API 직접 점검 결과는 `npm run bundle`의 `artifacts/submission.json`에 남습니다.
- 요청 횟수 제한은 아직 없습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
