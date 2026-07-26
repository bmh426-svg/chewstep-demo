// iddsi.js — 음식 형태를 국제 기준(IDDSI)으로 표시하는 축
// ─────────────────────────────────────────────────────────────────────
// ■ 왜 IDDSI만 쓰는가 (2026-07-26 결정)
//   자사 임의 레벨 체계(부모가이드의 BTDS 0·0.5·1~5)는 **대외 근거로 쓰지 않는다.**
//   - 아이에게 등급을 매기는 체계는 검증된 근거가 없고, 발달 판정처럼 읽힌다(의료 판단 경계 침범).
//   - IDDSI는 **음식·음료의 물성**을 기술하는 국제 표준이고, 공개된 테스트 방법이 있다.
//   → 이 파일이 기술하는 대상은 **아이가 아니라 '지금 주고 있는 음식의 형태'** 다.
//
// ■ 표기 원칙
//   ✅ "지금 주고 계신 음식 형태 = IDDSI Level 5(잘게 다져 촉촉)"
//   ❌ "우리 아이는 Level 5 단계입니다"   ← 아이를 등급화하지 않는다
//
// ■ 출처 (2026-07-26 원문 대조 완료)
//   IDDSI Complete Framework Detailed Definitions 2.2 (April 2026), iddsi.org
//   ✅ 수치·테스트 문구는 위 PDF 원문에서 옮겼다. 임의로 바꾸지 말 것.
//   ⚠ 라이선스: CC BY-SA 4.0. **언어 번역을 넘어서는 파생물(요약·재구성·변형)은 허용되지 않는다.**
//     → 화면·인쇄물에 이 표를 쓰면 IDDSI_ATTRIBUTION 을 반드시 함께 노출한다.
//     → 우리 말로 '요약'한 문구는 파생물로 볼 소지가 있어, 되도록 원문 직역에 가깝게 유지한다.

export const IDDSI_ATTRIBUTION =
  "© The International Dysphagia Diet Standardisation Initiative 2019 @ https://iddsi.org/ " +
  "Licensed under the CreativeCommons Attribution Sharealike 4.0 License " +
  "(Complete IDDSI Framework Detailed Definitions 2.2 | April 2026)";

export const IDDSI = [
  {
    lv: 3, en: "Liquidised", ko: "마실 수 있는 묽은 형태",
    sizeKo: "덩어리 없음", ped: null, adult: null,
    test: "포크 드립 테스트 — 포크 살 사이로 뚝뚝(dollop) 천천히 떨어지고, 포크로 눌러도 자국이 남지 않음",
    note: "숟가락을 기울이면 쉽게 흘러내리고 숟가락에 붙지 않는다. 씹기가 필요 없는 상태.",
  },
  {
    lv: 4, en: "Pureed", ko: "완전히 곱게 간 형태",
    sizeKo: "덩어리 없음", ped: null, adult: null,
    test: "포크 드립 테스트 — 포크 위에 산처럼 얹히고, 살 아래로 짧은 꼬리 정도만 생길 뿐 계속 흘러내리지 않음",
    note: "포크로 누르면 자국이 선명하게 남는다. 씹기·베어물기가 필요 없는 상태.",
  },
  {
    lv: 5, en: "Minced & Moist", ko: "잘게 다져 촉촉한 형태",
    // ⚠ 원문: Paediatric, equal to or less than 2 mm width and no longer than 8 mm in length
    sizeKo: "덩어리 폭 2mm 이하 · 길이 8mm 이하 (소아 기준)",
    ped: { w: 2, l: 8 }, adult: { w: 4, l: 15 },
    test: "포크 압력 테스트 — 포크 살 사이로 쉽게 뭉개져 빠져나옴 (포크 살 간격이 대략 4mm)",
    note: "⚠ 소아는 폭 2mm·길이 8mm, 성인은 폭 4mm·길이 15mm 로 기준이 다르다. 우리 대상은 소아 기준. 혀 힘만으로 눌러 으깰 수 있는 상태.",
  },
  {
    lv: 6, en: "Soft & Bite-Sized", ko: "부드러운 한입 크기",
    // ⚠ 원문: Paediatric, 8 mm pieces (no larger than) / Adults, 15 mm = 1.5 cm pieces
    sizeKo: "한 조각 8mm 이하 (소아 기준)",
    ped: { w: 8, l: 8 }, adult: { w: 15, l: 15 },
    test: "포크 압력 테스트 — 엄지손톱 크기(1.5×1.5cm) 조각을 엄지손톱이 하얘질 만큼 누르면 으스러지고 원래 모양으로 돌아오지 않음",
    note: "⚠ 소아 8mm · 성인 15mm. 베어무는 힘은 필요 없지만 씹기는 필요한 상태. 조각 크기 제한은 질식 위험을 줄이기 위한 것.",
  },
  {
    lv: 7, en: "Regular / Easy to Chew", ko: "일반 음식",
    sizeKo: "크기 제한 없음", ped: null, adult: null,
    test: "—",
    note: "Level 7은 Regular(일반)와 Easy to Chew(부드러운 일반식) 두 갈래다. ⚠ 원문 주의: 안전하게 먹기 위해 지켜봐 줄 사람이 필요한 경우에는 이 단계를 쓰기 전에 전문가와 상의하도록 되어 있다.",
  },
];

