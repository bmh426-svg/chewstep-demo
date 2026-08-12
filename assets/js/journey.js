// 방문 여정 기록 — 홈페이지 진입부터 데모까지 이벤트를 Supabase에 남긴다.
// 로그인 전에는 anon_id로, 로그인하면 user_id까지 함께 기록.
import { supabase, anonId, sessionId, currentUserId } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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

/* 언로드 중에는 일반 fetch 가 취소된다 — 탭을 닫거나 다른 페이지로 넘어가는 순간
   supabase.insert() 는 대개 나가지 못한다. 그래서 이탈 이벤트만 sendBeacon 으로 보낸다.
   sendBeacon 은 헤더를 못 붙이므로 apikey 를 쿼리로 넘긴다(Supabase 가 지원하는 방식).
   실패하면 조용히 false 를 돌려주고, 호출한 쪽이 일반 경로로 한 번 더 시도한다. */
function beacon(row) {
  try {
    if (!navigator.sendBeacon) return false;
    const url = `${SUPABASE_URL}/rest/v1/journey_events?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}`;
    return navigator.sendBeacon(url, new Blob([JSON.stringify(row)], { type: "application/json" }));
  } catch (e) { return false; }
}

function buildRow(eventType, meta, uid) {
  return {
    anon_id: anonId(),
    session_id: sessionId(),
    user_id: uid || null,
    event_type: eventType,
    page: (document.title || "").slice(0, 120),
    path: location.pathname + location.search,
    referrer: document.referrer || null,
    meta: IS_TEST ? { ...(meta || {}), is_test: true } : (meta || null),
    user_agent: navigator.userAgent,
  };
}

export async function logEvent(eventType, meta) {
  try {
    const uid = _cachedUserId ?? (await currentUserId());
    await supabase.from("journey_events").insert(buildRow(eventType, meta, uid));
  } catch (e) {
    /* 여정 로깅 실패는 조용히 무시 — 사용자 경험이 우선 */
  }
}

/* 이탈 시점 전용. await 하지 않고 즉시 보낸다 —
   여기서 await 하면 그 사이에 페이지가 사라져 아무것도 나가지 않는다.
   그래서 user_id 는 캐시된 값만 쓴다(getSession 은 비동기라 못 기다린다). */
