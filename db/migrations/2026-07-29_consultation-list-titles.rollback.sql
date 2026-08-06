-- 롤백 · 2026-07-29 상담 목록 함수
-- 되돌리면 목록에서 남의 비공개 글 제목이 보이지 않는다(행 자체가 사라짐).
-- 화면도 함께 되돌려야 한다:
--   ① assets/js/consult.js 의 supabase.rpc("consultation_titles") → from("consultations").select(…본문 포함…)
--   ② consult-view.html · assets/js/consult-view.js 는 남겨도 무해(상세는 원본 테이블만 쓴다)
drop function if exists public.consultation_titles();
