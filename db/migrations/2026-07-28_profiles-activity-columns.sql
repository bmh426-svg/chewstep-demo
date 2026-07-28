-- ============================================================================
-- 사용자 활동 컬럼 복원(last_login_at · is_active) + 로그인 시각 기록 RPC · v0.1
-- 대상: qwfskemfsrkmlrdttvqy · public.profiles
-- 작성: 2026-07-28
--
-- 배경(실측):
--   2026-07-26 B2C→B2B 단일 프로젝트 통합(adiq → qwfsk) 때 profiles 스키마가 B2B 쪽
--   (id, email, name, phone, user_type, created_at, updated_at)으로 정리되면서
--   adiq 에 있던 last_login_at / is_active 컬럼이 없어졌다.
--   /admin 사용자 탭은 이 두 컬럼을 읽는다(admin/index.html 의 최근 로그인·활성 열).
--   컬럼이 없으니 값은 항상 undefined → "최근 로그인"은 언제나 '-', "활성"은 언제나 '활성'.
--   admin/index.html 의 boot() 주석에도 "통합 후 qwfsk profiles엔 last_login_at 컬럼이
--   없어 갱신 생략"으로 남아 있었다. 결과적으로 가입 이후에는 사용자 행이 전혀
--   갱신되지 않았다(= 오늘 분석이 들어와도 사용자 목록은 그대로).
--
-- 하는 일
--   1) profiles 에 last_login_at, is_active 추가
--   2) auth.users.last_sign_in_at 값으로 last_login_at 1회 백필
--   3) touch_last_login() — 본인 행의 last_login_at 만 갱신하는 SECURITY DEFINER RPC
--   4) 열 단위 UPDATE 권한 정리
--      · 기존 정책 prof_upd(using auth.uid() = id)는 '행'만 제한하고 '열'은 제한하지
--        못한다. 그래서 지금까지 사용자가 자기 user_type 을 임의 값으로(예:
--        'chewstep_admin') 바꿀 수 있었다. 관리자 판정은 chewstep_staff 기반
--        is_admin()/is_chewstep_staff() 라서 권한 상승은 아니었지만, 관리자 화면의
--        역할 표시가 위조될 수 있었다.
--      · is_active 를 추가하는 순간에는 '정지된 사용자가 스스로 활성화'가 가능해지므로
--        같은 마이그레이션에서 함께 막는다.
--      · 조치: anon·authenticated 의 테이블 전체 UPDATE 를 회수하고,
--        authenticated 에게 (name, phone) 만 허용. service_role·postgres 는 그대로.
--        (2026-07-28 기준 클라이언트 코드에 profiles UPDATE 호출은 없다 — 확인함)
--
-- 참고: last_login_at 갱신은 trg_profiles_updated 때문에 updated_at 도 같이 움직인다.
--       updated_at = '마지막으로 이 행이 변경된 시각'이라는 뜻은 유지된다.
--
-- 성격: 추가형(additive) + 권한 축소. 재실행 안전.
-- 롤백:
--   drop function if exists public.touch_last_login();
--   alter table public.profiles drop column if exists last_login_at,
--                               drop column if exists is_active;
--   grant update on public.profiles to authenticated, anon;   -- 통합 직후 상태로 되돌릴 때만
-- ============================================================================

begin;

-- 1) 컬럼 추가 -----------------------------------------------------------------
alter table public.profiles
  add column if not exists last_login_at timestamptz,
  add column if not exists is_active     boolean not null default true;

comment on column public.profiles.last_login_at is
  '마지막 로그인 시각. 로그인 성공 직후 public.touch_last_login() 으로 갱신(클라이언트가 직접 쓰지 못함).';
comment on column public.profiles.is_active is
  '계정 활성 여부. 관리자(service_role)만 변경 가능. false = 정지.';

-- 2) 백필: auth.users.last_sign_in_at → profiles.last_login_at -----------------
update public.profiles p
   set last_login_at = u.last_sign_in_at
  from auth.users u
 where u.id = p.id
   and p.last_login_at is null
   and u.last_sign_in_at is not null;

-- 3) 로그인 시각 기록 RPC ------------------------------------------------------
--    본인 행 · last_login_at 한 컬럼만 건드린다. 클라이언트에 UPDATE 권한을 주지
--    않고도 로그인 시각을 남기기 위해 SECURITY DEFINER 로 둔다.
create or replace function public.touch_last_login()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set last_login_at = now() where id = auth.uid();
end $$;

revoke all on function public.touch_last_login() from public;
grant execute on function public.touch_last_login() to authenticated;

-- 4) 열 단위 UPDATE 권한 ------------------------------------------------------
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant  update (name, phone) on public.profiles to authenticated;

commit;
