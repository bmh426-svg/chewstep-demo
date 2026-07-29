// evidence-gate.js — '근거 없는 구체적 조언'을 걸러내는 방어층
// ─────────────────────────────────────────────────────────────────────
// 배경 (2026-07-29 · 리포트 구체성 개편 A단계)
//   구체적인 문장을 만들라고 요구하면, 입력에 없는 사실을 전제로 한 조언이 섞여 나온다.
//     "밥은 무조건 식탁에서 먹도록"        ← 식사 장소를 받은 적이 없다
//     "정해진 시간이 지나면 치우기"        ← 식사 시간 기록이 없다
//     "간식·수유량을 늘리지 않기"          ← 마지막 간식·수유 시각을 받은 적이 없다
//     "주먹밥을 절반 크기로 줄이기"        ← 한 입 크기를 받은 적이 없다
//   이런 문장은 '디테일해 보이지만 틀릴' 수 있고, 한 번 틀리면 결과 전체의 신뢰를 잃는다.
//
// 원칙
//   필요한 입력이 없으면 그 조언을 하지 않는다. 대신 missing_information 으로 넘겨
//   "입력되지 않아 이번에는 판단하지 않았다"고 밝힌다.
//
// 구조 — stage-gate.js 와 같은 2층 방식을 그대로 따른다.
//   1) 프롬프트: 엣지함수 SYSTEM 에 '미입력 사실 단정 금지' + factSheet 를 명시
//   2) 이 파일: 생성 결과를 신뢰하지 않고 문장 단위로 검사(규칙 엔진 문구도 함께 검사)
//
// 주의 — 여기서 막는 것은 '단정'이지 '언급'이 아니다.
//   "식사 장소는 입력되지 않아 판단하지 않았어요" 는 통과해야 한다.
//   그래서 패턴은 지시문 형태(…하세요/…주세요/…하기)와 함께 있을 때만 걸린다.
//
// 검증: cd verify && node prescription-check.mjs

/* ── 지시문 판정 ──
   조언(행동을 요구하는 문장)인지 본다. 설명·유보 문장은 대상이 아니다. */
//   '…세요' 로 끝나는 모든 존댓말 명령형을 잡는다(하세요·주세요·먹이세요·기다리세요…).
//   개별 동사를 나열하면 "밥은 식탁에서만 먹이세요" 처럼 목록에 없는 활용형이 그대로 새어 나간다.
//   근거 서술문은 '…답하셨어요 / …관찰됐어요' 로 끝나 '세요' 를 포함하지 않으므로 오탐이 없다.
const IMPERATIVE = /(세요|십시오|하기|줄이기|늘리기|치우기|앉히|먹이도록|먹도록|말아\s*주세요)/;

/* ── 근거가 필요한 조언 유형 ──
   re    : 문장에서 이 조언을 가리키는 표현
   needs : 이 중 하나라도 충족돼야 이 조언을 할 수 있다(OR 조건)
             "키"            → 그 값이 입력돼 있으면 충족
             {key, match}    → 그 값이 있고 **내용까지** 조건에 맞아야 충족
                               (설문 항목이 있다는 것만으로 근거가 되지 않는 경우.
                                예: refusal_response 는 6개 선택지 중 하나로, '영상 보여줌'을
                                고른 경우에만 식사 중 영상의 근거가 된다. 항목 존재만 보면
                                '좋아하는 음식으로 바꿔줌'을 고른 아이에게도 "영상을 끄세요"가
                                통과해 버린다 — 실제로 그렇게 새고 있었다)
   why   : 로그·검증에서 무엇이 없어 걸렸는지 남기기 위한 설명 */
export const CLAIM_RULES = [
  {
    id: "location",
    re: /(식탁|식사\s*의자|아기\s*의자|자리에\s*앉|앉아서\s*먹|한\s*자리에서)/,
    needs: ["meal_location", "tag.left_seat", "deep.seat"],
    why: "식사 장소·자리 이탈 입력이 없음",
  },
  {
    id: "wandering",
    re: /(돌아다니|따라다니지|자리를\s*뜨|일어나서\s*먹)/,
    needs: ["meal_location", "tag.left_seat", "deep.seat", { key: "refusal_response", match: /따라다니/ }],
    why: "돌아다님 관찰 입력이 없음",
  },
  {
    id: "clear_table",
    // '치우다'는 활용형이 갈린다(치우고·치워·치웠) → 치[우워] 로 함께 잡는다.
    re: /(정해진\s*시간|시간이\s*지나면|시간\s*되면).{0,14}(치[우워]|끝내|종료)|(\d+\s*분\s*(안에|이내에)).{0,10}(치[우워]|끝내|종료|마치)/,
    // meal_time(한 끼 식사 시간)은 설문에서 늘 받는 값이라, 식사가 길다는 '기록'이 된다.
    //   coach-rules.js GUARDS.end_meal_on_time 과 같은 조건을 유지한다(두 층이 갈리면 안 된다).
    needs: ["meal_schedule", "meal_time"],
    why: "정해진 식사시간·한 끼 식사 시간 입력이 없음",
  },
  {
    id: "snack_amount",
    re: /(간식|우유|분유|수유|주스).{0,14}(늘리지|줄이|양을|시간을|간격을)/,
    // interval(직전 식사와의 간격)은 '언제'만 알려주고 '무엇을 얼마나'는 알려주지 않는다.
    //   간식·수유의 양을 조정하라는 조언의 근거로는 부족하다 → 식사 전 섭취를 실제로 받았을 때만 허용.
    //   pre_intake_kind 는 meal-context.js 의 고정 코드값(none/snack/milk/formula/breastfeed).
    needs: ["pre_intake_kind"],
    why: "식사 전 간식·우유·수유 입력이 없음",
  },
  {
    id: "bite_size",
    // 막는 것은 '현재 크기를 기준으로 한 구체적 감량'이다("절반으로 줄여").
    //   일반적인 "한 입은 작게"·"한 입 양을 조금 줄이고"는 현재 크기를 몰라도 할 수 있는
    //   조언이므로 막지 않는다 — 여기까지 막으면 기존 단계별 팁이 통째로 사라진다.
    re: /(절반|반으로|반\s*정도로|현재\s*크기|지금\s*크기|현재의|지금의\s*절반).{0,10}(줄|낮추|작게)|(줄여|줄이).{0,6}(절반|반으로)/,
    // 태그 large_bite('큰 한입을 넣었어요')는 사람이 본 사실이라 크기 조언의 근거가 된다
    needs: ["bite_size", "serve_amount", "food_shape", "tag.large_bite", "tags"],
    why: "한 입 크기·음식 형태 입력이 없어 '현재의 절반'을 계산할 수 없음",
  },
  {
    id: "food_specific",
    re: /(주먹밥|김밥|국밥|볶음밥)/,
    needs: ["food_name", "food_shape"],
    why: "음식 이름 입력이 없음",
  },
  {
    id: "screen",
    re: /(영상|텔레비전|TV|티비|스마트폰|장난감).{0,14}(끄|치[우워]|보여주지|없이)/,
    needs: ["distraction", "deep.distract", "tag.lost_focus", { key: "refusal_response", match: /영상/ }],
    why: "식사 중 영상·장난감 입력이 없음",
  },
  {
    id: "self_feeding",
    re: /(스스로\s*먹|손으로\s*집어|먹여주지|숟가락을\s*쥐)/,
    needs: ["feeding_method", "tag.large_bite", "tag.repeated_prompt"],
    why: "먹는 방식(스스로·도움) 입력이 없음",
  },
];

