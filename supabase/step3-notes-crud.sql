-- 3단계: 로그인한 사용자가 가상 메모를 추가·수정·삭제할 수 있도록 notes 테이블을 바꿉니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run을 누릅니다. 다시 실행해도 안전합니다.
-- 2단계 SQL(supabase/notes.local.sql)을 먼저 실행한 프로젝트에서만 실행합니다.

-- 메모 ID를 UUID로 바꿉니다. 기존 숫자 ID는 정렬용 seq로 남깁니다.
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'notes' and column_name = 'id') = 'bigint' then
    alter table public.notes drop constraint notes_pkey;
    alter table public.notes rename column id to seq;
    alter table public.notes add column id uuid not null default gen_random_uuid();
    alter table public.notes add primary key (id);
  end if;
end $$;

-- 여러 사용자가 같은 제목을 쓸 수 있게 제목 중복 금지를 풉니다.
alter table public.notes drop constraint if exists notes_title_key;
alter table public.notes add column if not exists updated_at timestamptz not null default now();
create index if not exists notes_owner_id_idx on public.notes (owner_id);

-- 브라우저 키(anon·authenticated)는 계속 직접 읽거나 쓸 수 없습니다. 서버 함수만 서버 전용 키로 접근합니다.
alter table public.notes enable row level security;
revoke all on table public.notes from anon, authenticated;

-- (선택) 기존 가상 메모 네 건을 A 계정 목록에 보이게 하려면 아래 이메일 자리를 A 계정 이메일로 바꿔 실행합니다.
-- 이메일은 SQL Editor에서만 바꾸고, 이 파일에 적어 커밋하지 마세요. 바꾸지 않으면 아무 행도 바뀌지 않습니다.
update public.notes
set owner_id = (select id from auth.users where email = '<A 계정 이메일>')
where owner_id is null
  and exists (select 1 from auth.users where email = '<A 계정 이메일>');

-- 확인: id_type = uuid, rls_enabled = true, title_unique = 0, anon_authenticated_grants = 0 이어야 합니다.
-- owned_by_someone은 위 (선택) 문장을 실행했을 때 4가 됩니다.
select
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'notes' and column_name = 'id') as id_type,
  (select relrowsecurity from pg_class where oid = 'public.notes'::regclass) as rls_enabled,
  (select count(*) from pg_constraint
    where conrelid = 'public.notes'::regclass and conname = 'notes_title_key') as title_unique,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'notes'
      and grantee in ('anon', 'authenticated')) as anon_authenticated_grants,
  (select count(*) from public.notes) as note_count,
  (select count(*) from public.notes where owner_id is not null) as owned_by_someone;
