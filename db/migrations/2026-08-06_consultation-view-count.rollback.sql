-- 롤백: 2026-08-06_consultation-view-count.sql
-- 조회수 기능을 걷어내고 목록 함수를 2026-07-29 계약(조회수 없음)으로 되돌린다.
drop function if exists public.consultation_view(uuid);
drop table if exists public.consultation_views;      -- 열람 기록도 함께 사라진다(복구 불가)
drop function if exists public.consultation_titles();
-- 2026-07-29_consultation-list-titles.sql 의 함수 정의를 그대로 다시 실행하면 원상복구된다.
