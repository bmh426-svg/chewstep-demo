// recipe.js — 식감 연결 레시피 클라이언트 (웹 데모용).
// recipe-coach Edge Function(Claude) 호출 → 실패/키없음/오프라인 시 안전한 규칙 템플릿으로 폴백.
// 원칙: 익숙한 음식의 형태로 어려운 식감을 조금씩 경험하게 하는 '연결 레시피'(숨기기 아님).
// 반환 형태: { source:'ai'|'template', recipes:[ {approach, suitable, menu, reason, firstTry[], nextStep, caution, note} ] }
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/assets/js/config.js";

const FN = SUPABASE_URL + "/functions/v1/recipe-coach";

// API 키 없이도 만들 수 있는 3가지 접근법(규칙 기반). liked=잘 먹는 음식, practice=연습할 음식.
// 음식에 숨겨 섞거나 현재 단계를 낮추지 않고, 아이가 무엇을 경험하는지 알 수 있게 따로 제시한다.
function templateRecipes(liked, practice, context) {
  const L = liked, P = practice;
  const form = (context && context.food_form) || "";
  const stage = {
    ground:"현재의 갈아 만든 형태", mashed:"현재의 으깬 형태", small_bits:"현재의 작은 알갱이 형태",
    soft:"현재의 무른 유아식 형태", regular:"현재의 일반식 형태"
  }[form] || "현재 편하게 먹는 형태";
  return [
    {
      approach: "나란히 두기",
      suitable: true,
      menu: `${L} 옆에 ${P} 한 조각`,
      reason: `잘 먹는 ${L}은 안심 음식으로 두고, ${P}는 따로 보여 아이가 직접 탐색하고 선택하게 해요.`,
      firstTry: [
        `${L}를 평소처럼 준비해요.`,
        `${P}는 ${stage}를 유지해 한 조각만 접시 한쪽에 따로 둬요.`,
        `먹으라고 재촉하지 않고 보고·냄새 맡고·만지는 반응을 기다려요.`,
      ],
      nextStep: `표정과 몸이 편안해지면 ${P}를 입에 대보거나 한입 먹을지 아이가 고르게 해요.`,
      caution: `숨겨 섞거나 억지로 먹이지 말고, 아이가 멈추면 그날은 끝내요.`,
      note: "",
    },
    {
      approach: "함께 준비하기",
      suitable: true,
      menu: `${P} 탐색 접시 만들기`,
      reason: `먹기 전에 ${P}를 옮기고 냄새 맡는 경험을 넣어, 식탁에서 처음 마주하는 부담을 낮춰요.`,
      firstTry: [
        `${P}를 ${stage}로 준비해요.`,
        `아이에게 접시로 옮기거나 숟가락으로 건드리는 일을 맡겨요.`,
        `완성한 뒤 ${L} 옆에 따로 두고, 먹지 않아도 참여한 것을 성공으로 봐요.`,
      ],
      nextStep: `같은 준비 과정을 며칠 반복한 뒤 입에 대볼지 물어봐요.`,
      caution: `칼·불 등 조리 과정은 보호자가 맡고, 아이는 안전한 탐색만 하게 해요.`,
      note: "",
    },
    {
      approach: "가족과 반복하기",
      suitable: true,
      menu: `가족 식탁의 ${P}`,
      reason: `가족이 같은 음식을 편안하게 먹는 모습을 보며 ${P}를 익숙한 식탁 경험으로 만들어요.`,
      firstTry: [
        `가족도 ${P}를 식탁에 함께 올려요.`,
        `맛과 냄새를 평가하거나 먹으라고 설득하지 않고 자연스럽게 먹는 모습을 보여요.`,
        `아이 접시에는 ${P}를 한 조각만 따로 두고 한 번만 권해요.`,
      ],
      nextStep: `${P}를 보고·만지는 반응이 편해지면 같은 방법으로 다시 만나요.`,
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

function hasStageRegression(recipe, context) {
  const form = (context && context.food_form) || "";
  if (form !== "soft" && form !== "regular") return false;
  const text = JSON.stringify(recipe || {}).replace(/<[^>]+>/g, "");
  return /믹서|곱게\s*갈|갈아서|포크로\s*(거칠게\s*)?으깨|매시|죽에\s*섞|알갱이를\s*남기|형태를\s*낮/.test(text);
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
    if (j && j.ok && j.recipe && !hasStageRegression(j.recipe, context)) return { source: "ai", recipes: [normalizeAi(j.recipe)] };
  } catch (e) { /* 오프라인 등 — 템플릿 폴백 */ }
  return { source: "template", recipes: templateRecipes(liked, practice, context) };
}
