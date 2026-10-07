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

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 2단계: 자료를 코드 밖으로 옮겼습니다

가상 메모 네 건은 이제 저장소가 아니라 학습용 Supabase `notes` 테이블에 있습니다. 테이블은 RLS가 켜져 있고 `anon`·`authenticated`에는 읽기 권한이 없습니다. 테이블을 만드는 SQL(`supabase/*.local.sql`)은 메모 본문이 들어 있어 Git에 올리지 않습니다.

화면은 `/api/notes` 서버 함수를 거쳐 메모를 읽습니다. 함수는 Vercel 프로젝트 **Settings → Environment Variables**에 학생이 직접 넣은 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`만 사용하며, 키는 브라우저 파일·응답·로그에 나오지 않습니다. 정적 파일 `/data.json`은 더 이상 만들지 않아 404가 됩니다. 모든 응답에는 `X-Content-Type-Options: nosniff` 헤더가 붙습니다(`vercel.json`).

### 다시 실행하는 방법

```powershell
npm ci
npm run build -- --local
npm run test:r5
npm run bundle
```

`npm run bundle`은 커밋되지 않은 파일이 없고, Git에서 제외된 `bundle-notes.json`(이번 단계 설명)이 있을 때만 `artifacts/submission.json`을 만듭니다. 공격 점검은 `aleph.config.json`의 `publicAppUrl`에 실제로 요청을 보낸 결과만 기록하며 심판 판정이 아닙니다. `npm run test:package`의 함수 기준표 시험은 `api/notes.js`가 추가되어 실패합니다.

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

### 확인 기록 (2026-10-07, 2단계 변경 푸시 전)

**검색 결과**

- 푸시할 로컬 파일(Git 제외 파일 빼고): 0건. `public` 폴더에는 `index.html`만 있고 메모 문장은 0건입니다.
- GitHub 최신 파일(`origin/main` = `d5b10a0`): `data.json` 4줄, `public/data.json` 4줄이 검색됩니다. 2단계 변경을 아직 푸시하지 않았기 때문입니다. 푸시 뒤 1번을 다시 실행하고 이 기록을 고쳐 주세요.
- GitHub 비로그인 조회: 저장소 API와 raw 파일이 모두 404입니다. 저장소가 비공개로 바뀌었거나 비로그인 접근이 막힌 상태로 보입니다. 1단계 조건은 Public 저장소입니다.
- 현재 배포 파일: 미실행. 배포 주소를 확인하지 않았고 2단계는 아직 배포 전입니다. 확인 전까지 현재 배포의 `/data.json`은 메모가 공개된 상태로 간주합니다.
- 과거 노출: 해소되지 않음. 3번 명령에서 `d5b10a0`의 `data.json` 4줄과 `public/data.json` 4줄이 나왔고, 1단계 배포를 삭제한 기록도 없습니다.

**공개 API의 남은 약점**

- `/api/notes`는 로그인 없이 누구나 여는 공개 주소입니다. 정적 파일 검색이 0건이어도 이 주소로 메모 네 건이 그대로 나갑니다.
- 요청 횟수 제한이 없어 같은 주소를 반복 호출해도 막지 않습니다.
- 접근 제한은 3단계 로그인에서 추가합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
