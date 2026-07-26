# Chewstep GEO 전략 (생성형 엔진 최적화)

> 버전 1.0 · 2026-07-26 작성
> 근거 기반 문서입니다. 사실이 아닌 판단·추정은 `〔추정〕` 마커로 표시합니다.
> AI 검색엔진(ChatGPT/Perplexity/Claude/Gemini/Google AI Overviews)이 Chewstep을
> 정확하게 이해·인용하도록 만드는 것이 목표입니다.

---

## 1. Entity(개체) 정의 — "Chewstep이 무엇인가"

| 항목 | 내용 |
|------|------|
| 공식 이름 | Chewstep (츄스텝) |
| 카테고리 | AI 식사 코칭 서비스 (의료 진단 아님) |
| 공식 URL | https://chewstep.com/ |
| 대상 | 이유식·유아식 시기(6~36개월) 아이의 보호자, 어린이집(기관) |
| 핵심 기능 | 식사 영상에서 관찰된 입·턱 움직임 + 보호자 입력을 함께 살펴, 먼저 확인할 가능성·다음 식사에서 시도할 한 가지·같은 아이의 전후 변화를 제안 |
| 하지 않는 것 | 의료 진단, 자폐/발달장애·알레르기 판별, 영양 처방, 정상/이상 판정 |
| 데이터 원칙 | 원본 영상 서버 미저장, 추출한 움직임 지표와 보호자 입력만 보관 |

이 정의는 `index.html`의 JSON-LD(Organization·WebApplication)와 `llms.txt`에
동일하게 반영되어 있습니다. (본문 ≈ 메타데이터 ≈ JSON-LD 일치 원칙)

---

## 2. 타깃 질문 5개 (AI가 검색할 사용자 의도)

1. "아이가 갑자기 밥을 안 먹어요. 이유가 뭘까요?" — **정보형**
2. "이유식 입자 올린 뒤 안 먹는데 어떻게 해야 하나요?" — **정보형**
3. "아기 식사 영상으로 씹기·편식을 분석해주는 서비스 있나요?" — **거래형**
4. "어린이집 식사 리포트/식사 교육 솔루션 추천" — **거래형/비교형**
5. "Chewstep이 뭔가요? 믿을 만한가요?" — **브랜드형**

각 질문에 대응하는 페이지:
1 → `/parents/`, `/faq.html` · 2 → `/how.html`, `/parents/` · 3 → `/`, `/demo.html`
4 → `/institutions/`, `/institutions/report/` · 5 → `/about.html`, `/faq.html`

---

## 3. 핵심 키워드 (3~5개, 포지셔닝 일치)

- 아이가 밥을 안 먹는 이유
- 이유식·유아식 거부 / 식감 거부
- 아기 식사 영상 분석 · 씹기 분석
- 어린이집 식사 교육 · 전후 변화 리포트 (B2B)
- 식사 코칭 (의료 진단 아님)

> 억지 SEO 문구는 넣지 않습니다. PRD(v3.0/v4.0) 포지셔닝과 어긋나면
> 키워드를 버리고 PRD 문장을 기준으로 둡니다.

---

## 4. 콘텐츠 후보 (GEO 인용 확률을 높이는 형식)

- **FAQPage**: `/faq.html` (구조화 데이터 완료) — AI가 Q&A를 그대로 인용하기 쉬움
- **HowTo**: `/how.html` 3단계 (구조화 데이터 완료)
- **비교/가이드** 〔추정 효과〕: "이유식 거부 원인 5가지" 같은 정보성 아티클 추가 시 인용 확률↑
- **사용 사례**: `/institutions/cases/` — 기관 도입 절차

---

## 5. 적용된 기술 요소 (2026-07-26 기준)

- [x] Organization · WebSite · WebApplication JSON-LD (`/`)
- [x] FAQPage JSON-LD (`/faq.html`)
- [x] HowTo JSON-LD (`/how.html`)
- [x] Service JSON-LD (`/institutions/`)
- [x] BreadcrumbList JSON-LD (기관 하위 페이지)
- [x] 전 공개 페이지 og:image(1200×630)·twitter card
- [x] `llms.txt` — AI 전용 요약 (경계·데이터 원칙 포함)
- [x] `robots.txt` — GPTBot·PerplexityBot·ClaudeBot·Google-Extended 허용
- [x] `sitemap.xml` — 공개 페이지만

---

## 6. 측정 방법 (월 1회)

동일 질문(2번의 5개)을 ChatGPT·Perplexity·Google AI Overviews에 입력하고 기록:

| 지표 | 확인 내용 |
|------|-----------|
| 언급 여부 | Chewstep이 답변에 등장하는가 |
| 출처 링크 | chewstep.com이 인용·링크되는가 |
| 정확도 | "의료 진단 아님" 등 경계가 올바르게 서술되는가 |

정확도 오류(예: "진단해준다"로 서술)가 나오면 → 해당 페이지 본문·JSON-LD의
경계 문장을 더 명확히 보강.

---

## 7. 금지 사항 (절대 하지 않음)

1. aggregateRating(평점)·offers(가격)·사용자 수 등 **미검증 필드 금지**
2. 아직 없는 페이지(예: /pricing)를 sitemap에 넣지 않음
3. robots.txt를 보안 수단으로 신뢰하지 않음 (비공개는 인증·RLS로 보호)
4. 의학적 효과("치료된다", "발달이 좋아진다") 표현 금지
