// survey-draft.js — 설문 임시저장 · 이어하기 (localStorage)
// ─────────────────────────────────────────────────────────────────────
// 배경 (2026-07-28 · 사용자 테스트 피드백 #1)
//   설문 작성이나 영상 업로드 과정에서 중간에 나가면 처음부터 다시 해야 했다.
//
// 저장 범위 (같은 기기·같은 브라우저에서 이어쓰기)
//   · 선택한 아이 ID
//   · 설문 답변(폼 스냅샷)
//   · 현재 설문 스텝
//   · 마지막 저장 시각
//   · 진행 단계(stage) — 설문 작성 중 / 설문 완료·영상 대기
//   · 스키마 버전
//   ⚠ 영상 파일은 저장하지 않는다. 영상 선택 단계에서 이탈하면 설문까지만 복원하고
//     영상은 다시 선택하도록 안내한다(파일 핸들은 세션을 넘어 살아남지 않는다).
//
// 키는 사용자별·아이별로 분리한다 → 로그아웃 후 다른 계정에서 보이지 않는다.
//   chewstep_survey_draft_{userId}_{childId}
//
// 저장은 코드값 기준이라, 선택지 라벨이 바뀌어도 복원된다. 다만 문항 구조가 바뀌면
// 복원이 어긋날 수 있어 SCHEMA_VERSION 이 다른 초안은 폐기한다.
import S from "./survey-v3-schema.js";

const PREFIX = "chewstep_survey_draft_";
export const EXPIRY_DAYS = 14;            // 이보다 오래된 초안은 자동 만료
export const STAGE_SURVEY = "survey";         // 설문 작성 중
export const STAGE_VIDEO_PENDING = "video_pending";   // 설문 완료 · 영상 선택 대기

export function draftKey(userId, childId) {
  return PREFIX + (userId || "anon") + "_" + (childId || "nochild");
}

/* ── 폼 스냅샷 ──
   mount 안의 입력값을 name/id 기준으로 그대로 담는다. 코드값이라 라벨 변경에 안전하다. */
export function snapshotForm(mount) {
  if (!mount) return {};
  const form = {};
  mount.querySelectorAll('input[type="radio"]:checked').forEach((el) => { form[el.name] = el.value; });
  mount.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (!el.checked) return;
    if (!Array.isArray(form[el.name])) form[el.name] = [];
    form[el.name].push(el.value);
  });
  mount.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach((el) => {
    const key = el.id || el.name;
    if (key && el.value !== "") form[key] = el.value;
  });
  return form;
}

/* 스냅샷을 폼에 되돌린다. 없는 문항은 조용히 건너뛴다(조건부 문항은 나중에 렌더될 수 있다). */
export function restoreForm(mount, form) {
  if (!mount || !form) return;
  Object.keys(form).forEach((key) => {
    const val = form[key];
    if (Array.isArray(val)) {
      val.forEach((v) => {
        const el = mount.querySelector('input[type="checkbox"][name="' + key + '"][value="' + cssEscape(v) + '"]');
        if (el) el.checked = true;
      });
      return;
    }
    const radio = mount.querySelector('input[type="radio"][name="' + key + '"][value="' + cssEscape(val) + '"]');
    if (radio) { radio.checked = true; return; }
    const field = mount.querySelector("#" + cssEscape(key)) || mount.querySelector('[name="' + cssEscape(key) + '"]');
    if (field && ("value" in field)) field.value = val;
  });
}

// 선택지 값에 따옴표·특수문자가 들어가도 선택자가 깨지지 않게 한다(한글 라벨 값도 있다)
function cssEscape(v) {
  const s = String(v);
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s).replace(/\\/g, "\\");
  return s.replace(/["\\]/g, "\\$&");
}

/* ── 저장 ── */
export function saveDraft(userId, childId, patch) {
  if (!childId) return null;   // 아이를 고르기 전에는 초안을 만들지 않는다
  try {
    const prev = readRaw(userId, childId) || {};
    const rec = Object.assign({}, prev, patch, {
      version: S.SCHEMA_VERSION,
      userId: userId || null,
      childId: childId,
      savedAt: new Date().toISOString(),
    });
    localStorage.setItem(draftKey(userId, childId), JSON.stringify(rec));
    return rec;
  } catch (e) {
    return null;   // 용량 초과·프라이빗 모드 등 — 임시저장은 부가 기능이므로 흐름을 막지 않는다
  }
}

function readRaw(userId, childId) {
  try {
    const raw = localStorage.getItem(draftKey(userId, childId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ── 불러오기 ──
   반환: { rec, reason } — rec 이 null 이면 reason 에 사유(없음/만료/버전불일치).
   만료·버전불일치 초안은 읽는 시점에 지운다. */
export function loadDraft(userId, childId) {
  const rec = readRaw(userId, childId);
  if (!rec) return { rec: null, reason: "none" };
  if (rec.version !== S.SCHEMA_VERSION) {
    clearDraft(userId, childId);
    return { rec: null, reason: "version_mismatch" };
  }
  const age = Date.now() - new Date(rec.savedAt || 0).getTime();
  if (!isFinite(age) || age > EXPIRY_DAYS * 86400000) {
    clearDraft(userId, childId);
    return { rec: null, reason: "expired" };
  }
  if (!rec.form || !Object.keys(rec.form).length) {
    // 답변이 하나도 없는 초안은 이어쓸 의미가 없다
    clearDraft(userId, childId);
    return { rec: null, reason: "empty" };
  }
  return { rec: rec, reason: "ok" };
}

export function clearDraft(userId, childId) {
  try { localStorage.removeItem(draftKey(userId, childId)); } catch (e) { /* 무해 */ }
}

/* 현재 사용자의 초안을 모두 지운다(로그아웃 등). 다른 사용자 키는 건드리지 않는다. */
export function clearDraftsForUser(userId) {
  try {
    const pre = PREFIX + (userId || "anon") + "_";
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(pre) === 0) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    return keys.length;
  } catch (e) { return 0; }
}

/* 사람이 읽는 경과 시간 — 이어하기 안내에 쓴다 */
export function savedAgo(savedAt) {
  const t = new Date(savedAt || 0).getTime();
  if (!isFinite(t) || !t) return "";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return min + "분 전";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "시간 전";
  return Math.floor(hr / 24) + "일 전";
}
