// coach-schema.js — '관찰 근거 기반 처방' 단일 스키마 (웹·엣지함수·검증 공용)
// ─────────────────────────────────────────────────────────────────────
// 배경 (2026-07-29 · 리포트 구체성 개편 A단계)
//   결과가 "어디에나 적용되는 일반 문장"으로 읽히던 원인은 두 가지였다.
//     ① 설문은 20개 필드를 받는데 coach 프롬프트는 3개만 문장화했다
//        (hard_textures·interval·retry·portion·meal_time 은 body 로 받고 버려짐,
//         조건부 심화문항·안전응답·chew_ceiling 은 아예 전달되지 않음)
//     ② 출력 스키마가 {firstCheck, action, tips[], watch} 4개 문자열뿐이라
//        '근거'·'바꾸지 않아도 되는 것'·'확인 못 한 것'을 담을 자리가 없었다.
//        자리가 없으니 tips 칸을 늘려 같은 말을 변형 반복했다.
//
// 이 파일의 역할
//   결과의 뼈대(처방 = prescription)를 한 곳에서 정의하고,
//   규칙 엔진(키 없이 동작)과 LLM(coach 엣지함수) 두 경로가 **같은 모양**을 내게 한다.
//   화면·PDF·저장은 이 모양만 알면 되고, 어느 경로가 만들었는지는 source 로 구분한다.
//
// 중요 — 지금 운영 중인 coach 함수는 llm_401(키 무효) 상태다.
//   따라서 사용자가 보는 문장은 100% 규칙 엔진이 만든다. 이 파일의 build* 함수들이
//   키 없이도 근거·미확인정보를 만들어내는 이유가 그것이다.
//
// import 없음(순수 함수) — verify 에서 node 로 직접 import 해 검증한다.
// 검증: cd verify && node prescription-check.mjs

/* ── 처방 스키마 ───────────────────────────────────────────────────
   화면 5블록과 1:1 대응한다.
     1 primary_action      "이번에 바꿀 한 가지"      title / reason / how_to[]
     2 evidence[]          "그렇게 판단한 근거"        source·ref 필수
     3 (how_to)            "다음 식사에서 해볼 방법"    primary_action.how_to
     4 keep_as_is          "이번에는 바꾸지 않아도 되는 것"
     5 missing_information "추가로 확인할 생활 요인"    입력이 없어 판단하지 않은 항목
   그 외
     next_observation      다음 2~3회 무엇을 볼지
     safety_note           안전 관련 고정 문구(LLM 생성 금지)
     source                "rule" | "ai"  — 문장을 HTML 로 신뢰할지 결정한다
                           rule = 프로젝트가 쓴 문구(<b> 허용) / ai = 생성문(반드시 escape) */
export const FIELDS = [
  "primary_action", "evidence", "keep_as_is", "missing_information",
  "next_observation", "safety_note", "source",
];

/* LLM 이 만들어도 되는 필드 — 이 밖의 필드는 서버가 결정론적으로 채운다.
   missing_information 을 LLM 에 맡기면 "없는 데이터를 있다고" 쓰거나 그 반대가 되므로 제외. */
export const AI_FIELDS = ["primary_action", "evidence", "keep_as_is", "next_observation"];

/* 근거 출처 — evidence[].source 는 반드시 이 중 하나.
   ref 는 그 근거가 나온 입력 키(예: "survey.concern", "video.cpm")로, 실제 입력에 있어야 한다.
   출처·ref 가 확인되지 않는 문장은 화면에 올리지 않는다(= 근거 없는 디테일 차단). */
export const SOURCES = ["video", "survey", "tag", "stage", "history"];

/* ── 맥락 항목 카탈로그 ────────────────────────────────────────────
   '판단에 쓸 수 있는 사실'의 전체 목록. 지금 수집하는 것과 아직 못 받는 것을 한곳에 둔다.
     collected: true  → 설문 v3 에서 실제로 받는 값
     collected: false → 아직 입력칸이 없는 값 → missing_information 후보
   unlocks 는 "그 값이 들어오면 무엇을 말할 수 있게 되는가" — 보호자에게 그대로 보여준다.
   ※ 여기에 없는 사실을 전제로 조언하면 안 된다(evidence-gate.js 가 막는다). */
