// consult.js — 소아과 간호사 1:1 식습관 상담 게시판
// 사용: 페이지에 <div id="consultTop"></div> (글쓰기/로그인 안내) + <div id="consultList"></div>
// RLS가 공개글·본인글·관리자 열람을 보장하므로, 여기선 표시/답변 UX만 담당한다.
import { supabase } from "/assets/js/supabase.js";

const NURSE_LABEL = "👩‍⚕️ 소아과 간호사";

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }
function fmtDate(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

let CTX = { session: null, uid: null, isAdmin: false };
async function loadCtx() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    CTX.session = session || null;
    CTX.uid = session && session.user ? session.user.id : null;
    if (session) { try { const { data } = await supabase.rpc("is_admin"); CTX.isAdmin = data === true; } catch (e) { CTX.isAdmin = false; } }
  } catch (e) { /* 비로그인 */ }
}

// 상단: 로그인 사용자에게 글쓰기 버튼(+관리자 안내)
function renderTop() {
  const top = document.getElementById("consultTop");
  if (!top) return;
  top.innerHTML =
    '<a class="btn btn-primary consult-write-btn" href="/consult-write.html">✏️ 상담 글쓰기</a>' +
    (CTX.isAdmin ? '<span class="c-adminflag">관리자 · 모든 상담을 보고 답변할 수 있어요</span>' : '');
}

// 비로그인: 상담은 로그인해야 이용 가능 → 로그인 게이트 표시
function renderGate() {
  const top = document.getElementById("consultTop");
  const list = document.getElementById("consultList");
  if (top) top.innerHTML = "";
  if (list) {
    list.innerHTML =
      '<div class="c-gate">' +
        '<div class="c-gate-emoji">👩‍⚕️🔒</div>' +
        '<h3>상담은 로그인 후 이용할 수 있어요</h3>' +
        '<p>아이 식습관 정보를 안전하게 보호하기 위해, 1:1 상담은 로그인한 보호자만 작성·열람할 수 있어요.</p>' +
        '<a class="btn btn-primary" href="/login.html?next=/consult.html">로그인하고 상담하기</a>' +
        '<p class="c-gate-sub">계정이 없으신가요? <a href="/login.html?next=/consult.html">이메일로 간편 가입</a></p>' +
      "</div>";
  }
}

function cardHtml(r) {
  const priv = r.is_public
    ? '<span class="c-badge pub">🌐 공개</span>'
    : '<span class="c-badge priv">🔒 비공개</span>';
  const answered = r.status === "answered" && r.answer;
  const statusBadge = answered
    ? '<span class="c-badge done">답변완료</span>'
    : '<span class="c-badge wait">답변대기</span>';
  const who = esc(r.author_name || "보호자");
  const age = (r.child_age_months != null && r.child_age_months !== "") ? " · " + esc(r.child_age_months) + "개월" : "";
  const cat = r.category ? '<span class="c-cat">' + esc(r.category) + "</span>" : "";
  const canDelete = CTX.isAdmin || (CTX.uid && r.user_id === CTX.uid);

  // 답변 블록
  let answerBlock = "";
  if (answered) {
    answerBlock =
      '<div class="c-answer"><div class="c-answer-head">' + NURSE_LABEL + " 답변" +
        (r.answered_at ? ' <span class="c-answer-date">' + fmtDate(r.answered_at) + "</span>" : "") +
      "</div><div class=\"c-answer-body\">" + nl2br(r.answer) + "</div></div>";
  } else {
    answerBlock = '<div class="c-answer pending"><span>' + NURSE_LABEL + "가 확인 후 답변을 남겨드릴게요.</span></div>";
  }

  // 관리자 답변 작성/수정 폼
  let adminForm = "";
  if (CTX.isAdmin) {
    adminForm =
      '<form class="c-ansform" data-id="' + esc(r.id) + '">' +
        '<textarea rows="4" placeholder="' + NURSE_LABEL + ' 답변을 입력하세요">' + esc(r.answer || "") + "</textarea>" +
        '<div class="c-ansform-row">' +
          '<button type="submit" class="btn btn-primary c-sm">' + (answered ? "답변 수정" : "답변 등록") + "</button>" +
          '<span class="c-ansmsg" aria-live="polite"></span>' +
        "</div>" +
      "</form>";
  }

  return (
    '<article class="c-card" data-id="' + esc(r.id) + '">' +
      '<div class="c-top">' + cat + statusBadge + priv + '<span class="c-date">' + fmtDate(r.created_at) + "</span></div>" +
      '<h3 class="c-title">' + esc(r.title) + "</h3>" +
      '<div class="c-meta">' + who + age + "</div>" +
      '<div class="c-body">' + nl2br(r.body) + "</div>" +
      answerBlock +
      adminForm +
      (canDelete ? '<div class="c-actions"><button type="button" class="c-del" data-id="' + esc(r.id) + '">삭제</button></div>' : "") +
    "</article>"
  );
}

async function loadList() {
  const list = document.getElementById("consultList");
  if (!list) return;
  list.setAttribute("aria-busy", "true");
  const { data, error } = await supabase
    .from("consultations")
    .select("id, user_id, author_name, child_age_months, category, title, body, is_public, status, answer, answered_at, created_at")
    .order("status", { ascending: true })       // open(대기) 먼저 — 관리자 편의
    .order("created_at", { ascending: false });
  list.removeAttribute("aria-busy");

  if (error) { list.innerHTML = '<p class="c-empty">상담 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>'; return; }
  if (!data || !data.length) {
    list.innerHTML = CTX.uid
      ? '<p class="c-empty">아직 상담 글이 없어요. 위 <b>상담 글쓰기</b>로 첫 상담을 남겨보세요.</p>'
      : '<p class="c-empty">아직 공개된 상담이 없어요. 로그인하면 1:1 상담을 시작할 수 있어요.</p>';
    return;
  }
  list.innerHTML = data.map(cardHtml).join("");
}

// 관리자 답변 등록/수정
async function onAnswerSubmit(form) {
  const id = form.getAttribute("data-id");
  const ta = form.querySelector("textarea");
  const msg = form.querySelector(".c-ansmsg");
  const btn = form.querySelector("button[type=submit]");
  const text = (ta.value || "").trim();
  if (!text) { msg.textContent = "답변 내용을 입력해 주세요."; return; }
  btn.disabled = true; const orig = btn.textContent; btn.textContent = "저장 중…";
  const { error } = await supabase.from("consultations")
    .update({ answer: text, status: "answered", answered_by: CTX.uid, answered_at: new Date().toISOString() })
    .eq("id", id);
  btn.disabled = false; btn.textContent = orig;
  if (error) { msg.textContent = "저장 실패: " + error.message; return; }
  msg.textContent = "저장됐어요 ✓";
  await loadList();
}

async function onDelete(id) {
  if (!confirm("이 상담을 삭제할까요? 되돌릴 수 없어요.")) return;
  const { error } = await supabase.from("consultations").delete().eq("id", id);
  if (error) { alert("삭제 실패: " + error.message); return; }
  await loadList();
}

function bindEvents() {
  const list = document.getElementById("consultList");
  if (!list) return;
  list.addEventListener("submit", function (e) {
    const f = e.target.closest(".c-ansform");
    if (f) { e.preventDefault(); onAnswerSubmit(f); }
  });
  list.addEventListener("click", function (e) {
    const del = e.target.closest(".c-del");
    if (del) { onDelete(del.getAttribute("data-id")); }
  });
}

(async function init() {
  await loadCtx();
  if (!CTX.uid) { renderGate(); return; }   // 로그인 필수
  renderTop();
  bindEvents();
  await loadList();
})();
