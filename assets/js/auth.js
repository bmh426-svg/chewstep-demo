// 간편 로그인 — 이메일+비밀번호(지금) / 카카오·구글(키 연결 후).
// 무료: 로그인해야 데모 사용. 로그인하면 기록이 계정에 저장돼 기기를 바꿔도 이어짐.
import { supabase } from "./supabase.js";
import { logEvent } from "./journey.js";
import { inspectEmail } from "./email-check.js";

// 로그인 시각 기록 — profiles.last_login_at (관리자 사용자 탭 '최근 로그인').
// 본인 행의 그 컬럼만 갱신하는 SECURITY DEFINER RPC. 실패해도 로그인 흐름은 막지 않는다.
// (db/migrations/2026-07-28_profiles-activity-columns.sql)
async function touchLogin() {
  try { await supabase.rpc("touch_last_login"); } catch (e) { /* 기록 실패는 무시 */ }
}

/* ── 익명 세션 ──────────────────────────────────────────────────────────
   왜: 데모 시작 화면의 로그인 모달이 최대 이탈 지점이었다(진입 136세션 중 78이 닫고,
   그중 63은 그대로 종료 · 닫기까지 중앙값 1.1초). 로그인을 결과 저장 시점으로 미루려면
   그 전 단계(아이 등록·설문)가 로그인 없이 돌아가야 하는데, demo_children RLS 는
   authenticated 를 요구한다. 그래서 아무것도 묻지 않고 계정을 하나 발급받는다.

   승급하면 **같은 user_id 를 유지**하므로 익명으로 남긴 기록이 그대로 이어진다.
   대시보드에서 Anonymous sign-ins 가 꺼져 있으면 ok:false 를 돌려주고,
   호출부는 예전처럼 로그인부터 요구하면 된다(배포해도 안전). */
export async function ensureAnonSession() {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data && data.session && data.session.user;
    if (u) return { ok: true, uid: u.id, anonymous: !!u.is_anonymous, created: false };
  } catch (e) { /* 아래에서 새로 만든다 */ }

  if (typeof supabase.auth.signInAnonymously !== "function") {
    return { ok: false, disabled: true, reason: "이 클라이언트는 익명 로그인을 지원하지 않아요." };
  }
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      const disabled = /anonymous/i.test(error.message || "") || error.code === "anonymous_provider_disabled";
      logEvent("anon_session_failed", { disabled, msg: (error.message || "").slice(0, 120) });
      return { ok: false, disabled, reason: error.message };
    }
    const u = data && data.user;
    logEvent("anon_session_started", {});
    return { ok: true, uid: u && u.id, anonymous: true, created: true };
  } catch (e) {
    return { ok: false, disabled: false, reason: String(e && e.message || e) };
  }
}

/** 지금 세션이 '정식 계정'인지. 익명 세션은 uid 가 있어도 false. */
export async function isPermanentUser() {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data && data.session && data.session.user;
    return !!(u && !u.is_anonymous);
  } catch (e) { return false; }
}

/* 익명 → 정식 승급. 같은 user_id 를 유지하므로 기록이 끊기지 않는다.
   이미 가입된 이메일이면 승급이 실패한다 → 그 계정으로 로그인시킨 뒤,
   방금 익명으로 남긴 기록을 claim_anonymous_data 로 옮겨 붙인다. */
export async function upgradeOrSignIn(email, password) {
  const { data: s0 } = await supabase.auth.getSession();
  const cur = s0 && s0.session && s0.session.user;

  if (cur && cur.is_anonymous) {
    const anonUid = cur.id;
    const { error } = await supabase.auth.updateUser({ email, password });
    if (!error) {
      await touchLogin();
      logEvent("anon_upgraded", {});
      return { ok: true, mode: "upgrade" };
    }
    const m = (error.message || "").toLowerCase();
    const taken = m.includes("already") || m.includes("exists") || m.includes("registered");
    if (!taken) return { ok: false, error: error.message };

    // 이미 있는 계정 → 로그인 후 익명 기록 인계
    const r = await emailAuth(email, password);
    if (!r.ok) return r;
    try {
      const { data: moved } = await supabase.rpc("claim_anonymous_data", { p_from: anonUid });
      logEvent("anon_data_claimed", { rows: moved || 0 });
    } catch (e) { /* 인계 실패해도 로그인은 성공 — 흐름을 막지 않는다 */ }
    return { ok: true, mode: "signin_claimed" };
  }

  return emailAuth(email, password);
}

