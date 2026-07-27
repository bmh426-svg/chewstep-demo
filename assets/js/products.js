// products.js — 결과 연동 '연습 준비물'(제품) 추천 엔진 (B2C 데모)
// ─────────────────────────────────────────────────────────────────────
// v0.5 (2026-07-26) — 월령=대조축 · v0.4: IDDSI 형태축/영상 비의존 · v0.2: 비식품 우선/세트/record
// 설계 문서: B2C/PRD/제품추천-설계-v0.5.md · 구조도: B2C/PRD/제품추천-구조도.html
//
// ■ 연결 공식 (이걸 못 지키는 상품은 자사몰에 있어도 결과화면에 띄우지 않는다)
//     관찰된 어려움 → 이번 식사의 행동 1개 → 집에서 하는 방법 → 번거로울 때 쓰는 준비물
//   제품은 '진단'이 아니라 결과의 **행동 세트(T01·E01·Q01)** 에 붙는다. 그래서 homeFirst는 필수 필드다.
//
// ■ Phase 1 / Phase 2  (v0.2 핵심 변경)
//   Phase 1 = 비식품 도구 + 가이드 콘텐츠 + 시중 식재료 활용법 → 지금 판다.
//   Phase 2 = 식품 완제품(사다리 팩·소스·소분 식품) → 유통기한·냉장배송·알레르기·제조책임 때문에 보류.
//             PHASE2_ENABLED=false 인 동안 결과화면에 뜨지 않는다. 켤 때는 label(나트륨·당류·알레르기·월령) 필수.
//
// ■ 두 개의 층
//   ① 식사 준비물 — goal(texture/repetition/expectation). 영상 결과가 있으면 그걸 쓰고,
//      없거나 unclear면 **설문의 고민만으로** goal을 뽑는다(goalFromSurvey). → 영상 없이도 추천이 선다.
//   ② 기록·촬영 준비물(record) — v0.4에서 강등. **영상 품질이 낮을 때만** 1개.
//      (영상은 퍼포먼스 층이므로 촬영 장비를 기본 노출하지 않는다)
//
// ■ 게이팅 (하나라도 걸리면 해당 층 비노출)
//   1) safety_alert=true → ①② 전부 차단
//   2) interval(H01) → ① 차단 (덜 먹이라는 조언에 상품을 붙이면 논리가 깨짐)
//   3) 고민도 없고 영상 결과도 없음 → ① 차단
//   4) 알레르기 재료 · 월령 범위 밖 · 음식 형태(IDDSI) 불일치 → 해당 상품 제외
//   5) Phase 2 비활성 → 식품 전부 제외
//
// ■ 결과에 붙이지 않는 것(SUPPORT): 환경·자세·보호자 대응 — 결과설계 §1에서 판단범위 '보류'라 근거가 없다.
//   4주 프로그램 구성품 또는 무료 다운로드 자료로만 쓴다.
//
// ■ 표현 경계: 치료·개선·발달 금지. "연습 / 준비물 / 이 단계에서 보통 쉬워하는 형태"까지만.
//
// ■ 형태 축 = IDDSI (v0.4) — 월령이 아니라 '지금 주고 있는 음식 형태'로 매칭한다.
//   상품의 iddsi:[min,max] 는 국제 표준 IDDSI Level 3~7 기준. → iddsi.js
//   ⚠ 자사 임의 레벨(BTDS 0~5)은 대외 근거로 쓰지 않는다 — 아이를 등급화하지 않는다.

import { estimateLevel, fitsLevel, compareWithAge } from "./iddsi.js";

export const PHASE2_ENABLED = false;   // 식품 완제품 판매 준비되면 true

/* 커머스 킬 스위치 — 설계 문서 §10.
   지금은 '사람을 모으는' 단계(데모체험·상담 중심)라, 추천이 방해가 된다고 판단되면 이 한 줄로 전부 끈다.
   끄면 형태 안내와 행동 코칭은 그대로 남고 상품 카드·프로그램 배너만 사라진다.
   (신뢰 지표 '추천을 광고처럼 느꼈는지'가 기준을 넘을 때도 여기를 끈다.) */
export const PRODUCTS_ENABLED = true;

/* ── 세트(번들) — 우선순위 tier 1·2·3. 결과화면에서 단품보다 먼저 보여준다 ──
   사용자 우선순위: 1) 반복 노출 실행 2) 식감 조절 3) 기록·촬영 */