/* needs 한 항목이 충족됐는가 — 문자열이면 존재만, {key,match} 면 값 내용까지 본다. */
function needMet(need, have) {
  if (typeof need === "string") return have[need] != null;
  if (!need || !need.key) return false;
  const v = have[need.key];
  if (v == null) return false;
  if (!need.match) return true;
  const text = Array.isArray(v) ? v.map((x) => (x && x.label) || x).join(" ") : String(v);
  return need.match.test(text);
}

/* 이 문장이 근거 없이 단정하는가 — 걸리면 {id, why} 를 돌려준다. */
export function unfoundedClaim(text, present) {
  if (!text) return null;
  const s = String(text);
  if (!IMPERATIVE.test(s)) return null;                 // 조언이 아니면 대상 아님
  const have = present || {};
  for (const rule of CLAIM_RULES) {
    if (!rule.re.test(s)) continue;
    if (!rule.needs.some((n) => needMet(n, have))) return { id: rule.id, why: rule.why };
  }
  return null;
}

/* ── 근거 검증 ──
   evidence[].ref 가 실제 입력에 있는지 확인한다. 없으면 그 근거는 지어낸 것이다.
   (LLM 이 "영상에서 자리를 이탈했어요" 처럼 관찰하지 않은 사실을 근거로 쓰는 것을 막는다) */
export function verifyEvidence(evidence, present) {
  const have = present || {};
  const kept = [], dropped = [];
  (evidence || []).forEach((e) => {
    if (e && e.ref && have[e.ref] != null) kept.push(e);
    else dropped.push(e);
  });
  return { kept: kept, dropped: dropped };
}

/* ── 처방 전체 통과시키기 ──
   · primary_action.title 이 근거 없는 단정이면 처방 전체를 버린다(null 반환)
     → 호출부는 규칙 엔진 결과를 그대로 쓴다(stage-gate.js 와 같은 정책)
   · how_to 는 걸린 줄만 버린다. 전부 버려지면 rule 의 팁으로 채운다.
   · evidence 는 ref 검증에서 살아남은 것만 남긴다.
   · 걸러진 조언의 근거 항목은 missing_information 에 올려, 침묵이 아니라 안내가 되게 한다.
   log: (event, payload) => void — 선택 */
export function gatePrescription(p, present, rule, log) {
  if (!p) return p;
  const have = present || {};
  const bad = unfoundedClaim(p.primary_action && p.primary_action.title, have);
  if (bad) {
    if (log) log("coach_unfounded_rejected", { claim: bad.id, why: bad.why, field: "title" });
    return null;
  }
  const out = Object.assign({}, p);
  out.primary_action = Object.assign({}, p.primary_action || {});

  const how = (out.primary_action.how_to || []);
  const keptHow = [], reasons = [];
  how.forEach((t) => {
    const b = unfoundedClaim(t, have);
    if (b) reasons.push(b);
    else keptHow.push(t);
  });
  if (reasons.length && log) log("coach_unfounded_dropped", { count: reasons.length, claims: reasons.map((r) => r.id) });
  out.primary_action.how_to = keptHow.length ? keptHow : ((rule && rule.tips) || []);

  const ver = verifyEvidence(out.evidence, have);
  if (ver.dropped.length && log) log("coach_evidence_unverified", { dropped: ver.dropped.length });
  out.evidence = ver.kept;

  // reason 이 근거 없는 단정이면 문장을 비우기보다, 근거 없이 단정하지 않는 표현으로 바꾼다
  if (unfoundedClaim(out.primary_action.reason, have)) {
    out.primary_action.reason = (rule && rule.firstCheck) || out.primary_action.reason;
  }
  return out;
}

export default { CLAIM_RULES, unfoundedClaim, verifyEvidence, gatePrescription };
