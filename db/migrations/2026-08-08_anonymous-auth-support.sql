-- 2026-08-08_anonymous-auth-support.sql
-- 익명 인증(Supabase Anonymous sign-in) 도입 준비.
--
-- 배경
--   데모 시작 화면의 로그인 모달이 최대 이탈 지점이었다(진입 136세션 중 78세션이 닫고,
--   그중 63세션이 그대로 종료 · 닫기까지 중앙값 1.1초). 로그인을 결과 저장 시점으로 미루려면
--   그 전 단계(아이 등록·설문)가 로그인 없이도 돌아가야 한다.
--   demo_children RLS 가 authenticated 를 요구하므로, 묻지 않고 발급되는 익명 계정으로 채운다.
--
-- 이 파일이 하는 일
--   1) profiles.is_anonymous 컬럼 — 익명 계정이 관리자 '사용자' 목록·방문자 통계를 오염시키지 않게 표시
--   2) handle_new_user 트리거가 그 값을 채우도록 갱신 (기존 동작은 그대로)
--   3) claim_anonymous_data() — 이미 계정이 있는 사람이 익명으로 쓴 기록을 자기 계정으로 가져오는 RPC
--
-- 별도 조치 필요(이 파일로는 못 함)
--   Supabase 대시보드 → Authentication → Sign In / Providers → Anonymous sign-ins → Enable
--   켜기 전까지 앱은 기존 동작(로그인 먼저)으로 자동 폴백한다.
--
-- 되돌리기: 2026-08-08_anonymous-auth-support.rollback.sql

-- ── 1) 익명 계정 표시 컬럼 ───────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_anonymous boolean not null default false;

comment on column public.profiles.is_anonymous is
  '익명 인증으로 만들어진 계정. 관리자 사용자 목록·방문자 통계에서 제외한다. 이메일을 넣어 승급하면 false 로 바뀐다.';

-- 이미 있는 행 보정 — auth.users 가 진실의 원천
update public.profiles p
   set is_anonymous = coalesce(u.is_anonymous, false)
  from auth.users u
 where u.id = p.id
   and p.is_anonymous is distinct from coalesce(u.is_anonymous, false);

create index if not exists profiles_is_anonymous_idx
  on public.profiles (is_anonymous) where is_anonymous;

-- ── 2) 가입 트리거 — 익명 여부를 같이 기록 ────────────────────────────────
-- 기존과 달라지는 점은 is_anonymous 한 컬럼뿐이다.
-- 익명 계정은 email 이 null 이라 name 도 null 이 된다(의도된 동작).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, name, is_anonymous)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end $function$;

-- 익명 계정이 이메일을 넣어 승급하면(같은 id 유지) profiles 도 따라가야 한다.
create or replace function public.sync_profile_on_user_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.profiles
     set email        = coalesce(new.email, email),
         name         = coalesce(nullif(name,''), split_part(new.email,'@',1)),
         is_anonymous = coalesce(new.is_anonymous, false),
         updated_at   = now()
   where id = new.id;
  return new;
exception when others then
  return new;
end $function$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, is_anonymous on auth.users
  for each row execute function public.sync_profile_on_user_update();

-- ── 3) 익명 기록 인계 ────────────────────────────────────────────────────
-- 언제 쓰나: 익명으로 설문을 마친 사람이 "이미 가입된 이메일"을 넣은 경우.
--   그 이메일로 승급(updateUser)은 실패하므로 기존 계정으로 로그인시키는데,
--   그러면 방금 익명으로 남긴 기록이 붕 뜬다. 이 함수가 그걸 옮겨 붙인다.
--   (처음 가입하는 사람은 updateUser 가 같은 id 를 유지하므로 이 함수가 필요 없다.)
--
-- 안전장치
--   · 원본이 실제로 익명 계정일 때만 동작한다 → 남의 정식 계정은 절대 가져올 수 없다
--   · 최근 24시간 내 기록만 옮긴다 → uuid 를 알아내도 가져갈 수 있는 범위가 제한된다
--   · 대상은 호출자 자신(auth.uid())으로 고정 → 제3자에게 넘길 수 없다
create or replace function public.claim_anonymous_data(p_from uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_children integer := 0;
  v_responses integer := 0;
begin
  if v_me is null or p_from is null or p_from = v_me then
    return 0;
  end if;

  -- 원본이 익명 계정이 아니면 거부 — 계정 탈취 방지의 핵심
  if not exists (select 1 from auth.users u where u.id = p_from and coalesce(u.is_anonymous,false)) then
    raise exception '익명 계정의 기록만 인계할 수 있습니다.';
  end if;

  update public.demo_children
     set user_id = v_me
   where user_id = p_from
     and created_at > now() - interval '24 hours';
  get diagnostics v_children = row_count;

  update public.demo_responses
     set user_id = v_me
   where user_id = p_from
     and created_at > now() - interval '24 hours';
  get diagnostics v_responses = row_count;

  return v_children + v_responses;
end $function$;

revoke all on function public.claim_anonymous_data(uuid) from public, anon;
grant execute on function public.claim_anonymous_data(uuid) to authenticated;

comment on function public.claim_anonymous_data(uuid) is
  '익명 계정(p_from)이 최근 24시간에 남긴 demo_children·demo_responses 를 호출자 계정으로 옮긴다. 원본이 익명 계정일 때만 동작.';