export const BUNDLES = [
  {
    id: "set-exposure", kind: "bundle", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "반복 노출 실행 세트",
    sub: "5g·10g 소분 트레이 + 15회 접촉 기록판 + 미니 제공 용기 + 탈착형 미니컵 + 앞치마·매트",
    why: "한 번 조리해 10회분으로 나눠두면 반복 노출이 실제로 굴러가요. 매번 새로 만드는 부담과 치우는 부담을 같이 줄인 구성이에요.",
    homeFirst: "얼음틀에 소량씩 나눠 얼리고, 종이에 8칸 표를 그려 체크해도 똑같이 됩니다.",
    iddsi: [4, 7], age: [8, 60], contains: [], price: 39000, repeat: false,
    match: { concern: ["picky", "noeat", "texture"], retry: ["거의 안 함", "1~2번"] },
  },
  {
    id: "set-texture", kind: "bundle", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "식감 조절 세트",
    sub: "IDDSI 크기·경도 가이드 매트 + 전자레인지 스팀 용기 + 실리콘 매셔 + 한입 커터 + 재료별 조리 가이드",
    why: "‘작게 주세요’보다 어려운 건 몇 분 찌고 몇 mm로 자르는지예요. 도구에 기준을 새겨 넣은 구성입니다.",
    homeFirst: "자를 옆에 두고 한 조각 크기를 재보고, 포크로 눌러 뭉개지는지 확인하는 것부터 시작해도 같은 연습이에요.",
    iddsi: [4, 7], age: [8, 60], contains: [], price: 44000, repeat: false,
    match: { concern: ["texture", "spit", "meat", "hold"], hard: ["고기", "채소", "밥알", "덩어리"] },
  },
  {
    id: "set-record", kind: "bundle", goal: "record", tier: 3, phase: 1, demo: true,
    name: "기록·촬영 세트",
    sub: "식탁 고정 거치대 + 촬영 각도 가이드 + 주간 연습 보드 + 재촬영 체크 카드",
    why: "같은 위치·각도로 찍어야 지난번과 비교가 정확해져요. 분석 서비스와 가장 직접 연결되는 준비물입니다.",
    homeFirst: "컵 두 개로 휴대폰을 고정하고, 찍은 위치를 사진으로 남겨두면 다음에 같은 자리에서 찍을 수 있어요.",
    age: [1, 200], contains: [], price: 29000, repeat: false,
    match: {},
  },
];

/* ── 단품 카탈로그 ──
   goal   : texture(T01) / repetition(E01) / expectation(Q01) / record(촬영·기록)
   kind   : tool(도구·식기) · guide(가이드 콘텐츠) · nonfood(생활 준비물) · food(식품 — Phase 2)
   phase  : 1=지금 판매 · 2=식품, PHASE2_ENABLED 전까지 비노출
   label  : 식품 필수 표시(나트륨·당류·알레르기·월령) ⚠ Phase 2 켤 때 검수 항목 */
