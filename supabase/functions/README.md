# Supabase Edge Functions — 소스 버전관리

이 디렉터리는 **Supabase에 배포된 엣지함수의 소스를 버전관리에 넣기 위한** 곳입니다.
그동안 엣지함수는 대시보드/MCP로 직접 배포되어 저장소에 소스가 없었고, 프롬프트를
누가 언제 어떻게 고쳤는지 추적할 수 없었습니다.

프로젝트: `qwfskemfsrkmlrdttvqy`

| 함수 | 배포 버전 | 이 저장소 소스 | 상태 |
|---|---|---|---|
| `coach` | **v4** | v4 | ✅ **배포 완료** (2026-07-28) — 배포본 = 로컬 소스 일치 확인 |
| `recipe-coach` | v3 | 없음 | 미반영 |
| `send-inquiry` | v5 | 없음 | 미반영 |
| `get-report-media-url` | v3 | `B2B/edge-get-report-media-url.ts` | 별도 경로 |

## 배포

```bash
supabase functions deploy coach --project-ref qwfskemfsrkmlrdttvqy
```

⚠ **`verify_jwt` 는 반드시 `false`** 로 유지해야 합니다. 클라이언트(`assets/js/coach.js`)는
publishable key(`sb_publishable_…`, JWT 아님)를 보내므로 JWT 검증을 켜면 모든 호출이 401 이 됩니다.

## 롤백

v4 배포 직전의 운영본(v3)이 `coach/_rollback/index.v3.ts` 에 **원본 그대로** 보존돼 있습니다
(한글 인코딩 깨짐까지 포함 — 충실한 롤백을 위해 의도적으로 그대로 둔 것입니다).

```bash
cd chewstep-app/supabase/functions/coach
cp _rollback/index.v3.ts index.ts
supabase functions deploy coach --project-ref qwfskemfsrkmlrdttvqy
cd ../../../../verify && node coach-contract-check.mjs   # 되돌아갔는지 확인
```

Supabase 대시보드에서 이전 버전으로 되돌리는 기능은 제공되지 않으므로, 이 파일이 유일한 롤백 수단입니다.

## coach v4 변경분 (2026-07-28 배포)

사용자 테스트 피드백 #6(선택한 음식 단계와 결과 문구 불일치) 대응입니다.

1. **음식 단계 게이팅** — 클라이언트가 보내는 `food_stage`(코드·사람이 읽는 단계명·단계 순서·
   허용/금지 조언)를 프롬프트에 강한 조건으로 주입합니다. 이전에는 `food_form: "soft"` 코드만
   넘겨서 LLM이 단계를 이해할 수 없었습니다. SYSTEM 에 "현재 단계보다 이전 단계의 조언은
   제공하지 않는다"를 명시했습니다.
2. **알레르기 수신** — `body.allergies` 를 받아 절대 언급 금지 지시를 넣습니다.
   `recipe-coach` 는 이미 알레르기를 받는데 `coach` 만 못 받아, 식사 조언에서 알레르기 재료를
   이름으로 권할 수 있었습니다(안전 문제).
3. **인코딩 복구** — 씨기→씹기, 뀥기→뱉기, 바할→바꿀, 배고플→배고픔, 삼키 곤란→삼킴 곤란.
   `머금기`(입에 물고 있기)는 깨짐이 아니라 의도한 단어여서 그대로 뒀습니다.
4. **응답 필드 누락 방지** — `firstCheck`·`action`·`tips`·`watch` 4개를 항상 채웁니다.
   `tips` 가 비면 `action` 한 줄로 채웁니다. 응답에 `charset=utf-8` 을 명시했습니다.

### 하위호환
v3 가 읽던 요청 필드(`safetyOn`·`possibility`·`label`·`survey`·`foods`·`metrics`·`age_months`·
`concern_text`)를 v4 도 모두 읽습니다. 신규 필드(`food_stage`·`allergies`)는 **옵셔널** 이라
없어도 동작합니다. 응답 형태(`{ok:true,coach}` / `{ok:false,error}`)와 상태코드 정책
(런타임 실패는 모두 200, `method_not_allowed` 만 405)도 v3 와 같습니다.

### 클라이언트 방어층 (이중 안전장치)
프롬프트를 고쳤어도 생성 결과를 신뢰하지 않습니다. `demo.html` 이 두 번 더 걸러냅니다.
- `stage-gate.js` `sanitizeCoachForStage()` — 현재 단계보다 이전 단계의 조언 제거
- `demo.html` `sanitizeCoachForAllergy()` — 알레르기 재료를 언급한 문장 제거

`action` 이나 `firstCheck` 가 걸리면 LLM 결과 전체를 버리고 규칙 엔진 결과를 씁니다.

## ⚠ 현재 LLM 경로는 비활성입니다

`LETSUR_API_KEY` 시크릿이 설정돼 있지 않아 `coach` 는 모든 요청에 `{"ok":false,"error":"no_api_key"}`
를 반환합니다(HTTP 200). 즉 **지금 사용자가 보는 결과는 100% 클라이언트 규칙 엔진이 만든 것**이며,
사용자 테스트에서 신고된 "믹서로 갈지 말고 포크로 으깨…" 문구도 LLM이 아니라 규칙 엔진 출처였습니다.

키를 넣으면 LLM 개인화가 켜집니다.
```bash
supabase secrets set LETSUR_API_KEY=... --project-ref qwfskemfsrkmlrdttvqy
cd verify && node coach-contract-check.mjs    # 실제 생성 문장까지 검증됨
```
키가 없는 동안에도 `coach-contract-check.mjs` 의 프롬프트 조립·스키마·방어층 검증은 모두 동작합니다.

기준표 원본: `assets/js/survey-v3-schema.js` 의 `FOOD_ADVICE`
