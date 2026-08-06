-- 2026-08-06 · 상담 목록에 '조회수' 추가 (제목 · 상태 · 조회수 · 게시일시)
-- ※ Supabase MCP apply_migration 으로 원격(qwfskemfsrkmlrdttvqy)에 적용됨. 이 파일은 저장소 기록용.
--
-- 왜 컬럼(consultations.view_count)이 아니라 별도 테이블인가
--   1) consultations 에는 BEFORE UPDATE 트리거(consult_touch → updated_at = now())가 걸려 있다.
--      조회할 때마다 UPDATE 를 하면 '수정시각'이 조회로 갱신돼 답변·수정 이력이 오염된다.
--   2) 카운터 컬럼을 +1 하는 방식은 새로고침·뒤로가기로 얼마든지 부풀 수 있다.
--   그래서 (글, 열람자) 한 쌍을 한 번만 기록하고, 조회수 = 그 행의 개수로 센다.
--   → 같은 사람이 100번 새로고침해도 1이다. '몇 사람이 읽었는가'를 뜻하는 정직한 숫자.
--
-- 집계 대상
--   로그인한 사용자가 '읽을 수 있는 글'(공개글·본인글·관리자)을 실제로 열었을 때만 1건 기록한다.
--   목록만 본 것은 세지 않는다(제목만 보이므로 읽은 게 아니다).
--   글쓴이 본인·관리자(간호사)의 열람도 1명으로 포함된다 — 각자 한 번씩만 세므로 왜곡이 없다.
--
-- 롤백: 2026-08-06_consultation-view-count.rollback.sql

-- 1) 열람 기록 — (글, 열람자) 유일. 조회수는 이 표를 센 값이다.
create table if not exists public.consultation_views (
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  viewer_id       uuid not null references auth.users(id)            on delete cascade,
  first_viewed_at timestamptz not null default now(),
  primary key (consultation_id, viewer_id)
);

comment on table public.consultation_views is
  '상담 열람 기록(글·열람자 유일). 조회수 = 이 표의 행 수 = 읽은 사람 수. 직접 접근 불가(RPC 로만 기록).';

-- 화면에서 직접 읽거나 쓰지 못하게 잠근다. 기록·집계는 아래 security definer 함수만 한다.
alter table public.consultation_views enable row level security;
revoke all on table public.consultation_views from anon, authenticated;
-- (정책을 하나도 두지 않았으므로 RLS 아래에서는 어떤 역할도 행을 보거나 넣을 수 없다)

-- 2) 상세 화면 진입 시 호출 — 열람을 기록하고 현재 조회수를 돌려준다.
--    읽을 권한이 없으면 아무것도 기록하지 않고 null 을 돌려준다(권한 판단은 여기서도 DB 가 한다).
create or replace function public.consultation_view(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_can boolean;
  v_cnt integer;
begin
  if auth.uid() is null then
    return null;                       -- 상담은 로그인 게이트
  end if;

  select (c.is_public or c.user_id = auth.uid() or public.is_admin())
    into v_can
    from public.consultations c
   where c.id = p_id;

  if v_can is not true then
    return null;                       -- 없는 글이거나 남의 비공개 글 → 집계도 안 한다
  end if;

  insert into public.consultation_views (consultation_id, viewer_id)
  values (p_id, auth.uid())
  on conflict (consultation_id, viewer_id) do nothing;   -- 두 번째 열람부터는 늘지 않는다

  select count(*)::int into v_cnt
    from public.consultation_views
   where consultation_id = p_id;

  return v_cnt;
end;
$$;

comment on function public.consultation_view(uuid) is
  '상담 열람 기록 + 조회수 반환. 읽을 권한 없으면 null(기록도 하지 않음). 같은 사용자의 재열람은 세지 않는다.';

revoke all on function public.consultation_view(uuid) from anon, public;
grant execute on function public.consultation_view(uuid) to authenticated;

-- 3) 목록 함수에 view_count 추가 — 반환 타입이 바뀌므로 drop 후 재생성한다.
--    나머지 계약(body·answer·user_id 는 돌려주지 않는다)은 2026-07-29 파일과 동일하다.
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
    (c.is_public or c.user_id = auth.uid() or public.is_admin()) as can_read,
    (c.user_id = auth.uid())                                     as is_mine
  from public.consultations c
  where auth.uid() is not null          -- 상담은 로그인 게이트: 비로그인은 한 건도 보지 못한다
  order by c.created_at desc
  limit 500;
$$;

comment on function public.consultation_titles() is
  '상담 목록(제목·상태·조회수·게시일시). body·answer·user_id 는 반환하지 않는다. 본문 열람은 consultations RLS 가 판단.';

revoke all on function public.consultation_titles() from anon, public;
grant execute on function public.consultation_titles() to authenticated;