export const CATALOG = [
  /* ═══ E01 · 반복 노출 (tier 1) ═══ */
  {
    id: "tray-portion", kind: "tool", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "초소량 냉동 소분 트레이 (5g·10g)",
    sub: "한입 크기 큐브 틀 + 날짜·재료 스티커",
    why: "편식 재료를 한 번 조리해 10회분으로 얼려두면, 매번 조리하는 부담 없이 반복 노출을 이어갈 수 있어요.",
    homeFirst: "얼음틀에 소량씩 나눠 얼리고 지퍼백에 날짜를 적어도 같은 방식이에요.",
    iddsi: [4, 7], age: [6, 60], contains: [], price: 14000, repeat: false,
    match: { concern: ["picky", "noeat"], retry: ["거의 안 함", "1~2번"] },
  },
  {
    id: "board-15", kind: "guide", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "15회 노출 기록판 · 접촉 8단계",
    sub: "보기 → 식탁에 두기 → 만지기 → 냄새 → 입술에 대기 → 핥기 → 한입 → 삼키기",
    why: "먹었는지만 체크하면 대부분 ‘실패’로 기록돼요. 만졌는지·핥았는지까지 남겨야 변화가 보입니다.",
    homeFirst: "종이에 8칸 표를 그려 냉장고에 붙여도 똑같이 쓸 수 있어요.",
    iddsi: [4, 7], age: [8, 72], contains: [], price: 9000, repeat: false,
    match: { concern: ["picky", "noeat", "texture"], retry: ["거의 안 함", "1~2번"] },
  },
  {
    id: "cup-mini", kind: "tool", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "탈착형 미니컵 + 소스 찍기 접시",
    sub: "익숙한 음식 접시 옆에 붙여 아주 적은 양만 올리는 용기",
    why: "한 접시 가득이면 보기만 해도 부담이에요. 아주 적은 양을 ‘옆에 두는’ 형태로 만들어 줍니다.",
    homeFirst: "작은 종지를 접시 옆에 두는 것으로 시작해도 돼요.",
    iddsi: [4, 7], age: [8, 60], contains: [], price: 11000, repeat: false,
    match: { concern: ["picky", "noeat"], behavior: ["입에 넣지 않음"] },
  },
  {
    id: "tray-explore", kind: "nonfood", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "음식 탐색 트레이 (먹는 접시와 분리)",
    sub: "만지고 눌러보고 부숴보는 전용 트레이",
    why: "‘먹는 접시’와 ‘탐색하는 접시’를 나누면, 음식 놀이를 꺼리는 보호자도 받아들이기 쉬워져요.",
    homeFirst: "쟁반 하나를 탐색용으로 정해두는 것만으로도 구분이 됩니다.",
    iddsi: [4, 7], age: [8, 48], contains: [], price: 13000, repeat: false,
    match: { concern: ["picky", "texture"], deepTouch: true },
  },
  {
    id: "nonfood-play", kind: "nonfood", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "앞치마 + 바닥 매트",
    sub: "손으로 만지는 연습을 부담 없이 하게 하는 준비물",
    why: "촉감 놀이와 자기주도 식사를 미루는 가장 큰 이유가 ‘치우기 힘들어서’예요. 그 장벽을 줄입니다.",
    homeFirst: "큰 수건이나 신문지를 의자 아래 깔아두는 것만으로도 시작할 수 있어요.",
    iddsi: [4, 7], age: [8, 48], contains: [], price: 26000, repeat: false,
    match: { concern: ["picky", "texture"], deepTouch: true },
  },
  {
    id: "guide-pairing", kind: "guide", goal: "repetition", tier: 1, phase: 1, demo: true,
    name: "페어링 레시피 카드 20조합",
    sub: "감자+브로콜리 · 두부+버섯 · 밥+콩 · 달걀+시금치 · 바나나+아보카도 …",
    why: "익숙한 음식에 도전 음식을 5%부터 붙이는 조합을 시중 재료 기준으로 정리했어요. 식품 배송 없이 오늘 바로 씁니다.",
    homeFirst: "잘 먹는 음식 9 : 새 음식 1 비율로 섞어 시작하면 같은 원리예요.",
    iddsi: [4, 7], age: [8, 72], contains: [], price: 7000, repeat: false,
    match: { concern: ["picky", "meat", "texture"] },
  },

  /* ═══ T01 · 질감·크기 (tier 2) ═══ */
  {
    id: "mat-size", kind: "tool", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "크기·경도 가이드 매트 (IDDSI 기준)",
    sub: "소아 기준 실물 크기 — 폭 2mm×길이 8mm(Level 5) · 한 조각 8mm(Level 6) + 포크 압력 테스트 방법 인쇄",
    why: "자른 음식을 매트에 올리면 지금 주는 형태에 맞는 크기인지 바로 보여요. ‘작게’를 국제 기준 눈금으로 바꾼 준비물입니다.",
    homeFirst: "자를 식탁에 두고 한 조각을 재보고, 포크로 눌러 뭉개지는지 확인해도 같아요.",
    iddsi: [4, 7], age: [6, 72], contains: [], price: 12000, repeat: false,
    match: { concern: ["texture", "spit", "fast"], hard: ["덩어리", "밥알"], behavior: ["바로 삼키려 함"] },
  },
  {
    id: "steam-box", kind: "tool", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "전자레인지 스팀 용기 + 재료별 찌는 시간표",
    sub: "재료별 찌는 시간 가이드 동봉 ⚠ 시간 값은 실측 후 확정 예정",
    why: "‘푹 익히세요’가 몇 분인지 몰라 실패하는 경우가 많아요. 포크로 눌러 뭉개지는지 확인하는 기준을 함께 드립니다.",
    homeFirst: "냄비에 삶으면서 손가락으로 눌러 스르륵 뭉개질 때까지만 익혀도 같아요.",
    iddsi: [4, 6], age: [6, 72], contains: [], price: 16000, repeat: false,
    match: { concern: ["texture", "spit", "hold"], hard: ["채소", "고기"], ceiling: ["tofu", "veg"] },
  },
  {
    id: "masher-set", kind: "tool", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "실리콘 매셔 + 결대로 찢는 집게",
    sub: "믹서로 갈지 않고 알갱이를 남겨 으깨는 도구",
    why: "다시 갈면 이전 단계로 후퇴해요. 거칠게 으깨고 고기는 결 반대로 찢는 두 동작을 도구로 고정합니다.",
    homeFirst: "포크 등으로 거칠게 으깨고, 삶은 고기는 손으로 결 반대로 찢어도 같아요.",
    iddsi: [4, 6], age: [7, 60], contains: [], price: 13000, repeat: false,
    match: { concern: ["meat", "texture", "hold"], hard: ["고기", "채소"], behavior: ["씹다가 뱉음", "오래 물고 있음"] },
  },
  {
    id: "cutter-bite", kind: "tool", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "한입 크기 가이드 커터 + 두께 슬라이서",
    sub: "핑거푸드 길이(약 5~6cm)와 두께를 규격으로 잘라주는 도구",
    why: "잡기 어려워 놓친 걸 ‘거부’로 보는 경우가 있어요. 손에 쥐고 남는 길이로 고정해 줍니다.",
    homeFirst: "어른 검지 길이만큼 길쭉하게 썰어 주면 같은 크기예요.",
    iddsi: [6, 7], age: [8, 48], contains: [], price: 15000, repeat: false,
    match: { concern: ["texture", "noeat"], hard: ["미끄러운 음식", "덩어리"] },
  },
  {
    id: "plate-compare", kind: "tool", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "식감 비교 접시 (2칸)",
    sub: "삶은 당근 / 살짝 구운 당근 · 다진 고기 / 결대로 찢은 고기 · 맨밥 / 눌러 구운 밥",
    why: "같은 재료를 두 형태로 나란히 올려, 어떤 식감을 편해하는지 한 끼에 확인하는 접시예요.",
    homeFirst: "작은 접시 두 개에 나눠 담아 나란히 놓아도 같은 실험이 됩니다.",
    iddsi: [6, 7], age: [8, 72], contains: [], price: 12000, repeat: false,
    match: { concern: ["texture", "spit", "meat"], hard: ["고기", "채소", "바삭한 음식"] },
  },
  {
    id: "guide-ladder", kind: "guide", goal: "texture", tier: 2, phase: 1, demo: true,
    name: "식감 사다리 카드 (IDDSI 기준)",
    sub: "지금 형태 → 한 칸 위로 올리는 법 · 재료별 조리 순서 (곱게 감 → 잘게 다져 촉촉 → 부드러운 한입 → 일반식)",
    why: "같은 재료를 한 칸씩만 거칠게 올리는 순서를 정리했어요. 식품 배송 없이 오늘 바로 시작합니다.",
    homeFirst: "삶는 시간을 3단계로 나누는 것(푹→중간→살짝)이 사다리의 기본이에요.",
    iddsi: [4, 7], age: [7, 72], contains: [], price: 8000, repeat: false,
    match: { concern: ["texture", "spit", "meat", "hold"], hard: ["고기", "채소", "밥알", "덩어리"] },
  },

  /* ═══ Q01 · 기대 섭취량 ═══ */
  {
    id: "bowl-scale", kind: "tool", goal: "expectation", tier: 2, phase: 1, demo: true,
    name: "용량 눈금 미니볼 (10·20·30g)",
    sub: "첫 제공량을 눈금으로 고정",
    why: "‘적게 주세요’는 기준이 없어 실행이 어려워요. 눈금이 있으면 오늘 얼마를 담을지 바로 정해집니다.",
    homeFirst: "계량스푼 한 술이 약 15g이에요. 있는 스푼으로 세어 담아도 됩니다.",
    iddsi: [4, 7], age: [6, 72], contains: [], price: 14000, repeat: false,
    match: { concern: ["noeat", "slow"], portion: ["훨씬 적음", "조금 적음"] },
  },
  {
    id: "spoon-set", kind: "tool", goal: "expectation", tier: 2, phase: 1, demo: true,
    name: "스푼 3단계 세트",
    sub: "얕고 작은 스푼 → 중간 → 일반 유아 스푼",
    why: "한 입이 크면 입안에서 굴릴 공간이 없어요. 스푼을 바꾸면 한 입 양이 같이 바뀝니다.",
    homeFirst: "쓰던 스푼에 절반만 담아도 같은 연습이 돼요.",
    iddsi: [4, 6], age: [7, 48], contains: [], price: 12000, repeat: false,
    match: { concern: ["fast", "slow"], behavior: ["바로 삼키려 함"] },
  },
  {
    id: "plate-guide", kind: "tool", goal: "expectation", tier: 2, phase: 1, demo: true,
    name: "첫 제공량 가이드 칸접시",
    sub: "칸마다 권장 시작량이 인쇄된 접시 + 리필용 작은 반찬 용기",
    why: "적게 담고 아이가 더 원할 때 채워주는 방식이 부담을 낮춰요. 접시가 그 순서를 알려줍니다.",
    homeFirst: "가장 작은 종지에 담고, 더 원하면 그때 추가해 주세요.",
    iddsi: [5, 7], age: [8, 60], contains: [], price: 15000, repeat: false,
    match: { concern: ["noeat", "slow"], portion: ["훨씬 적음", "조금 적음"] },
  },

  /* ═══ record · 기록·촬영 (tier 3 — 결과 종류와 무관, 조건부 1개) ═══ */
  {
    id: "mount-phone", kind: "tool", goal: "record", tier: 3, phase: 1, demo: true,
    name: "식탁 고정 촬영 거치대 + 각도 가이드",
    sub: "아이 얼굴과 상체가 함께 담기는 위치 표시 · 미끄럼 방지 클램프",
    why: "같은 위치·각도로 찍어야 지난번과 비교가 정확해져요. 손으로 들고 찍으면 매번 조건이 달라집니다.",
    homeFirst: "컵 두 개 사이에 휴대폰을 세우고, 찍은 자리를 사진으로 남겨두면 다음에 같은 위치에서 찍을 수 있어요.",
    age: [1, 200], contains: [], price: 19000, repeat: false,
    match: {},
  },
  {
    id: "board-weekly", kind: "guide", goal: "record", tier: 3, phase: 1, demo: true,
    name: "주간 연습 보드",
    sub: "이번 주 도전 음식 1개 · 바꿀 조건 1개 · 3회 시도 체크 · 아이 반응 · 다음 단계",
    why: "한 주에 하나만 바꾸고 그 결과를 적어두면, 다음 촬영에서 무엇이 달라졌는지 설명할 수 있어요.",
    homeFirst: "달력 여백에 ‘이번 주 도전 음식’만 적어도 같은 역할을 합니다.",
    age: [1, 200], contains: [], price: 9000, repeat: false,
    match: {},
  },

  /* ═══ Phase 2 · 식품 완제품 (PHASE2_ENABLED=false 동안 비노출) ═══
     ⚠ 켤 때 필수: 알레르기 · 나트륨 · 당류 · 월령 표시(label) + 제조·유통 책임 주체 확정 */
  {
    id: "food-broth", kind: "food", goal: "texture", tier: 2, phase: 2, demo: true,
    name: "무염 채소 육수 큐브",
    sub: "한 스푼 분량 큐브 20개",
    why: "퍽퍽해서 오래 물고 있거나 뱉을 때, 촉촉함을 소량 더해 삼킴을 돕는 용도예요.",
    homeFirst: "집에서는 국물이나 미지근한 물 한 티스푼으로도 같은 역할을 해요.",
    iddsi: [4, 6], age: [7, 60], contains: [], price: 13000, repeat: true,
    label: { sodium: "무염", sugar: "무첨가", allergens: "없음", ageMin: 7 },
    match: { concern: ["meat", "hold", "spit"], behavior: ["오래 물고 있음", "씹다가 뱉음"] },
  },
  {
    id: "food-ladder-carrot", kind: "food", goal: "texture", tier: 2, phase: 2, demo: true,
    name: "식감 사다리 팩 · 당근 4단계",
    sub: "곱게 간 것 → 미세 입자 → 굵은 입자 → 스틱 (각 4회분)",
    why: "가이드 카드로 효과를 본 뒤, 직접 만들기 번거로운 분을 위한 완제품 단계예요.",
    homeFirst: "삶는 시간을 3단계로 나누면 집에서도 같은 사다리를 만들 수 있어요.",
    iddsi: [4, 6], age: [8, 48], contains: ["당근"], price: 18000, repeat: true,
    label: { sodium: "무염", sugar: "무첨가", allergens: "없음", ageMin: 8 },
    match: { hard: ["채소"], concern: ["texture", "spit"], ceiling: ["tofu", "veg"] },
  },
  {
    id: "food-ladder-meat", kind: "food", goal: "texture", tier: 2, phase: 2, demo: true,
    name: "식감 사다리 팩 · 고기 4단계",
    sub: "곱게 간 고기 → 다진 고기 → 결 반대로 찢은 고기 → 한입 조각",
    why: "고기는 입안에서 흩어져 뱉기 쉬워요. 결 반대로 찢은 단계가 중간 다리 역할을 합니다.",
    homeFirst: "삶은 고기를 결 반대로 찢어 밥에 섞어 주면 같은 연습이 돼요.",
    iddsi: [5, 7], age: [9, 60], contains: ["소고기", "닭고기", "고기"], price: 24000, repeat: true,
    label: { sodium: "무염", sugar: "무첨가", allergens: "소고기", ageMin: 9 },
    match: { hard: ["고기"], concern: ["meat", "hold", "spit"] },
  },
  {
    id: "food-exposure", kind: "food", goal: "repetition", tier: 1, phase: 2, demo: true,
    name: "15회 노출 소분 식품 팩",
    sub: "새 재료 1종 × 15회 극소량 냉동 소분",
    why: "소분 트레이로 직접 나누기 어려운 분을 위한 완제품이에요.",
    homeFirst: "소분 트레이에 한 번 조리해 나눠 얼리면 같은 구성이 됩니다.",
    iddsi: [4, 7], age: [8, 60], contains: [], price: 21000, repeat: true,
    label: { sodium: "무염", sugar: "무첨가", allergens: "제품별 표기", ageMin: 8 },
    match: { concern: ["picky", "noeat"], retry: ["거의 안 함", "1~2번"] },
  },
];

