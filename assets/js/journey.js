// 방문 여정 기록 — 홈페이지 진입부터 데모까지 이벤트를 Supabase에 남긴다.
// 로그인 전에는 anon_id로, 로그인하면 user_id까지 함께 기록.
import { supabase, anonId, sessionId, currentUserId } from "./supabase.js";

let _cachedUserId = null;
supabase.auth.onAuthStateChange((_e, session) => {
  _cachedUserId = session?.user?.id || null;
});

/* 자동화 트래픽 표식.
   왜: 2026-08-08 로그 분석에서 전체 377세션 중 208세션(55%)이 verify/ Playwright
   하네스였다. User-Agent 정규식으로 사후에 걸러냈지만, 그건 분석하는 사람이
   그 사실을 알고 있어야만 가능하다. 소스에서 표시해 두면 SQL 한 줄로 끝난다.
   meta.is_test 로 남기므로 이벤트 자체는 그대로 쌓인다(삭제가 아니라 구분). */
function isAutomated() {
  try {
    if (navigator.webdriver) return true;                       // Playwright·Selenium 등
    if (/headless|playwright|puppeteer|phantom|lighthouse|bot\b|crawl|spider/i.test(navigator.userAgent)) return true;
    if (localStorage.getItem("cs_is_test") === "1") return true; // 수동 테스트용 스위치
    return false;
  } catch (e) { return false; }
}
const IS_TEST = isAutomated();

export async function logEvent(eventType, meta) {
  try {
    const uid = _cachedUserId ?? (await currentUserId());
    const row = {
      anon_id: anonId(),
      session_id: sessionId(),
      user_id: uid || null,
      event_type: eventType,
      page: (document.title || "").slice(0, 120),
      path: location.pathname + location.search,
      referrer: document.referrer || null,
      // 자동화 트래픽이면 meta.is_test=true 를 덧붙인다(원래 meta 는 보존).
      meta: IS_TEST ? { ...(meta || {}), is_test: true } : (meta || null),
      user_agent: navigator.userAgent,
    };
    await supabase.from("journey_events").insert(row);
  } catch (e) {
    /* 여정 로깅 실패는 조용히 무시 — 사용자 경험이 우선 */
  }
}

// 전역 JS 에러 자동 기록(홈페이지 등 클라이언트 오류) → journey_events(event_type='client_error')
if (typeof window !== "undefined" && !window.__csErrHook) {
  window.__csErrHook = true;
  window.addEventListener("error", (e) => {
    try { logEvent("client_error", { message: String(e.message || "").slice(0, 300), src: String(e.filename || "").slice(0, 200), line: e.lineno || 0 }); } catch (_) {}
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    try { logEvent("client_error", { message: ("promise: " + String((r && r.message) || r || "")).slice(0, 300) }); } catch (_) {}
  });
}

// 페이지에 붙이면 page_view + 섹션 노출 + 클릭 + 이탈을 자동 기록
export function initJourneyAutoTrack() {
  logEvent("page_view", { title: document.title });

  // 섹션 노출(각 1회)
  if ("IntersectionObserver" in window) {
    const seen = new Set();
    const io = new IntersectionObserver(
      (ents) => {
        ents.forEach((en) => {
          if (!en.isIntersecting) return;
          const id = en.target.id || en.target.getAttribute("data-journey-section");
          if (id && !seen.has(id)) {
            seen.add(id);
            logEvent("section_view", { section: id });
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.35 }
    );
    document.querySelectorAll("section[id], [data-journey-section]").forEach((el) => io.observe(el));
  }

  // 링크/버튼 클릭
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest("a,button,[data-journey]");
      if (!el) return;
      const label = (el.getAttribute("data-journey") || el.innerText || el.getAttribute("aria-label") || "")
        .trim()
        .slice(0, 60);
      logEvent("click", {
        label,
        id: el.id || null,
        href: el.getAttribute && el.getAttribute("href"),
      });
    },
    { capture: true }
  );

  // 이탈 시 체류시간
  const t0 = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      logEvent("page_leave", { dwell_ms: Date.now() - t0 });
    }
  });
}
