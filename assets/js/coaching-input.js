// coaching-input.js — 관찰사실(출처·신뢰도) → coach 에 넘기는 **중간 객체** 조립
// ─────────────────────────────────────────────────────────────────────
// B단계 ③⑤ (2026-07-29)
//   리포트에서 '입력한 사실 / 영상이 관찰한 것 / 시스템의 해석'이 섞이면,
//   보호자는 무엇이 확인된 것이고 무엇이 추정인지 구분할 수 없다.
//   그래서 사실을 낱개로 쪼개 각각 출처·신뢰도·관찰시각을 붙여 저장한다.
//
//   observed_facts[]  = { key, value, label, source, confidence, observed_at, text? }
//     source: guardian_input | teacher_check | reviewer_tag | video_metric | history
//     confidence: 0~1
//       · guardian_input 0.9  보호자가 직접 입력한 맥락(음식·장소·식전 섭취)
//       · teacher_check  0.85 교사 관찰(현장에서 봤지만 기록 시점이 늦을 수 있음)
//       · reviewer_tag   0.9  검수자가 영상을 보고 확인
//       · video_metric   추출기가 계산한 신뢰도(표본·검출률 기반, observe.js confidence)
//     unknown 코드는 사실로 담지 않는다 — '모르겠다'는 근거가 아니다.
//
//   coaching_input = {
//     observed_facts, evidence, primary_action, allowed_actions, prohibited_actions,
//     missing_information, next_observation, safety_flags
//   }
//   coach v6 는 이 객체를 **보호자 언어로 표현만** 한다(행동을 새로 만들지 않는다).
//
// 검증: cd verify && node observation-rules-check.mjs

import M from "./meal-context.js";
import O from "./observe.js";
import R from "./coach-rules.js";
import { CONTEXT_KEYS, missingInfo, SAFETY_NOTES, factSheet, buildEvidence as surveyEvidence } from "./coach-schema.js";

export const FACT_SOURCES = ["guardian_input", "teacher_check", "reviewer_tag", "video_metric", "history"];
const CONF = { guardian_input: 0.9, teacher_check: 0.85, reviewer_tag: 0.9, history: 0.8, video_metric: 0.7 };

/* 설문에서 온 사실도 보호자 입력이다 — 어느 화면에서 받았는지가 아니라
   '누가 말한 것인가'로 출처를 정한다(리포트에서 그렇게 읽힌다). */
const SURVEY_FACTS = {
  concern: "가장 큰 고민", symptom_freq: "증상 빈도", food_form: "음식 형태(단계)",
  chew_ceiling: "씹기 상한", hard_textures: "어려워하는 식감", behavior: "어려운 음식에서의 모습",
  meal_time: "한 끼 식사 시간", interval: "직전 식사·간식 간격", portion_gap: "기대 대비 먹은 양",
  retry_count: "재시도 횟수", refusal_response: "거부할 때의 대응",
};

/* 영상에서 사실로 쓰는 지표 — observe.js 출력 중 규칙·근거에 쓰이는 것만 고른다.
   (구간 배열 전체를 사실로 만들면 목록이 읽을 수 없게 길어진다) */
const VIDEO_FACTS = [
  { key: "usable_video_ratio", label: "분석 가능 영상 비율", unit: "ratio" },
  { key: "observed_sec", label: "분석에 사용한 시간", unit: "초" },
  { key: "processed", label: "분석한 프레임 수" },
  { key: "skipped", label: "건너뛴 프레임 수" },
  { key: "effective_fps", label: "초당 분석 프레임" },
  { key: "face_segment_count", label: "얼굴이 보인 구간 수" },
  { key: "chew_count", label: "씹기 움직임 횟수", unit: "회" },
  { key: "chews_per_min", label: "분당 씹기", unit: "회/분" },
  { key: "chew_burst_count", label: "이어서 씹은 구간 수" },
  { key: "chew_burst_mean_sec", label: "한 구간 평균 씹기 시간", unit: "초" },
  { key: "chew_burst_max_sec", label: "한 구간 최대 씹기 시간", unit: "초" },
  { key: "chews_per_burst_mean", label: "한 구간 평균 씹기 횟수", unit: "회" },
  { key: "long_processing_count", label: "씹지 않고 길게 지나간 구간 수" },
  { key: "long_processing_max_sec", label: "가장 긴 무저작 구간", unit: "초" },
];

