-- 롤백 · 2026-08-20_lunch-demand-source
-- ⚠ source/note 를 지우면 포스터 수요조사와 랜딩 신청을 구분할 수 없게 된다.
--   되돌리기 전에 db/migrations/2026-08-20_lunch-demand-seed-ainuri.sql 로 들어간
--   행을 먼저 어떻게 할지 정할 것.
begin;
drop view if exists public.lunch_demand_by_daycare;
create view public.lunch_demand_by_daycare
with (security_invoker = true) as
select
  daycare_key,
  (array_agg(daycare_name   order by created_at desc))[1] as daycare_name,
  (array_agg(daycare_region order by created_at desc))[1] as daycare_region,
  count(*)                                    as applications,
  count(contact) filter (where contact <> '') as with_contact,
  min(created_at)                             as first_at,
  max(created_at)                             as last_at
from public.lunch_demand
where is_test = false
group by daycare_key
order by count(*) desc, max(created_at) desc;
drop index if exists public.lunch_demand_source_idx;
alter table public.lunch_demand drop column if exists note;
alter table public.lunch_demand drop column if exists source;
commit;