export const CONTEXT_KEYS = {
  // 받고 있는 것
  concern:           { label: "가장 큰 고민",        collected: true },
  symptom_freq:      { label: "증상 빈도",           collected: true },
  food_form:         { label: "음식 형태(단계)",     collected: true },
  chew_ceiling:      { label: "씹기 상한",           collected: true },
  hard_textures:     { label: "어려워하는 식감",     collected: true },
  behavior:          { label: "어려운 음식에서의 모습", collected: true },
  meal_time:         { label: "한 끼 식사 시간",     collected: true },
  interval:          { label: "직전 식사·간식 간격", collected: true },
  portion_gap:       { label: "기대 대비 먹은 양",   collected: true },
  retry_count:       { label: "재시도 횟수",         collected: true },
  refusal_response:  { label: "거부할 때의 대응",    collected: true },
  /* 아직 입력칸이 없는 것 — 값의 코드 정의는 meal-context.js(B단계 ①) 에 있다.
     answers.meal.* / answers.tags 가 채워지면 factSheet 이 자동으로 집어 올린다. */
  food_name:         { label: "음식 이름",           collected: false, unlocks: "먹은 음식에 맞춘 준비 방법을 말해 드릴 수 있어요" },
  food_shape:        { label: "음식 형태(덩어리·으깬·국물)", collected: false, unlocks: "덩어리라서 어려웠는지, 식감 때문인지 나눠 볼 수 있어요" },
  texture:           { label: "식감(찰짐·질김 등)",   collected: false, unlocks: "찰진 음식이라 입안에서 나누기 어려웠는지 볼 수 있어요" },
  bite_size:         { label: "한 입 크기",          collected: false, unlocks: "한 입 양을 줄이라고 말할 근거가 생겨요" },
  serve_amount:      { label: "한 번에 넣어 준 양",   collected: false, unlocks: "조각 크기와 제공량을 나눠 볼 수 있어요" },
  feeding_method:    { label: "먹는 방식(스스로·도움)", collected: false, unlocks: "속도를 아이가 정했는지 보호자가 정했는지 볼 수 있어요" },
  meal_location:     { label: "식사 장소",           collected: false, unlocks: "식사 자리와 집중이 이어지는지 연결해 볼 수 있어요" },
  pre_intake_kind:   { label: "식사 전 간식·우유·수유", collected: false, unlocks: "배고픔 때문인지 아닌지 판단할 수 있어요" },
  pre_intake_gap:    { label: "식사 전 섭취 후 경과 시간", collected: false, unlocks: "식사 간격을 조정하라고 말할 근거가 생겨요" },
  with_liquid:       { label: "함께 준 물·국물·음료",  collected: false, unlocks: "국물로 넘기고 있는지 확인할 수 있어요" },
  distraction:       { label: "식사 중 영상·장난감",  collected: false, unlocks: "집중이 깨진 이유를 함께 볼 수 있어요" },
  meal_schedule:     { label: "정해진 식사 시간",     collected: false, unlocks: "식사 리듬을 조정하는 조언을 드릴 수 있어요" },
  tags:              { label: "관찰 태그(머금음·뱉음·자리 이탈)", collected: false, unlocks: "영상만으로는 확정할 수 없는 모습을 근거로 쓸 수 있어요" },
};

/* 고민별로 '먼저 받아야 값진' 맥락 항목 — missing_information 을 우선순위대로 3개만 보여준다.
   전부 나열하면 안내가 아니라 잔소리가 된다. */
const MISSING_PRIORITY = {
  hold:    ["bite_size", "food_shape", "texture", "pre_intake_kind", "tags"],
  spit:    ["food_shape", "texture", "bite_size", "tags", "food_name"],
  noeat:   ["pre_intake_kind", "meal_location", "distraction", "meal_schedule"],
  texture: ["food_shape", "texture", "food_name", "bite_size", "tags"],
  meat:    ["food_shape", "texture", "food_name", "bite_size"],
  slow:    ["distraction", "meal_location", "bite_size", "meal_schedule"],
  fast:    ["serve_amount", "bite_size", "feeding_method", "pre_intake_kind"],
  other:   ["food_name", "bite_size", "meal_location", "pre_intake_kind"],
};
const MISSING_DEFAULT = ["bite_size", "food_name", "pre_intake_kind", "meal_location"];

/* ── 입력에 실제로 존재하는 사실의 목록(fact sheet) ─────────────────
   present 는 "이 ref 는 입력에 있다"의 집합이다. evidence 검증·미입력 단정 차단이 여기 기댄다.
   answers = demo.html 이 만드는 설문 응답 객체 / cur = 영상 분석 요약 / tags = 촬영 직후 태그 */