export function levelInfo(lv) {
  return IDDSI.find(x => x.lv === lv) || null;
}

/* 설문 v3 값 → '지금 주고 있는 음식 형태'의 IDDSI 근사값
   ⚠ 근사(≈)다. 설문 선택지는 IDDSI 테스트로 측정한 값이 아니라 보호자의 자기보고다.
     그래서 화면에도 "대략 이 형태에 해당해요"로만 쓰고, 판정처럼 말하지 않는다.
   ⚠ 특히 '작은 알갱이'는 보호자가 2mm(L5)인지 8mm(L6)인지 구분하기 어렵다 → 보수적으로 L5로 본다.
   - food_form    = 지금 주고 있는 형태
   - chew_ceiling = 무리 없이 먹는 가장 단단한 음식(= 감당 가능한 상한)
   둘 중 **낮은 쪽**을 택한다 — 더 쉬운 형태를 권하는 쪽이 항상 안전하다. */
const BY_FORM = { ground: 4, mashed: 5, small_bits: 5, soft: 6, regular: 7 };
const BY_CEILING = { tofu: 5, veg: 6, rice_egg: 6, minced_meat: 6, regular: 7 };

/* ── 월령은 '판정 축'이 아니라 '대조 축' ────────────────────────────
   월령으로 형태를 **정해버리면** ① 설문할 이유가 없어져 일반 유아식 커머스와 같아지고
   ② 아직 못 먹는 아이에게 큰 조각 도구를 권하게 된다. 그래서 참고 앵커로만 쓴다.

   🔎 밴드 근거 — 질병관리청 국가건강정보포털 '이유기보충식(이유식)' (2026-07-26 확인):
     · 6개월  "데쳐서 거르거나 으깨거나 반고형식을 먹을 수 있으며"      → L4~5
     · 8개월  "혼자 손으로 음식을 집어 먹을 수 있게 되고"
     · 9개월  "손으로 집어 먹을 수 있는 음식을 주어"(핑거푸드)          → L5~6
     · "10개월까지도 단단한 덩어리 음식을 시작하지 않으면 이후 섭식 장애가 발생할 수도 있으므로"
     · 12개월 "다른 가족이 먹는 음식을 함께 먹을 수 있습니다"           → L6~7
   ⚠ 임상 진단 기준이 아니라 일반 안내다. 화면에서는 "보통 이 시기엔 ~가 많아요" 수준으로만 쓴다. */
export function typicalRangeForAge(months) {
  const m = Number(months);
  if (!m || m < 6) return null;      // 이유식 시작 전 → 대조하지 않는다
  if (m < 9) return [4, 5];
  if (m < 12) return [5, 6];
  if (m < 24) return [6, 7];
  return [7, 7];
}
/* 설문이 없을 때의 최후 폴백(화면 표시 금지) — 범위의 하한을 쓴다(보수적). */
export function ageToLevel(months) {
  const r = typicalRangeForAge(months);
  return r ? r[0] : null;
}

/* 지금 주는 형태 vs 보통 이 시기 형태
   반환: null | { status:'behind'|'typical'|'ahead', range, typicalInfo }
   ⚠ 표현 경계: '늦었다 / 또래보다 느리다 / 발달 지연' 금지.
     behind 여도 "한 칸 올려볼 수 있어요" 라는 실행 제안으로만 쓴다. */
export function compareWithAge(level, months) {
  const r = typicalRangeForAge(months);
  if (level == null || !r) return null;
  const status = level < r[0] ? "behind" : (level > r[1] ? "ahead" : "typical");
  return { status, range: r, typical: r[0], typicalInfo: levelInfo(r[0]), topInfo: levelInfo(r[1]) };
}

export function estimateLevel(ctx) {
  const c = ctx || {};
  const l1 = (c.survey && c.survey.lens01) || {};
  const a = BY_FORM[l1.food_form];
  const b = BY_CEILING[l1.chew_ceiling];
  let level = null, source = null;
  if (a != null && b != null) { level = Math.min(a, b); source = "survey"; }
  else if (a != null || b != null) { level = (a != null ? a : b); source = "partial"; }
  else { level = ageToLevel(c.ageMonths); source = level == null ? null : "age"; }
  return { level, info: level == null ? null : levelInfo(level), source };
}

/* 상품이 이 형태에 맞는가 — item.iddsi = [min, max] (없으면 형태 무관) */
export function fitsLevel(item, level) {
  if (level == null || !item || !item.iddsi) return true;
  return level >= item.iddsi[0] && level <= item.iddsi[1];
}

export default { IDDSI, IDDSI_ATTRIBUTION, levelInfo, estimateLevel, ageToLevel, typicalRangeForAge, compareWithAge, fitsLevel };
