# 배포 기록 (프로덕션 = Vercel `chewstep-demo` · `main` 브랜치 · https://chewstep.com)

> 실제 실행·확인한 사실만 적는다. 추정은 〔추정〕 마커를 붙인다.
> 규칙: **무엇이 나갔는지 · 무엇을 일부러 뺐는지 · DB와 코드의 시차 · 롤백 방법 · 검증 결과**를 남긴다.

---

## 2026-08-06 — 상담게시판: 목록은 제목만(리스트형) + 조회수·게시일시

**나간 것** (`main` `58673a8` → 이 커밋, 브랜치 `release/consult-list-views` 보존)

지시: "상담하기는 제목만 나오게 리스트 형식으로. 내용·답변이 바로 보이지 않게 하고,
제목·조회수·게시 날짜시간이 보이도록."

| 범위 | 내용 |
|---|---|
| 목록 | `consult.html` + `assets/js/consult.js` — 카드 펼침(본문·답변·관리자 답변폼 전부 노출)을 **한 줄 리스트**로 교체. 한 줄 = 제목 · (비공개 🔒) · (내 글) · 답변상태 · 조회수 · 게시일시(분까지) |
| 상세 | `consult-view.html` + `assets/js/consult-view.js` **신설** — 본문·간호사 답변·관리자 답변폼·삭제는 여기로 옮겼다. 열람 권한은 화면이 아니라 `consultations` RLS 가 판단(주소를 직접 쳐도 남의 비공개 본문은 내려오지 않는다) |
| 글쓰기 | `consult-write.html` — "비공개로 남기더라도 **제목은 목록에 보여요**" 안내 추가(목록이 제목을 보여주게 됐으므로 쓰기 전에 알아야 하는 사실) |

**왜 목록에서 본문을 뺐나** — 이전 목록은 남의 상담 본문·간호사 답변이 스크롤만 하면 다 읽혔고,
글이 쌓이면 목록으로서 못 쓰게 된다. 이제 목록 함수는 `body`·`answer`·`user_id` 를 **애초에 돌려주지 않는다**.

**조회수 = '읽은 사람 수'** — 카운터 컬럼 +1 방식을 쓰지 않았다.
`consultations` 에는 `BEFORE UPDATE` 트리거(`updated_at = now()`)가 있어 조회가 '수정시각'을 오염시키고,
새로고침으로 숫자를 부풀릴 수 있다. 대신 `(글, 열람자)` 한 쌍만 기록하는 표를 세므로 같은 사람은 몇 번 봐도 1이다.
집계는 **상세 진입 + 읽을 권한 있음**일 때만 일어난다(목록만 본 것은 세지 않는다).

### DB (코드보다 먼저 적용됨)
| 마이그레이션 | 적용 시각(KST) | 내용 |
|---|---|---|
| `consultation_list_titles` (2026-07-29 파일) | 2026-07-29 | `consultation_titles()` — 목록용 security definer 함수(제목·상태만) |
| `consultation_view_count` (2026-08-06 파일) | **2026-08-06 배포 직전** | `consultation_views` 표 + `consultation_view(uuid)` RPC + `consultation_titles()` 에 `view_count` 추가 |

- DB가 먼저 나가 있어도 **역방향 위험 없음**: 배포 전 `main` 코드는 두 함수를 호출하지 않았고(직접 `consultations` 조회),
  `consultation_titles()` 재생성은 반환 컬럼 추가뿐이다. `consultation_views` 는 RLS 정책이 하나도 없어
  `anon`·`authenticated` 가 직접 읽거나 쓸 수 없다(RPC 만 기록).
- 〔추정〕 그 시차 동안 발생한 열람은 집계되지 않았다 — 코드가 없었으므로 기록될 수 없다. 조회수는 배포 시점부터 쌓인다.

### 롤백
- 코드: `main` 을 `58673a8` 로 되돌리면 목록이 옛 카드형으로 돌아간다(정적 사이트, 빌드 없음).
  단 그 상태는 **남의 상담 본문이 목록에서 읽히는** 상태라는 점을 알고 되돌려야 한다.
- DB: `db/migrations/2026-08-06_consultation-view-count.rollback.sql`(열람 기록도 함께 사라진다) ·
  `2026-07-29_consultation-list-titles.rollback.sql`.

### 검증 (실제 실행 결과)
| 하네스 | 로컬(릴리스 worktree = 이 커밋 내용) | 배포본(https://chewstep.com) |
|---|---|---|
| `verify/consult-list-check.mjs` | **52/52 PASS** | 아래 '미확인' 참조 |

확인한 항목: 목록에 본문·답변·관리자 답변폼·삭제버튼 없음 · 제목/조회수/게시일시(분) 표시 ·
비공개 글 자물쇠 2건 · 읽을 수 있는 글만 링크(남의 비공개는 `.locked`) · 제목 클릭 → 상세 진입 ·
상세 진입 시 열람 집계 1회(재렌더 시 재호출 없음) · 차단된 글은 집계도 안 함 ·
남의 비공개 주소 직접 진입 시 본문 미노출 · 관리자만 답변폼 · 본인·관리자만 삭제 · 비로그인 게이트 ·
390px 에뮬레이션(가로 스크롤 0 · 상태·조회수·게시일시 한 줄 유지) · 콘솔 오류 0.

> 하네스는 Supabase 를 route 로 가로채 흉내낸다(실계정 불필요). 함께 갱신한 이유: 옛 `consultation_list` 뷰를
> 흉내내고 ROOT 경로가 옛 위치(`../chewstep-app`)를 보고 있어 **동작하지 않는 상태(stale)** 였다.

### 일부러 빼둔 것
`feat/evidence-based-report` 의 나머지(근거 기반 처방·영상 품질 게이팅·설문 미응답 표시·coach v4 등)는
그대로 브랜치에 남긴다. 이 릴리스는 상담게시판 파일 5개 + 마이그레이션 4개만 골라 올렸다.

### 미확인 (남은 과제)
- 조회수 숫자는 배포 후 실제 계정으로 상세를 열어봐야 1 이상으로 오른다(현재 기존 글 전부 0에서 시작).
  → 과거 열람 기록은 없다. 기존 글의 조회수는 **배포 시점부터** 세기 시작한다.
- 실기기(갤럭시) 확인은 하지 않았다 — 390px 에뮬레이션까지만.
- 배포본(https://chewstep.com) 라이브 검증은 로그인 계정이 필요하다(`verify/uac-consult-live.mjs` 계열).

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
