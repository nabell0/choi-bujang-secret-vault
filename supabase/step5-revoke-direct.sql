-- 5단계: 학습용 public.notes를 공개 키·로그인 토큰으로 직접 부르는 길을 닫습니다. 다른 테이블은 건드리지 않습니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 검토한 뒤 Run을 누릅니다. 다시 실행해도 안전합니다.
-- 앱의 메모 읽기·추가·수정·삭제는 Vercel 서버 함수가 서버 전용 키(service_role)로 하므로 이 SQL의 영향을 받지 않습니다.
-- 마지막 결과 표에서 적용 전(before_*)과 적용 후(after_*)의 실제 권한을 역할별로 대조합니다.

-- 표 권한 기록(role_table_grants)과 실제 적용 권한(has_table_privilege)을 함께 봅니다.
-- has_table_privilege의 'public'은 모든 역할이 받는 PUBLIC 권한입니다. service_role은 서버 함수가 쓰는 역할로, 비교용으로 함께 봅니다.
create or replace temp view step5_notes_privileges as
select r.role, p.privilege,
  exists (select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'notes'
      and g.grantee = r.grantee and g.privilege_type = p.privilege) as granted,
  has_table_privilege(r.role, 'public.notes', p.privilege) as effective
from (values ('public', 'PUBLIC'), ('anon', 'anon'), ('authenticated', 'authenticated'),
  ('service_role', 'service_role')) as r(role, grantee)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
  as p(privilege);

drop table if exists pg_temp.step5_before;
create temp table step5_before as select * from step5_notes_privileges;

begin;

-- RLS는 켠 채로 둡니다. 4단계의 본인 행 정책도 남겨, 나중에 권한이 실수로 다시 생겨도 남의 행은 열리지 않게 합니다.
alter table public.notes enable row level security;

-- 공개 키(anon)와 로그인 토큰(authenticated), 모든 역할(PUBLIC)의 직접 권한을 모두 거둡니다. 다시 주지 않습니다.
revoke all on table public.notes from public, anon, authenticated;

-- notes의 자동 번호(seq) 시퀀스도 같은 세 역할에서 거둡니다. 다른 시퀀스는 건드리지 않습니다.
do $$
declare
  seq_name text := pg_get_serial_sequence('public.notes', 'seq');
begin
  if seq_name is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq_name);
  end if;
end $$;

commit;

-- 확인: public·anon·authenticated는 after 열이 모두 false여야 합니다.
-- service_role은 적용 전후가 같아야 합니다(SELECT·INSERT·UPDATE·DELETE가 true면 서버 함수가 계속 동작).
select b.role, b.privilege,
  b.granted as before_granted, b.effective as before_effective,
  a.granted as after_granted, a.effective as after_effective,
  case when a.role = 'service_role' then a.effective = b.effective else not a.effective and not a.granted end
    as matches_expected
from step5_before b
join step5_notes_privileges a using (role, privilege)
order by array_position(array['public', 'anon', 'authenticated', 'service_role'], b.role),
  array_position(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'], b.privilege);