export function factSheet(input) {
  const o = input || {};
  const a = o.answers || {};
  const sv = a.survey || {};
  const l1 = sv.lens01 || {};
  const present = {};
  const put = (k, v) => {
    if (v == null) return;
    if (Array.isArray(v) ? v.length === 0 : String(v).trim() === "") return;
    present[k] = v;
  };
  put("concern", sv.concern || a.concern_type);
  put("symptom_freq", sv.symptom_freq);
  put("food_form", l1.food_form || a.food_texture);
  put("chew_ceiling", l1.chew_ceiling);
  put("hard_textures", l1.hard_textures);
  put("behavior", l1.behavior);
  put("meal_time", l1.meal_time);
  put("interval", (sv.lens02 || {}).interval);
  put("portion_gap", (sv.lens03 || {}).portion_gap);
  put("retry_count", (sv.lens04 || {}).retry_count);
  put("refusal_response", (sv.lens05 || {}).refusal_response);
  put("age_months", a.child_age_months != null ? a.child_age_months : sv.age_months);
  put("concern_text", a.concern_text);
  // 조건부 심화문항 — 값이 있는 것만 deep.<id> 로 올린다
  const deep = sv.deep || {};
  Object.keys(deep).forEach((k) => put("deep." + k, deep[k]));
  /* 촬영 맥락(B단계 ①) — answers.meal 의 고정 코드값.
     'unknown'(물어봤지만 모른다)은 사실이 아니므로 담지 않는다 —
     담으면 근거 없는 조언의 가드가 통과해 버린다. */
  const meal = a.meal || {};
  ["food_name", "food_shape", "texture", "bite_size", "serve_amount", "feeding_method",
   "meal_location", "pre_intake_kind", "pre_intake_gap", "with_liquid",
   "distraction", "meal_schedule"].forEach((k) => {
    const v = meal[k];
    if (v === "unknown") return;
    if (Array.isArray(v) && v.length === 1 && v[0] === "unknown") return;
    put(k, v);
  });
  put("tags", a.tags);
  // 태그는 코드로도 조회할 수 있게 펼친다(규칙·차단이 tag 단위로 조건을 건다)
  (Array.isArray(a.tags) ? a.tags : []).forEach((t) => {
    const code = (t && (t.code || t)) || null;
    if (code) put("tag." + code, true);
  });
  // 영상 관찰
  const cur = o.cur;
  if (cur && cur.quality !== "low_face") {
    put("video.cpm", cur.cpm);
    put("video.chew", cur.chew);
    if (cur.quality !== "audio") put("video.left_pct", cur.leftPct);
    put("video.quality", cur.quality);
  }
  // 분석에 실제로 사용한 시간 — 엣지함수도 같은 ref 로 넘기므로 여기서도 잡아야 한다
  //   (없으면 LLM 이 이 ref 로 인용한 근거가 클라이언트 재검증에서 통째로 버려진다)
  if (o.metrics && o.metrics.obs > 0 && cur && cur.quality !== "low_face")
    put("video.observed_sec", Math.round(o.metrics.obs));
  /* 시계열에서 뽑은 관찰 지표(observe.js 결과) — B단계.
     ★ 이걸 넣지 않으면 '씹기 구간 3번'·'무저작 8.4초' 같은 **영상 근거가 통째로 버려진다**.
       evidence[].ref 검증(verifyEvidence)이 present 에서 ref 를 찾지 못하기 때문이다.
       (2026-07-29 앱 검증에서 실제로 잡혔다 — 화면에 영상 근거가 하나도 남지 않았다) */
  const vid = o.video;
  if (vid && vid.enough_samples) {
    ["usable_video_ratio", "observed_sec", "processed", "skipped", "effective_fps",
     "face_segments", "face_segment_count", "chew_count", "chews_per_min",
     "chew_bursts", "chew_burst_count", "chew_burst_mean_sec", "chew_burst_max_sec",
     "chews_per_burst_mean", "long_processing", "long_processing_count", "long_processing_max_sec",
    ].forEach((k) => put("video." + k, vid[k]));
    if (vid.laterality && vid.laterality.left_pct != null) put("video.laterality", vid.laterality.tendency);
  }
  if (o.prev && o.prev.cpm > 0) put("history.cpm_prev", o.prev.cpm);
  return present;
}

/* 아직 못 받은 맥락 항목 — 고민에 맞춰 우선순위대로 최대 3개.
   "입력되지 않아 이번 결과에서는 판단하지 않았다"를 명시하기 위한 목록이다. */
export function missingInfo(input, limit) {
  const present = (input && input.present) || factSheet(input);
  const concern = present.concern || null;
  const order = (MISSING_PRIORITY[concern] || MISSING_DEFAULT).concat(
    Object.keys(CONTEXT_KEYS).filter((k) => !CONTEXT_KEYS[k].collected)
  );
  const out = [];
  const seen = {};
  for (const k of order) {
    if (seen[k]) continue;
    seen[k] = 1;
    const meta = CONTEXT_KEYS[k];
    if (!meta || meta.collected) continue;
    if (present[k] != null) continue;                 // 이미 받았으면 미확인이 아니다
    out.push({ key: k, label: meta.label, unlocks: meta.unlocks || "" });
    if (out.length >= (limit || 3)) break;
  }
  return out;
}

