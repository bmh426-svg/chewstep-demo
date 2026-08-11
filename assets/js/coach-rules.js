// coach-rules.js — 관찰 조합별 코칭 규칙 + 근거 없는 조언 차단(가드)
// ─────────────────────────────────────────────────────────────────────
// B단계 ④ (2026-07-29)
//   "맞춤 조언을 써줘"라고만 하면 매번 비슷한 말이 나온다. 그래서 조언을 만드는 주체를
//   LLM 이 아니라 규칙으로 옮긴다. LLM 은 이 결과를 보호자 언어로 표현만 한다.
//
// 두 축으로 되어 있다.
//   RULES  관찰 조합 → 제안 가능한 행동(allowed_actions) + 이 조합에서 금지되는 행동
//   GUARDS 어떤 사실이 없으면 그 조언 자체를 금지 (근거 없는 디테일 차단)
//
// GUARDS 가 핵심이다. 사용자가 지적한 대로,
//   "밥은 무조건 식탁에서" · "정해진 시간이 지나면 치우기" · "간식·수유량을 늘리지 않기"
//   같은 조언은 각각 근거가 필요하고, 근거가 없으면 **디테일해 보이지만 틀릴** 수 있다.
//   그래서 필요한 사실이 없으면 그 행동을 prohibited_actions 로 내려보내고,
//   evidence-gate.js 가 문장 단위로 다시 막는다(2층 방어).
//
// 조건식(when)은 fact 맵을 본다 — key → 값. fact 맵은 coaching-input.js 가 만든다.
//   { key, in:[...] }        값이 목록 안에 있어야 한다
//   { key, gte / lte }       숫자 비교
//   { key, eq }              같아야 한다
//   { tag: "code" }          그 관찰 태그가 있어야 한다
//   { any: [조건…] }         하나라도 참
//   { absent: "key" }        그 사실이 **없어야** 한다
//
// import 없음(순수 정의). 검증: cd verify && node observation-rules-check.mjs

/* ── 행동 코드 ────────────────────────────────────────────────────
   LLM 에 "이 목록 안에서만 말하라"고 넘기는 계약. 문장이 아니라 코드로 주는 이유는
   표현은 LLM 이 다듬되 **행동의 종류**는 시스템이 정하기 위해서다. */
export const ACTIONS = {
  reduce_bite_size_one_step:   "한 입 크기를 한 단계 줄이기",
  reduce_serve_amount:         "한 번에 넣어 주는 양을 줄이기",
  split_sticky_lump:           "찰진 덩어리를 작게 나누어 주기",
  wait_until_mouth_clears:     "한 입을 삼킨 뒤 다음 한 입 주기",
  keep_texture_stage:          "지금의 식감 단계를 유지하기",
  soften_by_cooking:           "조리법으로 부드럽게 하기(형태는 유지)",
  mix_with_rice:               "밥·매시에 섞어 한 덩어리로 주기",
  flatten_and_long:            "납작하고 길게 썰어 주기",
  observe_three_bites:         "세 번의 한입만 같은 조건으로 관찰하기",
  adjust_meal_interval:        "식사 간격을 일정하게 맞추기",
  move_milk_to_snack_time:     "우유·수유를 식사 직전이 아닌 간식 시간으로 옮기기",
  reduce_pre_meal_intake:      "식사 전 간식·우유 양을 줄이기",
  seat_at_table:               "정해진 자리(식탁·식사의자)에서 먹게 하기",
  remove_distraction:          "식사 중 영상·장난감을 치우기",
  end_meal_on_time:            "정해진 시간에 식사를 마치기",
  shorten_meal_window:         "식사 시간을 20~30분으로 좁히기",
  repeated_exposure:           "익숙한 음식 옆에 조금씩 함께 두기",
  reduce_portion_offered:      "처음 제공량을 줄여 부담 낮추기",
  record_again_same_condition: "같은 조건으로 한 번 더 기록하기",
};

/* ── 절대 금지 행동 ── 어떤 근거가 있어도 시스템이 만들지 않는다.
   안전·의료 판단 영역이고, 안전 문구는 검수된 고정 문구에서만 나온다. */
