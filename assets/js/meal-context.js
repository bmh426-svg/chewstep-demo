// meal-context.js — 촬영 맥락(음식·한입·환경·식전 섭취)과 관찰 태그의 **고정 코드값** 정의
// ─────────────────────────────────────────────────────────────────────
// B단계 ① (2026-07-29)
//   리포트가 일반적인 이유는 모델이 아니라 입력이다. 모델에 들어가는 사실이
//   '월령 + 고민 + 씹기 횟수' 뿐이면 어떤 모델도 "주먹밥 한 개의 실제 크기"를 알 수 없다.
//   그래서 먼저 **무엇을 사실로 받을지**를 코드값으로 못 박는다.
//
// 원칙
//   1) 저장은 코드(v), 표시는 라벨(t). 라벨을 고쳐도 집계·규칙이 흔들리지 않는다.
//      (설문 v3 이 FREQ 를 코드화한 것과 같은 이유 — survey-v3-schema.js 참고)
//   2) '모르겠음(unknown)'을 반드시 둔다. 빈 값과 "모른다"는 다르다 —
//      빈 값은 아직 안 물어본 것이고, unknown 은 물어봤는데 모른다는 답이다.
//      둘 다 근거로는 쓸 수 없지만, 다시 물어볼지 여부가 갈린다.
//   3) 영상으로 확정할 수 없는 행동(삼킴·뱉음·머금음·사레·혀 으깨기)은
//      **태그로만** 받는다. TAG_ONLY_FACTS 가 그 목록이고, observe.js 는 이 항목을
//      절대 자동 판정하지 않는다(verify/observation-rules-check.mjs 가 검사).
//
// 저장 위치: answers.meal.*  /  answers.tags[]
//   answers.meal 은 coach-schema.js factSheet 이 이미 읽는 자리다 → 채우면 자동으로
//   근거·미확인정보·차단규칙에 반영된다(A단계에서 자리를 미리 만들어 둔 부분).
//
// import 없음(순수 정의) — 웹·앱·검증이 함께 쓴다.

/* ── 음식 ─────────────────────────────────────────────────────────── */
export const FOOD_SHAPE = [
  { v: "puree",       t: "완전히 간 것 (미음·퓌레)" },
  { v: "mashed",      t: "으깬 것" },
  { v: "bits",        t: "작은 알갱이" },
  { v: "lump",        t: "덩어리" },
  { v: "sticky_lump", t: "찰진 덩어리 (주먹밥·떡류)" },
  { v: "strip",       t: "길게 썬 것 (스틱)" },
  { v: "soup",        t: "국물·죽" },
  { v: "mixed",       t: "여러 형태가 섞임" },
  { v: "unknown",     t: "잘 모르겠음" },
];
// 식감 — 다중선택. 규칙에서 '찰짐'·'질김'이 핵심 조건이 된다.
export const TEXTURE = [
  { v: "soft",     t: "부드러움" },
  { v: "sticky",   t: "찰짐 (입에 붙음)" },
  { v: "tough",    t: "질김 (잘 안 끊어짐)" },
  { v: "crispy",   t: "바삭함" },
  { v: "slippery", t: "미끄러움" },
  { v: "dry",      t: "퍼석함·건조함" },
];
// 한 입 조각의 크기 — '아이 엄지손톱' 을 기준자로 쓴다(자·저울 없이 판단 가능해야 한다)
export const BITE_SIZE = [
  { v: "small",   t: "아이 엄지손톱보다 작음" },
  { v: "medium",  t: "아이 엄지손톱과 비슷함" },
  { v: "large",   t: "아이 엄지손톱보다 큼" },
  { v: "unknown", t: "잘 모르겠음" },
];
// 한 번에 입에 넣어 준 양 — 조각 크기와 다르다(작은 조각을 여러 개 넣을 수 있다)
export const SERVE_AMOUNT = [
  { v: "small",   t: "작은 한입" },
  { v: "normal",  t: "보통 한입" },
  { v: "large",   t: "큰 한입" },
  { v: "unknown", t: "잘 모르겠음" },
];
export const WITH_LIQUID = [
  { v: "none",  t: "함께 준 것 없음" },
  { v: "water", t: "물" },
  { v: "soup",  t: "국물" },
  { v: "milk",  t: "우유" },
  { v: "juice", t: "주스·음료" },
  { v: "unknown", t: "잘 모르겠음" },
];

