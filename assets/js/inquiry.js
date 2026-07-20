/* Chewstep · 공용 1:1 이메일 문의 모달
   [data-inquiry] 요소 클릭 시 모달 오픈 → send-inquiry(Edge Function, Resend)로 발송.
   페이지에 이미 #inquiryModal이 있으면(=index) 아무것도 하지 않는다. */
(function () {
  if (document.getElementById("inquiryModal")) return;

  var CONTACT_FN = "https://adiqnrdgsmszmqvveoow.supabase.co/functions/v1/send-inquiry";
  var SB_ANON_KEY = "sb_publishable_Asd-GkMXUFf-pGwtM3Bxag_4jECoxv_";

  var css = ""
    + ".cs-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;}"
    + ".cs-modal.open{display:flex;}"
    + ".cs-modal-backdrop{position:absolute;inset:0;background:rgba(20,30,26,.55);}"
    + ".cs-modal-card{position:relative;background:#fff;border-radius:18px;max-width:440px;width:100%;padding:26px 22px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);animation:csPop .2s ease;}"
    + "@keyframes csPop{from{transform:translateY(10px) scale(.98);opacity:0}to{transform:none;opacity:1}}"
    + ".cs-modal-x{position:absolute;top:10px;right:12px;border:0;background:transparent;font-size:26px;line-height:1;color:#9aa39d;cursor:pointer;padding:4px 8px;}"
    + ".cs-modal-card h3{margin:0 0 6px;font-size:20px;color:#0b0d10;}"
    + ".cs-modal-sub{margin:0 0 16px;font-size:13.5px;color:#6b736e;line-height:1.55;}"
    + ".cs-field{display:block;margin-bottom:14px;}"
    + ".cs-field>span{display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#0b0d10;}"
    + ".cs-field>span small{font-weight:400;color:#9aa39d;}"
    + ".cs-field input,.cs-field textarea{width:100%;box-sizing:border-box;border:1px solid #d9e0dc;border-radius:10px;padding:11px 12px;font-size:14px;font-family:inherit;color:inherit;}"
    + ".cs-field textarea{resize:vertical;min-height:110px;}"
    + ".cs-modal-card .btn{width:100%;justify-content:center;}"
    + ".cs-form-msg{margin-top:12px;font-size:13.5px;padding:12px 14px;border-radius:10px;display:none;background:#fdf6e7;color:#6b5518;border:1px solid #f0e2bf;}"
    + ".cs-form-msg.show{display:block;}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var html = ''
    + '<div class="cs-modal" id="inquiryModal" aria-hidden="true">'
    + '  <div class="cs-modal-backdrop" data-close></div>'
    + '  <div class="cs-modal-card" role="dialog" aria-modal="true" aria-labelledby="inqTitle">'
    + '    <button class="cs-modal-x" type="button" aria-label="닫기" data-close>&times;</button>'
    + '    <h3 id="inqTitle">1:1 문의하기</h3>'
    + '    <p class="cs-modal-sub">궁금한 점이나 상담 요청을 남겨 주세요. 입력하신 이메일로 답변드립니다.</p>'
    + '    <form id="inquiryForm" novalidate>'
    + '      <label class="cs-field"><span>이메일 <small>(답변 받을 주소)</small></span><input type="email" id="inqEmail" placeholder="you@example.com" autocomplete="email" /></label>'
    + '      <label class="cs-field"><span>문의 내용</span><textarea id="inqMsg" required placeholder="문의하실 내용을 자유롭게 적어 주세요."></textarea></label>'
    + '      <button type="submit" class="btn btn-primary" id="inqSend">보내기</button>'
    + '      <div class="cs-form-msg" id="inqMsgOut" role="status" aria-live="polite"></div>'
    + '    </form>'
    + '  </div>'
    + '</div>';
  var holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.appendChild(holder.firstChild);

  var modal = document.getElementById("inquiryModal");
  function openM() {
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var t = document.getElementById("inqMsg"); if (t) setTimeout(function () { t.focus(); }, 50);
  }
  function closeM() {
    modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  modal.querySelectorAll("[data-close]").forEach(function (el) { el.addEventListener("click", closeM); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal.classList.contains("open")) closeM(); });
  document.querySelectorAll("[data-inquiry]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); openM(); });
  });

  var form = document.getElementById("inquiryForm");
  var out = document.getElementById("inqMsgOut");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var msgEl = document.getElementById("inqMsg");
    var message = (msgEl.value || "").trim();
    if (!message) { msgEl.focus(); out.textContent = "문의 내용을 입력해 주세요."; out.classList.add("show"); return; }
    var email = (document.getElementById("inqEmail").value || "").trim();
    var sbtn = document.getElementById("inqSend");
    out.textContent = "보내는 중…"; out.classList.add("show"); sbtn.disabled = true;
    fetch(CONTACT_FN, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SB_ANON_KEY },
      body: JSON.stringify({ type: "inquiry", source: "fab-inquiry", email: email, message: message })
    })
      .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
      .then(function () { out.textContent = "문의가 접수되었습니다. 감사합니다! 🙌"; form.reset(); setTimeout(closeM, 1600); })
      .catch(function () { out.textContent = "전송 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."; })
      .finally(function () { sbtn.disabled = false; });
  });
})();
