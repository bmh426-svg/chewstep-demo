import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// coach: 식사 분석 '결과 코칭'을 LLM으로 개인화 (LETSUR AI 게이트웨이, OpenAI 호환).
// 하이브리드: 가능성(possibility)·안전 판정은 클라이언트 규칙엔진이 결정, 이 함수는 그 위에서 문장과 팁을 개인화.
// 키(LETSUR_API_KEY) 없으면 no_api_key → 클라이언트가 규칙엔진 결과를 그대로 사용.
//
// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 운영 배포본입니다(2026-07-28 v4 배포). verify_jwt=false 유지 필수 —
// 클라이언트는 publishable key(JWT 아님)를 보내므로 JWT 검증을 켜면 전부 401 이 됩니다.
//
// 배포:  supabase functions deploy coach --project-ref qwfskemfsrkmlrdttvqy
// 롤백:  cp _rollback/index.v3.ts index.ts  후 위 배포 명령 (v3 원본 그대로 보존돼 있음)
// 검증:  cd verify && node coach-contract-check.mjs
//
// 변경 이력
//  v5 (2026-07-29) 시크릿 값 정리(cleanKey) — 대시보드에 붙여넣을 때 따라 들어오는
//    앞뒤 공백·개행·감싼 따옴표·BOM·제로폭 문자를 제거한 뒤 게이트웨이에 보낸다.
//    (키 값은 맞는데 llm_401 이 나는 사고를 막는다. LLM_BASE_URL·LLM_MODEL 도 같이 정리)
//  v4 (2026-07-28) 사용자 테스트 피드백 #6 — 음식 단계 게이팅
//    · body.food_stage(코드·단계명·순서·허용/금지 조언)를 받아 프롬프트에 강한 조건으로 주입
//    · "현재 단계보다 이전 단계의 조언은 제공하지 않는다" 규칙을 SYSTEM에 명시
//    · 기존에는 food_form 코드("soft")만 넘겨 LLM이 단계를 이해할 수 없었다
//    · SYSTEM 프롬프트의 인코딩 깨짐 복구
//      (씨기→씹기, 뀥기→뱉기, 바할→바꿀, 배고플→배고픔, 삼키 곤란→삼킴 곤란)
//      ※ '머금기'(입에 물고 있기)는 깨짐이 아니라 의도한 단어 — 그대로 둔다
//    · 알레르기(body.allergies) 수신 + 프롬프트에 절대 언급 금지 지시 추가
//      (recipe-coach 는 이미 받는데 coach 만 못 받아 재료를 이름으로 권할 수 있었다)
//    · 응답 4개 필드(firstCheck·action·tips·watch) 누락 방지 정규화 + charset=utf-8 명시
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

const SYSTEM = [
  "당신은 Chewstep의 이유식·유아식 식사 코치입니다. 아이의 식사 분석 결과를 보호자에게 설명합니다.",
  "원칙: 씹기는 연습이 필요한 능력이다 · 월령보다 현재 단계를 본다 · 뱉기·머금기는 탐색 과정이다 · 경험이 먼저다.",
  "규칙: 의료 진단·치료·질병명·약물을 언급하지 않는다. 정상·이상 판정하지 않는다. 사레·삼킴 곤란 같은 안전 신호는 다루지 않는다. 보호자가 다음 식사에서 바로 할 수 있는 구체 행동만. 한국어, 따뜻하고 쉽게.",
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
  "출력은 JSON 객체 하나만, 코드펜스·설명 없이 반환:",
  '{"firstCheck": "가장 먼저 확인할 점 1문장", "action": "다음 식사에서 바꿀 핵심 한 가지 1문장", "tips": ["바로 할 수 있는 행동 3~5개", ""], "watch": "지켜볼 변화 1문장"}',
].join("\n");

