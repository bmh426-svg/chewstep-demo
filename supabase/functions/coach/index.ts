import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// coach: 식사 분석 '결과 코칭'을 LLM으로 개인화 (LETSUR AI 게이트웨이, OpenAI 호환).
// 하이브리드: 가능성(possibility)·안전 판정은 클라이언트 규칙엔진이 결정, 이 함수는 그 위에서 문장과 팁을 개인화.
// 키(LETSUR_API_KEY) 없으면 no_api_key → 클라이언트가 규칙엔진 결과를 그대로 사용.
//
// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 운영 배포본입니다. verify_jwt=false 유지 필수 —
// 클라이언트는 publishable key(JWT 아님)를 보내므로 JWT 검증을 켜면 전부 401 이 됩니다.
//
// 배포:  supabase functions deploy coach --project-ref qwfskemfsrkmlrdttvqy
// 롤백:  cp _rollback/index.v5.ts index.ts  후 위 배포 명령 (v5·v3 원본 보존)
// 검증:  cd verify && node coach-contract-check.mjs
//
// 변경 이력
//  v6 (2026-07-29) 근거 기반 처방으로 전환 — 리포트가 '일반적인 문장'으로 읽히던 문제
//    · 진단: 설문은 20개 필드를 받는데 v5 프롬프트는 3개(concern·food_form·behavior)만
//      문장화했다. hard_textures·interval·retry·portion·meal_time 은 body 로 받고 버렸고,
//      조건부 심화문항(SETS)·안전응답·chew_ceiling·영상 세부지표는 전달조차 안 됐다.
//      아이에 대해 3가지만 아는 상태로 "맞춤 조언"을 요구하니 일반론이 나올 수밖에 없었다.
//    · 입력: 받은 설문·영상·맥락·태그를 전부 사실목록(factSheet)으로 만들어 프롬프트에 넣고,
//      각 사실에 ref(입력 키)를 붙여 "근거로 인용할 수 있는 것"을 명시한다.
//    · 출력: {firstCheck, action, tips[], watch} 4문자열 → 처방 스키마로 교체.
//      primary_action{title,reason,how_to[]} · evidence[{source,ref,text}] · keep_as_is ·
//      missing_information[] · next_observation{period,items[]} · safety_note
//      (근거·유지할것·미확인정보를 담을 자리가 없어서 tips 칸에 같은 말을 반복했던 것)
//    · 근거 검증: evidence[].ref 가 실제 입력에 없으면 그 근거를 버린다(지어낸 근거 차단).
//    · 미입력 단정 금지: 식사 장소·간식 시각·한입 크기처럼 받지 않은 사실을 전제로 조언하지
//      않게 SYSTEM 에 명시하고, missing_information 은 LLM 이 아니라 서버가 결정론적으로 채운다.
//    · safety_note 는 검수된 고정 문구만 사용(LLM 생성 금지).
//    · 하위호환: 응답 coach 에 레거시 4필드(action·firstCheck·tips·watch)를 파생 투영해
//      함께 반환한다 → 기존 클라이언트 계약({ok, coach.action})·저장 스키마가 그대로 동작.
//      요청 스키마도 v5 필드를 모두 그대로 읽는다(추가 필드는 전부 옵셔널).
//  v5 (2026-07-29) 시크릿 값 정리(cleanSecret) — 대시보드에 붙여넣을 때 따라 들어오는
//    앞뒤 공백·개행·감싼 따옴표·BOM·제로폭 문자를 제거한 뒤 게이트웨이에 보낸다.
//    (키 값은 맞는데 llm_401 이 나는 사고를 막는다. LLM_BASE_URL·LLM_MODEL 도 같이 정리)
//  v4 (2026-07-28) 사용자 테스트 피드백 #6 — 음식 단계 게이팅
//    · body.food_stage(코드·단계명·순서·허용/금지 조언)를 받아 프롬프트에 강한 조건으로 주입
//    · "현재 단계보다 이전 단계의 조언은 제공하지 않는다" 규칙을 SYSTEM에 명시
//    · 알레르기(body.allergies) 수신 + 프롬프트에 절대 언급 금지 지시 추가
//    · SYSTEM 프롬프트의 인코딩 깨짐 복구
//      (씨기→씹기, 뀥기→뱉기, 바할→바꿀, 배고플→배고픔, 삼키 곤란→삼킴 곤란)
//      ※ '머금기'(입에 물고 있기)는 깨짐이 아니라 의도한 단어 — 그대로 둔다
//  v3 (이전) 최초 하이브리드 코칭
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  // charset 을 명시한다 — 클라이언트가 한글을 다른 인코딩으로 읽으면 문구가 깨진다.
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
function parseJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

