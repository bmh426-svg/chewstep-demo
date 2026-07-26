// Chewstep 공개 설정 — 브라우저에 노출돼도 안전한 값만 둡니다.
// (LLM API 키 등 비밀값은 절대 여기 두지 않음 → Supabase Edge Function 환경변수)
// 계정·데이터 통합(2026-07-26): B2C도 qwfsk 단일 프로젝트로 전환.
export const SUPABASE_URL = "https://qwfskemfsrkmlrdttvqy.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_5cL015aIZo-fRKwXM16RkQ_NbzkzibH";
// [롤백용] 통합 전 adiq 값: URL "https://adiqnrdgsmszmqvveoow.supabase.co" / ANON "sb_publishable_Asd-GkMXUFf-pGwtM3Bxag_4jECoxv_"

// 카카오 상담 채널(홈페이지 플로팅 버튼과 동일)
export const KAKAO_CHANNEL_URL = "https://pf.kakao.com/_nVIxbX/chat";
