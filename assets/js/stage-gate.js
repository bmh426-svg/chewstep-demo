// stage-gate.js — 음식 단계(food_form)에 맞지 않는 조언을 걸러내는 게이팅 모듈
// ─────────────────────────────────────────────────────────────────────
// 배경 (2026-07-28 · 사용자 테스트 피드백 #6)
//   '무른 유아식'을 먹이는 보호자에게 "믹서로 갈지 말고 포크로 거칠게 으깨 작은
//   알갱이를 남겨 주세요"가 결과로 나갔다. 이미 지나온 단계의 조언이라 후퇴로 읽힌다.
//   원인은 두 갈래였다.
//     ① 규칙 엔진의 공통 팁이 food_form 과 무관하게 삽입됨
//     ② LLM(coach 엣지함수)에 food_form 코드("soft")만 넘겨 단계 개념이 전달되지 않음
//
// 원칙
//   보호자가 선택한 현재 음식 단계보다 이전 단계의 조언은 제공하지 않는다.
//   현재 단계에서 실행할 수 있는 '다음 한 걸음'만 제안한다.
//
// 두 층으로 막는다
//   1) 규칙 엔진 팁 — tip.for = [코드…] 로 적용 단계를 선언하고 gateTips() 로 필터
//   2) LLM 출력    — sanitizeCoachForStage() 가 단계 후퇴 표현을 문장 단위로 제거
//                    (엣지함수 프롬프트도 고쳤지만, 생성 결과를 신뢰하지 않는 방어층)
//
// 기준표 원본: survey-v3-schema.js 의 FOOD_ADVICE / FOOD_ORDER
// 검증: verify/stage-gating-check.mjs (이 모듈을 직접 import 해서 확인)
import S from "./survey-v3-schema.js";

export const FOOD_ADVICE = S.FOOD_ADVICE;
export const FOOD_ORDER = S.FOOD_ORDER;
export const FOOD_LABEL = S.FOOD_LABEL;

/* ── 답변에서 현재 음식 형태 코드 뽑기 ──
   영상 재확인 단계('식사 상황이 조금 달라졌어요')에서 수정된 값도 여기로 들어온다. */
export function foodFormOf(answers) {
  const a = answers || {};
  const l1 = (a.survey && a.survey.lens01) || {};
  const v = l1.food_form || a.food_texture || null;
  return (v && FOOD_ORDER[v] != null) ? v : null;
}

/* ── 1층 · 규칙 엔진 팁 게이팅 ──
   tip 은 문자열(모든 단계 허용) 또는 { t, for:[코드…] } 형태.
   단계를 모를 때(food_form 미응답)는 판단 근거가 없으므로 제한하지 않는다. */
export function tipAllowed(tip, form) {
  if (typeof tip === "string") return true;
  if (!tip || !tip.t) return false;
  if (!tip.for || !tip.for.length) return true;
  if (!form) return true;
  return tip.for.indexOf(form) >= 0;
}
export function tipText(tip) {
  return (typeof tip === "string") ? tip : (tip && tip.t) || "";
}
export function gateTips(tips, form) {
  return (tips || []).filter((t) => tipAllowed(t, form)).map(tipText).filter(Boolean);
}

/* ── 2층 · LLM 출력 방어층 ──
   같은 단어라도 단계에 따라 정상 조언일 수 있어, 단어가 아니라 '조언의 형태를 띤 구(句)'로 잡는다.
     · 무른 유아식의 "으깬 음식과 작은 덩어리를 함께"  → 허용
     · 무른 유아식의 "포크로 으깨 알갱이를 남기기"      → 후퇴
   서술적 표현("혀·잇몸이 음식을 굴려 으깨요")까지 막으면 정상 문장이 사라지므로 주의.
   부정문 주의: /형태를 낮추/ 같은 패턴은 "형태를 낮추지 말고"(정반대 조언)까지 걸러 버린다. */
const REGRESS_GRIND = [/믹서/, /곱게\s*갈/, /다시\s*갈/, /갈지\s*말/, /가는\s*정도/, /갈아\s*서?\s*주/, /미음/, /퓌레|퓨레/];
const REGRESS_MASH  = [/알갱이를\s*남기/, /포크로\s*(거칠게\s*)?으깨/, /으깨\s*(어\s*)?주/, /으깨서\s*주/, /매시로/, /더\s*부드럽게\s*(갈|으깨)/];