// 이메일 로그인. 없는 계정이면 자동 가입까지 한 번에 처리한다.
export async function emailAuth(email, password) {
  await logEvent("email_auth_submit", {});
  // 1) 우선 로그인 시도
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) { await touchLogin(); return { ok: true, mode: "signin" }; }

  // 2) 계정이 없으면 가입 시도(로그인 자격 오류일 때만)
  const m = (error.message || "").toLowerCase();
  if (m.includes("invalid login credentials")) {
    const res = await supabase.auth.signUp({ email, password });
    if (res.error) return { ok: false, error: res.error.message };
    // 이메일 확인이 꺼져 있으면 즉시 세션 발급, 켜져 있으면 확인 메일 대기
    if (res.data.session) { await touchLogin(); return { ok: true, mode: "signup" }; }
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
    // 익명 세션은 '로그인 안 한 상태'로 보여준다 — 헤더에 이름 대신 [로그인] 버튼이 남아야 한다.
    if (session && session.user && !session.user.is_anonymous) {
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
    // 익명 세션 발급도 SIGNED_IN 으로 온다 — 그걸 로그인으로 세면 퍼널이 망가진다.
    // 승급(익명→정식)은 SIGNED_IN 이 아니라 USER_UPDATED 로 온다.
    const u = session && session.user;
    const permanent = !!(u && !u.is_anonymous);
    if (permanent && (event === "SIGNED_IN" || event === "USER_UPDATED")) {
      logEvent("login", { method: u.app_metadata?.provider || "email", upgraded: event === "USER_UPDATED" });
    }
    render(session);
    if (permanent) modal.close();
  });

  return { openLogin: () => modal.open() };
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "cs-modal";
  wrap.innerHTML =
    `<div class="cs-modal-card">` +
    `<button class="cs-modal-x" aria-label="닫기">×</button>` +
    `<div class="cs-modal-title">결과 저장하기</div>` +
    `<p class="cs-modal-sub">지금까지 <b>입력하신 내용은 이미 저장돼 있어요.</b><br/>이메일을 넣으면 그 기록을 계정에 묶어 <b>다음에 이어서</b> 볼 수 있어요 — 기기를 바꿔도요.<br/>처음이면 입력한 정보로 <b>자동 가입</b>돼요.</p>` +
    `<form class="cs-eform" novalidate>` +
      `<input class="cs-inp" type="email" name="email" placeholder="이메일 주소" autocomplete="email" required/>` +
      `<input class="cs-inp" type="password" name="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" minlength="6" required/>` +
      `<div class="cs-fix" hidden><span class="cs-fix-t"></span><button type="button" class="cs-fix-btn">이 주소로 바꾸기</button></div>` +
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

  /* 오타 도메인 교정 제안 (email-check.js)
     제안일 뿐 제출을 막지 않는다 — 정말 그 도메인을 쓰는 사람을 가로막으면 오타보다 나쁘다.
     한 번 무시하면 그 주소로는 다시 묻지 않는다. */
  const fixBar = form.querySelector(".cs-fix");
  const fixText = form.querySelector(".cs-fix-t");
  const fixBtn = form.querySelector(".cs-fix-btn");
  let pendingFix = null, dismissedFix = "";
  const hideFix = () => { pendingFix = null; fixBar.hidden = true; };
  function showFix(suggestion) {
    if (!suggestion || suggestion === dismissedFix) return;
    pendingFix = suggestion;
    fixText.textContent = `혹시 ${suggestion} 인가요?`;
    fixBar.hidden = false;
  }
  fixBtn.addEventListener("click", () => {
    if (!pendingFix) return;
    form.email.value = pendingFix;
    logEvent("email_typo_fixed", { to_domain: pendingFix.split("@")[1] });
    hideFix();
    msg.className = "cs-emsg"; msg.textContent = "";
    form.password.focus();
  });
  // 입력 중에는 잔소리하지 않고, 이메일 칸을 떠날 때 한 번만 본다.
  form.email.addEventListener("blur", () => {
    const v = form.email.value.trim();
    if (!v) return hideFix();
    const r = inspectEmail(v);
    if (!r.ok) { hideFix(); msg.className = "cs-emsg err"; msg.textContent = r.reason; return; }
    if (msg.classList.contains("err")) { msg.className = "cs-emsg"; msg.textContent = ""; }
    r.suggestion ? showFix(r.suggestion) : hideFix();
  });
  form.email.addEventListener("input", () => { if (!fixBar.hidden) hideFix(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const pw = form.password.value;
    // 1) 형식은 확실히 틀린 것이므로 막는다.
    const chk = inspectEmail(email);
    if (!chk.ok) {
      msg.className = "cs-emsg err";
      msg.textContent = chk.reason;
      form.email.focus();
      logEvent("email_format_rejected", { reason: chk.reason });
      return;
    }
    if (pw.length < 6) {
      msg.className = "cs-emsg err";
      msg.textContent = "비밀번호는 6자 이상이어야 해요.";
      form.password.focus();
      return;
    }
    // 2) 오타 의심이면 한 번만 되묻고, 그래도 그대로 누르면 진행한다.
    if (chk.suggestion && chk.suggestion !== dismissedFix) {
      showFix(chk.suggestion);
      dismissedFix = chk.suggestion;            // 다음 제출부터는 통과
      msg.className = "cs-emsg err";
      msg.textContent = "주소를 한 번만 확인해 주세요. 맞으면 다시 눌러 주세요.";
      logEvent("email_typo_suggested", { to_domain: chk.suggestion.split("@")[1] });
      return;
    }
    hideFix();
    submitBtn.disabled = true;
    msg.className = "cs-emsg";
    msg.textContent = "처리 중…";
    // 익명으로 쓰던 중이면 같은 계정을 승급시켜 기록을 잇는다(upgradeOrSignIn).
    const r = await upgradeOrSignIn(email, pw);
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
