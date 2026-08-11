// Supabase 클라이언트 (브라우저) + 익명/세션 식별자
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // OAuth 리다이렉트 복귀 시 세션 자동 처리
    flowType: "pkce",
  },
});

function uid() {
  try { return crypto.randomUUID(); }
  catch (e) { return "id-" + Date.now() + "-" + Math.round(Math.random() * 1e9); }
}

// 브라우저 영구 익명 식별 — 로그인 전후를 잇는 여정 연결 고리
export function anonId() {
  let v = localStorage.getItem("cs_anon_id");
  if (!v) { v = uid(); localStorage.setItem("cs_anon_id", v); }
  return v;
}

// 방문(탭) 단위 세션 식별
export function sessionId() {
  let v = sessionStorage.getItem("cs_session_id");
  if (!v) { v = uid(); sessionStorage.setItem("cs_session_id", v); }
  return v;
}

/* 이 실행이 실사용자인지 자동화(Playwright 등)인지 구분해 source에 남긴다.
   ── 왜 필요한가 ──
   verify 하네스가 실제 demo.html을 그대로 몰기 때문에, 합성 픽스처(e2e.webm 등)로 만든
   행이 실사용자와 똑같이 source='demo-app-v1'로 쌓였다. 그 결과 품질 통계에서
   quality='low_face'의 대부분이 "얼굴 없는 테스트 영상"이 돼 지표를 못 믿게 됐다.
   → 쓰는 시점에 갈라 둬야 나중에 읽는 쪽에서 되돌릴 수 있다.

   판별 순서:
     1) ?src=... 쿼리 — 하네스가 명시적으로 지정할 때(가장 정확)
     2) navigator.webdriver — Playwright/Selenium이 켜는 표준 플래그(하네스 수정 없이도 잡힘)
   기본값 base("demo-app-v1")는 실사용자 경로에서 지금까지와 동일하게 유지된다. */
export function runSource(base = "demo-app-v1") {
  try {
    const q = new URLSearchParams(location.search).get("src");
    if (q) return ("verify/" + q).slice(0, 60);
    if (navigator.webdriver === true) return "verify/automated";
  } catch (e) { /* 판별 실패 시 실사용자로 본다 — 통계가 과소집계되는 편이 낫다 */ }
  return base;
}

export async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch (e) { return null; }
}