/* 시크릿 값 정리(v5) — 대시보드 Secrets 입력창에 붙여넣을 때 값에 함께 들어오는
   앞뒤 공백·개행·감싼 따옴표·BOM·제로폭 문자를 제거한다.
   이게 없으면 키 값 자체는 맞는데 게이트웨이가 401(invalid_credentials)을 주고,
   원인이 코드가 아니라 입력값에 있어 찾기 어렵다. */
function cleanSecret(raw: string | undefined) {
  // 제로폭·BOM 문자는 코드포인트로 걸러낸다(소스에 보이지 않는 문자를 남기지 않기 위해).
  const ZERO_WIDTH = [0x200b, 0x200c, 0x200d, 0xfeff];
  return Array.from(String(raw ?? ""))
    .filter((ch) => ZERO_WIDTH.indexOf(ch.codePointAt(0) ?? 0) < 0)
    .join("")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/* ── 근거 출처(evidence[].source) — 클라이언트 assets/js/coach-schema.js SOURCES 와 동일 ──
   두 파일이 갈라지면 verify/coach-contract-check.mjs 가 깨진다(의도된 결합). */
const SOURCES = ["video", "survey", "tag", "stage", "history"];

/* ── 아직 입력칸이 없는 맥락 항목 — missing_information 후보 ──
   coach-schema.js CONTEXT_KEYS 의 collected:false 항목과 같아야 한다.
   서버가 결정론적으로 채운다: LLM 에 맡기면 '있는 데이터를 없다'고 쓰거나 그 반대가 된다. */
const MISSING_CATALOG: Record<string, { label: string; unlocks: string }> = {
  food_name:          { label: "음식 이름", unlocks: "먹은 음식에 맞춘 준비 방법을 말해 드릴 수 있어요" },
  food_shape:         { label: "음식 형태(덩어리·으깬·국물)", unlocks: "덩어리라서 어려웠는지, 식감 때문인지 나눠 볼 수 있어요" },
  texture:            { label: "식감(찰짐·질김 등)", unlocks: "찰진 음식이라 입안에서 나누기 어려웠는지 볼 수 있어요" },
  bite_size:          { label: "한 입 크기", unlocks: "한 입 양을 줄이라고 말할 근거가 생겨요" },
  serve_amount:       { label: "한 번에 넣어 준 양", unlocks: "조각 크기와 제공량을 나눠 볼 수 있어요" },
  feeding_method:     { label: "먹는 방식(스스로·도움)", unlocks: "속도를 아이가 정했는지 보호자가 정했는지 볼 수 있어요" },
  meal_location:      { label: "식사 장소", unlocks: "식사 자리와 집중이 이어지는지 연결해 볼 수 있어요" },
  pre_intake_kind:    { label: "식사 전 간식·우유·수유", unlocks: "배고픔 때문인지 아닌지 판단할 수 있어요" },
  pre_intake_gap:     { label: "식사 전 섭취 후 경과 시간", unlocks: "식사 간격을 조정하라고 말할 근거가 생겨요" },
  with_liquid:        { label: "함께 준 물·국물·음료", unlocks: "국물로 넘기고 있는지 확인할 수 있어요" },
  distraction:        { label: "식사 중 영상·장난감", unlocks: "집중이 깨진 이유를 함께 볼 수 있어요" },
  meal_schedule:      { label: "정해진 식사 시간", unlocks: "식사 리듬을 조정하는 조언을 드릴 수 있어요" },
  tags:               { label: "관찰 태그(머금음·뱉음·자리 이탈)", unlocks: "영상만으로는 확정할 수 없는 모습을 근거로 쓸 수 있어요" },
};
const MISSING_PRIORITY: Record<string, string[]> = {
  hold:    ["bite_size", "food_shape", "texture", "pre_intake_kind", "tags"],
  spit:    ["food_shape", "texture", "bite_size", "tags", "food_name"],
  noeat:   ["pre_intake_kind", "meal_location", "distraction", "meal_schedule"],
  texture: ["food_shape", "texture", "food_name", "bite_size", "tags"],
  meat:    ["food_shape", "texture", "food_name", "bite_size"],
  slow:    ["distraction", "meal_location", "bite_size", "meal_schedule"],
  fast:    ["serve_amount", "bite_size", "feeding_method", "pre_intake_kind"],
};
const MISSING_DEFAULT = ["bite_size", "food_name", "pre_intake_kind", "meal_location"];

/* ── 안전 문구 — 검수된 고정 문구만 사용한다(LLM 생성 금지) ──
   삼킴·사레·물 제공은 안전과 닿아 있어, 생성문을 쓰면 검수 이력을 남길 수 없다.
   coach-schema.js SAFETY_NOTES 와 동일해야 한다. */
const SAFETY_NOTES: Record<string, string> = {
  default: "참고용 코칭이에요. 사레·삼킴 곤란·체중 감소처럼 걱정되는 신호가 반복되면 소아과·섭식 전문가와 상의해 주세요.",
  fast: "빨리 삼키는 모습이 반복되면 한 입 양을 줄이는 것까지만 해보시고, 물로 넘기게 돕는 방법은 쓰지 말아 주세요. 사레나 기침이 있으면 먼저 전문가와 상의해 주세요.",
  gated: "안전 확인 문항에 주의가 필요한 응답이 있어, 이번에는 식사 습관 조정보다 전문가 확인을 먼저 권해요.",
};

const SYSTEM = [
  "당신은 Chewstep의 이유식·유아식 식사 코치입니다. 아이의 식사 분석 결과를 보호자에게 설명합니다.",
  "원칙: 씹기는 연습이 필요한 능력이다 · 월령보다 현재 단계를 본다 · 뱉기·머금기는 탐색 과정이다 · 경험이 먼저다.",
  "규칙: 의료 진단·치료·질병명·약물을 언급하지 않는다. 정상·이상 판정하지 않는다. 사레·삼킴 곤란 같은 안전 신호는 다루지 않는다. 보호자가 다음 식사에서 바로 할 수 있는 구체 행동만. 한국어, 따뜻하고 쉽게.",
  // ★ 근거 규칙 — v6 의 핵심. 이 규칙이 '어디에나 적용되는 일반 문장'을 막는다.
  "【근거 규칙 — 반드시 지킬 것】",
  "아래 '확인된 사실' 목록에 있는 것만 근거로 쓸 수 있습니다. 목록에 없는 사실은 존재하지 않는 것으로 취급하세요.",
  "evidence 의 각 항목에는 그 근거가 나온 사실의 ref 를 그대로 적습니다. 사실 목록에 없는 ref 를 쓰면 그 근거는 버려집니다.",
  "특히 다음은 입력되지 않았다면 어떤 형태로도 조언하지 마세요: 식사 장소·식탁에 앉았는지, 식사 중 돌아다녔는지, 마지막 간식·수유 시각, 한 입 크기와 제공량, 음식 이름, 스스로 먹었는지, 영상·장난감 여부, 정해진 식사 시간.",
  "위 항목이 필요한 조언이 떠오르면, 조언 대신 침묵하세요 — 무엇이 없어서 판단하지 않았는지는 시스템이 따로 안내합니다.",
  "추측을 사실처럼 쓰지 마세요. 관찰값에서 읽어낸 해석은 '…처럼 보였어요' 로, 확인된 입력은 '…라고 알려주셨어요' 로 구분해 씁니다.",
  /* ★ 역할 제한 (B단계) — 무엇을 바꿀지는 규칙 엔진이 이미 정했다.
     LLM 이 행동을 새로 만들면, 그 행동에는 근거를 검증할 방법이 없다. */
  "【당신의 역할 — 표현만 합니다】",
  "coaching_input.primary_action 이 주어지면 그것이 '바꿀 한 가지'입니다. 다른 행동으로 바꾸지 마세요.",
  "allowed_actions 에 있는 종류의 행동만 문장으로 쓸 수 있습니다. 목록에 없는 행동은 떠올라도 쓰지 마세요.",
  "prohibited_actions 에 있는 행동은 어떤 표현으로도 쓰지 마세요 — 근거가 없어서 막힌 것이거나 안전 영역입니다.",
  "당신이 하는 일은 ① 주어진 행동을 보호자가 바로 할 수 있는 말로 다듬기 ② 주어진 사실로 근거를 설명하기 입니다.",
  "새로운 사실·새로운 행동·새로운 원인을 만들지 마세요.",
  // ★ 반복 금지 — 정보량 없이 길어지는 것을 막는다(보호자가 느끼던 '같은 말 반복')
  "【반복 금지】",
  "primary_action.title 은 '다음 식사에서 바꿀 단 하나'입니다. how_to 는 그 하나를 실행하는 순서이며, 새로운 조언을 추가하는 칸이 아닙니다.",
  "같은 내용을 표현만 바꿔 두 번 쓰지 마세요. reason 에 쓴 근거를 how_to 에서 되풀이하지 마세요.",
  // ★ 음식 단계 게이팅 — 위반이 가장 잦았던 지점이라 별도 문단으로 강조한다.
  "【음식 단계 규칙 — 반드시 지킬 것】",
  "보호자가 알려준 '현재 음식 단계'가 food_stage 로 주어진다. 이 단계보다 이전 단계의 조언은 절대 제공하지 않는다.",
  "현재 단계에서 실행할 수 있는 '다음 한 걸음'만 제안한다. 음식 형태를 낮추거나 되돌리라는 제안은 하지 않는다.",
  "food_stage.allow 에 적힌 방향으로만 조언하고, food_stage.forbid 에 적힌 내용은 어떤 표현으로도 쓰지 않는다.",
  "예: 현재 단계가 '무른 유아식'이면 '믹서로 갈지 말고 포크로 으깨 알갱이를 남기세요' 같은 조언은 이미 지나온 단계이므로 금지. 대신 '같은 부드러움 안에서 크기를 조금씩 키우기'처럼 다음 단계 행동을 제안한다.",
  // ★ 알레르기 — 식사 조언에서 재료를 이름으로 권하므로 안전 문제다.
  "【알레르기 규칙 — 반드시 지킬 것】",
  "allergies 에 재료가 주어지면, 그 재료와 그 재료로 만든 음식을 어떤 문장에서도 예시로 들지 않는다.",
  "대체 재료를 굳이 찾아 제시하려 하지 말고, 재료 이름을 쓰지 않는 방식으로 조언한다(예: '두부' 대신 '잇몸으로 으깨지는 부드러운 재료').",
  // ★ 출력 — 처방 스키마. safety_note·missing_information 은 시스템이 채우므로 만들지 않는다.
  "출력은 JSON 객체 하나만, 코드펜스·설명 없이 반환:",
  '{"primary_action": {"title": "다음 식사에서 바꿀 한 가지 · 1문장 · 명령형", "reason": "그렇게 판단한 근거 · 2~3문장 · 확인된 사실을 인용", "how_to": ["그 한 가지를 실행하는 순서 2~4단계"]},',
  ' "evidence": [{"source": "video|survey|tag|stage|history", "ref": "사실 목록의 ref 그대로", "text": "보호자 언어로 옮긴 한 문장"}],',
  ' "keep_as_is": "이번에는 바꾸지 않아도 되는 것 1~2문장",',
  ' "next_observation": {"period": "다음 2~3회 식사", "items": ["보호자가 셀 수 있는 관찰 항목 2~3개"]}}',
  "how_to 와 items 는 셀 수 있고 실행할 수 있는 것으로 씁니다(횟수·시간·순서). 느낌·태도는 비교할 수 없어 넣지 않습니다.",
].join("\n");

const LABELS: Record<string, string> = {
  texture: "질감·크기", interval: "식사 간격·배고픔", repetition: "익숙함·반복 노출", expectation: "기대 섭취량", unclear: "판단 제한",
};

/* ── 사실 목록(factSheet) 만들기 ────────────────────────────────────
   요청에서 '값이 실제로 있는' 항목만 골라 ref → 사람이 읽는 문장으로 만든다.
   이 목록이 프롬프트의 근거 후보이고, 동시에 evidence[].ref 검증의 허용 목록이다.
   ※ 값이 비어 있으면 넣지 않는다 — 빈 값을 넣으면 LLM 이 '없음'을 사실로 오해한다. */
type Fact = { ref: string; text: string };
function buildFacts(body: any): Fact[] {
  const facts: Fact[] = [];
  const put = (ref: string, text: string | null) => {
    if (!text) return;
    facts.push({ ref, text });
  };
  const has = (v: unknown) =>
    v != null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== "");

  const survey = (body.survey && typeof body.survey === "object") ? body.survey : {};
  const obs = (body.observation && typeof body.observation === "object") ? body.observation : {};
  const meal = (body.meal && typeof body.meal === "object") ? body.meal : {};
  const deep = (survey.deep && typeof survey.deep === "object") ? survey.deep : {};

  // 아이
  if (has(body.age_months)) put("age_months", `월령 ${body.age_months}개월`);
  // 설문 — v5 가 버리고 있던 필드까지 전부 문장화한다
  if (has(survey.concern)) put("concern", `보호자가 고른 가장 큰 고민: ${survey.concern_label ?? survey.concern}`);
  if (has(survey.symptom_freq)) put("symptom_freq", `증상 빈도: ${survey.symptom_freq_label ?? survey.symptom_freq}`);
  if (has(survey.food_form)) put("food_form", `주로 먹는 음식 형태: ${survey.food_form_label ?? survey.food_form}`);
  if (has(survey.chew_ceiling)) put("chew_ceiling", `무리 없이 먹는 가장 단단한 음식: ${survey.chew_ceiling_label ?? survey.chew_ceiling}`);
  if (has(survey.hard_textures)) put("hard_textures", `특히 어려워하는 것: ${[].concat(survey.hard_textures).join(" · ")}`);
  if (has(survey.behavior)) put("behavior", `어려운 음식에서 보이는 모습: ${survey.behavior}`);
  if (has(survey.meal_time)) put("meal_time", `한 끼 식사 시간: ${survey.meal_time}`);
  if (has(survey.interval)) put("interval", `직전 식사·간식과의 간격: ${survey.interval}`);
  if (has(survey.portion_gap)) put("portion_gap", `기대 대비 실제로 먹은 양: ${survey.portion_gap}`);
  if (has(survey.retry_count)) put("retry_count", `안 먹는 음식을 다시 시도한 횟수: ${survey.retry_count}`);
  if (has(survey.refusal_response)) put("refusal_response", `거부할 때 보호자의 대응: ${survey.refusal_response}`);
  // 조건부 심화문항 — 고민에 딱 붙는 관찰 사실이라 가장 값진 근거다(v5 는 전달조차 안 했다)
  Object.keys(deep).forEach((k) => {
    if (!has(deep[k])) return;
    const q = (survey.deep_labels && survey.deep_labels[k]) || k;
    put("deep." + k, `${q}: ${deep[k]}`);
  });
  // 영상 관찰 — 신뢰할 수 있는 지표만 넘긴다(low_face 는 클라이언트가 애초에 넣지 않는다)
  if (has(obs.cpm)) put("video.cpm", `영상 관찰 · 분당 씹기 약 ${obs.cpm}회${has(obs.chew) ? ` (총 ${obs.chew}회)` : ""}`);
  if (has(obs.left_pct)) put("video.left_pct", `영상 관찰 · 씹는 쪽 좌우 비율 ${obs.left_pct}:${100 - Number(obs.left_pct)}`);
  if (has(obs.observed_sec)) put("video.observed_sec", `영상 관찰 · 분석에 사용한 시간 약 ${obs.observed_sec}초`);
  if (has(obs.quality)) {
    const qMap: Record<string, string> = {
      high: "영상 품질 충분(얼굴·입이 잘 보임)",
      medium: "영상 품질 보통",
      low_motion: "영상에서 씹는 움직임이 뚜렷하지 않았음(관찰 결과이며 재촬영 사유가 아님)",
      audio: "얼굴이 잘 보이지 않아 씹는 소리로 감지(참고용)",
    };
    put("video.quality", `영상 관찰 · ${qMap[String(obs.quality)] ?? obs.quality}`);
  }
  // 촬영 직후 태그 — 영상만으로는 알 수 없는 모습의 유일한 근거
  if (has(body.tags)) put("tags", `촬영 직후 보호자가 고른 관찰 태그: ${[].concat(body.tags).map((t: any) => (t && t.label) || t).join(" · ")}`);
  // 촬영 맥락 — meal-context.js 의 고정 코드값(B단계 ①). 클라이언트가 라벨까지 함께 보낸다.
  const mealLabels: Record<string, string> = {
    food_name: "먹은 음식", food_shape: "음식 형태", texture: "식감", bite_size: "한 조각 크기",
    serve_amount: "한 번에 넣어 준 양", feeding_method: "먹는 방식", meal_location: "식사 장소",
    pre_intake_kind: "식사 전에 먹은 것", pre_intake_gap: "그 뒤 지난 시간",
    with_liquid: "함께 준 물·국물·음료", distraction: "식사 중 영상·장난감",
    meal_schedule: "정해진 식사 시간",
  };
  Object.keys(mealLabels).forEach((k) => {
    if (has(meal[k])) put(k, `${mealLabels[k]}: ${meal[k]}`);
  });
  // 지난 기록
  if (has(body.prev_cpm)) put("history.cpm_prev", `지난 기록 · 분당 씹기 ${body.prev_cpm}회`);
  // 보호자 서술
  if (has(body.concern_text)) put("concern_text", `보호자 메모: ${String(body.concern_text).slice(0, 200)}`);
  return facts;
}

