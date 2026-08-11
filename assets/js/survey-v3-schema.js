// survey-v3-schema.js — Chewstep 설문 v3 정의(프레임워크 무관, 웹·앱 공용)
// ─────────────────────────────────────────────────────────────────────
// 이 파일 하나면 웹에서도 동일한 설문을 구성할 수 있습니다.
// - 선택지/조건부 세트/안전 문항/스텝 순서/필수 규칙/저장(answers) 스키마를 모두 담음.
// - import 없음. 렌더링은 각자 프레임워크(React/Vue/바닐라)로 하고 이 정의만 소비.
// - 값(value)은 저장·집계용 코드, 텍스트(t)는 표시용. 저장은 value로 하세요.
// 스펙 문서: B2C/PRD/설문-v3-5관점-스펙.html
// 앱 구현 참고: chewstep-mobile/www/assets/js/screens/survey.js (동일 정의 사용)

/* ── 공통 ── */
export const CONCERN = [ // 가장 고민되는 식사 문제 (단일선택 = 3단계 딥다이브 트리거)
  { v: "noeat", t: "안 먹음" }, { v: "hold", t: "오래 물고 있음" }, { v: "spit", t: "뱉음" },
  { v: "texture", t: "질감 거부" }, { v: "meat", t: "고기 거부" }, { v: "slow", t: "너무 느림" },
  { v: "fast", t: "너무 빨리 삼킴" }, { v: "other", t: "기타" },
];
// 증상 빈도 — 2026-07-28: 주관적 표현("일주일에 몇 번"·"가끔") 제거.
//   기간+횟수를 함께 제시하고, 저장은 코드(v)로 한다 → 라벨을 고쳐도 집계 기준이 흔들리지 않음.
//   구버전 응답은 한글 라벨 문자열로 저장돼 있어, 표시할 때 FREQ_LABEL 조회 실패 시 원문을 그대로 쓴다.
export const FREQ = [
  { v: "daily5", t: "거의 매일 (주 5회 이상)" },
  { v: "w34", t: "주 3~4회" },
  { v: "w12", t: "주 1~2회" },
  { v: "m12", t: "월 1~2회" },
  { v: "rare", t: "거의 없음" },
  { v: "unknown", t: "잘 모르겠음" },
];
// 코드 → 표시 라벨 (결과·리포트·관리자 집계 공용)
export const FREQ_LABEL = FREQ.reduce((m, o) => { m[o.v] = o.t; return m; }, {});

/* ── 관점 01 · 식감과 입자 (아이) ── */
export const FOOD = [ // 주로 먹는 음식 형태
  { v: "ground", t: "갈아 만든 음식" }, { v: "mashed", t: "으깬 음식" }, { v: "small_bits", t: "작은 알갱이" },
  { v: "soft", t: "무른 유아식" }, { v: "regular", t: "일반 가정식" },
];
// 음식 형태 코드 → 표시 라벨 / 단계 순서(낮을수록 이전 단계)
export const FOOD_LABEL = FOOD.reduce((m, o) => { m[o.v] = o.t; return m; }, {});
export const FOOD_ORDER = { ground: 0, mashed: 1, small_bits: 2, soft: 3, regular: 4 };

/* ── 음식 단계별 조언 게이팅 (2026-07-28) ─────────────────────────────
   문제: '무른 유아식'을 먹이는 보호자에게 "믹서로 갈지 말고 포크로 으깨 알갱이를 남기세요"처럼
         이미 지나온 단계의 조언이 나갔다. 공통 팁이 단계와 무관하게 삽입된 탓.
   원칙: 보호자가 선택한 현재 단계보다 이전 단계의 조언은 제공하지 않는다.
         현재 단계에서 실행할 수 있는 '다음 한 걸음'만 제안한다.
   구조: next  = 이 단계에서 권할 수 있는 조언의 방향(LLM에 허용 목록으로 전달)
         avoid = 이 단계에 제시하면 후퇴로 느껴지는 조언(LLM에 금지 목록으로 전달)
         tips  = 보호자에게 그대로 보여줄 문장(규칙 엔진 폴백용 · 굵게 강조 HTML 허용)
   규칙 엔진(demo.html RULES)의 개별 팁은 tip.for = [코드…] 로 적용 단계를 직접 지정한다. */