function push(list, fact) {
  if (!fact || fact.value == null || fact.value === "" || fact.value === "unknown") return;
  if (Array.isArray(fact.value) && !fact.value.length) return;
  list.push(fact);
}

/* ── 관찰사실 만들기 ──
   input: { answers, video(=observe.extractObservations 결과), now, prev }
   now 는 주입받는다(순수 함수 유지 — 검증에서 시각이 흔들리지 않게). */
export function buildObservedFacts(input) {
  const o = input || {};
  const a = o.answers || {};
  const sv = a.survey || {};
  const l1 = sv.lens01 || {};
  const meal = a.meal || {};
  const tags = Array.isArray(a.tags) ? a.tags : [];
  const vid = o.video || null;
  const now = o.now || null;
  const facts = [];

  /* ① 보호자 입력 — 촬영 맥락(B단계에서 새로 받는 값) */
  M.MEAL_FIELDS.forEach((f) => {
    const v = meal[f.key];
    if (v == null || v === "" || v === "unknown") return;
    push(facts, {
      key: f.key, value: v, label: f.label.replace(/\?$/, ""),
      display: f.text ? String(v) : M.label(f.key, v),
      source: "guardian_input", confidence: CONF.guardian_input,
      observed_at: meal.captured_at || now,
    });
  });

  /* ② 보호자 입력 — 설문(기존 v3) */
  const surveyVal = {
    concern: sv.concern, symptom_freq: sv.symptom_freq,
    food_form: l1.food_form || a.food_texture, chew_ceiling: l1.chew_ceiling,
    hard_textures: l1.hard_textures, behavior: l1.behavior, meal_time: l1.meal_time,
    interval: (sv.lens02 || {}).interval, portion_gap: (sv.lens03 || {}).portion_gap,
    retry_count: (sv.lens04 || {}).retry_count, refusal_response: (sv.lens05 || {}).refusal_response,
  };
  Object.keys(SURVEY_FACTS).forEach((k) => {
    push(facts, {
      key: k, value: surveyVal[k], label: SURVEY_FACTS[k],
      display: Array.isArray(surveyVal[k]) ? surveyVal[k].join(" · ") : surveyVal[k],
      source: "guardian_input", confidence: CONF.guardian_input, observed_at: now,
    });
  });
  // 조건부 심화문항
  const deep = sv.deep || {};
  Object.keys(deep).forEach((k) => {
    push(facts, {
      key: "deep." + k, value: deep[k], label: "심화 문항 · " + k, display: deep[k],
      source: "guardian_input", confidence: CONF.guardian_input, observed_at: now,
    });
  });

  /* ③ 관찰 태그 — 영상으로 확정할 수 없는 행동의 유일한 근거.
        태그를 고른 사람에 따라 출처·신뢰도가 달라진다. */
  tags.forEach((t) => {
    const code = (t && (t.code || t)) || null;
    if (!code || !M.TAG_LABEL[code]) return;
    const src = (t && FACT_SOURCES.indexOf(t.source) >= 0) ? t.source : "guardian_input";
    /* key 는 반드시 "tag.<code>" — coach-schema.factSheet 이 태그를 그 이름으로 담기 때문이다.
       bare code("pocketing")로 두면 evidence[].ref 검증(verifyEvidence)이 입력에서 찾지 못해
       **가장 값진 근거인 태그가 조용히 버려진다**(2026-07-29 C단계 검증에서 실제로 잡힘). */
    push(facts, {
      key: "tag." + code, value: true, code: code, label: M.TAG_LABEL[code], display: M.TAG_LABEL[code],
      source: src, confidence: CONF[src] || 0.8,
      observed_at: (t && t.observed_at) || now, by: (t && t.by) || null,
    });
  });

  /* ④ 영상 지표 — 표본이 부족하면 아무것도 담지 않는다(신뢰할 수 없는 수치를 사실로 만들지 않는다) */
  if (vid && vid.enough_samples) {
    VIDEO_FACTS.forEach((f) => {
      push(facts, {
        key: "video." + f.key, value: vid[f.key], label: f.label,
        display: (f.unit === "ratio") ? Math.round(Number(vid[f.key]) * 100) + "%" : String(vid[f.key]) + (f.unit ? f.unit : ""),
        source: "video_metric", confidence: vid.confidence, observed_at: now,
      });
    });
    const L = vid.laterality || {};
    if (L.left_pct != null)
      push(facts, {
        key: "video.laterality", value: L.tendency, label: "턱 좌우 움직임 경향",
        display: `${L.left_pct}:${L.right_pct}`,
        source: "video_metric", confidence: vid.confidence, observed_at: now,
      });
  }

  /* ⑤ 지난 기록 */
  if (o.prev && o.prev.cpm > 0)
    push(facts, {
      key: "history.cpm_prev", value: o.prev.cpm, label: "지난 기록 분당 씹기", display: o.prev.cpm + "회/분",
      source: "history", confidence: CONF.history, observed_at: (o.prev.date || null),
    });

  return facts;
}

