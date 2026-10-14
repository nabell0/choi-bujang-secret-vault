-- 10단계: 비공개 메모 사본 public.notes_backup과 복원 감사 기록 public.note_restore_audit을 만듭니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 검토한 뒤 Run을 누릅니다. notes·notices 등 다른 테이블은 바꾸지 않습니다.
-- 사본은 실행하는 순간의 notes를 그대로 뜹니다. B 시험 메모가 정상일 때(침해 전) 실행하세요.
-- 다시 실행해도 이미 뜬 사본은 덮어쓰지 않습니다. 메모 본문은 이 DB에만 있고 Git·제출 묶음에는 들어가지 않습니다.
-- 내용 해시 = SHA-256("<제목의 UTF-8 바이트 수>:<제목><내용>"), src/notes-server.mjs의 noteContentSha256과 같은 식입니다.

begin;

create table if not exists public.notes_backup (
  id uuid primary key,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  backed_up_at timestamptz not null default now()
);

create table if not exists public.note_restore_audit (
  id bigint generated always as identity primary key,
  note_id uuid not null,
  actor_id uuid not null,
  result text not null check (result ~ '^[a-z_]{1,40}$'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);

-- 공개 키·로그인 토큰의 직접 권한은 없습니다. 서버 함수(service_role)는 사본을 읽기만, 감사 기록은 읽기·추가만 합니다.
alter table public.notes_backup enable row level security;
alter table public.note_restore_audit enable row level security;
revoke all on table public.notes_backup, public.note_restore_audit from public, anon, authenticated, service_role;
grant select on table public.notes_backup to service_role;
grant select, insert on table public.note_restore_audit to service_role;
do $$
begin
  execute format('grant usage on sequence %s to service_role', pg_get_serial_sequence('public.note_restore_audit', 'id'));
end $$;

insert into public.notes_backup (id, owner_id, title, content, content_sha256)
select id, owner_id, title, content,
  encode(sha256(convert_to(octet_length(title)::text || ':' || title || content, 'UTF8')), 'hex')
from public.notes
where owner_id is not null and title is not null and content is not null
on conflict (id) do nothing;

commit;

-- 확인 1: b_test_backed_up = true, b_test_matches_now = true(지금 B 시험 메모가 사본과 같음)이어야 합니다.
select
  (select count(*) from public.notes_backup) as backup_count,
  exists (select 1 from public.notes_backup where id = 'b4000000-0000-4000-8000-000000000001') as b_test_backed_up,
  (select b.owner_id = n.owner_id
      and b.content_sha256 = encode(sha256(convert_to(octet_length(n.title)::text || ':' || n.title || n.content, 'UTF8')), 'hex')
    from public.notes_backup b join public.notes n using (id)
    where b.id = 'b4000000-0000-4000-8000-000000000001') as b_test_matches_now;

-- 확인 2: public·anon·authenticated는 모두 false, service_role은 사본 SELECT와 감사 기록 SELECT·INSERT만 true여야 합니다.
select t.name as table_name, r.role, p.privilege, has_table_privilege(r.role, t.name, p.privilege) as effective
from (values ('public.notes_backup'), ('public.note_restore_audit')) as t(name)
cross join (values ('public'), ('anon'), ('authenticated'), ('service_role')) as r(role)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege)
order by t.name, array_position(array['public', 'anon', 'authenticated', 'service_role'], r.role),
  array_position(array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], p.privilege);
