-- 2026-08-11 · 「반 전체 확인」 표시 — 미기록과 '이상 없음'을 구분한다
--
-- 왜 필요한가 (발달점검 계획 v0.3 §9-2 · B2B PRD v0.4 §9-7)
--   교사 기록은 **예외만 받는다**(뱉음·거부·특이하게 적게 먹음). 부담을 20명×3항목에서 줄이려는 설계다.
--   그런데 예외만 받으면 **"안 봤다"와 "보고 이상 없었다"가 구분되지 않는다.**
--   지금 구조에서는 관찰 0건이 곧 "기록 없음"인데, 리포트가 그것을 '잘 먹었음'으로 읽으면 거짓이 된다.
--
--   | review_completed_at | 예외 입력 | 보호자에게 표시할 것 |
--   |---|---|---|
--   | null                | —        | **관찰 기록 없음** |
--   | 있음                | 없음      | 특이사항 없음 |
--   | 있음                | 있음      | 특이사항 있음 |
--
-- 왜 boolean 이 아니라 timestamptz 인가
--   ① null 이 곧 '없음'이라 3상태가 컬럼 하나로 표현된다(boolean 이면 null/false/true 를 또 구분해야 한다).
--   ② **언제 확인했는지**가 남는다 — 성공지표 §15 2-1(교사 매일 기록 지속률)과 2(체감 부담)의 실측 근거가 된다.
--      배식 직후인지 퇴근 직전인지가 부담 판단을 바꾼다.
--
-- 권한
--   meal_sessions 의 기존 정책을 그대로 쓴다 — `meal_upd` 가 이미
--   (staff OR 원장 OR 그 반 담임) 에게 UPDATE 를 허용한다. 새 정책이 필요 없다.
--   보호자 읽기도 `meal_sel_guardian` 으로 이미 열려 있다(연결된 아이가 그 반에 재원 중일 때).
--
-- 되돌리기: 2026-08-11_meal-review-completed.rollback.sql

begin;

alter table public.meal_sessions
  add column if not exists review_completed_at timestamptz,
  add column if not exists review_completed_by uuid references public.profiles(id) on delete set null;

comment on column public.meal_sessions.review_completed_at is
  '교사가 이 끼니에서 반 전체를 확인한 시각. null = 확인 안 함(= 관찰 기록 없음). 예외 입력 유무와 조합해 3상태를 만든다.';
comment on column public.meal_sessions.review_completed_by is
  '반 전체 확인을 누른 교사. 누가 봤는지 없이는 기록의 출처를 말할 수 없다.';

-- 확인 시각만 세팅/해제하는 RPC.
--   왜 RPC 인가: 앱이 meal_sessions 를 직접 PATCH 하면 menu_text·status 같은 다른 칸을
--   실수로 덮어쓸 여지가 생긴다. 이 동작은 칸 두 개만 만진다.
create or replace function public.set_meal_review_completed(p_session uuid, p_done boolean)
returns timestamptz
language plpgsql
security invoker           -- 일부러 invoker: 기존 meal_upd 정책이 그대로 판정하게 둔다
set search_path to 'public'
as $$
declare v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update meal_sessions
     set review_completed_at = case when p_done then now() else null end,
         review_completed_by = case when p_done then auth.uid() else null end
   where id = p_session
  returning review_completed_at into v_at;
  -- 0행이면 정책에 막힌 것이다(그 반 담임이 아님). 조용히 성공한 척하지 않는다.
  if not found then raise exception 'MEAL_NOT_UPDATABLE'; end if;
  return v_at;
end $$;

comment on function public.set_meal_review_completed(uuid, boolean) is
  '그 끼니의 「반 전체 확인」을 켜거나 끈다. 권한은 meal_sessions 의 meal_upd 정책이 판정한다.';

revoke all on function public.set_meal_review_completed(uuid, boolean) from public, anon;
grant execute on function public.set_meal_review_completed(uuid, boolean) to authenticated;

commit;
