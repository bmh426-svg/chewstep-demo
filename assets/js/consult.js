// consult.js — 소아과 간호사 1:1 식습관 상담 게시판 · 목록(제목만)
// 사용: 페이지에 <div id="consultTop"></div> (글쓰기/로그인 안내) + <div id="consultList"></div>
//
// 2026-07-29 변경 — 목록은 '제목만' 보여준다.
//   이전에는 목록 카드에 본문·답변·관리자 답변폼까지 모두 펼쳐 놓아, 남의 상담 내용이
//   목록에서 그대로 읽혔고 글이 쌓일수록 스크롤이 길어졌다.
//   이제 목록은 제목 한 줄이고, 제목을 누르면 상세(consult-view.html?id=…)로 들어가 읽는다.
//   본문·답변·관리자 답변폼·삭제는 전부 상세 화면(consult-view.js)이 담당한다.
//
// 비공개 글 처리
//   목록은 consultation_titles() RPC 로 받는다(제목·상태만 돌려주고 body·answer 는 애초에 없다).
//   남의 비공개 글도 '제목 + 🔒'로 보이지만 링크가 아니라 눌러도 들어갈 수 없고,
//   설령 주소로 직접 들어가도 원본 테이블 RLS 가 본문을 주지 않는다(화면이 아니라 DB가 막는다).
//   함수 정의·노출 경계: db/migrations/2026-07-29_consultation-list-titles.sql
import { supabase } from "/assets/js/supabase.js";

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmtDate(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate());
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
    list.className = "consult-list plain";
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

/* 목록 한 줄 — 제목 + (비공개면 자물쇠) + 답변상태 + 날짜.
   읽을 수 있으면 <a>(상세로 이동), 읽을 수 없으면 <div>(눌러도 반응 없음 + 안내 툴팁). */
function rowHtml(r) {
  const lock = r.is_public
    ? ""
    : '<span class="c-lock" title="비공개 상담" aria-label="비공개">🔒</span>';
  const mine = r.is_mine ? '<span class="c-mine">내 글</span>' : "";
  const state = r.answered
    ? '<span class="c-badge done">답변완료</span>'
    : '<span class="c-badge wait">답변대기</span>';
  const inner =
    '<span class="c-rmain">' + lock + '<span class="c-rt">' + esc(r.title) + "</span>" + mine + "</span>" +
    '<span class="c-rmeta">' + state + '<span class="c-date">' + fmtDate(r.created_at) + "</span></span>";

  if (r.can_read) {
    return '<a class="c-row" href="/consult-view.html?id=' + encodeURIComponent(r.id) + '">' + inner + "</a>";
  }
  return (
    '<div class="c-row locked" aria-disabled="true" title="글쓴이가 비공개로 남긴 상담이라 내용을 볼 수 없어요">' +
      inner +
    "</div>"
  );
}

async function loadList() {
  const list = document.getElementById("consultList");
  if (!list) return;
  list.setAttribute("aria-busy", "true");
  // 목록 전용 함수 — body·answer 는 애초에 내려오지 않는다(최신순·최대 500건은 함수 안에서 정렬·제한).
  const { data, error } = await supabase.rpc("consultation_titles");
  list.removeAttribute("aria-busy");

  if (error) { list.className = "consult-list plain"; list.innerHTML = '<p class="c-empty">상담 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>'; return; }
  if (!data || !data.length) {
    list.className = "consult-list plain";
    list.innerHTML = '<p class="c-empty">아직 상담 글이 없어요. 위 <b>상담 글쓰기</b>로 첫 상담을 남겨보세요.</p>';
    return;
  }
  list.className = "consult-list";
  list.innerHTML =
    '<div class="c-listhead"><span>제목</span><span class="c-listhead-r">상태 · 날짜</span></div>' +
    data.map(rowHtml).join("") +
    '<p class="c-listnote">🔒 는 글쓴이가 비공개로 남긴 상담이에요 — 제목만 보이고 내용은 글쓴이와 간호사만 볼 수 있어요.</p>';
}

(async function init() {
  await loadCtx();
  if (!CTX.uid) { renderGate(); return; }   // 로그인 필수
  renderTop();
  await loadList();
})();
