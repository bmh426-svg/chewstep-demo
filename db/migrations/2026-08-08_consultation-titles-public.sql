-- 2026-08-08 · 상담 목록의 '제목'을 로그인 없이 볼 수 있게 연다
-- ※ Supabase MCP apply_migration 으로 원격(qwfskemfsrkmlrdttvqy)에 적용. 이 파일은 저장소 기록용.
--
-- 무엇이 바뀌는가 (사용자 지시)
--   전:  consultation_titles() 는 auth.uid() 가 없으면 한 건도 돌려주지 않았고(로그인 게이트),
--        anon 에게는 execute 권한조차 없었다 → 비로그인은 상담 화면에서 목록 자체를 못 봤다.
--   후:  비로그인(anon)도 목록을 받는다. 다만 돌려주는 것은 전과 똑같이 '목록에 필요한 값'뿐이다
--        (제목·분류·공개여부·상태·조회수·게시일시). body·answer·user_id 는 여전히 나가지 않는다.
--
-- 열람(본문)은 그대로 로그인 필수
--   can_read 는 '상세로 들어가 본문을 읽을 수 있는가'라는 표시용 값이다.
--   비로그인은 공개글이라도 can_read=false 로 내려간다 → 화면은 '로그인하면 볼 수 있어요'로 안내하고,
--   설령 주소로 직접 들어가도 consultations 의 RLS(consult_select)가 본문을 주지 않는다.
--   즉 이번 변경은 '목록 제목의 노출 범위'만 넓히고, 본문 경계는 건드리지 않는다.
--
-- ⚠ 알고 넘어갈 것 — 비공개 글의 제목도 이제 인터넷 누구에게나 보인다.
--   (전에는 '로그인한 모든 사용자'에게 보였다. 범위가 로그인 사용자 → 전체로 넓어진다.)
--   그래서 글쓰기 화면(consult-write.html)의 안내 문구도 '로그인 없이도 보인다'로 함께 고쳤다.
--
-- 롤백: 2026-08-08_consultation-titles-public.rollback.sql

drop function if exists public.consultation_titles();

create or replace function public.consultation_titles()
returns table (
  id uuid,
  title text,
  category text,
  is_public boolean,
  status text,
  answered boolean,
  created_at timestamptz,
  view_count integer,
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
    (select count(*)::int from public.consultation_views v where v.consultation_id = c.id) as view_count,
    -- 본문 열람 가능 여부: 로그인해야 하고, 그 위에 공개글·본인글·관리자 조건이 붙는다.
    (auth.uid() is not null
      and (c.is_public or c.user_id = auth.uid() or public.is_admin())) as can_read,
    -- 비로그인은 '내 글'이 있을 수 없다 → null 대신 false 로 떨어뜨린다(화면이 배지 판단에 그대로 쓴다).
    (auth.uid() is not null and c.user_id = auth.uid())                 as is_mine
  from public.consultations c
  order by c.created_at desc
  limit 500;
$$;

comment on function public.consultation_titles() is
  '상담 목록(제목·상태·조회수·게시일시). 비로그인도 조회 가능(2026-08-08). body·answer·user_id 는 반환하지 않으며, 본문 열람은 consultations RLS 가 판단.';

revoke all on function public.consultation_titles() from public;
grant execute on function public.consultation_titles() to anon, authenticated;
