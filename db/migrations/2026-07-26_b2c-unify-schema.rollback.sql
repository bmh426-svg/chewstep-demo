-- ============================================================================
-- 롤백: 2026-07-26_b2c-unify-schema.sql
-- 대상: qwfskemfsrkmlrdttvqy
--
-- Phase 1 은 추가형이라 이 스크립트로 완전 원복 가능(새로 만든 객체만 제거).
-- ⚠ 기관(B2B) 테이블/함수는 건드리지 않는다. is_chewstep_admin() 등은 유지.
-- ⚠ Phase 2(데이터 복사) 이후에는 데이터가 사라지므로 사용 주의.
-- ============================================================================
begin;

drop trigger  if exists consult_touch on public.consultations;
drop trigger  if exists notices_touch on public.notices;

drop table if exists public.demo_responses cascade;   -- child_id FK 때문에 먼저
drop table if exists public.demo_children  cascade;
drop table if exists public.inquiries      cascade;
drop table if exists public.notices        cascade;
drop table if exists public.consultations  cascade;
drop table if exists public.journey_events cascade;
drop table if exists public.audit_logs     cascade;

drop function if exists public.log_audit(text, text, text, jsonb);
drop function if exists public.b2c_touch_updated_at();
drop function if exists public.is_admin();   -- qwfsk 신규 생성분(기존 is_chewstep_admin 은 유지)

commit;