export function logEventSync(eventType, meta) {
  try {
    const row = buildRow(eventType, meta, _cachedUserId);
    if (!beacon(row)) supabase.from("journey_events").insert(row);
  } catch (e) { /* 조용히 무시 */ }
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

/* ── 개인정보 경계 ────────────────────────────────────────────────
   입력값은 어떤 경우에도 남기지 않는다. 이 서비스의 폼에는 아이 이름·생년월,
   보호자 이메일, 식사 고민(건강 정보)이 들어간다. 로그는 "무엇을 했는지"를
   알기 위한 것이고 "무엇을 적었는지"는 필요하지 않다.

   그래서 필드는 이름·종류·채워졌는지·길이 구간만 남긴다.
   선택형(라디오·체크박스·셀렉트)의 고른 값이 분석에 필요하면 그 컨트롤에
   data-journey-value 를 붙여 명시적으로 허용한다 — 기본은 안 남기는 쪽이다.
   비밀번호는 길이 구간조차 남기지 않는다.

   클릭 텍스트도 같은 문제가 있다(아이 이름이 적힌 버튼). data-journey-private
   안에 있으면 텍스트 대신 태그·id 만 남긴다. */
const PRIVATE_SEL = "[data-journey-private]";
function isPrivate(el) {
  try { return !!(el && el.closest && el.closest(PRIVATE_SEL)); } catch (e) { return true; }
}
// 길이를 그대로 두면 값을 좁힐 단서가 된다. 구간으로만 남긴다.
function lenBucket(n) {
  if (!n) return "0";
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  return "51+";
}
function fieldName(el) {
  return (el.getAttribute("name") || el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase()).slice(0, 40);
}

// 페이지에 붙이면 page_view + 섹션 노출 + 클릭 + 폼·필드 + 스크롤 깊이 + 이탈을 자동 기록
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
      const el = e.target.closest("a,button,[data-journey],input[type=submit],[role=button]");
      if (!el) return;
      // data-journey 라벨은 우리가 쓴 값이라 항상 안전하다. 없을 때만 텍스트로 내려가고,
      // 그 텍스트가 개인정보 구역 안이면 태그·id 로 대체한다.
      const tag = el.tagName.toLowerCase();
      const explicit = el.getAttribute("data-journey");
      const label = explicit
        ? explicit.slice(0, 60)
        : isPrivate(el)
          ? `(private:${tag}${el.id ? "#" + el.id : ""})`
          : (el.innerText || el.getAttribute("aria-label") || tag).trim().slice(0, 60);
      logEvent("click", {
        label,
        tag,
        id: el.id || null,
        // 같은 출처 경로만 남긴다. 외부 링크는 호스트까지만.
        href: (() => {
          const h = el.getAttribute && el.getAttribute("href");
          if (!h) return null;
          if (/^(mailto|tel):/i.test(h)) return h.split(":")[0] + ":";
          try { const u = new URL(h, location.href); return u.origin === location.origin ? u.pathname : u.host; }
          catch (e) { return h.slice(0, 80); }
        })(),
      });
    },
    { capture: true }
  );

  /* 폼 필드 변경 — change 로만 듣는다(input 으로 들으면 타자마다 쌓인다).
     값은 남기지 않는다. 위 '개인정보 경계' 주석 참고. */
  document.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (!el || !/^(input|select|textarea)$/i.test(el.tagName)) return;
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (type === "hidden") return;
      const meta = { field: fieldName(el), type, form: (el.form && (el.form.id || el.form.getAttribute("name"))) || null };
      if (type === "checkbox" || type === "radio") {
        meta.checked = !!el.checked;
        if (el.hasAttribute("data-journey-value")) meta.value = String(el.value || "").slice(0, 40);
      } else if (type === "file") {
        meta.filled = !!(el.files && el.files.length);
        meta.count = (el.files && el.files.length) || 0;
      } else if (type === "password") {
        meta.filled = !!el.value;              // 길이 구간조차 남기지 않는다
      } else {
        meta.filled = !!el.value;
        meta.len = lenBucket(String(el.value || "").length);
        if (el.hasAttribute("data-journey-value")) meta.value = String(el.value || "").slice(0, 40);
      }
      logEvent("field_change", meta);
    },
    { capture: true }
  );

  // 폼 제출 — 어느 폼이 실제로 끝까지 갔는지. 채워진 칸 수만 센다.
  document.addEventListener(
    "submit",
    (e) => {
      const f = e.target;
      if (!f || f.tagName !== "FORM") return;
      const els = [...f.elements].filter((x) => /^(input|select|textarea)$/i.test(x.tagName) && (x.type || "") !== "hidden");
      logEvent("form_submit", {
        form: f.id || f.getAttribute("name") || null,
        action: (() => { try { return new URL(f.action || location.href, location.href).pathname; } catch (e) { return null; } })(),
        fields: els.length,
        filled: els.filter((x) => (x.type === "checkbox" || x.type === "radio" ? x.checked : !!x.value)).length,
      });
    },
    { capture: true }
  );

  // 스크롤 깊이 — 어디까지 읽고 떠났는지. 구간마다 한 번만.
  const marks = [25, 50, 75, 100];
  const hit = new Set();
  let maxPct = 0;
  let queuedScroll = false;
  /* 바닥까지 내려도 100% 가 안 잡히는 경우가 있다 — .reveal 애니메이션이나 늦게 뜨는
     이미지로 scrollHeight 가 늘어나면 같은 위치의 비율이 내려간다. 그래서
     ① 3px 여유를 두고 바닥 판정을 하고 ② resize 와 이탈 시점에 다시 잰다. */
  const remeasure = () => {
    queuedScroll = false;
    const el = document.documentElement;
    const max = el.scrollHeight - window.innerHeight;
    const y = window.scrollY || window.pageYOffset || 0;
    const atBottom = max <= 0 || y >= max - 3;
    const pct = atBottom ? 100 : Math.min(100, Math.round((y / max) * 100));
    if (pct > maxPct) maxPct = pct;
    for (const m of marks) {
      if (maxPct >= m && !hit.has(m)) { hit.add(m); logEvent("scroll_depth", { pct: m }); }
    }
  };
  window.addEventListener("scroll", () => {
    if (queuedScroll) return;
    queuedScroll = true;
    requestAnimationFrame(remeasure);
  }, { passive: true });
  window.addEventListener("resize", remeasure, { passive: true });
  remeasure(); // 첫 화면에 다 들어오는 짧은 페이지도 기록되게

  /* 이탈 시 체류시간 + 그때까지의 최대 스크롤 깊이.
     visibilitychange 만으로는 탭을 그냥 닫는 경로를 놓친다 — pagehide 도 함께 듣고,
     둘 다 불려 두 번 쌓이지 않게 한 번만 남긴다. */
  const t0 = Date.now();
  let left = false;
  const leave = (via) => {
    if (left) return;
    left = true;
    remeasure();  // 마지막 위치를 한 번 더 — 레이아웃이 늘어나 100% 를 놓치는 경우가 있다
    logEventSync("page_leave", { dwell_ms: Date.now() - t0, max_scroll: maxPct, via });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave("hidden");
  });
  window.addEventListener("pagehide", () => leave("pagehide"));
}