/* ── 상품 페이지 진입 카테고리 (2026-07-27) ──
   원칙: 고민이 명확한 사람은 카테고리로 바로 상품을 보고,
        모르겠는 사람에게는 **별도의 제품 추천 문항을 만들지 않고** 영상·체크리스트 분석으로 보낸다.
        (핵심 흐름: 분석 → 행동 솔루션 → 필요한 경우 제품. 구매에 분석을 강제하지는 않는다)
   goal 로 묶이지 않는 '자기주도'는 품목을 직접 지정한다 — 엔진에 해당 possibility가 없기 때문. */
export const CATEGORIES = [
  { id: "texture",  label: "질기거나 오래 물고 있어요",      sub: "질감·크기 조절",   goal: "texture" },
  { id: "newfood",  label: "새로운 음식을 거부해요",          sub: "반복 노출 연습",   goal: "repetition" },
  { id: "portion",  label: "한입 양을 줄이고 싶어요",         sub: "한입 양 조절",     goal: "expectation" },
  { id: "selffeed", label: "자기주도 식사를 준비하고 싶어요", sub: "스스로 집어 먹기",
    items: ["cutter-bite", "tray-explore", "nonfood-play", "cup-mini", "mat-size", "plate-guide"] },
];
export function categoryItems(catId) {
  const c = CATEGORIES.find(x => x.id === catId);
  if (!c) return { bundles: [], items: [] };
  if (c.items) return { bundles: [], items: c.items.map(id => CATALOG.find(x => x.id === id)).filter(Boolean) };
  return {
    bundles: BUNDLES.filter(b => b.goal === c.goal),
    items: CATALOG.filter(x => x.goal === c.goal),
  };
}