/* ── 근거 문장 만들기 ──────────────────────────────────────────────
   규칙 엔진 경로에서 쓰는 '관찰 사실' 목록. 전부 입력에서 그대로 끌어온 것만 담는다.
   추측·일반론은 넣지 않는다 — 여기 담긴 것이 화면의 "그렇게 판단한 근거"가 된다. */

// 조건부 심화문항 → 관찰 사실 문장. 값이 있을 때만, 정보량이 있는 답만 문장으로 만든다.
//   ("아니오"처럼 판단을 좁히지 못하는 답은 넣지 않는다 — 근거 칸이 길어질 뿐이다)
const DEEP_EVIDENCE = {
  hold: {
    allfood:  { "예": "모든 음식에서 오래 물고 있다고 답하셨어요 — 특정 음식의 문제가 아닐 수 있어요." },
    meatveg:  { "예": "고기나 채소에서 특히 오래 물고 있다고 답하셨어요." },
    tired:    { "예": "피곤하거나 배부를 때 더 심해진다고 답하셨어요." },
    washdown: { "예": "물이나 국과 함께 넘기려 한다고 답하셨어요 — 입안에서 처리하기 어려운 신호일 수 있어요." },
  },
  spit: {
    timing:       { "바로": "입에 넣자마자 뱉는다고 답하셨어요 — 씹기보다 첫 감촉에서 멈추는 모습이에요.", "씹다가": "씹다가 뱉는다고 답하셨어요 — 입안에서 처리하다 어려워지는 모습이에요." },
    texture_only: { "예": "특정 식감에서만 뱉는다고 답하셨어요." },
    softer_ok:    { "예": "더 부드럽게 하면 먹는다고 답하셨어요 — 형태가 영향을 주고 있어요.", "아니오": "더 부드럽게 해도 마찬가지라고 답하셨어요 — 형태만의 문제는 아닐 수 있어요." },
  },
  noeat: {
    scope:  { "대부분": "대부분을 안 먹는다고 답하셨어요.", "특정 음식만": "특정 음식만 안 먹는다고 답하셨어요." },
    hungry: { "예": "배고파 보이는데도 안 먹는다고 답하셨어요." },
    fav:    { "예": "좋아하는 음식은 잘 먹는다고 답하셨어요 — 먹는 힘 자체보다 음식에 대한 반응일 수 있어요." },
    seat:   { "아니오": "식사 자리에 앉아 있기 어려워한다고 답하셨어요." },
  },
  texture: {
    which:    { "덩어리": "덩어리 식감을 특히 거부한다고 답하셨어요.", "미끄러움": "미끄러운 식감을 특히 거부한다고 답하셨어요.", "바삭함": "바삭한 식감을 특히 거부한다고 답하셨어요.", "섞인 식감": "여러 식감이 섞인 음식을 특히 거부한다고 답하셨어요.", "여러 가지": "여러 가지 식감을 함께 거부한다고 답하셨어요." },
    puree_ok: { "예": "매끈하게 갈면 잘 먹는다고 답하셨어요 — 입자 크기가 영향을 주고 있어요." },
    touch:    { "예": "음식을 손으로 만지는 것도 싫어한다고 답하셨어요 — 감각 쪽 반응이 함께 있을 수 있어요." },
  },
  meat: {
    timing:      { "바로": "고기를 입에 넣자마자 거부한다고 답하셨어요.", "씹다가": "고기를 씹다가 뱉는다고 답하셨어요 — 끝까지 부수기 어려운 모습이에요." },
    minced_ok:   { "예": "잘게 다진 고기는 먹는다고 답하셨어요 — 크기가 관건이에요." },
    broth_ok:    { "예": "국물에 부드럽게 익힌 고기는 먹는다고 답하셨어요 — 조리법으로 풀어볼 수 있어요." },
    other_tough: { "예": "고기 말고 다른 질긴 음식도 거부한다고 답하셨어요." },
  },
  slow: {
    onset:     { "처음부터": "처음부터 느리다고 답하셨어요.", "뒤로 갈수록": "뒤로 갈수록 느려진다고 답하셨어요 — 후반에 집중이나 힘이 떨어지는 모습이에요." },
    where:     { "씹기 오래": "씹는 데 오래 걸린다고 답하셨어요.", "안 삼킴": "삼키기를 미룬다고 답하셨어요." },
    distract:  { "예": "먹는 중 딴짓을 한다고 답하셨어요." },
    soft_fast: { "예": "부드러운 음식은 빨리 먹는다고 답하셨어요 — 형태에 따라 속도가 달라져요." },
  },
  fast: {
    nochew:  { "예": "거의 씹지 않고 삼킨다고 답하셨어요." },
    biglump: { "예": "큰 덩어리도 그냥 삼키려 한다고 답하셨어요." },
    rush:    { "예": "급하게 먹는다고 답하셨어요." },
  },
};