/* ── 먹는 방식 · 환경 ──────────────────────────────────────────────── */
export const FEEDING_METHOD = [
  { v: "self_hand",  t: "손으로 집어 스스로" },
  { v: "self_spoon", t: "숟가락으로 스스로" },
  { v: "assisted",   t: "보호자·교사가 먹여줌" },
  { v: "mixed",      t: "스스로 + 도움 섞임" },
  { v: "unknown",    t: "잘 모르겠음" },
];
export const MEAL_LOCATION = [
  { v: "table",     t: "식탁" },
  { v: "highchair", t: "아기 식사의자" },
  { v: "floor",     t: "바닥·좌식 상" },
  { v: "moving",    t: "정해진 자리 없이 (돌아다니며)" },
  { v: "other",     t: "그 외" },
  { v: "unknown",   t: "잘 모르겠음" },
];
export const DISTRACTION = [
  { v: "none",   t: "없음" },
  { v: "screen", t: "영상·TV" },
  { v: "toy",    t: "장난감·책" },
  { v: "both",   t: "영상 + 장난감" },
  { v: "unknown", t: "잘 모르겠음" },
];

/* ── 식사 전 섭취 ──────────────────────────────────────────────────
   "밥을 적게 먹었다"의 원인을 음식에서 찾기 전에 확인해야 하는 값.
   종류와 간격을 나눠 받는다 — 우유 200ml 를 30분 전에 먹은 것과
   과일 몇 조각을 2시간 전에 먹은 것은 전혀 다른 사실이다. */
export const PRE_INTAKE_KIND = [
  { v: "none",        t: "없음" },
  { v: "snack",       t: "간식(과일·과자 등)" },
  { v: "milk",        t: "우유" },
  { v: "formula",     t: "분유" },
  { v: "breastfeed",  t: "수유" },
  { v: "unknown",     t: "잘 모르겠음" },
];
export const PRE_INTAKE_GAP = [
  { v: "lt30",  t: "30분 이내" },
  { v: "m30_60", t: "30분~1시간" },
  { v: "h1_2",  t: "1~2시간" },
  { v: "gt2",   t: "2시간 이상" },
  { v: "unknown", t: "잘 모르겠음" },
];
export const MEAL_SCHEDULE = [
  { v: "fixed",   t: "정해진 시간에 먹어요" },
  { v: "loose",   t: "대체로 비슷하지만 들쭉날쭉해요" },
  { v: "none",    t: "정해진 시간이 없어요" },
  { v: "unknown", t: "잘 모르겠음" },
];

/* ── 관찰 태그 ────────────────────────────────────────────────────
   영상만으로는 확정할 수 없는 행동을 사람이 골라 넣는 자리.
   source: 누가 골랐는지 — 신뢰도·리포트 출처 표기가 달라진다.
     guardian_input  보호자가 촬영 직후 선택
     teacher_check   교사가 급식 관찰 뒤 선택 (B2B)
     reviewer_tag    관리자·검수자가 영상을 보고 선택
   auto:false 는 "자동 판정 금지" 표시다(observe.js 가 만들어서는 안 되는 사실). */
