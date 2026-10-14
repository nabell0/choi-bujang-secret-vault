-- 8단계: 반 공지 테이블 public.notices를 만듭니다. notes 등 다른 테이블은 건드리지 않습니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 검토한 뒤 Run을 누릅니다. 다시 실행해도 안전합니다.
-- 공지는 Vercel 서버 함수만 서버 전용 키(service_role)로 읽고 고칩니다. 공개 키·로그인 토큰의 직접 권한은 주지 않습니다.
-- 공지 수정은 서버의 /api/admin/notices/:id에서 INSTRUCTOR_USER_IDS에 있는 로그인만 할 수 있습니다.

begin;

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  content text not null check (char_length(content) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS를 켜고 정책은 만들지 않습니다. 공개 키(anon)·로그인 토큰(authenticated)·PUBLIC 권한도 모두 거둡니다.
alter table public.notices enable row level security;
revoke all on table public.notices from public, anon, authenticated;
grant select, insert, update, delete on table public.notices to service_role;

-- 구역 분리 시험용 가상 공지 한 건. 고정 ID로 넣어 다시 실행해도 한 건만 남습니다.
insert into public.notices (id, title, content)
values ('c8000000-0000-4000-8000-000000000001', '8단계 시험용 반 공지', '구역 분리 시험을 위한 가상 공지입니다.')
on conflict (id) do nothing;

commit;

-- 확인: public·anon·authenticated는 모든 권한이 false, service_role은 SELECT·INSERT·UPDATE·DELETE가 true여야 합니다.
select r.role, p.privilege, has_table_privilege(r.role, 'public.notices', p.privilege) as effective
from (values ('public'), ('anon'), ('authenticated'), ('service_role')) as r(role)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege)
order by array_position(array['public', 'anon', 'authenticated', 'service_role'], r.role),
  array_position(array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], p.privilege);
