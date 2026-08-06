-- 2026-07-29 · 상담게시판 목록을 '제목만' 보여주기 위한 함수(consultation_titles)
-- ※ Supabase MCP apply_migration 으로 원격(qwfskemfsrkmlrdttvqy)에 이미 적용됨. 이 파일은 저장소 기록용.
--
-- 왜 필요한가
--   상담 목록에 비공개 글도 '제목 + 자물쇠'로 보여주기로 했다(사용자 지시).
--   consultations 의 RLS(consult_select)는 남의 비공개 글을 행 자체로 감추므로 제목조차 알 수 없고,
--   RLS 를 열면 body·answer 까지 새어 나간다. 그래서 목록에 필요한 컬럼만 돌려주는
--   security definer 함수를 두고, 본문은 계속 원본 테이블 RLS 로 지킨다.
--
-- 노출/비노출 경계 (이 함수의 계약)
--   돌려줌  : id · title · category · is_public · status · answered · created_at · can_read · is_mine
--   안 돌려줌: body · answer · answered_by · user_id
--   ⚠ 비공개 글의 '제목'은 로그인한 모든 사용자에게 보인다 —
--     그래서 글쓰기 화면(consult-write.html)에 "제목은 목록에 공개된다"는 안내를 함께 넣었다.
--
-- 왜 뷰가 아니라 함수인가
--   처음에는 뷰(consultation_list)로 만들었는데 Supabase advisor 가 security_definer_view 를
--   ERROR 로 잡는다(RLS 우회 뷰 탐지). 같은 경계를 함수로 옮기면 다른 헬퍼(is_admin 등)와
--   동일한 WARN 등급이 되어, 감사 결과에서 ERROR 가 남지 않는다.
--
-- can_read : 상세로 들어가 본문을 읽을 수 있는가(공개글·본인글·관리자).
--            목록에서 제목을 링크로 만들지 자물쇠만 둘지 결정하는 '표시용' 값이다.
--            실제 차단은 화면이 아니라 consultations RLS 가 한다.
--
-- 로그인 게이트: auth.uid() 가 없으면 한 건도 돌려주지 않고, anon 은 execute 권한 자체가 없다.
-- 롤백: 2026-07-29_consultation-list-titles.rollback.sql

create or replace function public.consultation_titles()
returns table (
  id uuid,
  title text,
  category text,
  is_public boolean,
  status text,
  answered boolean,
  created_at timestamptz,
  can_read boolean,
  is_mine boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id,
    c.title,
    c.category,
    c.is_public,
    c.status,
    (c.status = 'answered' and c.answer is not null) as answered,
    c.created_at,
    (c.is_public or c.user_id = auth.uid() or public.is_admin()) as can_read,
    (c.user_id = auth.uid())                                     as is_mine
  from public.consultations c
  where auth.uid() is not null          -- 상담은 로그인 게이트: 비로그인은 한 건도 보지 못한다
  order by c.created_at desc
  limit 500;
$$;

comment on function public.consultation_titles() is
  '상담 목록(제목만). body·answer·user_id 는 반환하지 않는다. 본문 열람은 consultations RLS 가 판단.';

revoke all on function public.consultation_titles() from anon, public;
grant execute on function public.consultation_titles() to authenticated;