export const ALWAYS_PROHIBITED = [
  "diagnose_swallowing_disorder",       // 한 번의 영상으로 구강 기능 문제 확정
  "recommend_liquid_to_force_swallow",  // 물·국으로 넘기게 돕기
  "blend_to_puree_without_evidence",    // 무조건 믹서로 갈기
  "force_feed",                         // 억지로 먹이기
  "restrict_meal_time_uniformly",       // 모든 아이에게 같은 식사시간 제한
];
export const PROHIBITED_LABEL = {
  diagnose_swallowing_disorder: "한 번의 영상으로 삼킴·구강 기능 문제를 단정하기",
  recommend_liquid_to_force_swallow: "물이나 국으로 넘기게 돕기",
  blend_to_puree_without_evidence: "근거 없이 믹서로 갈아 주기",
  force_feed: "억지로 더 먹이기",
  restrict_meal_time_uniformly: "정해진 시간이 지나면 무조건 치우기",
  soften_or_reduce_texture: "식감을 더 부드럽고 잘게 낮추기",
  seat_at_table: "식탁에서 먹게 하라고 조언하기",
  remove_distraction: "영상·장난감을 치우라고 조언하기",
  reduce_pre_meal_intake: "식사 전 간식·우유 양을 줄이라고 조언하기",
  reduce_bite_size_one_step: "한 입 크기를 줄이라고 조언하기",
  end_meal_on_time: "정해진 시간에 식사를 마치라고 조언하기",
};

/* ── 가드 ── "이 사실이 없으면 이 조언을 하지 않는다"
   needs: 하나라도 있으면 허용(OR). 값 내용까지 봐야 하는 경우는 { key, in } 으로 적는다.
   사용자가 든 4가지 예를 그대로 담았다. */
export const GUARDS = [
  {
    action: "seat_at_table",
    needs: [{ key: "meal_location" }, { tag: "left_seat" }, { key: "deep.seat" }],
    why: "식사 장소나 자리 이탈이 입력·관찰되지 않았음",
    missing: ["meal_location"],
  },
  {
    action: "remove_distraction",
    needs: [{ key: "distraction" }, { tag: "lost_focus" }, { key: "refusal_response", in: ["영상 보여줌"] }],
    why: "식사 중 영상·장난감 여부가 입력되지 않았음",
    missing: ["distraction"],
  },
  {
    action: "reduce_pre_meal_intake",
    needs: [{ key: "pre_intake_kind" }],
    why: "식사 전 간식·우유·수유 정보가 입력되지 않았음",
    missing: ["pre_intake_kind"],
  },
  {
    action: "move_milk_to_snack_time",
    needs: [{ key: "pre_intake_kind", in: ["milk", "formula", "breastfeed"] }],
    why: "식사 전 우유·수유 여부가 확인되지 않았음",
    missing: ["pre_intake_kind"],
  },
  {
    // '더 부드럽고 작게' 는 현재 단계를 알 때만 방향을 판단할 수 있다
    action: "soften_or_reduce_texture",
    needs: [{ key: "food_form" }],
    why: "현재 식감 단계가 입력되지 않았음",
    missing: ["food_form"],
  },
  {
    action: "reduce_bite_size_one_step",
    needs: [{ key: "bite_size" }, { key: "serve_amount" }, { tag: "large_bite" }],
    why: "한 입 크기·제공량이 입력·관찰되지 않았음",
    missing: ["bite_size"],
  },
  {
    action: "end_meal_on_time",
    needs: [{ key: "meal_schedule" }, { key: "meal_time" }],
    why: "정해진 식사시간·실제 식사 시간이 입력되지 않았음",
    missing: ["meal_schedule"],
  },
];

/* ── 규칙 ──
   순서가 우선순위다. 먼저 맞는 규칙 하나가 primary_action 이 된다
   (여러 개를 한꺼번에 제시하면 "무엇을 바꿀지" 가 흐려진다 — 결과는 항상 한 가지).
   requires 는 모두 참이어야 한다. */
