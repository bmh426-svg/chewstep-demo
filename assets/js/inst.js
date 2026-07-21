/* =========================================================
   Chewstep · 기관용(B2B) 공용 상호작용 — 여러 페이지 공유
   ========================================================= */
(function () {
  // 도입 상담 CTA([data-contact]) → 카카오톡 채널
  var KAKAO_CHANNEL_URL = "http://pf.kakao.com/_nVIxbX/chat";
  document.querySelectorAll("[data-contact]").forEach(function (a) {
    if (KAKAO_CHANNEL_URL) {
      a.setAttribute("href", KAKAO_CHANNEL_URL);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else {
      a.addEventListener("click", function (e) { e.preventDefault(); alert("카카오톡 상담 채널은 곧 연결됩니다."); });
    }
  });

  // 모바일 햄버거
  var burger = document.getElementById("hamburger");
  var mobileMenu = document.getElementById("mobileMenu");
  if (burger && mobileMenu) {
    burger.addEventListener("click", function () {
      var open = mobileMenu.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    });
    mobileMenu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { mobileMenu.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); });
    });
  }

  // 페이지 내 앵커 부드러운 스크롤 (data-contact 제외)
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      if (a.hasAttribute("data-contact")) return;
      var id = a.getAttribute("href");
      if (!id || id === "#") return;
      var el = document.querySelector(id);
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
  });

  // 스크롤 진입 애니메이션
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var reveals = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }
})();