// 설문 단일 응답 → 근거 문장. 값이 그대로 문장에 나와야 보호자가 자기 답을 확인할 수 있다.
const SURVEY_EVIDENCE = {
  // 고민과 같은 표현이면 넣지 않는다 — "고민: 오래 물고 있음" 바로 아래에
  //   "어려운 음식에서 오래 물고 있음" 이 오면 근거가 아니라 같은 말의 반복이다.
  behavior:      (v, ctx) => (ctx && ctx.concernLabel && String(ctx.concernLabel).indexOf(v) >= 0)
                   ? null : `어려운 음식에서 <b>${v}</b> 모습을 보인다고 답하셨어요.`,
  meal_time:     (v) => (v === "40분 이상" || v === "30~40분") ? `한 끼에 <b>${v}</b> 걸린다고 답하셨어요.` : null,
  interval:      (v) => (v === "30분 이내" || v === "30분~1시간") ? `직전 식사·간식과 <b>${v}</b> 간격이었다고 답하셨어요 — 충분히 배고프지 않았을 수 있어요.` : null,
  // 선택지 라벨을 문장에 그대로 끼우면 조사가 어긋난다("훨씬 적음 먹었다고") → 문장형으로 바꾼다
  portion_gap:   (v) => ({ "훨씬 적음": "기대보다 <b>훨씬 적게</b> 먹었다고 답하셨어요.",
                           "조금 적음": "기대보다 <b>조금 적게</b> 먹었다고 답하셨어요." }[v] || null),
  retry_count:   (v) => ({ "거의 안 함": "안 먹는 음식을 <b>다시 시도한 적이 거의 없다</b>고 답하셨어요 — 아직 익숙해질 기회가 적었어요.",
                           "1~2번": "안 먹는 음식을 <b>1~2번</b> 다시 시도해 보셨다고 했어요 — 아직 익숙해질 기회가 적었어요." }[v] || null),
  refusal_response: (v) => (v === "좋아하는 음식으로 바꿔줌" || v === "억지로 더 먹임" || v === "따라다니며 먹임" || v === "영상 보여줌") ? `거부할 때 주로 <b>${v}</b>고 답하셨어요.` : null,
  chew_ceiling:  (v) => null,   // 단계 근거에서 이미 다룬다(중복 방지)
};

export function buildEvidence(input) {
  const o = input || {};
  const a = o.answers || {};
  const sv = a.survey || {};
  const l1 = sv.lens01 || {};
  const cur = o.cur || null;
  const present = o.present || factSheet(o);
  const ev = [];
  const push = (source, ref, text) => {
    if (!text || present[ref] == null) return;
    if (ev.some((e) => e.text === text)) return;
    ev.push({ source: source, ref: ref, text: text });
  };

  /* ① 영상 관찰 — 품질에 따라 말할 수 있는 범위가 다르다.
        low_face 는 지표 자체를 근거로 쓰지 않는다(factSheet 에서 present 에 넣지 않음). */
  if (cur) {
    if (present["video.cpm"] != null) {
      const cpm = cur.cpm;
      const via = (cur.quality === "audio") ? "씹는 소리로" : "영상에서";
      let read = "";
      if (cpm > 0 && cpm < 25) read = " — 또박또박 씹기보다 입안에 오래 머무는 쪽에 가까운 속도예요";
      else if (cpm > 50) read = " — 빠르게 넘기는 쪽에 가까운 속도예요";
      push("video", "video.cpm", `${via} 분당 약 <b>${cpm}회</b>(총 ${cur.chew || 0}회) 씹는 움직임이 관찰됐어요${read}.`);
    }
    if (cur.quality === "low_motion")
      push("video", "video.quality", "영상에서 씹는 움직임이 뚜렷하게 잡히지 않았어요 — 입을 크게 움직이지 않고 처리했을 수 있어요.");
    if (present["video.left_pct"] != null) {
      const lp = cur.leftPct;
      if (Math.abs(lp - 50) >= 20) push("video", "video.left_pct", `씹는 쪽이 <b>${lp}:${100 - lp}</b>로 한쪽에 치우쳐 관찰됐어요.`);
    }
  }
  /* ② 촬영 직후 태그 — 영상만으로는 알 수 없는 모습(머금기·뱉기·자리 이탈)의 유일한 근거 */
  if (Array.isArray(present.tags)) {
    present.tags.forEach((t) => {
      const label = (t && t.label) || t;
      if (label) push("tag", "tags", `촬영 직후 <b>${label}</b>을 선택해 주셨어요.`);
    });
  }
  /* ③ 보호자 고민 — 결과의 출발점이라 항상 첫 근거로 둔다 */
  if (present.concern) {
    const cLabel = a.concern_type || present.concern;
    const freq = sv.symptom_freq_label || null;
    push("survey", "concern", `가장 큰 고민으로 <b>${cLabel}</b>을 골라 주셨어요${freq ? `(${freq})` : ""}.`);
  }
  /* ④ 조건부 심화문항 — 고민에 직접 붙는 관찰 사실이라 근거로서 가장 값지다.
        ★ 순서 중요: normalize() 가 근거를 8개로 자르므로, 설문 단일응답보다 **먼저** 담아야
          한다. 뒤에 두면 일반적인 응답(간격·양·재시도)에 밀려 화면에서 사라진다. */
  const set = DEEP_EVIDENCE[present.concern] || null;
  if (set) {
    Object.keys(set).forEach((id) => {
      const v = present["deep." + id];
      if (v == null) return;
      const text = set[id][v];
      if (text) push("survey", "deep." + id, text);
    });
  }
  /* ⑤ 설문 단일 응답 */
  if (Array.isArray(present.hard_textures) && present.hard_textures.length && present.hard_textures[0] !== "특정 음식 없음")
    push("survey", "hard_textures", `특히 어려워하는 것으로 <b>${present.hard_textures.join(" · ")}</b>을 꼽아 주셨어요.`);
  const evCtx = { concernLabel: a.concern_type || present.concern };
  Object.keys(SURVEY_EVIDENCE).forEach((k) => {
    const v = present[k];
    if (v == null) return;
    push("survey", k, SURVEY_EVIDENCE[k](v, evCtx));
  });
  /* ⑥ 현재 음식 단계 */
  if (o.stageLabel && present.food_form)
    push("stage", "food_form", `현재 <b>${o.stageLabel}</b> 단계라고 알려주셨어요 — 조언은 이 단계에서 할 수 있는 다음 걸음으로만 잡았어요.`);
  /* ⑦ 지난 기록과의 비교 */
  if (present["history.cpm_prev"] != null && cur && cur.cpm > 0) {
    const prev = present["history.cpm_prev"];
    const d = Math.round((cur.cpm - prev) / prev * 100);
    if (Math.abs(d) >= 10)
      push("history", "history.cpm_prev", `지난 기록(분당 ${prev}회)과 비교하면 <b>${d > 0 ? "+" : ""}${d}%</b> 달라졌어요.`);
  }
  return ev;
}