/* 아직 못 받은 맥락 항목 — 고민 우선순위대로 최대 3개.
   "입력되지 않아 이번 결과에서는 판단하지 않았다"를 밝히기 위한 목록. */
function computeMissing(body: any, refs: Set<string>) {
  const concern = String(((body.survey || {}).concern) ?? "");
  const order = (MISSING_PRIORITY[concern] || MISSING_DEFAULT).concat(Object.keys(MISSING_CATALOG));
  const out: Array<{ key: string; label: string; unlocks: string }> = [];
  const seen = new Set<string>();
  for (const k of order) {
    if (seen.has(k)) continue;
    seen.add(k);
    const meta = MISSING_CATALOG[k];
    if (!meta || refs.has(k)) continue;
    out.push({ key: k, label: meta.label, unlocks: meta.unlocks });
    if (out.length >= 3) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const key = cleanSecret(Deno.env.get("LETSUR_API_KEY") || Deno.env.get("LLM_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) return json({ ok: false, error: "no_api_key" }, 200);
  const base = cleanSecret(Deno.env.get("LLM_BASE_URL")) || "https://gw.letsur.ai";
  const model = cleanSecret(Deno.env.get("LLM_MODEL")) || "claude-sonnet-4-6";

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (body.safetyOn === true) return json({ ok: false, error: "safety_gated" }, 200);

  const possibility = String(body.possibility ?? "unclear");
  const label = String(body.label ?? LABELS[possibility] ?? "");
  const survey = (body.survey && typeof body.survey === "object") ? body.survey : {};
  const foods = (body.foods && typeof body.foods === "object") ? body.foods : {};
  const metrics = (body.metrics && typeof body.metrics === "object") ? body.metrics : {};
  const stage = (body.food_stage && typeof body.food_stage === "object") ? body.food_stage : null;

  /* 사실 목록 — 프롬프트의 근거 후보 + evidence[].ref 허용 목록.
     v5 는 여기 있는 값의 1/5 만 프롬프트에 넣었다(그래서 일반론이 나왔다). */
  const facts = buildFacts(body);
  const refs = new Set(facts.map((f) => f.ref));
  /* coaching_input.observed_facts 의 키도 인용 가능한 ref 로 인정한다(B단계).
     이 목록은 클라이언트가 출처·신뢰도까지 붙여 만든 사실이라 근거로 쓸 수 있다. */
  if (body.coaching_input && Array.isArray(body.coaching_input.observed_facts))
    body.coaching_input.observed_facts.forEach((f: any) => { if (f && f.key) refs.add(String(f.key)); });
  if (body.coaching_input && Array.isArray(body.coaching_input.evidence))
    body.coaching_input.evidence.forEach((e: any) => { if (e && e.ref) refs.add(String(e.ref)); });
  const factBlock = facts.length
    ? ["【확인된 사실 — 근거로 쓸 수 있는 것은 이것뿐입니다】"]
        .concat(facts.map((f) => `· [ref=${f.ref}] ${f.text}`))
        .join("\n")
    : "【확인된 사실】 입력이 거의 없습니다 — 구체적인 조언을 만들지 말고, 다음 촬영에서 무엇을 알려주면 좋은지만 안내하세요.";

  // 아직 못 받은 항목 — LLM 에는 '이것을 전제로 조언하지 말라'는 금지 목록으로 전달한다.
  const missing = computeMissing(body, refs);
  const missingBlock = missing.length
    ? "【입력되지 않은 항목 — 이 사실을 전제로 조언하지 마세요】\n" +
      missing.map((m) => `· ${m.label}`).join("\n")
    : "";

  // 음식 단계 블록 — 코드만 주면 LLM이 단계를 오해하므로 단계명·순서·허용/금지를 함께 명시한다.
  const stageBlock = stage
    ? [
        `【현재 음식 단계】 ${stage.label ?? stage.code ?? "-"} (코드 ${stage.code ?? "-"}, ${Number(stage.order ?? 0) + 1}/${stage.total ?? 5}단계)`,
        `이 단계에서 권할 수 있는 조언: ${(Array.isArray(stage.allow) ? stage.allow : []).join(" / ") || "-"}`,
        `이 단계에 제시하면 안 되는 조언(이전 단계로 후퇴): ${(Array.isArray(stage.forbid) ? stage.forbid : []).join(" / ") || "-"}`,
        "primary_action·how_to 전부 위 '권할 수 있는 조언' 범위 안에서만 쓰세요.",
      ].join("\n")
    : "【현재 음식 단계】 보호자가 알려주지 않았습니다 — 형태를 바꾸라는 조언은 피하고, 한 입 양·속도·환경 쪽으로만 제안하세요.";

  // 알레르기 — 없으면 그 줄 자체를 넣지 않는다(빈 값이 '없음'으로 오해되지 않게 명시)
  const allergies = String(body.allergies ?? "").trim();
  const allergyBlock = allergies
    ? `【알레르기 — 절대 언급 금지】 ${allergies}\n위 재료와 그 재료로 만든 음식을 예시로 들지 마세요. 재료 이름 없이 조언하세요.`
    : "";

  /* ── coaching_input 블록 (B단계 ⑤) ────────────────────────────────
     클라이언트(coaching-input.js)가 관찰사실 → 규칙 → 허용/금지까지 이미 판단해서 보낸다.
     여기서는 그것을 계약으로 못 박아 넘긴다. 이 블록이 있으면 LLM 은 표현만 한다. */
  const ci = (body.coaching_input && typeof body.coaching_input === "object") ? body.coaching_input : null;
  const A = (v: unknown) => (Array.isArray(v) ? v : []);
  const ciBlock = ci
    ? [
        "【이번 결과의 처방 — 이 안에서만 표현하세요】",
        `· 바꿀 한 가지: ${(ci.primary_action && ci.primary_action.title) || "-"}`,
        ((ci.primary_action && A(ci.primary_action.how_to).length)
          ? `· 실행 순서(다듬어 쓰되 순서·내용은 유지): ${A(ci.primary_action.how_to).join(" → ")}` : ""),
        `· 제안해도 되는 행동: ${A(ci.allowed_actions).join(", ") || "(없음 — 관찰 안내만)"}`,
        `· 제안하면 안 되는 행동: ${A(ci.prohibited_actions).map((p: any) => (p && (p.label || p.action)) || p).join(", ") || "-"}`,
        (ci.keep_as_is ? `· 바꾸지 않아도 되는 것: ${ci.keep_as_is}` : ""),
        (A(ci.safety_flags).length ? `· 안전 신호가 있습니다: ${A(ci.safety_flags).map((s: any) => s.label || s.code).join(", ")} — 식사 습관 조정보다 전문가 확인을 먼저 권하는 톤으로 쓰세요.` : ""),
      ].filter(Boolean).join("\n")
    : "";
  // 관찰사실 — 출처·신뢰도를 그대로 넘긴다. 낮은 신뢰도 사실을 단정에 쓰지 않게.
  const factsBlock2 = (ci && A(ci.observed_facts).length)
    ? "【관찰사실(출처·신뢰도)】\n" + A(ci.observed_facts).slice(0, 30).map((f: any) =>
        `· [${f.source}${f.confidence != null ? ` ${f.confidence}` : ""}] ${f.label}: ${f.display ?? f.value}`).join("\n")
    : "";

  const userMsg = [
    `possibility: ${possibility} (${label}) — 규칙 엔진이 먼저 좁힌 가능성입니다. 이 방향 안에서 설명하세요.`,
    ciBlock,
    factsBlock2,
    factBlock,
    stageBlock,
    missingBlock,
    allergyBlock,
    (foods.liked || foods.practice ? `【참고】 잘 먹는 음식: ${foods.liked ?? "-"} / 연습하고 싶은 음식: ${foods.practice ?? "-"}` : ""),
    (metrics.quality === "low_face"
      ? "【주의】 영상에서 얼굴·입이 충분히 보이지 않아 영상 지표는 근거로 쓸 수 없습니다. 설문 응답만으로 설명하세요."
      : ""),
    "위 사실만 근거로, primary_action · evidence · keep_as_is · next_observation 을 JSON으로 주세요.",
  ].filter(Boolean).join("\n\n");

  let data: any = null;
  try {
    const r = await fetch(base + "/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0.5,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
      }),
    });
    if (!r.ok) return json({ ok: false, error: `llm_${r.status}`, detail: (await r.text()).slice(0, 300) }, 200);
    const msg = await r.json();
    const text = msg?.choices?.[0]?.message?.content || "";
    data = parseJson(text);
  } catch (e) {
    return json({ ok: false, error: "generation_failed", detail: String(e).slice(0, 300) }, 200);
  }

  const pa = (data && data.primary_action && typeof data.primary_action === "object") ? data.primary_action : {};
  if (!pa.title) return json({ ok: false, error: "empty" }, 200);

  /* ── 응답 정규화 ────────────────────────────────────────────────
     ① 처방 스키마의 모든 필드를 보장한다(클라이언트가 전제하는 모양).
     ② evidence 는 source 가 허용 목록에 있고 ref 가 **실제 입력에 있을 때만** 남긴다
        → 지어낸 근거가 화면에 오르지 않는다. 이 필터가 v6 의 안전장치다.
     ③ missing_information·safety_note 는 LLM 결과를 쓰지 않고 서버가 채운다.
     ④ 레거시 4필드(action·firstCheck·tips·watch)를 파생 투영해 함께 반환한다
        → 기존 클라이언트·저장 스키마·관리자 화면이 그대로 동작한다. */
  const str = (v: unknown, fallback = "") => {
    const s = (typeof v === "string") ? v.trim() : "";
    return s || fallback;
  };
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter((s) => s.length > 0) : []);

  const evidence = (Array.isArray(data.evidence) ? data.evidence : [])
    .map((e: any) => ({ source: str(e && e.source), ref: str(e && e.ref), text: str(e && e.text) }))
    .filter((e: any) => e.text && SOURCES.indexOf(e.source) >= 0 && refs.has(e.ref))
    .slice(0, 8);
  const dropped = (Array.isArray(data.evidence) ? data.evidence.length : 0) - evidence.length;

  const nx = (data.next_observation && typeof data.next_observation === "object") ? data.next_observation : {};
  const primary = {
    title: str(pa.title),
    reason: str(pa.reason, "이번 영상과 알려주신 답변에서 보인 모습을 바탕으로 정리했어요."),
    how_to: arr(pa.how_to).slice(0, 5),
  };
  if (!primary.how_to.length) primary.how_to = [primary.title];   // 실행 순서가 비면 핵심 한 줄이라도 남긴다
  /* ★ B단계 — coaching_input 이 정한 '바꿀 한 가지'는 LLM 이 바꿀 수 없다.
     표현을 다듬는 것은 허용하지만, 규칙이 정한 행동에서 벗어났는지는 클라이언트가
     rule_id 로 다시 확인한다. 여기서는 제목이 비면 규칙의 제목으로 되돌린다.
     (LLM 이 빈 제목이나 전혀 다른 종류의 행동을 낼 때의 안전판) */
  if (ci && ci.primary_action && ci.primary_action.title) {
    if (!primary.title) primary.title = String(ci.primary_action.title);
    if (!arr(pa.how_to).length) primary.how_to = A(ci.primary_action.how_to).map((x: unknown) => str(x)).filter(Boolean);
  }

  const coach: Record<string, unknown> = {
    source: "ai",
    primary_action: primary,
    evidence: evidence,
    keep_as_is: str(data.keep_as_is, (ci && ci.keep_as_is) || "한 번에 여러 가지를 바꾸지 않아도 돼요. 위의 한 가지만 바꾸고 나머지는 그대로 두세요."),
    /* missing_information — LLM 결과를 쓰지 않는다.
       coaching_input 이 있으면 그것(가드가 막은 이유까지 담긴 목록)을 우선한다. */
    missing_information: (ci && Array.isArray(ci.missing_information) && ci.missing_information.length)
      ? ci.missing_information.slice(0, 4) : missing,
    next_observation: {
      period: str(nx.period, (ci && ci.next_observation && ci.next_observation.period) || "다음 2~3회 식사"),
      items: (arr(nx.items).length ? arr(nx.items) : A(ci && ci.next_observation && ci.next_observation.items).map((x: unknown) => str(x)).filter(Boolean)).slice(0, 3),
    },
    // 안전 문구는 검수된 고정 문구만. 안전 신호가 들어왔으면 게이팅 문구로 바꾼다.
    safety_note: (ci && A(ci.safety_flags).length)
      ? SAFETY_NOTES.gated
      : (SAFETY_NOTES[String((survey.concern) ?? "")] ?? SAFETY_NOTES.default),
    // 규칙 추적 — 어느 규칙이 이 처방을 만들었는지(관리자 검수·재현용)
    rule_id: (ci && ci.primary_action && ci.primary_action.rule_id) || null,
    allowed_actions: A(ci && ci.allowed_actions),
    prohibited_actions: A(ci && ci.prohibited_actions),
    // 레거시 투영(하위호환) — 같은 내용을 두 번 생성하지 않기 위해 파생시킨다
    action: primary.title,
    firstCheck: primary.reason,
    tips: primary.how_to,
    watch: (arr(nx.items).slice(0, 3).join(" · ")) || "같은 상황에서 아이의 반응이 달라지는지",
    // 진단용 — 몇 개의 근거가 검증에서 걸러졌는지(프롬프트 준수도 추적)
    _meta: { facts: facts.length, evidence_dropped: Math.max(0, dropped) },
  };
  return json({ ok: true, coach });
});
