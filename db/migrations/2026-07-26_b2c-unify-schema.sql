-- ============================================================================
-- B2C→qwfsk 계정·데이터 통합 · Phase 1: 추가형 스키마
-- 대상 프로젝트: qwfskemfsrkmlrdttvqy (chewstep-b2b-prod, 통합 목적지)
-- 작성: 2026-07-26
--
-- 성격: 100% 추가형(additive). 새 객체만 생성. 기존 기관 테이블/데이터에 대한
--       DROP/ALTER 전혀 없음. 여러 번 실행해도 안전(IF NOT EXISTS / OR REPLACE).
--
-- 결정 반영:
--   · B2C children → demo_children 로 분리(기관 children 과 이름/의미 충돌 회피)
--   · demo_responses.child_id → demo_children(id) 참조
--   · journey_events / audit_logs : 구조만 생성(과거 이력은 미이관, adiq 백업 보존)
--   · adiq is_admin() → qwfsk is_chewstep_admin() 래핑으로 RLS 정책 그대로 이식
--
-- 데이터 복사(demo_responses/demo_children/inquiries/notices)와 계정 이관은
-- Phase 2 에서 별도 마이그레이션으로 진행한다(이 파일은 스키마만).
-- ============================================================================

begin;

-- ─────────────────────────────────────────────────────────────
-- 0) 권한 헬퍼: adiq 의 is_admin() 을 qwfsk 관리자 판정으로 매핑
--    (qwfsk 에는 is_admin() 이 없음 → 신규 생성, 기존 함수 미변경)
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$ select public.is_chewstep_admin() $$;

-- ─────────────────────────────────────────────────────────────
-- 1) demo_children  (B2C 부모 소유 아이 · adiq children 을 개명 이관)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.demo_children (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  birth_date    date,
  concern       text,
  allergies     text,
  feeding_stage text,
  created_at    timestamptz not null default now()
);
create index if not exists demo_children_user_id_idx on public.demo_children(user_id);
alter table public.demo_children enable row level security;

drop policy if exists demo_children_select_own on public.demo_children;
create policy demo_children_select_own on public.demo_children
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists demo_children_insert_own on public.demo_children;
create policy demo_children_insert_own on public.demo_children
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists demo_children_update_own on public.demo_children;
create policy demo_children_update_own on public.demo_children
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists demo_children_delete_own on public.demo_children;
create policy demo_children_delete_own on public.demo_children
  for delete to authenticated using (auth.uid() = user_id);
drop policy if exists demo_children_admin_read on public.demo_children;
create policy demo_children_admin_read on public.demo_children
  for select to authenticated using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 2) demo_responses  (B2C 데모 분석 결과 · child_id → demo_children)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.demo_responses (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  age_band       text,
  answers        jsonb,
  score          integer,
  level          integer,
  age_status     text,
  avoid_foods    text[],
  has_video      boolean default false,
  video_name     text,
  video_size     bigint,
  video_duration numeric,
  nickname       text,
  note           text,
  consent        boolean default false,
  source         text default 'demo-v1',
  user_agent     text,
  video_metrics  jsonb,
  video_series   jsonb,
  user_id        uuid references auth.users(id) on delete set null,
  anon_id        text,
  session_id     text,
  feedback       jsonb,
  result         jsonb,
  status         text,
  child_id       uuid references public.demo_children(id) on delete set null
);
create index if not exists demo_responses_user_id_idx  on public.demo_responses(user_id);
create index if not exists demo_responses_child_id_idx  on public.demo_responses(child_id);
create index if not exists demo_responses_created_idx   on public.demo_responses(created_at desc);
alter table public.demo_responses enable row level security;

drop policy if exists demo_anon_insert on public.demo_responses;
create policy demo_anon_insert on public.demo_responses
  for insert to anon, authenticated with check (true);
drop policy if exists demo_select_own on public.demo_responses;
create policy demo_select_own on public.demo_responses
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists demo_update_own on public.demo_responses;
create policy demo_update_own on public.demo_responses
  for update to authenticated using ((auth.uid() = user_id) or (user_id is null))
  with check (auth.uid() = user_id);
drop policy if exists admin_read_all_demo on public.demo_responses;
create policy admin_read_all_demo on public.demo_responses
  for select to authenticated using (public.is_admin());
drop policy if exists admin_delete_demo on public.demo_responses;
create policy admin_delete_demo on public.demo_responses
  for delete to authenticated using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 3) inquiries  (문의/후기/사전신청)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.inquiries (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  email       text,
  message     text not null,
  source      text,
  user_agent  text,
  emailed     boolean not null default false,
  email_error text
);
alter table public.inquiries enable row level security;