/* ── 결과에 붙이지 않는 자료(SUPPORT) ──
   환경·자세·보호자 대응은 결과설계 §1에서 판단범위 '보류' → 영상·설문으로 판단하지 않는다.
   따라서 결과화면 추천 대상이 아니며, 4주 프로그램 구성품 또는 무료 다운로드로만 쓴다. */
export const SUPPORT = [
  { id: "card-talk", name: "식사 대화 카드", note: "‘먹어봐’ 대신 ‘여기 같이 놓아둘게’ 등 상황별 문구", use: "무료 자료" },
  { id: "card-response", name: "보호자 반응 체크 카드", note: "재촉·떠먹임·대체음식·화면·기다림 5항목 자기점검", use: "무료 자료" },
  { id: "card-routine", name: "식사 루틴 자석 카드", note: "손 씻기 → 앉기 → 보기 → 먹기 → 끝 인사 → 정리", use: "프로그램 구성품" },
  { id: "seat-support", name: "발판·자세 보조", note: "발이 닿는 환경인지 확인하는 용도. ‘씹기 개선 제품’으로 표현 금지", use: "프로그램 구성품" },
  { id: "focus-kit", name: "식사 집중 환경 키트", note: "장난감 보관 바구니·가림막·15분 타이머. 타이머는 ‘시간 안에 먹기’가 아니라 시작과 끝을 예측하는 용도", use: "프로그램 구성품" },
];