export const STAGE_FORBID = {
  ground:     [],                                          // 가장 이전 단계 — 후퇴할 곳이 없다
  mashed:     [/믹서/, /곱게\s*갈/, /다시\s*갈/],            // 갈기로 되돌리는 것만 차단(으깨기는 현재 단계)
  small_bits: REGRESS_GRIND.concat([/완전히\s*으깨/]),
  soft:       REGRESS_GRIND.concat(REGRESS_MASH),
  regular:    REGRESS_GRIND.concat(REGRESS_MASH),
};

export function isStageRegression(text, form) {
  if (!text || !form) return false;
  const pats = STAGE_FORBID[form];
  if (!pats || !pats.length) return false;
  const s = String(text);
  return pats.some((re) => re.test(s));
}

/* LLM 코칭 결과에서 현재 단계와 맞지 않는 문장을 제거한다.
     · action(핵심 한 가지)이나 firstCheck 가 후퇴 조언이면 LLM 결과 전체를 버린다(null)
       → 호출부는 규칙 엔진 결과를 그대로 유지한다
     · tips 중 일부만 문제면 그 줄만 버리고, 전부 버려지면 규칙 엔진 팁으로 채운다
   log: (event, payload) => void — 선택. 무엇을 걸렀는지 기록하고 싶을 때 주입. */
export function sanitizeCoachForStage(coach, form, rule, log) {
  if (!coach || !form) return coach;
  const badAction = isStageRegression(coach.action, form);
  if (badAction || isStageRegression(coach.firstCheck, form)) {
    if (log) log("coach_stage_rejected", { food_form: form, field: badAction ? "action" : "firstCheck" });
    return null;
  }
  const tips = coach.tips || [];
  const kept = tips.filter((t) => !isStageRegression(t, form));
  const dropped = tips.length - kept.length;
  if (dropped > 0 && log) log("coach_stage_tips_dropped", { food_form: form, dropped: dropped });
  const out = Object.assign({}, coach);
  out.tips = kept.length ? kept : ((rule && rule.tips) || []);
  return out;
}

/* LLM 에 넘길 단계 계약 — 코드만 주면 단계를 오해하므로
   사람이 읽는 단계명 + 순서 + 허용/금지 조언을 함께 넘긴다. */
export function stageContract(form) {
  const adv = (form && FOOD_ADVICE[form]) || null;
  if (!adv) return null;
  return {
    code: form,
    label: adv.label,
    order: FOOD_ORDER[form],
    total: Object.keys(FOOD_ORDER).length,
    allow: adv.next,
    forbid: adv.avoid,
  };
}

/* ── 알레르기 필터 ────────────────────────────────────────────────
   단계별 팁은 구체 재료를 이름으로 권한다("푹 익힌 애호박·두부·바나나").
   아이 등록 시 받은 알레르기(demo_children.allergies)에 걸리는 재료가 있으면
   그 팁을 내보내지 않는다. 재료를 골라내 문장을 고치는 것보다, 문장을 버리는 쪽이 안전하다.
   토큰화 규칙은 products.js allergyTokens 와 같다(쉼표·가운뎃점·슬래시·공백 분리). */
export function allergyTokens(raw) {
  return String(raw || "").split(/[,·\/\s]+/).map((s) => s.trim()).filter((s) => s.length >= 1);
}
export function mentionsAllergen(text, tokens) {
  if (!text || !tokens || !tokens.length) return false;
  const s = String(text);
  // 1글자 토큰은 오탐이 커서(예: '밀' 이 '밀어냄'에 걸림) 2글자 이상만 문장 대조에 쓴다.
  return tokens.some((t) => t.length >= 2 && s.indexOf(t) >= 0);
}
/* 팁 목록에서 알레르기 재료를 언급한 줄을 제거한다.
   전부 제거되면 빈 목록이 되므로, 호출부가 단계 무관 팁으로 채울 수 있게 그대로 반환한다. */
export function filterAllergyTips(tips, allergies) {
  const tokens = allergyTokens(allergies);
  if (!tokens.length) return (tips || []).slice();
  return (tips || []).filter((t) => !mentionsAllergen(tipText(t), tokens));
}
