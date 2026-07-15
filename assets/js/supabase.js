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

export async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch (e) { return null; }
}