/* ── 그렇게 판단한 근거(문단) ──────────────────────────────────────
   규칙 엔진의 firstCheck 는 "…부담스럽지 않았는지 먼저 확인해 보세요" 처럼 **지시문**이다.
   그것을 '근거' 칸에 넣으면 근거가 아니라 또 하나의 조언이 되어, 사용자가 지적한
   "같은 말을 다르게 반복"이 그대로 재현된다. 그래서 근거 문단은 따로 만든다.
     · 첫 문장 = 무엇을 보고 그렇게 봤는지(영상/설문 중 실제로 근거가 된 쪽을 밝힌다)
     · 둘째 문장 = 그것이 왜 그 행동으로 이어지는지(가능성별 해석, 단정하지 않는 표현)
   확인되지 않은 것은 쓰지 않는다 — 해석은 '…일 수 있어요' 로만 쓴다. */
const REASON_BY_POSSIBILITY = {
  texture: "지금 단계에서 한 입의 크기나 두께가 아이가 입안에서 다루기에 조금 부담스러웠을 수 있어요. 형태를 되돌리지 않고 크기·두께만 조절해 보는 것이 다음 걸음이에요.",
  interval: "충분히 배고픈 상태가 아니었다면, 음식이 어려워서가 아니라 먹을 이유가 약해서 그럴 수 있어요. 식사 간격을 먼저 일정하게 맞춰 보는 것이 순서예요.",
  expectation: "한 끼 양은 한 번의 식사만으로 판단하기 어려워요. 제공량을 조금 낮춰 부담을 줄이면 아이가 스스로 더 원할 여지가 생겨요.",
  repetition: "아직 이 음식이 익숙해질 기회가 적었을 수 있어요. 익숙한 음식 옆에 조금씩 함께 두는 것만으로도 경험이 쌓여요.",
  unclear: "이번 영상과 답변만으로는 한 가지 원인으로 좁히기 어려웠어요. 비슷한 조건에서 한 번 더 기록하면 반복되는 모습인지 확인할 수 있어요.",
};
export function buildReason(input) {
  const o = input || {};
  const ev = o.evidence || [];
  const cur = o.cur || null;
  /* ★ 규칙이 발동했으면 그 규칙의 해석을 쓴다(interpretation).
     possibility 기반 해석은 A단계의 4가지 축이라, B단계 규칙이 정한 행동과 어긋날 수 있다.
     실제로 '한 입 크기를 줄이세요' 행동에 '식사 간격을 맞추세요' 해석이 붙는 것을 앱 검증에서 잡았다. */
  const vid = ev.find((e) => e.source === "video");
  const svy = ev.filter((e) => e.source === "survey");
  const plain = (s) => String(s || "").replace(/<[^>]+>/g, "");
  let lead;
  // 개수를 문장에 쓰지 않는다 — 여기서 세는 목록은 화면 상한(10개) 적용 전이라 숫자가 어긋난다.
  if (vid && svy.length)
    lead = "이번 영상에서 관찰된 모습과 알려주신 답변이 아래와 같이 같은 방향을 가리켰어요.";
  else if (vid)
    lead = "이번 영상에서 관찰된 씹기 모습을 근거로 봤어요.";
  else if (cur && cur.quality === "low_face")
    lead = "이번에는 얼굴·입이 충분히 보이지 않아 영상 지표는 쓰지 않고, 알려주신 답변만으로 봤어요.";
  else if (svy.length)
    lead = "알려주신 답변을 근거로 봤어요.";
  else
    lead = "이번에는 근거로 쓸 수 있는 관찰·응답이 많지 않았어요.";
  const interp = o.interpretation || REASON_BY_POSSIBILITY[o.possibility] || REASON_BY_POSSIBILITY.unclear;
  return plain(lead) + " " + plain(interp);
}

