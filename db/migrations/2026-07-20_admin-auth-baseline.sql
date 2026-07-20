-- ============================================================================
-- Chewstep · 관리자/보안 기본선 마이그레이션 v1
-- 브랜치: feature/admin-auth   |  날짜: 2026-07-20
-- 목적: 이미 존재하는 로그인/profiles/RLS 위에서
--   (1) 🔴 권한상승 취약점 차단  (2) 🔴 본인 분석결과 조회 허용
--   (3) 🔴 미사용 연습테이블 개방 정책 닫기  (4) 관리자 전체 사용자목록 조회 지원
--   (5) profiles 컬럼/역할 보강 + 신규가입자 email 저장
-- 근거: pg_policies / pg_proc 실측 (2026-07-20). 되돌리기 쉬운 변경만 포함.
-- ============================================================================

-- ── 0) is_admin: super_admin도 관리자 권한에 포함 ───────────────────────────
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(
  select 1 from public.profiles
  where id = auth.uid() and role in ('admin','super_admin')
) $$;

-- ── 1) profiles 컬럼 보강 + 역할 어휘 확정 ─────────────────────────────────
alter table public.profiles
  add column if not exists email          text,
  add column if not exists is_active      boolean not null default true,
  add column if not exists last_login_at  timestamptz,
  add column if not exists organization_id uuid;

-- 기존 사용자 email 백필(auth.users → profiles)
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

-- 역할 값 제약: user / staff / admin / super_admin
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk check (role in ('user','staff','admin','super_admin'));

-- ── 2) 관리자 계정을 super_admin으로 승격 (권한 변경 가능자) ─────────────────
update public.profiles set role = 'super_admin'
where id = 'db87c0fc-cee4-43f1-8397-da1890e95315';  -- algo426@naver.com

-- ── 3) 🔴 권한상승 차단 ────────────────────────────────────────────────────
-- role / is_active / organization_id 변경은 super_admin(또는 서버=service_role)만.
-- auth.uid() IS NULL → service_role(Edge Function) 이므로 허용, 그 외엔 super_admin만.
create or replace function public.guard_profile_privilege()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (new.role            is distinct from old.role)
  or (new.is_active       is distinct from old.is_active)
  or (new.organization_id is distinct from old.organization_id) then
    if auth.uid() is not null
       and not exists(select 1 from public.profiles
                      where id = auth.uid() and role = 'super_admin') then
      raise exception '권한 변경(role/is_active/organization_id)은 super_admin만 가능합니다';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile_privilege();

-- ── 4) 관리자: 전체 사용자 목록 조회 (/admin 사용자 탭) ─────────────────────
drop policy if exists admin_read_all_profiles on public.profiles;
create policy admin_read_all_profiles on public.profiles
  for select to authenticated using (public.is_admin());

-- ── 5) 🔴 본인 분석결과 조회 (보호자가 자기 결과를 볼 수 있게) ───────────────
drop policy if exists demo_select_own on public.demo_responses;
create policy demo_select_own on public.demo_responses
  for select to authenticated using (auth.uid() = user_id);

-- ── 6) 🔴 미사용 연습테이블 anon 전체개방(ALL/true) 닫기 ────────────────────
drop policy if exists practice_anon_all_frames   on public.chew_frames;
drop policy if exists practice_anon_all_sessions on public.chew_sessions;

-- ── 7) 신규 가입 시 profiles.email 자동 저장 ───────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name',      new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'nickname',  new.raw_user_meta_data->>'user_name'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_app_meta_data->>'provider', 'unknown')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ============================================================================
-- 적용 후 검증(별도 실행):
--   • 일반계정으로 update profiles set role='admin' where id=auth.uid()  → 실패해야 정상
--   • 일반계정으로 select * from demo_responses where user_id=auth.uid() → 본인 것만 보임
--   • 관리자계정 select count(*) from profiles → 전체(3) 보임
-- ============================================================================
