-- 4단계: 학습 DB의 public.notes에 RLS와 최소 권한을 적용합니다. 다른 테이블은 건드리지 않습니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 검토한 뒤 Run을 누릅니다. 다시 실행해도 안전합니다.
-- 4단계 소유자 SQL(supabase/step4-owners.sql)을 먼저 실행해 모든 메모에 owner_id가 있는 상태에서 실행합니다.
-- 마지막 결과 표에서 적용 전(before_*)과 적용 후(after_*)의 실제 권한을 역할별로 대조합니다.

-- 대조에 쓸 권한 표: 표 권한 기록(role_table_grants)과 실제 적용 권한(has_table_privilege)을 함께 봅니다.
-- has_table_privilege의 'public'은 모든 역할이 받는 PUBLIC 권한을 뜻합니다.
create or replace temp view step4_notes_privileges as
select r.role, p.privilege,
  exists (select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'notes'
      and g.grantee = r.grantee and g.privilege_type = p.privilege) as granted,
  has_table_privilege(r.role, 'public.notes', p.privilege) as effective
from (values ('anon', 'anon'), ('authenticated', 'authenticated'), ('public', 'PUBLIC')) as r(role, grantee)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
  as p(privilege);

drop table if exists pg_temp.step4_before;
create temp table step4_before as select * from step4_notes_privileges;

begin;

alter table public.notes enable row level security;

-- 기존 권한을 먼저 모두 회수하고, 로그인한 사용자(authenticated)에게 네 가지만 줍니다. anon에는 아무것도 주지 않습니다.
revoke all on table public.notes from public, anon, authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

-- 이 표의 기존 정책을 모두 지웁니다. 남아 있는 허용(permissive) 정책이 있으면 아래 조건이 OR로 넓어지기 때문입니다.
do $$
declare
  existing record;
begin
  for existing in select policyname from pg_policies where schemaname = 'public' and tablename = 'notes' loop
    execute format('drop policy %I on public.notes', existing.policyname);
  end loop;
end $$;

-- auth.uid()는 (select ...)로 감싸 한 번만 계산합니다. 조건은 auth.uid() = owner_id와 같습니다.
-- owner_id가 비어 있는 행은 auth.uid()와 같을 수 없으므로 누구에게도 허용되지 않습니다.
create policy notes_select_own on public.notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy notes_insert_own on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy notes_update_own on public.notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy notes_delete_own on public.notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;

-- 정책만 따로 확인하려면 아래 주석을 풀어 따로 실행합니다. 네 줄(select·insert·update·delete)이 나와야 합니다.
-- select policyname, cmd, roles, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'notes' order by cmd;

-- 확인: after 열에서 anon·public은 모두 false, authenticated는 SELECT·INSERT·UPDATE·DELETE만 true여야 합니다.
-- expected_after와 after_effective가 다르면 matches_expected가 false로 나옵니다.
select b.role, b.privilege,
  b.granted as before_granted, b.effective as before_effective,
  a.granted as after_granted, a.effective as after_effective,
  (a.role = 'authenticated' and a.privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as expected_after,
  a.effective = (a.role = 'authenticated' and a.privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
    and a.granted = a.effective as matches_expected
from step4_before b
join step4_notes_privileges a using (role, privilege)
order by array_position(array['anon', 'authenticated', 'public'], b.role),
  array_position(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'], b.privilege);