const LABELS: Record<string, string> = {
  texture: "질감·크기", interval: "식사 간격·배고픔", repetition: "익숙함·반복 노출", expectation: "기대 섭취량", unclear: "판단 제한",
};

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

  // 음식 단계 블록 — 코드만 주면 LLM이 단계를 오해하므로 단계명·순서·허용/금지를 함께 명시한다.
  const stageBlock = stage
    ? [
        `【현재 음식 단계】 ${stage.label ?? stage.code ?? "-"} (코드 ${stage.code ?? "-"}, ${Number(stage.order ?? 0) + 1}/${stage.total ?? 5}단계)`,
        `이 단계에서 권할 수 있는 조언: ${(Array.isArray(stage.allow) ? stage.allow : []).join(" / ") || "-"}`,
        `이 단계에 제시하면 안 되는 조언(이전 단계로 후퇴): ${(Array.isArray(stage.forbid) ? stage.forbid : []).join(" / ") || "-"}`,
        "firstCheck·action·tips 전부 위 '권할 수 있는 조언' 범위 안에서만 쓰세요.",
      ].join("\n")
    : "【현재 음식 단계】 보호자가 알려주지 않았습니다 — 형태를 바꾸라는 조언은 피하고, 한 입 양·속도·환경 쪽으로만 제안하세요.";

  // 알레르기 — 없으면 그 줄 자체를 넣지 않는다(빈 값이 '없음'으로 오해되지 않게 명시)
  const allergies = String(body.allergies ?? "").trim();
  const allergyBlock = allergies
    ? `【알레르기 — 절대 언급 금지】 ${allergies}\n위 재료와 그 재료로 만든 음식을 예시로 들지 마세요. 재료 이름 없이 조언하세요.`
    : "";

  const userMsg = [
    `possibility: ${possibility} (${label})`,
    (body.age_months != null ? `월령: ${body.age_months}개월` : ""),
    `지표: 분당 씹기 약 ${metrics.cpm ?? "?"}회, 품질 ${metrics.quality ?? "?"}`,
    `설문: 고민=${survey.concern ?? "-"}, 음식형태=${survey.food_form ?? "-"}, 행동=${survey.behavior ?? "-"}`,
    stageBlock,
    allergyBlock,
    (foods.liked || foods.practice ? `잘 먹는: ${foods.liked ?? "-"} / 연습: ${foods.practice ?? "-"}` : ""),
    (body.concern_text ? `메모: ${String(body.concern_text).slice(0, 200)}` : ""),
    "위 아이에게 맞춰 firstCheck·action·tips·watch를 JSON으로 주세요.",
  ].filter(Boolean).join("\n");

  let data: any = null;
  try {
    const r = await fetch(base + "/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 900,
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

  if (!data || !data.action) return json({ ok: false, error: "empty" }, 200);

  /* 응답 정규화 — 클라이언트가 4개 필드를 전제로 렌더하므로 누락을 만들지 않는다.
     생성 결과가 일부 필드를 빼먹어도 여기서 채운다(빈 문자열이 아니라 의미 있는 기본값).
     tips 는 배열 보장 + 빈 문자열 제거 + 최대 6개. */
  const str = (v: unknown, fallback = "") => {
    const s = (typeof v === "string") ? v.trim() : "";
    return s || fallback;
  };
  const coach = {
    firstCheck: str(data.firstCheck, "이번 식사에서 아이가 어떤 형태를 편하게 먹었는지 먼저 살펴보세요."),
    action: str(data.action),                     // 위에서 존재를 이미 확인함
    tips: (Array.isArray(data.tips) ? data.tips : [])
      .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
      .filter((t: string) => t.length > 0)
      .slice(0, 6),
    watch: str(data.watch, "같은 상황에서 아이의 반응이 달라지는지 지켜봐 주세요."),
  };
  if (!coach.tips.length) coach.tips = [coach.action];   // 팁이 비면 핵심 행동 한 줄이라도 남긴다
  return json({ ok: true, coach });
});
