-- 롤백 · 2026-08-08 상담 목록 비로그인 공개 → 다시 로그인 게이트로 되돌린다.
-- (2026-08-06_consultation-view-count.sql 의 함수 정의와 동일한 상태로 복구)

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
  where auth.uid() is not null
  order by c.created_at desc
  limit 500;
$$;

revoke all on function public.consultation_titles() from anon, public;
grant execute on function public.consultation_titles() to authenticated;