export const FOOD_ADVICE = {
  ground: {
    label: "갈아 만든 음식 (미음·완전히 간 상태)",
    next: [
      "완전히 간 상태에서 아주 작은 알갱이를 조금씩 남기기",
      "믹서 대신 포크로 으깨 입자를 남기기",
      "가는 정도(곱기)를 며칠에 걸쳐 서서히 줄이기",
    ],
    avoid: [
      "덩어리·깍둑 썰기처럼 씹어야 하는 크기를 바로 제시하기",
      "질긴 재료(고기 결·나물)를 그대로 제시하기",
    ],
    tips: [
      "믹서로 다시 갈지 말고 <b>포크로 거칠게 으깨</b> 아주 작은 알갱이를 남겨 주세요(다시 갈면 이전 단계로 후퇴).",
      "가는 정도는 <b>한 번에 바꾸지 말고</b> 3~4일에 걸쳐 조금씩 거칠게 해주세요.",
    ],
  },
  mashed: {
    label: "으깬 음식",
    next: [
      "으깬 정도를 거칠게 바꿔 알갱이 크기를 조금씩 키우기",
      "으깬 음식에 부드러운 작은 알갱이를 섞어 함께 주기",
      "손가락으로 눌러 뭉개지는 재료부터 알갱이로 올리기",
    ],
    avoid: [
      "다시 곱게 갈거나 믹서로 되돌리기",
      "질긴 재료를 그대로 제시하기",
    ],
    tips: [
      "으깨는 정도를 <b>조금 더 거칠게</b> 해서 알갱이 크기를 키워 보세요.",
      "으깬 음식에 <b>부드러운 작은 알갱이를 섞어</b> 같은 그릇에 담아 주세요.",
      "손가락으로 눌러 <b>스르륵 뭉개지는 재료</b>부터 알갱이로 올려 보세요.",
    ],
  },
  small_bits: {
    label: "작은 알갱이",
    next: [
      "같은 부드러움을 유지하면서 알갱이 크기만 조금 키우기",
      "작은 알갱이와 부드러운 덩어리를 한 그릇에 함께 담기",
      "잇몸으로 으깰 수 있는 재료를 하나씩 늘리기",
    ],
    avoid: [
      "다시 갈거나 완전히 으깨 되돌리기",
      "알갱이를 남기라는 조언(이미 알갱이 단계)",
    ],
    tips: [
      "부드러움은 그대로 두고 <b>알갱이 크기만</b> 조금 키워 보세요.",
      "작은 알갱이와 <b>부드러운 덩어리를 한 그릇에</b> 함께 담아 주세요.",
      "<b>잇몸으로 으깰 수 있는 재료</b>를 한 가지씩 늘려 보세요(푹 익힌 채소·두부).",
    ],
  },
  soft: {
    label: "무른 유아식",
    next: [
      "같은 부드러움 안에서 크기를 조금씩 키우기",
      "으깬 음식과 작은 덩어리를 함께 제공하기",
      "씹을 수 있는 부드러운 재료를 하나씩 추가하기",
      "한 입 크기와 두께를 조절해 씹는 횟수를 늘리기",
    ],
    avoid: [
      "믹서로 갈거나 포크로 으깨 알갱이를 남기라는 조언",
      "곱게 가는 정도를 조절하라는 조언",
      "음식을 더 부드럽게·잘게 되돌리라는 조언",
    ],
    tips: [
      "지금의 <b>부드러움은 그대로</b> 두고, 한 입 크기를 조금씩 키워 보세요.",
      "<b>으깬 음식과 작은 덩어리를 함께</b> 담아, 아이가 고를 수 있게 해주세요.",
      "<b>씹을 수 있는 부드러운 재료</b>를 한 가지씩 추가해 보세요(푹 익힌 애호박·두부·바나나).",
      "덩어리는 <b>납작하고 길게</b> 썰어 주세요 — 잇몸으로 누르기 쉬워 씹는 연습이 돼요.",
    ],
  },
  regular: {
    label: "일반 가정식",
    next: [
      "한 입 크기와 두께를 조절하기",
      "질긴 식재료를 더 부드러운 조리법으로 바꾸기",
      "선호 음식과 어려운 음식을 한 접시에 조합하기",
      "씹는 시간이 필요한 재료를 식사 앞쪽에 배치하기",
    ],
    avoid: [
      "갈기·으깨기처럼 이유식 단계로 되돌리는 조언",
      "알갱이를 남기라는 조언",
      "음식 형태를 한 단계 낮추라는 조언",
    ],
    tips: [
      "형태를 낮추지 말고 <b>한 입 크기와 두께</b>만 조절해 주세요.",
      "질긴 재료는 <b>조리법을 바꿔</b> 부드럽게 해주세요(볶음 → 국물에 푹 익히기·다지기).",
      "<b>좋아하는 음식과 어려운 음식을 한 접시에</b> 담아 번갈아 먹게 해주세요.",
      "씹는 시간이 필요한 재료는 <b>가장 배고픈 식사 앞쪽</b>에 두세요.",
    ],
  },
};

