import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ⚠ 롤백 전용 — 2026-07-28 배포 직전의 운영본(version 3) 원본입니다. 수정하지 마세요.
//   MCP get_edge_function 으로 내려받아 그대로 보존했습니다.
//   되돌리려면 이 파일을 ../index.ts 로 복사한 뒤 배포하세요.
//     cp _rollback/index.v3.ts index.ts
//     supabase functions deploy coach --project-ref qwfskemfsrkmlrdttvqy
//
//   ⚠ 이 v3 에는 한글 인코딩 깨짐이 있습니다(씨기·뀥기·바할·배고플·삼키 곤란).
//     의도적으로 보존한 것입니다 — 롤백은 '깨진 상태로 정확히 되돌리는' 것이 목적입니다.

// coach: 식사 분석 '결과 코칭'을 LLM으로 개인화 (LETSUR AI 게이트웨이, OpenAI 호환).
// 하이브리드: 가능성(possibility)·안전 판정은 클라이언트 규칙엔진이 결정, 이 함수는 그 위에서 문장과 팁을 개인화.
// 키(LETSUR_API_KEY) 없으면 no_api_key → 클라이언트가 규칙엔진 결과를 그대로 사용.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function parseJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

const SYSTEM = [
  "당신은 Chewstep의 이유식·유아식 식사 코치입니다. 아이의 식사 분석 결과를 보호자에게 설명합니다.",
  "원칙: 씨기는 연습이 필요한 능력이다 · 월령보다 현재 단계를 본다 · 뀥기·머금기는 탐색 과정이다 · 경험이 먼저다.",
  "규칙: 의료 진단·치료·질병명·약물을 언급하지 않는다. 정상·이상 판정하지 않는다. 사레·삼키 곤란 같은 안전 신호는 다루지 않는다. 보호자가 다음 식사에서 바로 할 수 있는 구체 행동만. 한국어, 따뜻하고 쉽게.",
  "출력은 JSON 객체 하나만, 코드펜스·설명 없이 반환:",
  '{"firstCheck": "가장 먼저 확인할 점 1문장", "action": "다음 식사에서 바할 핵심 한 가지 1문장", "tips": ["바로 할 수 있는 행동 3~5개", ""], "watch": "지켜볼 변화 1문장"}',
].join("\n");

const LABELS: Record<string, string> = {
  texture: "질감·크기", interval: "식사 간격·배고플", repetition: "익숙함·반복 노출", expectation: "기대 섭취량", unclear: "판단 제한",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const key = Deno.env.get("LETSUR_API_KEY") || Deno.env.get("LLM_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, error: "no_api_key" }, 200);
  const base = Deno.env.get("LLM_BASE_URL") || "https://gw.letsur.ai";
  const model = Deno.env.get("LLM_MODEL") || "claude-sonnet-4-6";

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (body.safetyOn === true) return json({ ok: false, error: "safety_gated" }, 200);

  const possibility = String(body.possibility ?? "unclear");
  const label = String(body.label ?? LABELS[possibility] ?? "");
  const survey = (body.survey && typeof body.survey === "object") ? body.survey : {};
  const foods = (body.foods && typeof body.foods === "object") ? body.foods : {};
  const metrics = (body.metrics && typeof body.metrics === "object") ? body.metrics : {};

  const userMsg = [
    `possibility: ${possibility} (${label})`,
    (body.age_months != null ? `월령: ${body.age_months}개월` : ""),
    `지표: 분당 씨기 약 ${metrics.cpm ?? "?"}회, 품질 ${metrics.quality ?? "?"}`,
    `설문: 고민=${survey.concern ?? "-"}, 음식형태=${survey.food_form ?? "-"}, 행동=${survey.behavior ?? "-"}`,
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
  data.tips = Array.isArray(data.tips) ? data.tips.slice(0, 6) : [];
  return json({ ok: true, coach: data });
});
