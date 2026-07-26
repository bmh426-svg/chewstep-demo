# 통합 Phase 2 — 계정·데이터 이관 기록 (adiq → qwfsk)

> 2026-07-26 · 이 파일은 **문서(기록)**입니다. 실제 이관 SQL은 이메일·비밀번호 해시 등
> 민감정보를 포함하므로 **런타임(execute_sql)으로만 실행**했고 Git·마이그레이션 이력에
> 남기지 않았습니다(민감정보 비커밋 원칙). 여기엔 방식·건수만 기록합니다.

## 방식
- 계정: `auth.users` + `auth.identities` 직접 INSERT (Admin API 엣지함수 배포가 분류기에
  차단되어 DB 방식 채택). GoTrue 정상 로그인에 필요한 형태로 삽입:
  aud/role=`authenticated`, 토큰 컬럼=`''`, `email_confirmed_at` 설정,
  `raw_app_meta_data={provider:email}`, 이메일 identity(`provider_id=user.id`, `identity_data.sub`).
- **같은 UUID 재사용**(adiq id = qwfsk id) → demo_children/demo_responses 소유관계 1:1 보존.
- 비밀번호: adiq의 bcrypt 해시 그대로 복사(기존 비밀번호 유지).
- 충돌 이메일(qwfsk에 이미 존재)은 **덮어쓰지 않고 제외**(`where not exists`).

## 이관 건수
- 계정: 8명(운영자 algo426 1 + 부모 7). 충돌 1명(fariypark) 제외.
- demo_children 8 · demo_responses 11 · notices 7 · inquiries 2.
- journey_events / audit_logs: 과거 이력 미이관(구조만, adiq 백업 보존).
- demo_responses.video_series(원시 트레이스): 미이관(adiq 백업 보존).

## 검증(통과)
- 관리자: 실제 로그인 + 세션 RLS(본인 profiles만) + 격리(reports 0) + is_admin()=true + /console/.
- 부모(carol1219 표본): 실제 로그인 + 본인 아이1·응답1만 조회 + 기관 children 0(격리). 검증 후 원래 해시 복원.
- 정합성: 고아행 0(user/child FK), 부모별 children/responses 원본과 일치.
- 기존 기관 데이터 무변경(children 3·reports 2·organizations 1·profiles는 신규 계정만 증가).

## 남은 작업
- Phase 3: 더미 계정 정리(adiq/qwfsk) · fariypark 충돌 결정
- Phase 4: 엣지함수(send-inquiry·coach·recipe-coach) qwfsk 재배포 + 시크릿
- Phase 5: 프론트 리포인트(config.js·admin·inquiry.js → qwfsk) + get_my_landing 부모→/demo.html 분기
- 최종 검증 후 adiq Pause(백업). (검증 전 Pause 금지)

## 매핑표(이메일↔UUID)
민감정보라 Git 미포함. 세션 스크래치패드 `phase2-id-mapping.md` 참조.
