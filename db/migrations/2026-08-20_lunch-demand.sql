-- ============================================================================
-- 2026-08-20 · lunch_demand — 어린이집 점심 영상 서비스 수요조사(사전 신청) 접수
--
-- 배경: /lunch/ 랜딩(Meta 광고 유입)에서 보호자가 "우리 어린이집도 신청하기"를
--       누르고 남기는 정보를 담는다. 결제 의향이 아니라 **어느 어린이집에 몇 명이
--       모였는지**를 세는 것이 목적이다 → 같은 원 신청이 모인 곳부터 협의.
--
-- 개인정보 최소 수집: 아이 이름·생년월일·보호자 이름은 받지 않는다.
--   · 필수 = 어린이집 이름 / 지역 / 반(연령)  ← 개인 식별 정보가 아니다
--   · 선택 = 연락처(휴대폰 또는 이메일)      ← 남길 때만 동의 체크
--
-- 익명 삽입 테이블이라 조회는 관리자만 가능하게 잠근다(journey_events 와 같은 구조).
-- ============================================================================

begin;

create table if not exists public.lunch_demand (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),

  -- 신청 본문
  daycare_name     text not null,
  daycare_region   text not null,
  child_age        text not null,          -- '0세반' … '5세반' | '기타'
  contact          text,                   -- 선택. 휴대폰 또는 이메일(형식 강제 안 함)
  contact_consent  boolean not null default false,

  -- 집계 키: 공백·대소문자를 무시한 "원+지역" 그룹 (같은 원 신청을 모으기 위함)
  daycare_key      text generated always as (
                     lower(regexp_replace(coalesce(daycare_name,''), '\s', '', 'g'))
                     || '|' ||
                     lower(regexp_replace(coalesce(daycare_region,''), '\s', '', 'g'))
                   ) stored,

  -- 유입 계측(광고 성과 측정용) — 사이트 여정 로그와 anon_id 로 이어진다
  anon_id          text,
  session_id       text,
  referrer         text,
  landing_path     text,
  utm              jsonb,
  user_agent       text,
  is_test          boolean not null default false,

  constraint lunch_demand_name_len   check (char_length(daycare_name)   between 1 and 80),
  constraint lunch_demand_region_len check (char_length(daycare_region) between 1 and 80),
  constraint lunch_demand_age_len    check (char_length(child_age)      between 1 and 20),
  constraint lunch_demand_contact_len check (contact is null or char_length(contact) <= 120)
);

create index if not exists lunch_demand_created_idx on public.lunch_demand(created_at desc);
create index if not exists lunch_demand_key_idx     on public.lunch_demand(daycare_key);

alter table public.lunch_demand enable row level security;

-- 삽입: 로그인 없이(광고 유입 그대로) 신청할 수 있어야 한다.
drop policy if exists lunch_demand_insert_anyone on public.lunch_demand;
create policy lunch_demand_insert_anyone on public.lunch_demand
  for insert to anon, authenticated with check (true);

-- 조회: 관리자만. (연락처가 들어 있으므로 공개 조회는 열지 않는다)
drop policy if exists lunch_demand_select_admin on public.lunch_demand;
create policy lunch_demand_select_admin on public.lunch_demand
  for select to authenticated using (public.is_admin());

drop policy if exists lunch_demand_delete_admin on public.lunch_demand;
create policy lunch_demand_delete_admin on public.lunch_demand
  for delete to authenticated using (public.is_admin());

-- 관리자용 집계: 어느 원에 얼마나 모였는지 한눈에 (테스트 트래픽 제외)
create or replace view public.lunch_demand_by_daycare
with (security_invoker = true) as
select
  daycare_key,
  (array_agg(daycare_name  order by created_at desc))[1] as daycare_name,
  (array_agg(daycare_region order by created_at desc))[1] as daycare_region,
  count(*)                                       as applications,
  count(contact) filter (where contact <> '')    as with_contact,
  min(created_at)                                as first_at,
  max(created_at)                                as last_at
from public.lunch_demand
where is_test = false
group by daycare_key
order by count(*) desc, max(created_at) desc;

commit;
