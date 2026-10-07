-- 4단계 준비: 기존 가상 메모를 A 소유로 연결하고, B 소유의 공개 가능한 시험 메모 한 건을 준비합니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고, 아래 두 이메일 자리만 바꾼 뒤 Run을 누릅니다. 다시 실행해도 안전합니다.
-- 이메일은 SQL Editor에서만 바꾸고, 이 파일에 적어 커밋하지 마세요.
-- 3단계 SQL(supabase/step3-notes-crud.sql)을 먼저 실행한 프로젝트에서만 실행합니다. API와 권한 정책은 바꾸지 않습니다.

drop table if exists pg_temp.step4_accounts;
create temp table step4_accounts (label text primary key, email text not null);
insert into step4_accounts values
  ('A', '<A 계정 이메일>'),
  ('B', '<B 계정 이메일>');

do $$
declare
  a_id uuid;
  b_id uuid;
begin
  select u.id into a_id from auth.users u
    join step4_accounts s on lower(u.email) = lower(trim(s.email)) where s.label = 'A';
  select u.id into b_id from auth.users u
    join step4_accounts s on lower(u.email) = lower(trim(s.email)) where s.label = 'B';
  if a_id is null then raise exception 'A 계정 이메일을 auth.users에서 찾지 못했습니다. 이메일 자리를 확인하세요.'; end if;
  if b_id is null then raise exception 'B 계정 이메일을 auth.users에서 찾지 못했습니다. 이메일 자리를 확인하세요.'; end if;
  if a_id = b_id then raise exception 'A와 B는 서로 다른 계정이어야 합니다.'; end if;

  -- 소유자가 없는 행은 2단계에서 옮긴 가상 메모 네 건뿐입니다(3단계 API는 추가할 때 항상 owner_id를 넣음).
  update public.notes set owner_id = a_id, updated_at = now() where owner_id is null;

  -- B의 시험 메모는 고정 ID로 만들어 다시 실행해도 한 건만 남습니다. 4단계에서 A가 이 ID로 접근하는 시험에 씁니다.
  insert into public.notes (id, owner_id, title, content)
  values ('b4000000-0000-4000-8000-000000000001', b_id, 'B 시험 메모',
    'B 계정이 가진 공개 가능한 시험 메모입니다. 4단계부터 A는 이 메모를 읽거나 고칠 수 없어야 합니다.')
  on conflict (id) do update
    set owner_id = excluded.owner_id, title = excluded.title, content = excluded.content, updated_at = now();
end $$;

-- 확인: a_notes = 4(3단계에서 A가 직접 추가한 메모가 있으면 그만큼 더 많음), b_notes = 1,
-- ownerless = 0, b_test_owned_by_b = true 이어야 합니다.
with owners as (
  select s.label, u.id from step4_accounts s
  join auth.users u on lower(u.email) = lower(trim(s.email))
)
select
  (select count(*) from public.notes where owner_id = (select id from owners where label = 'A')) as a_notes,
  (select count(*) from public.notes where owner_id = (select id from owners where label = 'B')) as b_notes,
  (select count(*) from public.notes where owner_id is null) as ownerless,
  (select owner_id = (select id from owners where label = 'B') from public.notes
    where id = 'b4000000-0000-4000-8000-000000000001') as b_test_owned_by_b;
