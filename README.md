# Chewstep — 씹기 발달 AI 식사 코치 (데모)

이유식·유아식 전환기 아이의 **씹기 발달**을 체크리스트 + 식사 영상으로 확인하고,
레벨별 맞춤 가이드를 무료로 제공하는 **MVP 전 프로토타입(데이터 모집용)** 입니다.

## 구조 (정적 사이트 · 빌드 없음)

- `index.html` — 홍보 랜딩페이지(서비스 소개 → "무료 데모 체험하기" → `demo.html`)
- `demo.html` — 데모 본체(촬영 체크리스트 → 브라우저 내 영상 분석 → 결과 리포트)
- `assets/css/app.css` — 공통 스타일
- `assets/js/`
  - `config.js` — 공개 설정(Supabase URL·anon/publishable 키, 카카오 채널)
  - `supabase.js` — Supabase 클라이언트 + 익명/세션 식별자
  - `auth.js` — 간편 로그인(카카오/구글) 헤더 UI
  - `journey.js` — 방문 여정 기록(`journey_events`)

> ES 모듈을 쓰므로 **로컬에서는 웹서버로 열어야** 합니다(`python -m http.server 8000`).
> `file://` 더블클릭 시 분석이 막힙니다. Vercel(https) 배포본에서는 정상 동작합니다.

## 데이터 (Supabase 프로젝트 `adiqnrdgsmszmqvveoow`)

- `demo_responses` — 체크리스트/영상 지표 익명 INSERT(동의 후). 개인 식별정보 미수집.
- `journey_events` — 페이지 방문·클릭 등 익명 여정 기록.
- `profiles` — 로그인 사용자 프로필(선택).
- `inquiries` + `send-inquiry` Edge Function — 문의 폼.

## 배포

정적 사이트라 Vercel에서 별도 설정 없이 배포됩니다(루트 `index.html` 자동 서빙, `demo.html`·`assets/`는 정적 제공).

## 참고

- 클라이언트에 포함된 Supabase 키는 **공개(anon/publishable) 키**로 노출돼도 무방합니다.
  RLS로 INSERT만 허용되고 조회는 막혀 있습니다. `service_role` 키는 절대 커밋하지 않습니다.
- **영상은 저장하지 않습니다**: 브라우저 안에서 MediaPipe FaceLandmarker(CDN)로 씹기 지표만 추출해
  숫자·시계열만 저장합니다. 영상 픽셀은 기기를 떠나지 않습니다.
- 씹기 지표는 겉으로 보이는 턱 움직임 기반 **추정치**이며 **의료 진단이 아닙니다.**