/* ── 바꾸지 않아도 되는 것 ─────────────────────────────────────────
   "무조건 갈지 마세요"를 말할 수 있는 건 현재 단계를 알 때뿐이다.
   단계를 모르면 형태 얘기를 아예 하지 않는다(근거 없는 단정 금지). */
export function buildKeepAsIs(input) {
  const o = input || {};
  const form = o.food_form || null;
  const order = { ground: 0, mashed: 1, small_bits: 2, soft: 3, regular: 4 };
  if (form && order[form] >= 2)
    return "음식을 더 묽게 만들거나 믹서로 갈 필요는 없어 보여요. 지금의 부드러움은 그대로 두고, 한 가지만 바꿔 반응을 비교해 보세요.";
  if (form && order[form] != null)
    return "지금 단계를 되돌릴 필요는 없어요. 현재 형태를 유지한 채로 한 가지만 조절해 보세요.";
  return "한 번에 여러 가지를 바꾸지 않아도 돼요. 위의 한 가지만 바꾸고 나머지는 그대로 두세요.";
}

/* ── 다음에 지켜볼 것 ──────────────────────────────────────────────
   '관찰 항목'은 보호자가 셀 수 있는 것으로만 준다(횟수·시간). 느낌은 비교가 안 된다. */
export function buildNextObservation(input) {
  const o = input || {};
  const concern = o.concern || null;
  const items = [];
  if (concern === "hold" || concern === "slow") items.push("한 입을 물고 있는 시간", "세 번의 한입 중 오래 머금은 횟수");
  else if (concern === "spit") items.push("세 번의 한입 중 뱉은 횟수", "뱉기까지 걸린 시간");
  else if (concern === "noeat") items.push("첫 한입을 받아들이는지", "스스로 집어 먹은 횟수");
  else if (concern === "texture" || concern === "meat") items.push("입에 넣어 본 횟수", "씹다가 멈추는지 끝까지 씹는지");
  else if (concern === "fast") items.push("한 입을 삼키기까지 씹은 횟수", "사레 없이 넘겼는지");
  else items.push("같은 상황이 반복되는지", "씹는 시간이 조금씩 달라지는지");
  return { period: "다음 2~3회 식사", items: items.slice(0, 3) };
}

/* ── 안전 문구(고정) ───────────────────────────────────────────────
   삼킴·사레·물 제공처럼 안전과 닿는 지침은 LLM 이 만들게 하지 않는다.
   여기서만 불러오고, 문구를 바꿀 때는 검수 이력을 남긴다. */
export const SAFETY_NOTES = {
  default: "참고용 코칭이에요. 사레·삼킴 곤란·체중 감소처럼 걱정되는 신호가 반복되면 소아과·섭식 전문가와 상의해 주세요.",
  fast: "빨리 삼키는 모습이 반복되면 한 입 양을 줄이는 것까지만 해보시고, 물로 넘기게 돕는 방법은 쓰지 말아 주세요. 사레나 기침이 있으면 먼저 전문가와 상의해 주세요.",
  gated: "안전 확인 문항에 주의가 필요한 응답이 있어, 이번에는 식사 습관 조정보다 전문가 확인을 먼저 권해요.",
};
export function safetyNote(input) {
  const o = input || {};
  if (o.safetyOn) return SAFETY_NOTES.gated;
  if (o.concern === "fast") return SAFETY_NOTES.fast;
  return SAFETY_NOTES.default;
}