export const CEILING = [ // 무리 없이 먹는 가장 단단한 음식(씹기 상한)
  { v: "tofu", t: "두부·바나나" }, { v: "veg", t: "푹 익힌 채소" }, { v: "rice_egg", t: "부드러운 밥·계란" },
  { v: "minced_meat", t: "잘게 조리한 고기" }, { v: "regular", t: "일반식" },
];
export const HARD = ["고기", "채소", "밥알", "덩어리", "바삭한 음식", "미끄러운 음식", "특정 음식 없음"]; // 다중선택
export const BEHAVIOR = ["입에 넣지 않음", "혀로 밀어냄", "구역질함", "씹다가 뱉음", "오래 물고 있음", "바로 삼키려 함", "잘 먹음"];
export const MEALTIME = ["15분 미만", "15~30분", "30~40분", "40분 이상"];

/* ── 관점 02·03·04·05 (환경·부모) ── */
export const INTERVAL = ["30분 이내", "30분~1시간", "1~2시간", "2시간 이상"];            // 02 식사·간식 간격
export const PORTION = ["훨씬 적음", "조금 적음", "비슷함", "더 많음"];                    // 03 기대 대비 실제 양
export const RETRY = ["1~2번", "3~5번", "여러 번(6번+)", "거의 안 함"];                   // 04 반복 노출(재시도)
export const RESPONSE = ["좋아하는 음식으로 바꿔줌", "억지로 더 먹임", "따라다니며 먹임", "영상 보여줌", "그냥 식사 종료", "기다렸다 다시 시도"]; // 05 거부 시 대응

/* ── 3단계 조건부 세트 · 고민(value) → 문항[] ── */
export const YN = ["예", "아니오"];
export const SETS = {
  noeat: [
    { id: "scope", q: "대부분을 안 먹나요, 특정 음식만 안 먹나요?", opts: ["대부분", "특정 음식만"] },
    { id: "hungry", q: "배고파 보이는데도 안 먹나요?", opts: YN },
    { id: "fav", q: "좋아하는 음식은 잘 먹나요?", opts: YN },
    { id: "seat", q: "식사 자리에 앉아 있기는 하나요?", opts: YN },
  ],
  hold: [
    { id: "allfood", q: "모든 음식에서 그런가요?", opts: YN },
    { id: "meatveg", q: "고기나 채소에서만 그런가요?", opts: YN },
    { id: "tired", q: "피곤하거나 배가 부를 때 심해지나요?", opts: YN },
    { id: "washdown", q: "물이나 국과 함께 넘기려 하나요?", opts: YN },
  ],
  spit: [
    { id: "timing", q: "입에 넣자마자 뱉나요, 씹다가 뱉나요?", opts: ["바로", "씹다가"] },
    { id: "texture_only", q: "특정 식감에서만 뱉나요?", opts: YN },
    { id: "softer_ok", q: "더 부드럽게·잘게 하면 먹나요?", opts: YN },
  ],
  texture: [
    { id: "which", q: "특히 어떤 식감을 거부하나요?", opts: ["덩어리", "미끄러움", "바삭함", "섞인 식감", "여러 가지"] },
    { id: "puree_ok", q: "매끈하게 갈면 잘 먹나요?", opts: YN },
    { id: "touch", q: "음식을 손으로 만지는 것도 싫어하나요?", opts: YN },
  ],
  meat: [
    { id: "timing", q: "입에 넣자마자 거부하나요, 씹다가 뱉나요?", opts: ["바로", "씹다가"] },
    { id: "minced_ok", q: "잘게 다진 고기는 먹나요?", opts: YN },
    { id: "broth_ok", q: "국물에 부드럽게 익힌 고기는 먹나요?", opts: YN },
    { id: "other_tough", q: "고기 말고 다른 질긴 음식도 거부하나요?", opts: YN },
  ],
  slow: [
    { id: "onset", q: "처음부터 느린가요, 뒤로 갈수록 느려지나요?", opts: ["처음부터", "뒤로 갈수록"] },
    { id: "where", q: "씹는 데 오래 걸리나요, 삼키길 미루나요?", opts: ["씹기 오래", "안 삼킴"] },
    { id: "distract", q: "먹는 중 딴짓(TV·놀이)을 하나요?", opts: YN },
    { id: "soft_fast", q: "부드러운 음식은 빨리 먹나요?", opts: YN },
  ],
  fast: [ // 안전 연계: choke/biglump 응답은 안전 안내 강화
    { id: "nochew", q: "거의 안 씹고 삼키나요?", opts: YN },
    { id: "biglump", q: "큰 덩어리도 그냥 삼키려 하나요?", opts: YN },
    { id: "choke", q: "삼킨 뒤 사레나 기침이 있나요?", opts: YN },
    { id: "rush", q: "급하게 먹나요(배고픔·경쟁)?", opts: YN },
  ],
  other: [
    { id: "nearest", q: "가장 가까운 유형은?", opts: ["안 먹음", "뱉음", "질감", "느림", "빠름", "모르겠음"] },
    // + 자유서술(otherText) 1개
  ],
};

