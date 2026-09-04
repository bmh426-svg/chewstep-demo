-- 롤백: 2026-08-20_lunch-demand.sql
-- ⚠ 신청 데이터가 함께 사라진다. 지우기 전에 반드시 내려받을 것:
--    select * from public.lunch_demand order by created_at;
begin;
drop view  if exists public.lunch_demand_by_daycare;
drop table if exists public.lunch_demand;
commit;