export const RULES = [
  {
    id: "sticky_large_bite_long_processing",
    label: "찰진 덩어리 + 큰 한입 + 긴 처리 시간",
    requires: [
      { any: [{ key: "bite_size", in: ["large"] }, { key: "serve_amount", in: ["large"] }, { tag: "large_bite" }] },
      { any: [{ key: "food_shape", in: ["sticky_lump", "lump"] }, { key: "texture", in: ["sticky"] }] },
      { any: [{ key: "long_processing_count", gte: 1 }, { tag: "pocketing" }] },
    ],
    action: {
      title: "한 입 크기를 지금의 한 단계 아래로 줄여 주세요.",
      how_to: [
        "같은 음식을 지금 크기의 절반 정도로 나누어 준비합니다.",
        "한 입을 먹은 뒤 입안이 비워질 때까지 기다린 다음 다음 한 입을 줍니다.",
        "세 번의 한입 중 오래 머금거나 뱉은 횟수만 세어 봅니다.",
      ],
    },
    allowed: ["reduce_bite_size_one_step", "split_sticky_lump", "wait_until_mouth_clears", "keep_texture_stage", "observe_three_bites"],
    prohibited: ["blend_to_puree_without_evidence", "recommend_liquid_to_force_swallow", "diagnose_swallowing_disorder"],
    reason: "찰지게 뭉친 음식은 크기가 클수록 입안에서 나누거나 옮기기 어려워, 오래 물고 있는 모습으로 이어지기 쉬워요. 형태를 되돌리지 않고 크기만 줄여 반응을 비교해 보는 것이 다음 걸음이에요.",
    keep_as_is: "식감을 더 부드럽게 바꾸거나 갈 필요는 없어 보여요. 크기만 먼저 조절하고 반응을 비교해 보세요.",
    watch: ["한 입을 물고 있는 시간", "세 번의 한입 중 오래 머금은 횟수"],
  },
  {
    id: "tough_food_spit_after_chew",
    label: "질긴 음식 + 씹은 뒤 뱉음",
    requires: [
      { any: [{ key: "texture", in: ["tough"] }, { key: "food_shape", in: ["lump"] }] },
      { any: [{ tag: "spit_after_chew" }, { key: "behavior", in: ["씹다가 뱉음"] }] },
    ],
    action: {
      title: "같은 재료를 형태는 그대로 두고, 조리법으로 더 부드럽게 해주세요.",
      how_to: [
        "국물에 푹 익히거나 결 반대로 잘게 다져 씹어 끊기 쉽게 만듭니다.",
        "밥이나 매시에 섞어 한 덩어리로 만들어 입안에서 흩어지지 않게 합니다.",
        "세 번의 한입 중 끝까지 씹어 넘긴 횟수를 세어 봅니다.",
      ],
    },
    allowed: ["soften_by_cooking", "mix_with_rice", "keep_texture_stage", "flatten_and_long", "observe_three_bites"],
    prohibited: ["blend_to_puree_without_evidence", "recommend_liquid_to_force_swallow", "force_feed"],
    reason: "질긴 음식은 끝까지 부수기 어려워 씹다가 내보내게 될 수 있어요. 형태를 낮추기보다 조리법으로 부드럽게 하면 지금 단계를 유지하면서 넘길 수 있어요.",
    keep_as_is: "뱉는 것 자체를 막을 필요는 없어요. 한 번 입에 넣어 오물거린 것만으로도 경험이 쌓여요.",
    watch: ["끝까지 씹어 넘긴 횟수", "뱉기까지 걸린 시간"],
  },
  {
    id: "pre_meal_milk_low_intake",
    label: "식사 전 우유·수유 + 적은 식사량",
    requires: [
      { key: "pre_intake_kind", in: ["milk", "formula", "breastfeed", "snack"] },
      { any: [{ key: "pre_intake_gap", in: ["lt30", "m30_60"] }, { key: "interval", in: ["30분 이내", "30분~1시간"] }] },
      { any: [{ key: "portion_gap", in: ["훨씬 적음", "조금 적음"] }, { key: "concern", in: ["noeat"] }] },
    ],
    action: {
      title: "다음 식사는 식사 전 간격을 먼저 벌려서 시작해 보세요.",
      how_to: [
        "식사 2시간 전부터는 우유·간식을 주지 않고 간격을 둡니다.",
        "우유는 식사 직전이 아니라 간식 시간으로 옮깁니다.",
        "밥을 적게 먹었다고 그 자리에서 우유·간식을 늘리지 않습니다.",
      ],
    },
    allowed: ["adjust_meal_interval", "move_milk_to_snack_time", "reduce_pre_meal_intake", "observe_three_bites"],
    prohibited: ["force_feed", "blend_to_puree_without_evidence"],
    reason: "먹을 준비가 안 된 상태였다면, 음식이 어려워서가 아니라 배가 덜 고파서 그럴 수 있어요. 음식을 바꾸기 전에 식사 간격을 먼저 맞춰 보는 것이 순서예요.",
    keep_as_is: "음식의 형태나 크기를 바꿀 필요는 아직 없어 보여요. 먹을 준비가 된 상태였는지를 먼저 맞춰 보세요.",
    watch: ["첫 한입을 받아들이는지", "먹은 양이 달라지는지"],
  },
  {
    id: "left_seat_lost_focus",
    label: "자리 이탈 + 집중 저하",
    requires: [
      { any: [{ tag: "left_seat" }, { key: "meal_location", in: ["moving"] }] },
      { any: [{ tag: "lost_focus" }, { key: "meal_time", in: ["30~40분", "40분 이상"] }, { key: "face_segment_count", gte: 2 }] },
    ],
    action: {
      title: "식사는 정해진 자리에 앉아 있는 동안만 이어가 주세요.",
      how_to: [
        "아이가 자리에서 일어나면 접시를 잠시 그대로 두고 기다립니다.",
        "따라다니며 먹이지 않고, 다시 앉으면 이어서 줍니다.",
        "한 끼를 20~30분 안에 마치고 깔끔하게 정리합니다.",
      ],
    },
    allowed: ["seat_at_table", "shorten_meal_window", "remove_distraction", "observe_three_bites"],
    prohibited: ["force_feed", "restrict_meal_time_uniformly"],
    reason: "자리에서 일어나면 씹는 일에 집중하기 어려워지고, 식사가 길어질수록 그 경향이 커져요. 먹는 양보다 앉아서 먹는 시간이 자리를 잡는 것이 먼저예요.",
    keep_as_is: "먹는 양을 지금 바로 늘리려 하지 않아도 돼요. 앉아서 먹는 시간이 자리를 잡는 것이 먼저예요.",
    watch: ["자리에 앉아 있던 시간", "자리를 떠난 횟수"],
  },
  {
    id: "no_chew_swallow_fast",
    label: "거의 씹지 않고 삼킴",
    requires: [
      { any: [{ tag: "no_chew_swallow" }, { key: "concern", in: ["fast"] }] },
      { any: [{ key: "chews_per_burst_mean", lte: 3 }, { key: "bite_size", in: ["large"] }, { tag: "large_bite" }] },
    ],
    action: {
      title: "한 번에 넣어 주는 양을 줄이고, 삼킨 것을 확인한 뒤 다음 한 입을 주세요.",
      how_to: [
        "한 입 양을 지금의 절반으로 줄여 담습니다.",
        "삼킨 것을 확인한 뒤에 다음 한 입을 줍니다.",
        "한 입을 삼키기까지 씹은 횟수를 세어 봅니다.",
      ],
    },
    allowed: ["reduce_serve_amount", "wait_until_mouth_clears", "observe_three_bites"],
    prohibited: ["recommend_liquid_to_force_swallow", "force_feed", "diagnose_swallowing_disorder"],
    reason: "한 번에 많이 넣으면 충분히 씹기 전에 넘기게 될 수 있어요. 음식 형태를 바꾸기보다 한 입 양과 속도를 먼저 조절해 보세요.",
    keep_as_is: "음식 형태를 바꿀 필요는 없어 보여요. 속도와 한 입 양만 먼저 조절해 보세요.",
    watch: ["한 입을 삼키기까지 씹은 횟수", "사레 없이 넘겼는지"],
  },
];