/* ── 2단계 안전 문항 (예·아니오) ── */
export const SAFETY = [
  { id: "s1", q: "식사 중 반복적으로 사레가 들거나 기침하나요?" },
  { id: "s2", q: "먹는 동안 숨쉬기 힘들어하거나 입술색이 변한 적이 있나요?" },
  { id: "s3", q: "체중이 줄거나 최근 성장에 대한 의료진의 우려가 있었나요?" },
];
// 게이팅: SAFETY 중 하나라도 "예" → safety_alert=true → 코칭보다 먼저 안전 안내 노출

/* ── 스텝 순서 + 스텝별 필수 필드(검증용) ── */
export const STEPS = [
  { key: "common", title: "기본 정보", required: ["concern", "symptom_freq"] }, // age는 온보딩 자동
  { key: "lens01", title: "식감과 입자", required: ["food_form", "chew_ceiling", "hard_textures", "behavior", "meal_time"] },
  { key: "env", title: "식사 환경 · 부모 관점", required: ["interval", "portion_gap", "retry_count", "refusal_response"] },
  { key: "deep", title: "조금 더 자세히", required: "SETS[concern] 전 문항(서술 제외)" },
  { key: "safety", title: "안전 확인", required: ["s1", "s2", "s3"] },
  { key: "wrap", title: "마무리 (선택)", required: [] }, // 하루 일과·서술 전부 선택
];

/* ── 스키마 버전 ──
   설문 임시저장(초안) 호환 판정용. 문항 구조·선택지 코드가 바뀌면 올린다.
   초안에 저장된 버전이 이 값과 다르면 초안을 폐기하고 처음부터 받는다.
   v3.1 (2026-07-28): FREQ 코드화(daily5/w34/w12/m12/rare/unknown) + FOOD_ADVICE 단계 게이팅 도입 */
export const SCHEMA_VERSION = "v3.1";

/* ── 저장(answers) 스키마 ──
   결과·비교 호환을 위해 legacy 2필드(food_texture·concern_type)는 반드시 함께 저장.
   전체 응답은 survey 객체로 저장. */
export const ANSWERS_SHAPE = {
  food_texture: "lens01.food_form 값(코드)",   // legacy · compare/result가 사용
  concern_type: "CONCERN에서 고른 항목의 t(한글 라벨)", // legacy · result 표시
  concern_text: "want_to_know(서술) 또는 null",
  survey: {
    age_months: "number|null",
    concern: "CONCERN value(단일)",
    symptom_freq: "FREQ v(코드) — 표시는 FREQ_LABEL[v], 구버전 행은 한글 라벨 원문",
    want_to_know: "string",
    lens01: { food_form: "FOOD v", chew_ceiling: "CEILING v", hard_textures: "HARD[] (다중)", behavior: "BEHAVIOR", meal_time: "MEALTIME" },
    lens02: { interval: "INTERVAL" },
    lens03: { portion_gap: "PORTION" },
    lens04: { retry_count: "RETRY" },
    lens05: { refusal_response: "RESPONSE" },
    deep: "{ [SETS[concern].id]: 값, otherText?: string }",
    safety: { s1: "예|아니오", s2: "예|아니오", s3: "예|아니오" },
    routine: { wake: "HH:MM", bfast: "", lunch: "", dinner: "", snack_time: "", snack_kind: "", milk_time: "", milk_amt: "", sleep: "" },
  },
  safety_alert: "boolean — SAFETY 중 하나라도 '예'",
};

export const SURVEY_SCHEMA = { CONCERN, FREQ, FREQ_LABEL, FOOD, FOOD_LABEL, FOOD_ORDER, FOOD_ADVICE, CEILING, HARD, BEHAVIOR, MEALTIME, INTERVAL, PORTION, RETRY, RESPONSE, YN, SETS, SAFETY, STEPS, ANSWERS_SHAPE, SCHEMA_VERSION };
export default SURVEY_SCHEMA;
