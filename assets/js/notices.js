// 공지사항 목록 렌더 + 관리자 글쓰기 버튼 노출
// 사용: 페이지에 <div id="noticeList" data-scope="parent|institution"></div>
//       (선택) <div id="noticeAdmin"></div>  ← 관리자일 때만 '글쓰기' 버튼이 채워짐
import { supabase } from "/assets/js/supabase.js";

// 카테고리 → 배지 색 클래스 (두 페이지 모두 정의된 클래스만 사용)
const CAT_CLASS = {
  "안내": "c-notice", "공지": "c-notice",
  "모집": "c-recruit",
  "개인정보": "c-privacy", "점검": "c-privacy",
  "이용 안내": "c-info", "운영 안내": "c-info", "업데이트": "c-info",
};

function esc(s) {
  return (s || "").replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmtDate(iso) {
  const d = new Date(iso);
  const p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate());
}

async function loadNotices() {
  const list = document.getElementById("noticeList");
  if (!list) return;
  const scope = list.dataset.scope || "all";
  list.setAttribute("aria-busy", "true");
  const { data, error } = await supabase
    .from("notices")
    .select("id, category, title, body, pinned, created_at, scope")
    .in("scope", [scope, "all"])
    .eq("is_published", true)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  list.removeAttribute("aria-busy");

  if (error) {
    list.innerHTML = '<p class="n-empty">공지사항을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>';
    return;
  }
  if (!data || !data.length) {
    list.innerHTML = '<p class="n-empty">아직 등록된 공지가 없어요.</p>';
    return;
  }
  list.innerHTML = data.map(function (n, i) {
    const cls = CAT_CLASS[n.category] || "c-info";
    const pin = n.pinned ? '<span class="n-pin" aria-label="상단 고정">📌</span> ' : "";
    return (
      '<details class="notice"' + (i === 0 ? " open" : "") + ">" +
        "<summary>" +
          '<span class="n-cat ' + cls + '">' + esc(n.category) + "</span>" +
          '<span class="n-title">' + pin + esc(n.title) + "</span>" +
          '<span class="n-date">' + fmtDate(n.created_at) + "</span>" +
          '<span class="n-plus" aria-hidden="true">+</span>' +
        "</summary>" +
        '<div class="n-body"><p>' + esc(n.body).replace(/\n/g, "<br>") + "</p></div>" +
      "</details>"
    );
  }).join("");
}

// 로그인 + 관리자일 때만 '글쓰기' 버튼 표시
async function setupAdmin() {
  const bar = document.getElementById("noticeAdmin");
  if (!bar) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) return;
    const scope = (document.getElementById("noticeList") || {}).dataset
      ? document.getElementById("noticeList").dataset.scope || "all"
      : "all";
    bar.innerHTML =
      '<a class="btn btn-primary notice-write-btn" href="/notice-write.html?scope=' +
      encodeURIComponent(scope) + '">✏️ 글쓰기</a>';
  } catch (e) { /* 비로그인/네트워크 실패 시 버튼 미표시 */ }
}

loadNotices();
setupAdmin();