/* ── 조건 평가 ────────────────────────────────────────────────────
   facts: { key → value }  ·  tags: [{code}] 또는 [code]
   값이 없으면(undefined/null) 조건은 **거짓**이다 — 없는 사실로 규칙이 발동하면
   그것이 바로 근거 없는 조언이다. */
function hasTagCode(tags, code) {
  return (Array.isArray(tags) ? tags : []).some((t) => (t && (t.code || t)) === code);
}
export function testCondition(cond, facts, tags) {
  if (!cond) return false;
  const f = facts || {};
  if (cond.any) return cond.any.some((c) => testCondition(c, f, tags));
  if (cond.all) return cond.all.every((c) => testCondition(c, f, tags));
  if (cond.absent) return f[cond.absent] == null;
  if (cond.tag) return hasTagCode(tags, cond.tag);
  const v = f[cond.key];
  if (v == null) return false;
  if (cond.in) {
    const arr = Array.isArray(v) ? v : [v];
    return arr.some((x) => cond.in.indexOf(x) >= 0);
  }
  if (cond.eq !== undefined) return v === cond.eq;
  if (cond.gte !== undefined) return Number(v) >= cond.gte;
  if (cond.lte !== undefined) return Number(v) <= cond.lte;
  return true;                                  // { key } 만 있으면 '값이 존재하면 참'
}