/* ── 서비스 상품 ── */
export const PROGRAM = {
  id: "program-4w", demo: true,
  name: "4주 식감 연습 프로그램",
  sub: "1주 현재 확인 → 2주 한 단계 쉬운 형태 → 3주 익숙한 음식과 페어링 → 4주 원래 형태 재도전 · 매주 영상 재분석",
  why: "매주 한 가지만 바꾸고, 그 주의 준비물을 함께 보내드려요.",
  price: 59000,
};
export const SERVICES = [
  { id: "svc-reanalysis", name: "영상 추가 분석권", note: "변화 비교 · 다른 음식 조건 · 형제자매 추가 분석" },
  { id: "svc-consult", name: "전문가 상담 연결권", note: "15분 결과 설명 · 4주 계획 점검 · 전문가 상담이 필요한 신호 안내. ⚠ 진단·치료 아님, 결과 이해와 일상 실행 지원 범위" },
];

/* ── 알레르기 필터 ── */
function allergyTokens(raw) {
  return String(raw || "").split(/[,·\/\s]+/).map(s => s.trim()).filter(s => s.length >= 1);
}
function hitsAllergy(item, tokens) {
  if (!tokens.length || !item.contains || !item.contains.length) return false;
  return item.contains.some(c => tokens.some(t => c.includes(t) || t.includes(c)));
}