export const TAGS = [
  { v: "large_bite",       t: "큰 한입을 넣었어요",           needs: [], auto: false },
  { v: "pocketing",        t: "입에 오래 머금었어요",         needs: [], auto: false },
  { v: "spit_after_chew",  t: "씹은 뒤 뱉었어요",             needs: [], auto: false },
  { v: "spit_immediately", t: "넣자마자 뱉었어요",            needs: [], auto: false },
  { v: "swallowed_ok",     t: "삼키는 것을 확인했어요",       needs: [], auto: false },
  { v: "tongue_mash",      t: "혀와 입천장으로 으깨는 듯했어요", needs: [], auto: false },
  { v: "no_chew_swallow",  t: "거의 씹지 않고 삼켰어요",      needs: [], auto: false },
  { v: "left_seat",        t: "자리를 떠났어요",              needs: [], auto: false },
  { v: "repeated_prompt",  t: "여러 번 권해야 먹었어요",      needs: [], auto: false },
  { v: "lost_focus",       t: "중간부터 집중이 흐트러졌어요", needs: [], auto: false },
  { v: "refused_first",    t: "첫 한입부터 거부했어요",       needs: [], auto: false },
  { v: "choke_sign",       t: "사레·기침이 있었어요",         needs: [], auto: false, safety: true },
];
export const TAG_LABEL = TAGS.reduce((m, o) => { m[o.v] = o.t; return m; }, {});
/* 자동 판정 금지 목록 — observe.js 의 출력에 이 키가 나타나면 안 된다.
   (사용자 지시: 삼킴·뱉음·입안 잔여·혀 으깨기·사레·정확한 한입 크기는 태그로만) */
export const TAG_ONLY_FACTS = [
  "swallowed_ok", "spit_after_chew", "spit_immediately", "pocketing",
  "tongue_mash", "no_chew_swallow", "choke_sign", "large_bite", "bite_size",
];
export const SAFETY_TAGS = TAGS.filter((o) => o.safety).map((o) => o.v);
export const TAG_SOURCES = ["guardian_input", "teacher_check", "reviewer_tag"];

/* ── answers.meal 필드 정의 ────────────────────────────────────────
   key → { list, label, required }  (list 가 없으면 자유 텍스트)
   촬영 직전 폼(C단계)이 이 정의만 읽어 렌더할 수 있게 한곳에 모은다. */
export const MEAL_FIELDS = [
  { key: "food_name",          label: "무엇을 먹었나요?",              text: true, max: 40, placeholder: "예: 주먹밥" },
  { key: "food_shape",         label: "음식 형태는요?",                list: FOOD_SHAPE },
  { key: "texture",            label: "식감은 어땠나요?",              list: TEXTURE, multi: true },
  { key: "bite_size",          label: "한 조각 크기는요?",             list: BITE_SIZE },
  { key: "serve_amount",       label: "한 번에 입에 넣어 준 양은요?",  list: SERVE_AMOUNT },
  { key: "feeding_method",     label: "어떻게 먹었나요?",              list: FEEDING_METHOD },
  { key: "meal_location",      label: "어디에서 먹었나요?",            list: MEAL_LOCATION },
  { key: "distraction",        label: "식사 중 영상이나 장난감이 있었나요?", list: DISTRACTION },
  { key: "pre_intake_kind",    label: "이 식사 전에 먹은 것이 있나요?", list: PRE_INTAKE_KIND },
  { key: "pre_intake_gap",     label: "그것을 먹은 뒤 얼마나 지났나요?", list: PRE_INTAKE_GAP, when: { key: "pre_intake_kind", not: ["none", "unknown", ""] } },
  { key: "with_liquid",        label: "함께 준 물·국물·음료가 있나요?", list: WITH_LIQUID },
  { key: "meal_schedule",      label: "평소 식사 시간이 정해져 있나요?", list: MEAL_SCHEDULE },
];
export const MEAL_FIELD_MAP = MEAL_FIELDS.reduce((m, f) => { m[f.key] = f; return m; }, {});

/* 코드 → 라벨. 규칙·리포트·관리자 집계가 함께 쓴다.
   구버전 행이 한글 라벨을 그대로 저장했을 수 있어, 조회 실패 시 원문을 돌려준다. */
export function label(key, v) {
  const f = MEAL_FIELD_MAP[key];
  if (!f || !f.list) return v == null ? "" : String(v);
  if (Array.isArray(v)) return v.map((x) => label(key, x)).filter(Boolean).join(" · ");
  const o = f.list.find((x) => x.v === v);
  return o ? o.t : (v == null ? "" : String(v));
}

