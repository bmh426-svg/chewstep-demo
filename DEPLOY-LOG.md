# 배포 기록 (프로덕션 = Vercel `chewstep-demo` · `main` 브랜치 · https://chewstep.com)

> 실제 실행·확인한 사실만 적는다. 추정은 〔추정〕 마커를 붙인다.
> 규칙: **무엇이 나갔는지 · 무엇을 일부러 뺐는지 · DB와 코드의 시차 · 롤백 방법 · 검증 결과**를 남긴다.

---

## 2026-07-29 — 관리자 사용자 활동 표시 · 메인 히어로(밥태기) · FAQ 문답

**나간 것** (`main` `6bb2faa` → `c6f9e6c`, 브랜치 `release/admin-activity-hero-faq` 보존)

| 커밋 | 범위 |
|---|---|
| `8280807` | 관리자 사용자 활동 표시 복원 — `profiles.last_login_at`·`is_active`, `touch_last_login()` RPC 호출(웹·관리자·콘솔), 사용자 탭 '최근 분석' 열·최근 활동순 정렬, `consult-write.html` 없는 컬럼 조회 수정 |
| `6c59a6b` | 메인 히어로 카피 교체(밥태기) + '밥태기·안 먹는 이유' 이중 키워드 메타(title·description·og·twitter·keywords·WebSite JSON-LD) + `GEO_전략.md` v1.1 |
| `c6f9e6c` | FAQ '밥태기가 뭔가요?' 문답 추가(FAQPage 구조화 데이터 포함, 진단 금지 문구 준수) |

**일부러 빼둔 것** — `feat/video-quality-and-draft` 에 그대로 유지한다. 직접 회귀 검증 후 별도 병합 예정.
- `38a4d73` 사용자 테스트 피드백 7건(세로영상·품질게이팅·재업로드·단계게이팅·촬영가이드·빈도수치화·임시저장)
- `50496bd` coach 엣지함수 v4 배포 + 소스 버전관리 시작

> ⚠ `feat/video-quality-and-draft` 에는 위 3범위와 **내용이 같은 커밋(`87c8c0c`·`3b59f15`)이 별도 해시로** 남아 있다.
> 나중에 그 브랜치를 병합할 때는 `git rebase origin/main` 으로 이미 적용된 패치를 떨어낸 뒤 병합할 것(중복 충돌 방지).

### ⚠ DB가 코드보다 먼저 적용된 구간 (부분 불일치)
- DB 마이그레이션 `profiles_activity_columns` = **2026-07-28 22:56 KST** 운영 DB 적용(`20260728135651`).
- 코드 `main` 병합·프로덕션 배포 = **2026-07-29 01:0x KST**.
- 그 사이(약 2시간) 상태: DB에는 `last_login_at`·`is_active`·`touch_last_login()` 이 있었지만 **배포된 앱 코드에는 호출이 없었다.**
  - 영향: 그 구간의 실제 로그인은 `last_login_at` 에 기록되지 않았다. 관리자 화면에는 `auth.users.last_sign_in_at` 백필 값만 보였다.
  - 역방향 위험 없음: 추가형 컬럼이고, 권한 축소(`anon`·`authenticated` 테이블 UPDATE 회수 → `name`·`phone` 만 허용)는 **클라이언트 코드가 쓰지 않던 컬럼**에만 영향한다(2026-07-28 기준 클라이언트 `profiles` UPDATE 호출 0건 확인).

### 롤백
- 코드: `main` 을 `6bb2faa` 로 되돌리면 된다(정적 사이트, 빌드 없음).
- DB: 되돌리지 않아도 무해하다(코드가 호출하지 않으면 컬럼이 남아 있을 뿐). 완전 롤백 SQL은
  `db/migrations/2026-07-28_profiles-activity-columns.sql` 헤더의 롤백 절 참조.
  단 권한 회수를 되돌리면 사용자가 자기 `user_type` 을 바꿀 수 있는 상태로 돌아간다 — 권장하지 않는다.

### 검증 (실제 실행 결과)
| 하네스 | 로컬(worktree, origin/main 기준) | 배포본(https://chewstep.com) |
|---|---|---|
| `verify/profiles-activity-check.mjs` | **21/21 PASS** | **21/21 PASS** |
| `verify/hero-faq-meta-check.mjs` | **25/25 PASS** | **25/25 PASS** |
| `verify/admin-delete-check.mjs` (관리자 회귀) | **31/31 PASS** | — |
| `verify/uac-admin-stage.mjs` (단계 현황 회귀) | 콘솔 오류 0 · 모든 탭 렌더 | — |

확인한 항목: 관리자 '최근 로그인' 표시 · 실제 로그인으로 새 활동 기록 · '최근 분석' 표시 ·
최근 활동순 정렬 · 관리자 기존 기능(삭제·복원 4겹 안전장치·단계 현황·테스트 계정 필터) 회귀 ·
`index.html` JSON-LD 3건 파싱 · title/description/H1/og/twitter 메타 · FAQPage 파싱 ·
페이지 콘솔 오류 0 · 모바일 390px 히어로 줄바꿈(낱말 붙음·가로 넘침 없음).

### 미확인 (남은 과제)
- '밥태기' 실제 검색량 — 네이버 검색광고 키워드도구·구글 키워드플래너로 측정 필요.
- 검색 반영 여부(색인·순위)는 배포 직후 확인 불가. 서치콘솔·네이버 서치어드바이저에서 며칠 뒤 확인.
