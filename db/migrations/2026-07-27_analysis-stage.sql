-- ============================================================================
-- 분석 단계(설문만 / 설문+영상) 구분 컬럼  ·  v0.1
-- 대상: qwfskemfsrkmlrdttvqy · public.demo_responses
-- 작성: 2026-07-27
--
-- 배경: 영상 업로드를 "필수 → 선택"으로 바꾸기로 결정.
--       하나의 분석 기록(analysis_id = demo_responses.id) 안에서 단계가
--       업데이트되는 구조. 설문 결과를 먼저 만들고, 나중에 같은 기록에
--       영상을 추가하면 result_version 이 올라간다.
--
-- 성격: 100% 추가형(additive). 기존 컬럼/데이터 변경 없음. 재실행 안전.
--       기존 20건은 모두 영상 분석 완료 데이터 → analyzed/video_combined 로 백필.
--
-- 롤백: alter table public.demo_responses
--         drop column if exists video_status,
--         drop column if exists result_type,
--         drop column if exists result_version;
-- ============================================================================

begin;

-- video_status  : none(영상 없음) / uploaded(업로드됨, 분석 전) / analyzed(분석 완료)
-- result_type   : questionnaire(설문 기반) / video_combined(영상·설문 통합)
-- result_version: 같은 기록 안에서 결과가 갱신된 횟수(설문 결과 1 → 영상 추가 2 …)
alter table public.demo_responses
  add column if not exists video_status   text    default 'none',
  add column if not exists result_type    text    default 'questionnaire',
  add column if not exists result_version integer default 1;

-- 값 검증(오타로 집계가 깨지는 것을 DB에서 막는다)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demo_responses_video_status_chk') then
    alter table public.demo_responses
      add constraint demo_responses_video_status_chk
      check (video_status is null or video_status in ('none','uploaded','analyzed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demo_responses_result_type_chk') then
    alter table public.demo_responses
      add constraint demo_responses_result_type_chk
      check (result_type is null or result_type in ('questionnaire','video_combined'));
  end if;
end $$;

-- ── 백필: 기존 기록의 실제 상태에 맞춰 단계 값을 채운다 ────────────────────
-- 영상 지표가 있으면 분석 완료 · 통합 결과
update public.demo_responses
   set video_status = 'analyzed',
       result_type  = 'video_combined'
 where has_video is true
   and video_metrics is not null;

-- 영상은 올렸으나 지표가 없으면 업로드까지만 (분석 실패/중단)
update public.demo_responses
   set video_status = 'uploaded',
       result_type  = 'questionnaire'
 where has_video is true
   and video_metrics is null;

-- 영상 없음 = 설문 기반 결과
update public.demo_responses
   set video_status = 'none',
       result_type  = 'questionnaire'
 where coalesce(has_video, false) = false;

-- 관리자 집계(기간 × 단계)용 인덱스
create index if not exists demo_responses_stage_idx
  on public.demo_responses (result_type, video_status, created_at desc);

commit;