/* ── 점수 매칭 ── */
function scoreItem(item, ctx) {
  const sv = ctx.survey || {};
  const l1 = sv.lens01 || {};
  let s = item.goal === (ctx._goal || ctx.possibility) ? 3 : 0;
  if (!s) return 0;                                     // goal 불일치 → 후보 제외
  const m = item.match || {};
  const hard = Array.isArray(l1.hard_textures) ? l1.hard_textures : [];
  if (m.hard && m.hard.some(h => hard.indexOf(h) >= 0)) s += 2;
  if (m.concern && m.concern.indexOf(sv.concern) >= 0) s += 2;
  if (m.behavior && m.behavior.indexOf(l1.behavior) >= 0) s += 1;
  if (m.ceiling && m.ceiling.indexOf(l1.chew_ceiling) >= 0) s += 1;
  if (m.retry && m.retry.indexOf((sv.lens04 || {}).retry_count) >= 0) s += 2;
  if (m.portion && m.portion.indexOf((sv.lens03 || {}).portion_gap) >= 0) s += 2;
  if (m.deepTouch && (sv.deep || {}).touch === "예") s += 2;
  if (item.kind === "guide") s += 0.7;                  // 가이드=배송·재고 부담 없음 → 초기 검증 우선
  return s;
}
function passesBasics(item, ctx, tokens, age, level) {
  // ctx.enablePhase2 는 관리자 미리보기·테스트용 오버라이드. 실서비스 기본값은 PHASE2_ENABLED.
  const p2 = (ctx && ctx.enablePhase2 != null) ? !!ctx.enablePhase2 : PHASE2_ENABLED;
  if (item.phase === 2 && !p2) return false;
  if (hitsAllergy(item, tokens)) return false;
  if (age && (age < item.age[0] || age > item.age[1])) return false;
  if (!fitsLevel(item, level)) return false;          // 지금 주는 음식 형태(IDDSI)가 주 매칭 축
  return true;
}

/* ── 후보 목록(랭킹 전) ── 관리자 미리보기·검증용. 게이팅/필터가 실제로 무엇을 걸러냈는지 본다. */
export function candidateItems(ctx) {
  const c = ctx || {};
  const tokens = allergyTokens(c.allergies);
  const age = Number(c.ageMonths) || null;
  const lv = (c.iddsiLevel !== undefined) ? c.iddsiLevel : estimateLevel(c).level;
  return [...BUNDLES, ...CATALOG].filter(it => passesBasics(it, c, tokens, age, lv));
}

/* ── 설문만으로 goal 도출 (v0.4 · 영상 비의존) ──
   영상은 퍼포먼스 층이고 실제 목적은 솔루션·상품 제안이다. 영상이 흐리거나(=unclear) 아예 없어도
   **설문의 '가장 큰 고민'만으로** 어떤 연습이 필요한지는 정해진다. 그래서 goal을 설문에서 직접 뽑는다.
   ⚠ 단, 안전 신호와 H01(식사 간격)은 그대로 막는다 — 이건 영상과 무관한 규칙이다. */
export const GOAL_BY_CONCERN = {
  texture: "texture", spit: "texture", meat: "texture", hold: "texture",
  slow: "expectation", fast: "expectation",
  picky: "repetition",            // legacy 설문 값 — 현행 v3 CONCERN에는 없다(⚠ 편식 항목 부재)
  // noeat 은 조건부 → goalFromSurvey 참조
};
/* goal → 행동 한 가지 (영상 없는 진입점 prep.html 용 짧은 버전)
   ⚠ 결과화면(demo.html)의 문구 원본은 RULES.possibility 다. 여기 문구를 고치면 그쪽도 같이 볼 것. */
export const ACTIONS = {
  texture: {
    label: "질감·크기",
    action: "같은 음식을 지금보다 조금 더 부드럽고 작게 준비해 보세요.",
    watch: "바로 뱉는 행동이 줄어드는지, 씹는 움직임이 조금 더 이어지는지",
    home: "믹서로 다시 갈지 말고 포크로 거칠게 으깨 알갱이를 남기고, 고기·채소는 밥에 섞어 한 덩어리로 주세요.",
  },
  repetition: {
    label: "익숙함·반복 노출",
    action: "익숙한 음식 옆에 새 음식을 소량 두고, 만지거나 맛보게만 해보세요.",
    watch: "만지거나 입에 대보는 횟수가 느는지",
    home: "새 음식은 익숙한 음식에 5%만 섞어 시작하고, 뱉어도 되돌리지 말고 며칠 반복해 주세요.",
  },
  expectation: {
    label: "기대 섭취량",
    action: "처음 제공량을 조금 줄여 부담을 낮추고, 더 원할 때 추가로 주세요.",
    watch: "거부감이 줄어드는지, 스스로 더 먹으려 하는지",
    home: "가장 작은 종지에 담아 시작하고, 식사는 20~30분 안에 깔끔하게 마쳐 주세요.",
  },
};

