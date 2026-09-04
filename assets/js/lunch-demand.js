/* =============================================================================
   /lunch/ 어린이집 점심 영상 서비스 · 수요조사 랜딩 스크립트
   -----------------------------------------------------------------------------
   왜 supabase-js 를 안 쓰는가: 이 페이지는 광고에서 바로 들어오는 첫 화면이라
   첫 화면이 빨라야 한다. esm.sh 에서 SDK(수십 KB)를 끌어오지 않고
   PostgREST 에 fetch 로 직접 넣는다. anon 키는 공개키라 노출 무방하다.

   저장 대상 테이블: public.lunch_demand
     (db/migrations/2026-08-20_lunch-demand.sql · RLS = anon insert / admin select)
   계측: public.journey_events — 사이트 나머지와 같은 anon_id 로 이어진다.

   다른 저장소(구글 시트·에어테이블)로 바꾸려면 submitApplication() 안의
   fetch 한 곳만 갈아끼우면 된다. 폼 UI 는 저장 방식을 모른다.
   ========================================================================== */
(function () {
  "use strict";

  var SB_URL = "https://qwfskemfsrkmlrdttvqy.supabase.co";
  var SB_KEY = "sb_publishable_5cL015aIZo-fRKwXM16RkQ_NbzkzibH"; // 공개키(노출 무방)
  var TABLE = "lunch_demand";
  var DONE_KEY = "cs_lunch_demand_done";
  var SHARE_URL = "https://chewstep.com/lunch/";

  /* ── 식별자: 사이트 나머지(assets/js/supabase.js)와 같은 키를 쓴다 ───────── */
  function uid() {
    try { return crypto.randomUUID(); }
    catch (e) { return "id-" + Date.now() + "-" + Math.round(Math.random() * 1e9); }
  }
  function anonId() {
    try {
      var v = localStorage.getItem("cs_anon_id");
      if (!v) { v = uid(); localStorage.setItem("cs_anon_id", v); }
      return v;
    } catch (e) { return null; }
  }
  function sessionId() {
    try {
      var v = sessionStorage.getItem("cs_session_id");
      if (!v) { v = uid(); sessionStorage.setItem("cs_session_id", v); }
      return v;
    } catch (e) { return null; }
  }

  /* 자동화 트래픽 표식 — 검증 하네스·봇이 수요 숫자를 부풀리지 않게 한다.
     지우지 않고 is_test 로 구분만 한다(집계 뷰가 이 값을 걸러낸다). */
  var IS_TEST = (function () {
    try {
      if (navigator.webdriver) return true;
      if (/headless|playwright|puppeteer|phantom|lighthouse|bot\b|crawl|spider/i.test(navigator.userAgent)) return true;
      if (localStorage.getItem("cs_is_test") === "1") return true;
      return false;
    } catch (e) { return false; }
  })();

  /* ── 유입 계측: 광고 성과를 원 단위로 되짚기 위한 최소 정보 ────────────── */
  var UTM = (function () {
    var out = null;
    try {
      var q = new URLSearchParams(location.search);
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ad"].forEach(function (k) {
        var v = q.get(k);
        if (v) { out = out || {}; out[k] = String(v).slice(0, 120); }
      });
    } catch (e) { /* 무시 */ }
    return out;
  })();

  function post(path, row, keepalive) {
    return fetch(SB_URL + "/rest/v1/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(row),
      keepalive: !!keepalive
    });
  }

  function logEvent(type, meta) {
    try {
      var m = meta || {};
      if (IS_TEST) m.is_test = true;
      post("journey_events", {
        anon_id: anonId(), session_id: sessionId(), user_id: null,
        event_type: type,
        page: (document.title || "").slice(0, 120),
        path: location.pathname + location.search,
        referrer: document.referrer || null,
        meta: m,
        user_agent: navigator.userAgent
      }, true).catch(function () {});
    } catch (e) { /* 계측 실패는 조용히 무시 — 사용자 경험이 우선 */ }
  }

  /* ── 신청 저장 (여기 한 곳만 갈아끼우면 저장소를 바꿀 수 있다) ─────────── */
  function submitApplication(v) {
    return post(TABLE, {
      daycare_name: v.name,
      daycare_region: v.region,
      child_age: v.age,
      contact: v.contact || null,
      contact_consent: !!v.consent,
      anon_id: anonId(),
      session_id: sessionId(),
      referrer: document.referrer || null,
      landing_path: location.pathname + location.search,
      utm: UTM,
      user_agent: navigator.userAgent,
      is_test: IS_TEST
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + " " + String(t).slice(0, 200)); });
      return true;
    });
  }

  /* ── DOM ────────────────────────────────────────────────────────────────── */
  var $ = function (s) { return document.querySelector(s); };
  var all = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var form = $("#applyForm");
  var formCard = $("#formCard");
  var success = $("#successCard");
  var msg = $("#formMsg");
  var sticky = $("#stickyCta");
  var again = $("#applyAgain");
  var repeatNote = $("#repeatNote");

  function say(text, tone) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "form-msg" + (text ? " show" : "") + (tone ? " " + tone : "");
  }

  /* 연령 칩: :has() 미지원 브라우저에서도 선택 표시가 보이도록 클래스도 함께 토글 */
  all(".chip input").forEach(function (input) {
    input.addEventListener("change", function () {
      all(".chip").forEach(function (c) { c.classList.remove("on"); });
      var on = input.parentNode;
      if (on && on.classList) on.classList.add("on");
      say("");
    });
  });

  /* 연락처를 적었을 때만 동의가 필요하다 —
     원 이름·지역·반은 개인 식별 정보가 아니어서 동의 대상이 아니다.
     빈칸으로 두는 사람에게 체크 하나를 더 요구하지 않는 이유. */
  var contactEl = $("#contact");
  var consentRow = $("#consentRow");
  var consentEl = $("#consent");
  function syncConsent() {
    var filled = !!(contactEl && contactEl.value.trim());
    if (consentRow) consentRow.classList.toggle("need", filled);
    if (consentEl) consentEl.required = filled;
  }
  if (contactEl) contactEl.addEventListener("input", syncConsent);
  syncConsent();

  /* 폼 시작 지점 1회 기록 — 어디서 멈추는지 보려면 시작을 세야 한다 */
  var started = false;
  if (form) {
    form.addEventListener("input", function () {
      if (started) return;
      started = true;
      logEvent("lunch_form_start", {});
    });
  }

  /* CTA 클릭 → 폼으로 스크롤 (+ 첫 칸에 포커스)
     섹션(#apply) 머리말이 아니라 **입력 카드**로 보낸다 —
     모바일에서 섹션 top 으로 보내면 설명글에 밀려 입력 칸이 화면 밖에 남는다. */
  all("[data-cta]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      logEvent("lunch_cta_click", { where: btn.getAttribute("data-cta") });
      var target = (formCard && !formCard.hidden) ? formCard : $("#apply");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      var first = $("#daycareName");
      if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); } }, 420);
    });
  });

  /* 제출 */
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = ($("#daycareName").value || "").trim();
      var region = ($("#daycareRegion").value || "").trim();
      var ageEl = form.querySelector('input[name="childAge"]:checked');
      var contact = contactEl ? contactEl.value.trim() : "";
      var consent = !!(consentEl && consentEl.checked);

      if (!name) { say("어린이집 이름을 알려주세요.", "warn"); $("#daycareName").focus(); return; }
      if (!region) { say("어린이집 지역을 알려주세요.", "warn"); $("#daycareRegion").focus(); return; }
      if (!ageEl) {
        say("아이 반(연령)을 선택해주세요.", "warn");
        var c = $(".chips"); if (c) c.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (contact && !consent) { say("연락처를 남기시려면 아래 동의에 체크해주세요.", "warn"); if (consentEl) consentEl.focus(); return; }

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.classList.add("busy");
      say("신청을 보내는 중이에요…");

      submitApplication({ name: name, region: region, age: ageEl.value, contact: contact, consent: consent })
        .then(function () {
          logEvent("lunch_apply_success", { age: ageEl.value, has_contact: !!contact, region: region });
          try { localStorage.setItem(DONE_KEY, JSON.stringify({ name: name, region: region, at: Date.now() })); } catch (_) {}
          showSuccess(name);
        })
        .catch(function (err) {
          logEvent("lunch_apply_error", { message: String((err && err.message) || err).slice(0, 200) });
          say("전송이 잘 안 됐어요. 잠시 후 한 번만 더 눌러주세요.", "warn");
        })
        .then(function () { btn.disabled = false; btn.classList.remove("busy"); });
    });
  }

  function showSuccess(name) {
    say("");
    if (formCard) formCard.hidden = true;
    if (repeatNote) repeatNote.hidden = true;
    if (success) {
      var who = $("#successWho");
      if (who && name) who.textContent = name;
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (sticky) sticky.classList.remove("show");
    document.body.classList.add("applied");
  }

  /* 이미 신청한 브라우저: 폼을 지우지 않고(다른 아이도 있을 수 있다)
     "이미 신청했어요 + 공유" 를 위에 얹어 중복 신청을 줄인다. */
  (function restore() {
    var raw = null;
    try { raw = localStorage.getItem(DONE_KEY); } catch (_) {}
    if (!raw || !repeatNote) return;
    var prev = {};
    try { prev = JSON.parse(raw) || {}; } catch (_) {}
    var el = $("#repeatWho");
    if (el && prev.name) el.textContent = prev.name;
    repeatNote.hidden = false;
  })();

  if (again) {
    again.addEventListener("click", function (e) {
      e.preventDefault();
      if (success) success.hidden = true;
      if (formCard) formCard.hidden = false;
      if (repeatNote) repeatNote.hidden = true;
      document.body.classList.remove("applied");
      if (form) form.reset();
      syncConsent();
      all(".chip").forEach(function (c) { c.classList.remove("on"); });
      var first = $("#daycareName");
      if (first) first.focus();
    });
  }

  /* 공유 — Web Share API 우선, 없으면 링크 복사 */
  all("[data-share]").forEach(function (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var out = $("#shareMsg");
      var payload = {
        title: "어린이집 점심 영상 서비스",
        text: "우리 어린이집도 아이 점심시간을 30초 영상으로 볼 수 있을까요? 신청이 모이면 원과 협의한다고 해요.",
        url: SHARE_URL
      };
      logEvent("lunch_share_click", { api: !!navigator.share });
      if (navigator.share) {
        navigator.share(payload).catch(function () { /* 사용자가 취소 */ });
        return;
      }
      var done = function () {
        if (out) { out.textContent = "링크를 복사했어요. 단톡방에 붙여넣어 주세요!"; out.classList.add("show"); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(SHARE_URL).then(done).catch(function () {
          if (out) { out.textContent = SHARE_URL; out.classList.add("show"); }
        });
      } else if (out) { out.textContent = SHARE_URL; out.classList.add("show"); }
    });
  });

  /* 하단 고정 CTA — 히어로를 지나가면 나타나고, 폼이 보이면 사라진다 */
  if (sticky && "IntersectionObserver" in window) {
    var heroCta = $("#heroCtaAnchor");
    var applySec = $("#apply");
    var pastHero = false, formVisible = false;
    var render = function () {
      sticky.classList.toggle("show", pastHero && !formVisible && !document.body.classList.contains("applied"));
    };
    if (heroCta) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) { pastHero = !en.isIntersecting && en.boundingClientRect.top < 0; render(); });
      }, { threshold: 0 }).observe(heroCta);
    }
    if (applySec) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) { formVisible = en.isIntersecting; render(); });
      }, { threshold: 0.08 }).observe(applySec);
    }
  }

  /* 영상 목업 탭 — 아직 재생할 영상이 없다는 것을 정직하게 알린다 */
  all("[data-mock-play]").forEach(function (el) {
    el.addEventListener("click", function () {
      logEvent("lunch_mock_play", {});
      var note = el.querySelector(".mock-toast");
      if (note) { note.classList.add("show"); setTimeout(function () { note.classList.remove("show"); }, 2200); }
    });
  });

  logEvent("lunch_view", UTM ? { utm: UTM } : {});
})();
