// 간편 로그인 — 이메일+비밀번호(지금) / 카카오·구글(키 연결 후).
// 무료: 로그인해야 데모 사용. 로그인하면 기록이 계정에 저장돼 기기를 바꿔도 이어짐.
import { supabase } from "./supabase.js";
import { logEvent } from "./journey.js";

// 이메일 로그인. 없는 계정이면 자동 가입까지 한 번에 처리한다.
export async function emailAuth(email, password) {
  await logEvent("email_auth_submit", {});
  // 1) 우선 로그인 시도
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return { ok: true, mode: "signin" };

  // 2) 계정이 없으면 가입 시도(로그인 자격 오류일 때만)
  const m = (error.message || "").toLowerCase();
  if (m.includes("invalid login credentials")) {
    const res = await supabase.auth.signUp({ email, password });
    if (res.error) return { ok: false, error: res.error.message };
    // 이메일 확인이 꺼져 있으면 즉시 세션 발급, 켜져 있으면 확인 메일 대기
    if (res.data.session) return { ok: true, mode: "signup" };
    return { ok: false, needConfirm: true };
  }
  return { ok: false, error: error.message };
}

// 소셜 로그인(카카오/구글) — 제공자 키 등록 후 활성화.
export async function signIn(provider) {
  await logEvent("login_click", { provider });
  const { error } = await supabase.auth.signInWithOAuth({
    provider, // 'kakao' | 'google'
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) alert("로그인을 시작할 수 없어요: " + error.message);
}

export async function signOut() {
  await logEvent("logout", {});
  await supabase.auth.signOut();
  location.reload();
}

// 로그인 자격 오류 메시지를 사용자 친화 문구로.
function friendly(msg) {
  const m = (msg || "").toLowerCase();
  if (m.includes("at least 6")) return "비밀번호는 6자 이상이어야 해요.";
  if (m.includes("invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않아요.";
  if (m.includes("email not confirmed")) return "이메일 확인이 필요해요. 받은 메일의 링크를 눌러 주세요.";
  if (m.includes("already registered")) return "이미 가입된 이메일이에요. 비밀번호를 확인해 주세요.";
  if (m.includes("rate limit") || m.includes("too many")) return "잠시 후 다시 시도해 주세요.";
  return msg || "문제가 발생했어요. 다시 시도해 주세요.";
}

// 헤더의 <div id="authArea"></div> 안을 상태에 맞게 채운다.
export async function mountAuthUI() {
  const area = document.getElementById("authArea");
  const modal = buildModal();

  function render(session) {
    if (!area) return;
    if (session && session.user) {
      const u = session.user;
      const name =
        u.user_metadata?.name ||
        u.user_metadata?.full_name ||
        u.user_metadata?.nickname ||
        (u.email || "").split("@")[0] ||
        "회원";
      const avatar = u.user_metadata?.avatar_url;
      area.innerHTML =
        `<div class="cs-user">` +
        (avatar
          ? `<img src="${avatar}" alt="" class="cs-ava"/>`
          : `<span class="cs-ava cs-ava-ph">${(name || "?").slice(0, 1)}</span>`) +
        `<span class="cs-uname">${name}</span>` +
        `<button class="cs-logout" id="csLogout">로그아웃</button></div>`;
      document.getElementById("csLogout").onclick = signOut;
    } else {
      area.innerHTML = `<button class="cs-login-btn" id="csLoginOpen">로그인</button>`;
      document.getElementById("csLoginOpen").onclick = () => modal.open();
    }
  }

  const { data } = await supabase.auth.getSession();
  render(data.session);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN") logEvent("login", { method: session?.user?.app_metadata?.provider || "email" });
    render(session);
    if (session && session.user) modal.close();
  });

  return { openLogin: () => modal.open() };
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "cs-modal";
  wrap.innerHTML =
    `<div class="cs-modal-card">` +
    `<button class="cs-modal-x" aria-label="닫기">×</button>` +
    `<div class="cs-modal-title">간편 로그인</div>` +
    `<p class="cs-modal-sub">이메일로 로그인하면 우리 아이 식사 <b>변화 기록</b>이 기기를 바꿔도 이어져요.<br/>처음이면 입력한 정보로 <b>자동 가입</b>돼요.</p>` +
    `<form class="cs-eform" novalidate>` +
      `<input class="cs-inp" type="email" name="email" placeholder="이메일 주소" autocomplete="email" required/>` +
      `<input class="cs-inp" type="password" name="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" minlength="6" required/>` +
      `<button type="submit" class="cs-oauth cs-email"><span>✉️</span> 이메일로 계속하기</button>` +
      `<div class="cs-emsg" role="alert"></div>` +
    `</form>` +
    `<p class="cs-modal-note">로그인 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.</p>` +
    `</div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.classList.remove("open");
  wrap.querySelector(".cs-modal-x").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });

  // 이메일 로그인 폼
  const form = wrap.querySelector(".cs-eform");
  const msg = wrap.querySelector(".cs-emsg");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const pw = form.password.value;
    if (!email || pw.length < 6) {
      msg.className = "cs-emsg err";
      msg.textContent = pw.length < 6 ? "비밀번호는 6자 이상이어야 해요." : "이메일을 입력해 주세요.";
      return;
    }
    submitBtn.disabled = true;
    msg.className = "cs-emsg";
    msg.textContent = "처리 중…";
    const r = await emailAuth(email, pw);
    submitBtn.disabled = false;
    if (r.ok) {
      // 세션 발급됨 → onAuthStateChange가 화면 갱신/데모 이어가기 처리, 모달은 닫힘
      msg.className = "cs-emsg ok";
      msg.textContent = "로그인되었어요!";
    } else if (r.needConfirm) {
      msg.className = "cs-emsg ok";
      msg.textContent = "확인 메일을 보냈어요. 메일의 링크를 누르면 로그인돼요.";
    } else {
      msg.className = "cs-emsg err";
      msg.textContent = friendly(r.error);
    }
  });

  // 소셜 로그인 버튼 제거됨 — 이메일 로그인만 제공(제공자 키 연결 후 재도입 가능).

  return { open: () => wrap.classList.add("open"), close };
}