export function goalFromSurvey(survey) {
  const sv = survey || {};
  // ⚠ '안 먹음'만으로는 연습을 정할 수 없다. 대부분을 안 먹는 경우는 식사 간격·양 쪽일 수 있어 상품을 붙이지 않고,
  //   **특정 음식만** 안 먹을 때만 반복 노출(E01)로 본다. (설문 SETS.noeat.scope 와 같은 값)
  if (sv.concern === "noeat") {
    return ((sv.deep || {}).scope === "특정 음식만") ? "repetition" : null;
  }
  const g = GOAL_BY_CONCERN[sv.concern];
  if (g) return g;
  // 고민이 '기타'여도 양 관련 응답이 뚜렷하면 Q01로
  const p = (sv.lens03 || {}).portion_gap;
  if (p === "훨씬 적음" || p === "조금 적음") return "expectation";
  return null;
}

/* ── 추천 계산 ──
   ctx: { possibility, action, safetyOn, ageMonths, survey, allergies, videoQuality, hasPrev }
        possibility 가 없거나 'unclear' 여도 설문으로 goal을 뽑는다(영상 비의존).
   반환: { gated, reason, bundle, items[], record, program, tex, goal, goalSource } */
export function recommendProducts(ctx) {
  const c = ctx || {};
  const tex = estimateLevel(c);                         // 🔎 설문(형태·씹기상한) → 음식 형태 추정, 없으면 월령 폴백
  // 월령은 판정이 아니라 대조 축 — 설문으로 형태를 알 때만 '보통 이 시기'와 비교한다.
  tex.age = (tex.source && tex.source !== "age") ? compareWithAge(tex.level, c.ageMonths) : null;
  const empty = (reason) => ({ gated: true, reason, items: [], bundle: null, record: null, tex, goal: null });
  const on = (c.enableProducts != null) ? !!c.enableProducts : PRODUCTS_ENABLED;
  if (!on) return empty("products_off");                // 커머스 킬 스위치
  if (c.safetyOn) return empty("safety");               // 안전 신호 → 두 층 모두 차단

  const tokens = allergyTokens(c.allergies);
  const age = Number(c.ageMonths) || null;
  const lv = (c.iddsiLevel !== undefined) ? c.iddsiLevel : tex.level;

  // ② 기록·촬영 층 — v0.4에서 강등: 영상이 주목적이 아니므로 '영상 품질이 낮을 때'만.
  //    (첫 촬영이라는 이유만으로는 띄우지 않는다. 영상이 아예 없으면 당연히 안 뜬다.)
  let record = null;
  if (c.videoQuality && c.videoQuality !== "high") {
    record = [...BUNDLES, ...CATALOG]
      .filter(it => it.goal === "record" && passesBasics(it, c, tokens, age, lv))
      .sort((a, b) => (a.kind === "bundle" ? -1 : 1))[0] || null;
  }

  // ① 식사 준비물 층 — 영상 결과(possibility)를 우선 쓰되, 없거나 unclear면 설문에서 goal을 뽑는다.
  let goal = null, goalSource = null;
  if (c.possibility && c.possibility !== "unclear" && c.possibility !== "interval") { goal = c.possibility; goalSource = "video+survey"; }
  else if (c.possibility !== "interval") { goal = goalFromSurvey(c.survey); goalSource = goal ? "survey" : null; }
  if (!goal) {
    if (record) return { gated: false, reason: c.possibility === "interval" ? "record_only_interval" : "record_only_unclear", items: [], bundle: null, record, program: null, tex, goal: null };
    return empty(c.possibility === "interval" ? "no_product_goal" : "unclear");
  }

  const bundle = BUNDLES
    .filter(b => b.goal === goal && passesBasics(b, c, tokens, age, lv))
    .map(b => ({ b, s: scoreItem(b, Object.assign({}, c, { _goal: goal })) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.b)[0] || null;

  const scored = CATALOG
    .filter(it => it.goal !== "record" && passesBasics(it, c, tokens, age, lv))
    .map(it => ({ it, s: scoreItem(it, Object.assign({}, c, { _goal: goal })) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!scored.length && !bundle) {
    if (record) return { gated: false, reason: "record_only_nomatch", items: [], bundle: null, record, program: null, tex, goal: null };
    return empty("no_match");
  }

  // 세트가 있으면 단품 2개, 없으면 3개. 같은 종류만 나열되지 않게 kind를 섞는다.
  const limit = bundle ? 2 : 3;
  const picked = []; const kinds = new Set();
  for (const x of scored) {
    if (picked.length >= limit) break;
    if (kinds.has(x.it.kind) && picked.length >= 1) continue;
    picked.push(x.it); kinds.add(x.it.kind);
  }
  return { gated: false, reason: "ok", bundle, items: picked, record, program: PROGRAM, tex, goal, goalSource };
}

export default { CATALOG, BUNDLES, SUPPORT, SERVICES, PROGRAM, PHASE2_ENABLED, PRODUCTS_ENABLED, recommendProducts };
