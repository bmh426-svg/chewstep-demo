-- ============================================================================
-- 2026-08-20 · lunch_demand.source — 유입 경로 구분
--
-- 왜: /lunch/ 광고 랜딩 신청과 오프라인 포스터 수요조사(아이누리, 2026-07-22~31)를
--     같은 테이블에 담는다. 수요 총계는 합쳐 봐야 하지만(원별로 몇 명이 원하나),
--     전환율은 랜딩 유입만으로 재야 한다. 섞으면 광고 성과가 부풀려진다.
--
-- 적용: 2026-08-20 · qwfskemfsrkmlrdttvqy (chewstep-b2b-prod)
-- ============================================================================

begin;

alter table public.lunch_demand
  add column if not exists source text not null default 'lunch_landing',
  add column if not exists note   text;

comment on column public.lunch_demand.source is
  'lunch_landing = /lunch/ 랜딩 폼(광고 유입) · poster_survey = 오프라인 포스터 수요조사 · manual = 운영자 수기 입력';

create index if not exists lunch_demand_source_idx on public.lunch_demand(source);

-- 컬럼이 늘어나므로 뷰는 새로 만든다(create or replace 는 컬럼 순서 변경을 거부한다).
drop view if exists public.lunch_demand_by_daycare;
create view public.lunch_demand_by_daycare
with (security_invoker = true) as
select
  daycare_key,
  (array_agg(daycare_name   order by created_at desc))[1] as daycare_name,
  (array_agg(daycare_region order by created_at desc))[1] as daycare_region,
  count(*)                                            as applications,
  count(*) filter (where source = 'lunch_landing')     as from_landing,
  count(*) filter (where source <> 'lunch_landing')    as from_offline,
  count(contact) filter (where contact <> '')          as with_contact,
  min(created_at)                                     as first_at,
  max(created_at)                                     as last_at
from public.lunch_demand
where is_test = false
group by daycare_key
order by count(*) desc, max(created_at) desc;

commit;
