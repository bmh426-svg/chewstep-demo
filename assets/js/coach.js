// coach.js — 결과 코칭 LLM 클라이언트 (웹 데모용).
// coach Edge Function(LETSUR 게이트웨이) 호출 → 키 없음/오류/오프라인/안전게이팅이면 null 반환(클라이언트가 규칙엔진 결과 사용).
// 반환: { source:'ai', coach:{firstCheck, action, tips[], watch} } 또는 null
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/assets/js/config.js";

const FN = SUPABASE_URL + "/functions/v1/coach";

export async function fetchCoach(ctx) {
  try {
    const r = await fetch(FN, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(ctx || {}),
    });
    const j = await r.json();
    if (j && j.ok && j.coach && j.coach.action) return { source: "ai", coach: j.coach };
  } catch (e) { /* 오프라인 등 — 규칙엔진 폴백 */ }
  return null;
}
