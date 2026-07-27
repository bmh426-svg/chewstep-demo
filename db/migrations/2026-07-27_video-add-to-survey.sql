-- ============================================================================
-- 설문 기록에 영상을 나중에 추가하는 흐름 · v0.1
-- 대상: qwfskemfsrkmlrdttvqy · public.demo_responses
-- 작성: 2026-07-27  (2026-07-27_analysis-stage.sql 이후)
--
-- 배경: 설문만 완료한 보호자가 나중에 영상을 추가할 때, 설문을 처음부터 다시
--       받지 않고 같은 analysis_id(=demo_responses.id) 를 승급한다.
--       이때 지켜야 할 원칙:
--         · 기존 설문 응답(answers)과 설문 결과(questionnaire_result)는 덮어쓰지 않는다.
--         · 촬영 당일 정보는 video_context 에 따로 저장한다.
--         · 영상 반영 후 통합 결과는 combined_result 에 별도로 남긴다(result 는 화면 호환용).
--
-- video_context 예:
--   { "relation":"same|changed|different",     -- 재확인 게이트 응답
--     "food_today":"소고기 볶음밥",
--     "last_meal_gap":"2시간 이상",
--     "watch_behavior":"씹다가 뱉음",
--     "food_form_updated":"small_bits",        -- 'changed' 일 때만
--     "at":"2026-07-27T08:30:00.000Z" }
--
-- 관리자 전환율 정의: 같은 기록이 questionnaire → video_combined 로 바뀐 비율.
--   분모 = questionnaire_result 가 있는 기록(설문 단계를 거침)
--   분자 = 그 중 result_type='video_combined'
--   (설문 없이 곧바로 영상만 올린 기록은 분모·분자 모두에서 제외)
--
-- 성격: 100% 추가형(additive). 재실행 안전.
-- 롤백: alter table public.demo_responses
--         drop column if exists video_context,
--         drop column if exists combined_result,
--         drop column if exists questionnaire_result;
-- ============================================================================

begin;

alter table public.demo_responses
  add column if not exists questionnaire_result jsonb,   -- 설문 기반 결과(승급 후에도 보존)
  add column if not exists video_context        jsonb,   -- 촬영 당일 정보(설문 답변과 분리)
  add column if not exists combined_result      jsonb;   -- 영상 반영 후 통합 결과

-- 전환율 집계용(설문 단계를 거친 기록만 빠르게 추리기)
create index if not exists demo_responses_qres_idx
  on public.demo_responses ((questionnaire_result is not null), result_type, created_at desc);

commit;