drop policy if exists inquiries_anon_insert on public.inquiries;
create policy inquiries_anon_insert on public.inquiries
  for insert to anon with check (true);
drop policy if exists admin_read_all_inquiries on public.inquiries;
create policy admin_read_all_inquiries on public.inquiries
  for select to authenticated using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 4) notices  (공지 · 7건 데이터는 Phase 2 에서 복사)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notices (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null default 'all',
  category     text not null default '안내',
  title        text not null,
  body         text not null,
  is_published boolean not null default true,
  pinned       boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.notices enable row level security;

drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices
  for select to public using ((is_published = true) or public.is_admin());
drop policy if exists notices_admin_insert on public.notices;
create policy notices_admin_insert on public.notices
  for insert to authenticated with check (public.is_admin());
drop policy if exists notices_admin_update on public.notices;
create policy notices_admin_update on public.notices
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists notices_admin_delete on public.notices;
create policy notices_admin_delete on public.notices
  for delete to authenticated using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 5) consultations  (간호사 상담게시판 · 현재 0건, 구조만)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.consultations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  author_name      text,
  child_age_months integer,
  category         text,
  title            text not null,
  body             text not null,
  is_public        boolean not null default false,
  status           text not null default 'open',
  answer           text,
  answered_by      uuid references auth.users(id) on delete set null,
  answered_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.consultations enable row level security;

drop policy if exists consult_select on public.consultations;
create policy consult_select on public.consultations
  for select to public using ((is_public = true) or (auth.uid() = user_id) or public.is_admin());
drop policy if exists consult_insert on public.consultations;
create policy consult_insert on public.consultations
  for insert to public with check (auth.uid() = user_id);
drop policy if exists consult_admin_update on public.consultations;
create policy consult_admin_update on public.consultations
  for update to public using (public.is_admin()) with check (public.is_admin());
drop policy if exists consult_delete on public.consultations;
create policy consult_delete on public.consultations
  for delete to public using ((auth.uid() = user_id) or public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 6) journey_events  (텔레메트리 · 과거 이력 미이관, 구조만)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.journey_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  anon_id    text,
  session_id text,
  user_id    uuid references auth.users(id) on delete set null,
  event_type text not null,
  page       text,
  path       text,
  referrer   text,
  meta       jsonb,
  user_agent text
);
create index if not exists journey_events_created_idx on public.journey_events(created_at desc);
create index if not exists journey_events_session_idx on public.journey_events(session_id);
alter table public.journey_events enable row level security;

drop policy if exists journey_insert_anyone on public.journey_events;
create policy journey_insert_anyone on public.journey_events
  for insert to anon, authenticated with check (true);
drop policy if exists journey_select_own on public.journey_events;
create policy journey_select_own on public.journey_events
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists admin_read_all_journey on public.journey_events;
create policy admin_read_all_journey on public.journey_events
  for select to authenticated using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 7) audit_logs  (감사 로그 · 과거 이력 미이관, 구조만 + log_audit)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  target_type   text,
  target_id     text,
  metadata      jsonb,
  ip            text,
  user_agent    text
);
alter table public.audit_logs enable row level security;

drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs
  for select to authenticated using (public.is_admin());

create or replace function public.log_audit(
  p_action text, p_target_type text default null, p_target_id text default null, p_metadata jsonb default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.audit_logs (actor_user_id, actor_email, action, target_type, target_id, metadata)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          p_action, p_target_type, p_target_id, p_metadata);
end $$;

-- ─────────────────────────────────────────────────────────────
-- 8) updated_at 자동 갱신 트리거 (전용 함수 · 이름충돌 없음)
-- ─────────────────────────────────────────────────────────────
create or replace function public.b2c_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists notices_touch on public.notices;
create trigger notices_touch before update on public.notices
  for each row execute function public.b2c_touch_updated_at();
drop trigger if exists consult_touch on public.consultations;
create trigger consult_touch before update on public.consultations
  for each row execute function public.b2c_touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 9) 역할별 grant (PostgREST anon/authenticated)
-- ─────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.demo_children, public.demo_responses,
      public.consultations, public.notices, public.inquiries to authenticated;
grant select, insert on public.journey_events to authenticated;
grant select on public.audit_logs to authenticated;
grant insert on public.demo_responses, public.journey_events, public.inquiries to anon;
grant select on public.notices, public.consultations to anon;

commit;