/* ── 정규화 ────────────────────────────────────────────────────────
   화면·앱·관리자에서 들어온 값을 저장 직전에 통과시킨다.
     · 목록에 없는 코드는 버린다(오타·구버전 값이 규칙을 조용히 어긋나게 하는 것을 막는다)
     · 빈 문자열은 키 자체를 만들지 않는다 — '아직 안 물어봄'과 '모르겠음'을 구분한다
     · 조건부 필드(when)는 조건이 안 맞으면 버린다(우유를 안 먹었는데 경과시간이 남지 않게)
   반환: { meal, dropped[] } — dropped 는 로깅용(무엇이 왜 버려졌는지) */
export function normalizeMeal(raw) {
  const src = raw || {};
  const meal = {}, dropped = [];
  MEAL_FIELDS.forEach((f) => {
    let v = src[f.key];
    if (v == null) return;
    if (f.text) {
      v = String(v).trim().slice(0, f.max || 40);
      if (v) meal[f.key] = v;
      return;
    }
    if (f.multi) {
      const arr = (Array.isArray(v) ? v : [v])
        .map((x) => String(x).trim())
        .filter((x) => x && f.list.some((o) => o.v === x));
      if (arr.length) meal[f.key] = arr;
      else if (Array.isArray(v) ? v.length : v) dropped.push({ key: f.key, value: v, why: "목록에 없는 코드" });
      return;
    }
    v = String(v).trim();
    if (!v) return;
    if (!f.list.some((o) => o.v === v)) { dropped.push({ key: f.key, value: v, why: "목록에 없는 코드" }); return; }
    meal[f.key] = v;
  });
  // 조건부 필드 정리
  MEAL_FIELDS.filter((f) => f.when).forEach((f) => {
    if (meal[f.key] == null) return;
    const w = f.when;
    const cur = meal[w.key];
    const ok = w.not ? (cur != null && w.not.indexOf(cur) < 0) : (w.in ? w.in.indexOf(cur) >= 0 : true);
    if (!ok) { dropped.push({ key: f.key, value: meal[f.key], why: `조건 불충족(${w.key}=${cur ?? "없음"})` }); delete meal[f.key]; }
  });
  return { meal: meal, dropped: dropped };
}

/* 태그 정규화 — [{code, source, observed_at, by?}] 로 통일한다.
   문자열 배열("pocketing")로 들어오면 보호자 입력으로 본다(촬영 직후 칩이 그 경로).
   now: ISO 문자열을 주입받는다 — 순수 함수로 유지해 검증에서 시간이 흔들리지 않게. */
export function normalizeTags(raw, opts) {
  const o = opts || {};
  const now = o.now || null;
  const defSource = TAG_SOURCES.indexOf(o.source) >= 0 ? o.source : "guardian_input";
  const out = [], dropped = [];
  (Array.isArray(raw) ? raw : []).forEach((x) => {
    const code = (typeof x === "string") ? x : (x && (x.code || x.v));
    if (!code || !TAG_LABEL[code]) { dropped.push({ value: x, why: "정의되지 않은 태그" }); return; }
    const source = (x && TAG_SOURCES.indexOf(x.source) >= 0) ? x.source : defSource;
    if (out.some((t) => t.code === code && t.source === source)) return;   // 같은 사람이 같은 태그 두 번
    out.push({
      code: code,
      label: TAG_LABEL[code],
      source: source,
      observed_at: (x && x.observed_at) || now || null,
      by: (x && x.by) || null,
    });
  });
  return { tags: out, dropped: dropped };
}

/* 태그 목록에 이 사실이 있는가 — 규칙에서 조건으로 쓴다. */
export function hasTag(tags, code) {
  return (Array.isArray(tags) ? tags : []).some((t) => (t && (t.code || t)) === code);
}

export default {
  FOOD_SHAPE, TEXTURE, BITE_SIZE, SERVE_AMOUNT, WITH_LIQUID, FEEDING_METHOD,
  MEAL_LOCATION, DISTRACTION, PRE_INTAKE_KIND, PRE_INTAKE_GAP, MEAL_SCHEDULE,
  TAGS, TAG_LABEL, TAG_ONLY_FACTS, SAFETY_TAGS, TAG_SOURCES,
  MEAL_FIELDS, MEAL_FIELD_MAP, label, normalizeMeal, normalizeTags, hasTag,
};
