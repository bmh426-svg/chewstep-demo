-- 2026-08-08_anonymous-auth-support.rollback.sql
-- 2026-08-08_anonymous-auth-support.sql 되돌리기.
--
-- 순서 주의: 되돌리기 전에 대시보드에서 Anonymous sign-ins 를 먼저 끈다.
--   (켠 채로 이 파일을 돌리면 익명 계정이 계속 생기면서 profiles 에 표시가 안 남는다.)
-- 이미 만들어진 익명 계정은 지우지 않는다 — 그들이 남긴 demo_responses 가 함께 사라지기 때문.
--   정말 지우려면 관리자 '분석 기록' 탭의 삭제 모드로 데이터를 먼저 확인한 뒤 처리한다.

drop trigger if exists on_auth_user_updated on auth.users;
drop function if exists public.sync_profile_on_user_update();
drop function if exists public.claim_anonymous_data(uuid);

-- 트리거 함수를 원래 정의로 되돌린다 (is_anonymous 컬럼 참조 제거)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end $function$;

drop index if exists public.profiles_is_anonymous_idx;
alter table public.profiles drop column if exists is_anonymous;