/* 규칙 평가에 넘길 평평한 fact 맵 — coach-rules 의 조건식이 이 모양을 본다.
   key 는 접두사 없이(video.chew_count → chew_count) 규칙을 읽기 쉽게 유지한다. */
export function factMap(facts) {
  const m = {};
  (facts || []).forEach((f) => {
    const k = String(f.key).replace(/^video\./, "");
    if (m[k] === undefined) m[k] = f.value;
  });
  /* 태그가 하나라도 있으면 'tags' 도 채워진 것으로 본다.
     이게 없으면 태그를 골랐는데도 미확인 목록이 "관찰 태그를 알려주세요"를 계속 요구한다
     (사실 키는 tag.<code> 라서 'tags' 라는 키는 만들어지지 않는다). */
  if (Object.keys(m).some((k) => k.indexOf("tag.") === 0)) m.tags = true;
  return m;
}

/* ── 근거 문장 ──
   사실을 보호자 언어로 한 줄씩 옮긴다. **해석을 섞지 않는다** —
   해석은 primary_action.reason 한 곳에서만 한다(리포트에서 층이 섞이지 않게).
   evidence[].source 는 리포트 배지용 축약 출처로 매핑한다. */
const SRC_TO_EVIDENCE = {
  guardian_input: "survey", teacher_check: "tag", reviewer_tag: "tag",
  video_metric: "video", history: "history",
};
const FACT_SENTENCE = {
  food_name:        (f) => `이번에 먹은 음식은 <b>${f.display}</b>이라고 알려주셨어요.`,
  food_shape:       (f) => `음식 형태는 <b>${f.display}</b>라고 알려주셨어요.`,
  texture:          (f) => `식감은 <b>${f.display}</b>이라고 알려주셨어요.`,
  bite_size:        (f) => `한 조각 크기는 <b>${f.display}</b>이라고 알려주셨어요.`,
  serve_amount:     (f) => `한 번에 넣어 준 양은 <b>${f.display}</b>이라고 알려주셨어요.`,
  feeding_method:   (f) => `<b>${f.display}</b> 먹었다고 알려주셨어요.`,
  meal_location:    (f) => `식사 장소는 <b>${f.display}</b>이라고 알려주셨어요.`,
  distraction:      (f) => `식사 중 <b>${f.display}</b>이 있었다고 알려주셨어요.`,
  pre_intake_kind:  (f) => `이 식사 전에 <b>${f.display}</b>을 먹었다고 알려주셨어요.`,
  pre_intake_gap:   (f) => `그 뒤 <b>${f.display}</b> 지나 식사를 시작했어요.`,
  with_liquid:      (f) => `함께 준 것은 <b>${f.display}</b>이라고 알려주셨어요.`,
  meal_schedule:    (f) => `평소 식사 시간은 <b>${f.display}</b>이라고 알려주셨어요.`,
};
export function buildEvidenceFromFacts(facts, opts) {
  const o = opts || {};
  const out = [];
  const seen = {};
  const add = (f, text) => {
    if (!text || seen[f.key]) return;
    seen[f.key] = 1;
    out.push({
      source: SRC_TO_EVIDENCE[f.source] || "survey",
      ref: f.key, text: text,
      fact_source: f.source, confidence: f.confidence,
    });
  };
  const byKey = {};
  (facts || []).forEach((f) => { byKey[f.key] = f; });

  /* ① 영상 관찰 — 추출기의 문장을 그대로 쓴다(observe.js describeObservations).
        수치를 여기서 다시 만들지 않는다(두 곳에서 만들면 값이 갈라진다). */
  if (o.video && o.video.enough_samples) {
    O.describeObservations(o.video).forEach((line) => {
      const ref = "video." + line.key;
      if (seen[ref]) return;
      seen[ref] = 1;
      out.push({ source: "video", ref: ref, text: line.text, fact_source: "video_metric", confidence: o.video.confidence });
    });
  }
  /* ② 관찰 태그 — 누가 확인했는지 밝힌다. 태그는 사람이 본 사실이라 가장 강한 근거다. */
  const WHO = { guardian_input: "보호자", teacher_check: "교사", reviewer_tag: "검수자" };
  (facts || []).filter((f) => f.code && M.TAG_LABEL[f.code]).forEach((f) => {
    add(f, `${WHO[f.source] || "관찰자"}가 <b>${f.label}</b>라고 확인해 주셨어요.`);
  });
  /* ③ 촬영 맥락(보호자 입력) */
  Object.keys(FACT_SENTENCE).forEach((k) => {
    const f = byKey[k];
    if (f) add(f, FACT_SENTENCE[k](f));
  });
  /* ④ 설문 응답 — A단계의 문장 생성기(coach-schema.buildEvidence)를 재사용한다.
        여기서 문장을 다시 쓰면 같은 사실이 두 표현으로 갈라진다.
        cur 를 넘기지 않는 이유: 영상 근거는 위 ①에서 이미 만들었다(중복 방지). */
  if (o.answers) {
    const present = o.present || factSheet({ answers: o.answers, cur: o.cur, metrics: o.metrics });
    /* cur 는 '영상 시계열이 없을 때만' 넘긴다.
       시계열이 있으면 영상 근거는 위 ①(observe.js 구간 서술)이 이미 만들었다 → 중복.
       시계열이 없고 요약 지표(cur)만 있는 기록(지난 기록 열람·복원 등)에서는
       cur 기반 영상 근거가 유일한 통로다 — 넘기지 않으면 영상 근거가 통째로 사라진다. */
    surveyEvidence({ answers: o.answers, cur: o.video ? null : (o.cur || null),
                     metrics: o.metrics, prev: o.prev, present: present, stageLabel: o.stageLabel })
      .forEach((e) => {
        if (seen[e.ref]) return;
        seen[e.ref] = 1;
        // 출처는 근거의 성격을 따른다 — video/history 근거를 보호자 입력으로 표시하면 층이 섞인다
        const fs = (e.source === "video") ? "video_metric" : (e.source === "history" ? "history" : "guardian_input");
        out.push(Object.assign({}, e, { fact_source: fs, confidence: CONF[fs] || 0.85 }));
      });
  }
  return out;
}