/* 가드 평가 → 지금 금지되는 행동 목록 + 무엇이 없어서 금지됐는지 */
export function evaluateGuards(facts, tags) {
  const blocked = [], missingKeys = [];
  GUARDS.forEach((g) => {
    if (g.needs.some((n) => testCondition(n, facts, tags))) return;      // 근거 있음 → 허용
    blocked.push({ action: g.action, why: g.why, label: PROHIBITED_LABEL[g.action] || g.action });
    (g.missing || []).forEach((k) => { if (missingKeys.indexOf(k) < 0) missingKeys.push(k); });
  });
  return { blocked: blocked, missingKeys: missingKeys };
}

/* 규칙 평가 → 맞는 규칙(우선순위 순). 첫 번째가 primary_action 이 된다. */
export function matchRules(facts, tags) {
  return RULES.filter((r) => r.requires.every((c) => testCondition(c, facts, tags)));
}

/* 최종 허용·금지 목록 조립.
   금지가 허용을 이긴다 — 규칙이 허용한 행동도 가드가 막으면 빠진다.
   (예: '큰 한입' 규칙이 발동했는데 한 입 크기 입력이 없다면 크기 조언을 낼 수 없다.
    단, 태그 large_bite 가 있으면 가드가 통과하므로 그대로 허용된다) */
export function resolveActions(matched, guards) {
  const blockedSet = {};
  (guards.blocked || []).forEach((b) => { blockedSet[b.action] = b; });
  ALWAYS_PROHIBITED.forEach((a) => { blockedSet[a] = { action: a, why: "안전·의료 판단 영역", label: PROHIBITED_LABEL[a] || a }; });
  const allowed = [];
  (matched || []).forEach((r) => (r.allowed || []).forEach((a) => {
    if (blockedSet[a]) return;
    if (allowed.indexOf(a) < 0) allowed.push(a);
  }));
  (matched || []).forEach((r) => (r.prohibited || []).forEach((a) => {
    if (!blockedSet[a]) blockedSet[a] = { action: a, why: "이 상황에서 권하지 않는 방향", label: PROHIBITED_LABEL[a] || a };
  }));
  return { allowed_actions: allowed, prohibited_actions: Object.keys(blockedSet).map((k) => blockedSet[k]) };
}

export default {
  ACTIONS, ALWAYS_PROHIBITED, PROHIBITED_LABEL, GUARDS, RULES,
  testCondition, evaluateGuards, matchRules, resolveActions,
};
