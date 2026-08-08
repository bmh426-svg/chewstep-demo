// email-check.js — 로그인·가입 이메일 입력 검증 (형식 + 흔한 오타 도메인 교정 제안)
//
// 왜 필요한가
//   2026-07-29 실제 가입 기록에 `bmh426@gamil.com`(gmail 오타)과 `jd2326@maver.com`(naver 오타)이
//   남아 있다. 앞의 사람은 같은 날 `bmh426@gmail.com`으로 다시 가입했다 — 오타 하나로 계정이
//   둘로 갈라졌고, 첫 기록은 닿을 수 없는 주소에 묶였다.
//   Supabase는 문법이 맞는 주소면 통과시키므로(`gamil.com`도 문법상 정상) 이쪽에서 잡아야 한다.
//
// 설계 원칙
//   - 형식 오류는 **막는다**(제출 차단). 확실히 틀린 것이라서.
//   - 오타 의심은 **막지 않는다**(제안만). `naver.co.kr` 처럼 진짜로 그 도메인을 쓰는 사람이 있다.
//     오탐으로 가입을 막으면 오타보다 더 나쁘다.
//
// 여기서 하지 않는 것
//   메일이 실제로 도달하는지는 확인하지 못한다. 그건 인증 메일 링크(⑤)만 보장할 수 있고,
//   지금 데모의 최대 이탈 지점이 로그인 게이트라서 의도적으로 넣지 않았다.

/* 문법 검증 — HTML5 이메일 규칙에 맞추되 TLD를 반드시 요구한다.
   (브라우저 기본 규칙은 `a@b` 도 통과시킨다. 우리한테는 그게 오타다.) */
const RE_EMAIL = /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/* 한국 사용자가 실제로 쓰는 도메인. 오타 교정의 기준이 된다.
   여기 없는 도메인은 "모르는 도메인"일 뿐 틀린 게 아니므로 아무 말도 하지 않는다. */
const KNOWN_DOMAINS = [
  "naver.com", "gmail.com", "daum.net", "hanmail.net", "nate.com",
  "kakao.com", "icloud.com", "outlook.com", "hotmail.com", "yahoo.com",
  "yahoo.co.kr", "korea.com", "empas.com", "chol.com", "dreamwiz.com",
  "me.com", "live.com", "msn.com", "protonmail.com", "naver.co.kr",
];

/* 편집거리로는 못 잡는(또는 위험한) 오타를 직접 못박아 둔다.
   예: gmail.co 는 gmail.com 과 거리 1 이지만, .co 는 실재하는 TLD라 규칙 없이는 애매하다. */
const HARD_TYPOS = {
  "gamil.com": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com",
  "gmaill.com": "gmail.com", "gnail.com": "gmail.com", "gmail.comm": "gmail.com",
  "maver.com": "naver.com", "navr.com": "naver.com", "nvaer.com": "naver.com",
  "naver.con": "naver.com", "naver.co": "naver.com", "naver.cm": "naver.com",
  "navber.com": "naver.com", "naber.com": "naver.com", "naver.comm": "naver.com",
  "hanmail.ne": "hanmail.net", "hanmial.net": "hanmail.net", "hanmail.com": "hanmail.net",
  "daum.ne": "daum.net", "daum.com": "daum.net",
  "nate.co": "nate.com", "nates.com": "nate.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
  "icloud.co": "icloud.com", "iclould.com": "icloud.com",
  "kakao.co": "kakao.com",
};

/* 편집거리(Levenshtein). 도메인 문자열이 짧아 단순 DP로 충분하다. */
function distance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[n];
}

/** 이메일 문법 검증. { ok, reason } 을 돌려준다. reason 은 사용자에게 그대로 보여줄 문장. */
export function checkEmailFormat(raw) {
  const email = String(raw == null ? "" : raw).trim();
  if (!email) return { ok: false, reason: "이메일을 입력해 주세요." };
  if (/\s/.test(email)) return { ok: false, reason: "이메일에 공백이 들어 있어요. 지우고 다시 입력해 주세요." };
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(email)) return { ok: false, reason: "이메일에 한글이 섞여 있어요. 한/영 키를 확인해 주세요." };
  const at = email.split("@").length - 1;
  if (at === 0) return { ok: false, reason: "@ 가 빠졌어요. 예: name@naver.com" };
  if (at > 1) return { ok: false, reason: "@ 가 두 번 들어갔어요. 주소를 다시 확인해 주세요." };
  const [local, domain] = email.split("@");
  if (!local) return { ok: false, reason: "@ 앞부분이 비어 있어요." };
  if (!domain) return { ok: false, reason: "@ 뒷부분(예: naver.com)이 비어 있어요." };
  if (!domain.includes(".")) return { ok: false, reason: `"${domain}" 뒤에 .com · .net 같은 주소가 빠졌어요.` };
  if (/^\.|\.$|\.\./.test(domain)) return { ok: false, reason: "점(.) 위치를 다시 확인해 주세요." };
  if (!RE_EMAIL.test(email)) return { ok: false, reason: "이메일 형식이 올바르지 않아요. 예: name@naver.com" };
  return { ok: true, reason: "" };
}

/** 오타로 보이면 고친 주소를, 아니면 null 을 돌려준다. 형식이 틀린 주소에는 아무 말도 하지 않는다. */
export function suggestEmail(raw) {
  const email = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!checkEmailFormat(email).ok) return null;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at), domain = email.slice(at + 1);

  if (KNOWN_DOMAINS.includes(domain)) return null;            // 아는 주소면 건드리지 않는다
  if (HARD_TYPOS[domain]) return local + "@" + HARD_TYPOS[domain];

  // 편집거리 1 이내면 오타로 본다. 2 는 오탐이 급격히 늘어 쓰지 않는다.
  // 짧은 도메인(≤5자)은 한 글자만 달라도 다른 회사일 수 있어 제외한다.
  let best = null, bestD = 99;
  for (const known of KNOWN_DOMAINS) {
    if (Math.abs(known.length - domain.length) > 1) continue;
    const d = distance(domain, known);
    if (d < bestD) { bestD = d; best = known; }
  }
  if (best && bestD === 1 && domain.length > 5) return local + "@" + best;
  return null;
}

/** 폼에서 한 번에 쓰기 좋은 묶음. { ok, reason, suggestion } */
export function inspectEmail(raw) {
  const fmt = checkEmailFormat(raw);
  return { ok: fmt.ok, reason: fmt.reason, suggestion: fmt.ok ? suggestEmail(raw) : null };
}