/* ── 중간 객체 조립 ──
   input: { answers, series, summary, prev, now, ruleFallback, allergies }
     series/summary → observe.extractObservations 로 영상 지표를 만든다(없으면 영상 근거 없음)
     ruleFallback   → 규칙이 하나도 안 맞을 때 쓸 기존 규칙엔진 결과(단계 게이팅된 action/tips)
   반환: coaching_input (사용자 지정 8개 필드) */
export function buildCoachingInput(input) {
  const o = input || {};
  const a = o.answers || {};
  const now = o.now || null;
  const video = o.video || ((o.series && o.series.t) ? O.extractObservations({ series: o.series, summary: o.summary || {} }) : null);
  const facts = buildObservedFacts({ answers: a, video: video, prev: o.prev, now: now });
  const fm = factMap(facts);
  const tags = Array.isArray(a.tags) ? a.tags : [];

  /* 안전 — 설문 안전문항(safety_alert)과 사레 태그. 안전은 규칙보다 먼저 본다. */
  const safety_flags = [];
  if (a.safety_alert) safety_flags.push({ code: "survey_safety", label: "안전 확인 문항에 주의가 필요한 응답", source: "guardian_input" });
  // 사실 키는 "tag.<code>" 다(위 buildObservedFacts 주석 참고) — bare code 로 찾으면 사레 신호를 놓친다
  M.SAFETY_TAGS.forEach((code) => {
    const f = facts.find((x) => x.key === "tag." + code);
    if (f) safety_flags.push({ code: code, label: M.TAG_LABEL[code], source: f.source });
  });

  const guards = R.evaluateGuards(fm, tags);
  const matched = R.matchRules(fm, tags);
  const resolved = R.resolveActions(matched, guards);
  const top = matched.length ? matched[0] : null;

  /* primary_action — 규칙이 맞으면 규칙의 행동, 아니면 기존 규칙엔진(단계 게이팅된) 행동.
     규칙이 없을 때 억지로 구체적인 문장을 만들지 않는다(그것이 일반론의 출발점이다). */
  const fb = o.ruleFallback || {};
  /* reason_hint — 규칙이 정한 '왜 그 행동인가'. 화면은 이걸 buildReason 의 interpretation 으로 넘긴다.
     넘기지 않으면 A단계 possibility(4축) 해석이 붙어, 행동과 근거가 어긋난다
     (예: '한 입 크기를 줄이세요' 행동에 '식사 간격을 맞추세요' 해석 — 앱 검증에서 실제로 잡혔다). */
  const primary = top
    ? { title: top.action.title, how_to: top.action.how_to.slice(0, 4), rule_id: top.id, rule_label: top.label,
        reason_hint: top.reason || "" }
    : { title: fb.action || "비슷한 조건에서 한 번 더 기록해, 반복되는 모습인지 확인해 보세요.",
        how_to: (fb.tips || []).slice(0, 3), rule_id: null, rule_label: null, reason_hint: "" };

  /* ── missing_information ──
     두 목록을 합친다.
       ① 가드가 막은 항목 — "이게 없어서 이 조언을 하지 않았다"까지 말할 수 있다
       ② 고민별 우선순위(A단계 missingInfo) — 이 아이에게 먼저 물어볼 값
     순서는 ②의 우선순위를 따른다. 가드 순서(GUARDS 배열 순)를 그대로 쓰면
     '오래 물고 있음' 아이에게 가장 중요한 한 입 크기가 목록 끝으로 밀려 잘린다. */
  const prioritized = missingInfo({ present: fm }, 12).map((m) => m.key);
  const guardKeys = guards.missingKeys.filter((k) => fm[k] == null);
  const order = prioritized.filter((k) => guardKeys.indexOf(k) >= 0)          // 막힌 것 중 우선순위 높은 순
    .concat(guardKeys.filter((k) => prioritized.indexOf(k) < 0))              // 우선순위 목록에 없는 막힌 것
    .concat(prioritized.filter((k) => guardKeys.indexOf(k) < 0));             // 막히진 않았지만 아직 없는 것
  const blockedLabelFor = (k) => {
    const g = R.GUARDS.find((x) => (x.missing || []).indexOf(k) >= 0 &&
      guards.blocked.some((b) => b.action === x.action));
    return g ? (R.PROHIBITED_LABEL[g.action] || g.action) : "";
  };
  const missing = [];
  order.forEach((k) => {
    if (missing.some((x) => x.key === k)) return;
    const meta = CONTEXT_KEYS[k] || {};
    const fld = M.MEAL_FIELD_MAP[k];
    missing.push({
      key: k,
      label: meta.label || (fld ? fld.label.replace(/\?$/, "") : k),
      unlocks: meta.unlocks || "",
      blocked_action: blockedLabelFor(k),
    });
  });

  const next_observation = {
    period: "다음 2~3회 식사",
    items: (top && top.watch) ? top.watch.slice(0, 3)
         : (fb.watch ? [fb.watch] : ["같은 상황이 반복되는지"]),
  };

  return {
    observed_facts: facts,
    // present 는 넘기지 않는다 — factSheet 가 unknown 걸러내기·tag 펼치기까지 하므로 그쪽이 정확하다
    evidence: buildEvidenceFromFacts(facts, {
      video: video, answers: a, stageLabel: o.stageLabel,
      // 시계열이 없는 기록에서도 요약 지표(cur)로 영상 근거를 낼 수 있게 함께 넘긴다
      cur: o.cur || null, metrics: o.metrics || null, prev: o.prev || null,
    }),
    primary_action: {
      title: primary.title,
      how_to: primary.how_to,
      rule_id: primary.rule_id,
      rule_label: primary.rule_label,
      reason_hint: primary.reason_hint,
    },
    allowed_actions: resolved.allowed_actions,
    prohibited_actions: resolved.prohibited_actions,
    missing_information: missing.slice(0, 4),
    next_observation: next_observation,
    safety_flags: safety_flags,
    keep_as_is: top ? top.keep_as_is : "",
    // 부가 정보(리포트·저장용) — 규칙 판단의 재현에 필요한 것만
    _video: video,
    _fact_map: fm,
    _safety_note: safety_flags.length ? SAFETY_NOTES.gated : null,
  };
}

export default {
  FACT_SOURCES, buildObservedFacts, factMap, buildEvidenceFromFacts, buildCoachingInput,
};
