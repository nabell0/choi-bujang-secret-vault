-- 11단계: 기기 등록부 public.device_registrations를 만듭니다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 검토한 뒤 Run을 누릅니다. notes·notices 등 다른 테이블은 바꾸지 않습니다.
-- 등록부에는 기기 ID(확인 코드), 소유자, 패스키 ID, 공개키(SPKI)와 상태만 있습니다. 개인키·토큰·메모는 없습니다.
-- 서버 함수(service_role)는 조회·추가만 할 수 있고, 추가한 행은 언제나 'pending'입니다. 승인은 이 SQL Editor에서만 합니다.

begin;

create table if not exists public.device_registrations (
  device_id text primary key check (device_id ~ '^[0-9a-f]{16}$'),
  owner_id uuid not null,
  credential_id text not null unique check (credential_id ~ '^[A-Za-z0-9_-]{16,1024}$'),
  public_key_spki text not null check (public_key_spki ~ '^[A-Za-z0-9_-]{64,1024}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- 추가 요청이 어떤 상태를 보내도 'pending'으로만 들어갑니다(화면·API로는 승인할 수 없음).
create or replace function public.device_registrations_force_pending()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.status := 'pending';
  new.decided_at := null;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists device_registrations_force_pending on public.device_registrations;
create trigger device_registrations_force_pending before insert on public.device_registrations
  for each row execute function public.device_registrations_force_pending();

alter table public.device_registrations enable row level security;
revoke all on table public.device_registrations from public, anon, authenticated, service_role;
grant select, insert on table public.device_registrations to service_role;
revoke all on function public.device_registrations_force_pending() from public, anon, authenticated;

commit;

-- 확인: 권한 대조표. service_role은 SELECT·INSERT만 true, anon·authenticated는 모두 false여야 합니다.
select r.role,
  has_table_privilege(r.role, 'public.device_registrations', 'SELECT') as can_select,
  has_table_privilege(r.role, 'public.device_registrations', 'INSERT') as can_insert,
  has_table_privilege(r.role, 'public.device_registrations', 'UPDATE') as can_update,
  has_table_privilege(r.role, 'public.device_registrations', 'DELETE') as can_delete
from (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- [목록] 화면의 "확인 코드"와 같은 device_id인지, 소유자가 맞는지 대조합니다.
-- select device_id, owner_id, status, created_at, decided_at from public.device_registrations order by created_at desc;

-- [승인] 확인 코드를 대조한 기기 한 대만 승인합니다. '<확인 코드>'를 화면의 16자리로 바꿔 실행합니다.
-- update public.device_registrations set status = 'approved', decided_at = now()
--   where device_id = '<확인 코드>' and status = 'pending';

-- [회수] 승인을 거둡니다. 그 기기의 다음 요청부터 자료가 닫힙니다.
-- update public.device_registrations set status = 'revoked', decided_at = now()
--   where device_id = '<확인 코드>';
