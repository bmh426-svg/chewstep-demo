// consult-view.js — 상담 상세(글 읽기) · 2026-07-29 신설
// 목록(consult.js)은 제목만 보여주고, 제목을 누르면 이 화면으로 들어와 본문·답변을 읽는다.
//
// 열람 권한은 화면이 아니라 DB가 정한다.
//   consultations 의 RLS(consult_select: 공개글 OR 본인글 OR 관리자)로 조회하므로,
//   남의 비공개 글은 주소(?id=…)를 직접 입력해도 행이 내려오지 않는다 → '비공개' 안내를 띄운다.
//   즉 목록의 자물쇠는 안내일 뿐이고, 실제 차단은 이 조회에서 일어난다.
//
// 사용: <div id="cvBody"></div> · <div id="cvTop"></div>
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
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const POST_ID = qs.get("id") || "";

let CTX = { uid: null, isAdmin: false };
let ROW = null;

async function loadCtx() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    CTX.uid = session && session.user ? session.user.id : null;
    if (session) { try { const { data } = await supabase.rpc("is_admin"); CTX.isAdmin = data === true; } catch (e) { CTX.isAdmin = false; } }
  } catch (e) { /* 비로그인 */ }
}

/* 안내 화면 — 로그인 필요 / 잘못된 주소 / 비공개·삭제된 글 */
function renderNotice(emoji, head, msg, cta) {
  $("cvBody").innerHTML =
    '<div class="c-gate">' +
      '<div class="c-gate-emoji">' + emoji + "</div>" +
      "<h3>" + esc(head) + "</h3>" +
      "<p>" + msg + "</p>" +
      (cta || '<a class="btn btn-primary" href="/consult.html">상담 목록으로</a>') +
    "</div>";
}

function renderPost(r) {
  const answered = r.status === "answered" && r.answer;
  const priv = r.is_public
    ? '<span class="c-badge pub">🌐 공개</span>'
    : '<span class="c-badge priv">🔒 비공개</span>';
  const state = answered
    ? '<span class="c-badge done">답변완료</span>'
    : '<span class="c-badge wait">답변대기</span>';
  const cat = r.category ? '<span class="c-cat">' + esc(r.category) + "</span>" : "";
  const who = esc(r.author_name || "보호자");
  const age = (r.child_age_months != null && r.child_age_months !== "") ? " · " + esc(r.child_age_months) + "개월" : "";
  const canDelete = CTX.isAdmin || (CTX.uid && r.user_id === CTX.uid);

  const answerBlock = answered
    ? '<div class="c-answer"><div class="c-answer-head">' + NURSE_LABEL + " 답변" +
        (r.answered_at ? ' <span class="c-answer-date">' + fmtDate(r.answered_at) + "</span>" : "") +
      '</div><div class="c-answer-body">' + nl2br(r.answer) + "</div></div>"
    : '<div class="c-answer pending"><span>' + NURSE_LABEL + "가 확인 후 답변을 남겨드릴게요.</span></div>";

  // 관리자만 답변 작성/수정
  const adminForm = CTX.isAdmin
    ? '<form class="c-ansform" id="cvAnsForm">' +
        '<textarea rows="5" placeholder="' + NURSE_LABEL + ' 답변을 입력하세요">' + esc(r.answer || "") + "</textarea>" +
        '<div class="c-ansform-row">' +
          '<button type="submit" class="btn btn-primary c-sm">' + (answered ? "답변 수정" : "답변 등록") + "</button>" +
          '<span class="c-ansmsg" aria-live="polite"></span>' +
        "</div>" +
      "</form>"
    : "";

  $("cvBody").innerHTML =
    '<article class="c-card cv-card">' +
      '<div class="c-top">' + cat + state + priv + '<span class="c-date">' + fmtDate(r.created_at) + "</span></div>" +
      '<h2 class="cv-title">' + esc(r.title) + "</h2>" +
      '<div class="c-meta">' + who + age + "</div>" +
      '<div class="c-body cv-body">' + nl2br(r.body) + "</div>" +
      answerBlock +
      adminForm +
      (canDelete ? '<div class="c-actions"><button type="button" class="c-del" id="cvDel">삭제</button></div>' : "") +
    "</article>";

  const form = $("cvAnsForm");
  if (form) form.addEventListener("submit", function (e) { e.preventDefault(); onAnswerSubmit(form); });
  const del = $("cvDel");
  if (del) del.addEventListener("click", onDelete);
}

async function onAnswerSubmit(form) {
  const ta = form.querySelector("textarea");
  const msg = form.querySelector(".c-ansmsg");
  const btn = form.querySelector("button[type=submit]");
  const text = (ta.value || "").trim();
  if (!text) { msg.textContent = "답변 내용을 입력해 주세요."; return; }
  btn.disabled = true; const orig = btn.textContent; btn.textContent = "저장 중…";
  const { error } = await supabase.from("consultations")
    .update({ answer: text, status: "answered", answered_by: CTX.uid, answered_at: new Date().toISOString() })
    .eq("id", POST_ID);
  btn.disabled = false; btn.textContent = orig;
  if (error) { msg.textContent = "저장 실패: " + error.message; return; }
  msg.textContent = "저장됐어요 ✓";
  await load();                      // 저장된 내용으로 다시 그린다
}

async function onDelete() {
  if (!confirm("이 상담을 삭제할까요? 되돌릴 수 없어요.")) return;
  const { error } = await supabase.from("consultations").delete().eq("id", POST_ID);
  if (error) { alert("삭제 실패: " + error.message); return; }
  location.href = "/consult.html";
}

async function load() {
  // 본문·답변까지 전부 — RLS 가 열람 권한을 판단한다(권한 없으면 행이 없다)
  const { data, error } = await supabase
    .from("consultations")
    .select("id, user_id, author_name, child_age_months, category, title, body, is_public, status, answer, answered_at, created_at")
    .eq("id", POST_ID)
    .maybeSingle();

  if (error) {
    renderNotice("⚠️", "상담을 불러오지 못했어요", "잠시 후 다시 시도해 주세요.");
    return;
  }
  if (!data) {
    // 비공개 글(남의 글)이거나 삭제된 글 — 둘을 구분할 방법이 없으므로 함께 안내한다
    renderNotice("🔒", "이 상담은 볼 수 없어요",
      "글쓴이가 <b>비공개</b>로 남긴 상담이거나 삭제된 글이에요. 비공개 상담은 <b>글쓴이와 소아과 간호사만</b> 내용을 볼 수 있어요.");
    return;
  }
  ROW = data;
  document.title = data.title + " | 1:1 식습관 상담 | Chewstep";
  renderPost(data);
}

(async function init() {
  await loadCtx();
  if (!CTX.uid) {
    renderNotice("👩‍⚕️🔒", "상담은 로그인 후 볼 수 있어요",
      "아이 식습관 정보를 안전하게 보호하기 위해, 1:1 상담은 로그인한 보호자만 열람할 수 있어요.",
      '<a class="btn btn-primary" href="/login.html?next=' + encodeURIComponent("/consult-view.html?id=" + POST_ID) + '">로그인하고 보기</a>');
    return;
  }
  if (!POST_ID) {
    renderNotice("🤔", "어떤 상담인지 알 수 없어요", "주소가 올바르지 않아요. 목록에서 다시 선택해 주세요.");
    return;
  }
  await load();
})();