/* ── 조립 ──────────────────────────────────────────────────────────
   규칙 엔진 결과(rule)를 처방 스키마로 옮긴다. LLM 경로는 엣지함수가 같은 모양을 만들고,
   화면은 둘을 구분하지 않고 렌더한다(source 만 본다). */
export function assemble(input) {
  const o = input || {};
  const rule = o.rule || {};
  const present = o.present || factSheet(o);
  const evidence = o.evidence || buildEvidence(Object.assign({}, o, { present: present }));
  return normalize({
    source: o.source || "rule",
    primary_action: {
      title: rule.action || "",
      // rule.firstCheck 는 지시문이라 근거 칸에 쓰지 않는다(위 buildReason 주석 참고)
      reason: buildReason({ evidence: evidence, cur: o.cur, possibility: rule.possibility }) || rule.firstCheck || "",
      how_to: (rule.tips || []).slice(0, 5),
    },
    evidence: evidence,
    keep_as_is: buildKeepAsIs({ food_form: rule.food_form || present.food_form }),
    missing_information: missingInfo({ present: present }),
    next_observation: buildNextObservation({ concern: present.concern }),
    safety_note: safetyNote({ safetyOn: rule.safetyOn, concern: present.concern }),
  });
}

/* ── 정규화 ────────────────────────────────────────────────────────
   어느 경로가 만들었든 화면이 전제하는 모양을 보장한다(누락 필드로 렌더가 깨지지 않게).
   레거시 4필드(firstCheck·action·tips·watch)는 여기서 **파생**시킨다 —
   같은 내용을 두 번 생성하지 않게 하려는 것이 이번 개편의 핵심이다. */
export function normalize(p) {
  const o = p || {};
  const pa = o.primary_action || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const arr = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const primary = {
    title: str(pa.title),
    reason: str(pa.reason),
    how_to: arr(pa.how_to).slice(0, 5),
  };
  // 근거는 source·ref·text 가 모두 있어야 근거다. 하나라도 없으면 버린다.
  /* 근거 상한 10개 — buildEvidence 는 설문을 다 채우면 13~14개를 만든다.
     너무 적게 자르면 정작 값진 근거(심화문항·식사 간격)가 사라지고,
     제한이 없으면 근거 칸이 화면을 삼킨다. 순서가 곧 우선순위다(buildEvidence 참고). */
  const evidence = (Array.isArray(o.evidence) ? o.evidence : [])
    .map((e) => ({ source: str(e && e.source), ref: str(e && e.ref), text: str(e && e.text) }))
    .filter((e) => e.text && SOURCES.indexOf(e.source) >= 0 && e.ref)
    .slice(0, 10);
  const missing = (Array.isArray(o.missing_information) ? o.missing_information : [])
    .map((m) => (typeof m === "string" ? { key: m, label: (CONTEXT_KEYS[m] || {}).label || m, unlocks: (CONTEXT_KEYS[m] || {}).unlocks || "" } : m))
    .filter((m) => m && m.key)
    .slice(0, 3);
  const nx = o.next_observation || {};
  const out = {
    source: (o.source === "ai") ? "ai" : "rule",
    primary_action: primary,
    evidence: evidence,
    keep_as_is: str(o.keep_as_is),
    missing_information: missing,
    next_observation: { period: str(nx.period) || "다음 2~3회 식사", items: arr(nx.items).slice(0, 3) },
    safety_note: str(o.safety_note) || SAFETY_NOTES.default,
  };
  Object.assign(out, toLegacy(out));
  return out;
}

/* 레거시 투영 — 저장(result.first_check·action·watch)·관리자·지난기록·앱이 이 4개를 읽는다.
   새 스키마를 도입해도 이 키가 유지돼야 과거 화면이 안 깨진다. */
export function toLegacy(p) {
  const o = p || {};
  const pa = o.primary_action || {};
  const items = (o.next_observation && o.next_observation.items) || [];
  return {
    action: pa.title || "",
    firstCheck: pa.reason || "",
    tips: (pa.how_to || []).slice(),
    watch: items.length ? items.join(" · ") : "같은 상황에서 아이의 반응이 달라지는지",
  };
}

/* 처방이 화면에 올릴 만한가 — 핵심 한 가지와 근거가 최소 1개는 있어야 한다.
   근거가 0개면 그것이 바로 "일반적인 문장"이므로, 규칙 엔진 결과로 되돌린다. */
export function isUsable(p) {
  return !!(p && p.primary_action && p.primary_action.title && Array.isArray(p.evidence) && p.evidence.length > 0);
}

export default {
  FIELDS, AI_FIELDS, SOURCES, CONTEXT_KEYS, SAFETY_NOTES,
  factSheet, missingInfo, buildEvidence, buildKeepAsIs, buildNextObservation,
  safetyNote, assemble, normalize, toLegacy, isUsable,
};
