-- 롤백: 2026-08-11_meal-review-completed.sql
-- ⚠ 컬럼을 지우면 「반 전체 확인」 기록이 함께 사라진다. 되돌리기 전에 값이 쌓였는지 확인할 것:
--     select count(*) from meal_sessions where review_completed_at is not null;
begin;
drop function if exists public.set_meal_review_completed(uuid, boolean);
alter table public.meal_sessions
  drop column if exists review_completed_by,
  drop column if exists review_completed_at;
commit;
