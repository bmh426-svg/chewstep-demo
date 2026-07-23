// recipe.js — 식감 연결 레시피 클라이언트 (웹 데모용).
// recipe-coach Edge Function(Claude) 호출 → 실패/키없음/오프라인 시 안전한 규칙 템플릿으로 폴백.
// 원칙: 익숙한 음식의 형태로 어려운 식감을 조금씩 경험하게 하는 '연결 레시피'(숨기기 아님).
// 반환 형태: { source:'ai'|'template', recipes:[ {approach, suitable, menu, reason, firstTry[], nextStep, caution, note} ] }
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/assets/js/config.js";

const FN = SUPABASE_URL + "/functions/v1/recipe-coach";

// API 키 없이도 만들 수 있는 3가지 접근법(규칙 기반). liked=잘 먹는 음식, practice=연습할 음식.
function templateRecipes(liked, practice) {
  const L = liked, P = practice;
  return [
    {
      approach: "섞기",
      suitable: true,
      menu: `${L}에 ${P} 조금 섞기`,
      reason: `잘 먹는 ${L}에 ${P}를 아주 조금 섞어, 익숙한 맛 속에서 새로운 식감을 자연스럽게 만나게 해요.`,
      firstTry: [
        `${L}를 평소처럼 준비해요`,
        `${P}는 아주 잘게 다지거나 부드럽게 익혀요`,
        `${L} 90%에 ${P} 10%만 섞어 1~2숟가락부터 시작해요`,
      ],
      nextStep: `잘 먹으면 ${P}의 비율을 조금씩 높여요.`,
      caution: `억지로 섞지 말고, 아이가 부담스러워하면 양을 줄여요.`,
      note: "",
    },
    {
      approach: "형태 바꾸기",
      suitable: true,
      menu: `${P}를 ${L}처럼 부드럽게`,
      reason: `아이가 편해하는 ${L}의 형태·질감을 ${P}에도 적용해, 낯선 음식을 익숙한 방식으로 경험하게 해요.`,
      firstTry: [
        `${P}를 ${L}과 비슷한 질감(곱게 다지거나 갈기)으로 만들어요`,
        `간과 모양을 ${L}과 비슷하게 맞춰요`,
        `처음엔 작은 한 입 크기로 제공해요`,
      ],
      nextStep: `익숙해지면 ${P} 본래의 형태에 조금씩 가깝게 만들어요.`,
      caution: `삼키기 어려운 크기·질감은 피하고 아이 씹기 수준에 맞춰요.`,
      note: "",
    },
    {
      approach: "곁들이기",
      suitable: true,
      menu: `${L} 옆에 ${P} 한 입`,
      reason: `믿고 먹는 ${L}을 '안심 음식'으로 두고, 그 옆에서 ${P}를 부담 없이 한 입씩 시도하게 해요.`,
      firstTry: [
        `한 접시에 ${L}과 ${P}를 따로 담아요`,
        `${L}를 먼저 먹어 편안한 분위기를 만들어요`,
        `${L} 한 입 → ${P} 한 입을 번갈아 권해요(강요 없이)`,
      ],
      nextStep: `${P}를 스스로 집는 횟수가 늘면 양을 조금씩 늘려요.`,
      caution: `거부하면 물러나고 다음 기회를 기다려요.`,
      note: "",
    },
  ];
}

// 엣지 함수(AI) 단일 레시피 → 공통 형태로 정규화
function normalizeAi(r) {
  return {
    approach: r.approach || "맞춤 제안",
    suitable: r.suitable !== false,
    menu: r.menu || "",
    reason: r.reason || "",
    firstTry: Array.isArray(r.firstTry) ? r.firstTry : [],
    nextStep: r.nextStep || "",
    caution: r.caution || "",
    note: r.note || "",
  };
}

// liked/practice + 맥락 → 레시피 목록. 반환: { source:'ai'|'template', recipes:[...] }
export async function fetchRecipe(liked, practice, context) {
  liked = (liked || "").trim(); practice = (practice || "").trim();
  if (!liked || !practice) return null;
  try {
    const r = await fetch(FN, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ liked, practice, context: context || {} }),
    });
    const j = await r.json();
    if (j && j.ok && j.recipe) return { source: "ai", recipes: [normalizeAi(j.recipe)] };
  } catch (e) { /* 오프라인 등 — 템플릿 폴백 */ }
  return { source: "template", recipes: templateRecipes(liked, practice) };
}
