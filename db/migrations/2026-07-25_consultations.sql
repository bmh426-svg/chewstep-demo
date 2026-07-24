-- 2026-07-25 · 1:1 식습관 상담 게시판(consultations)
-- 소아과 간호사(관리자)가 답변. 글쓴이가 글마다 공개/비공개를 선택.
-- RLS: 공개글 OR 본인글 OR 관리자만 조회 / 로그인 사용자 본인 명의 작성 / 답변(수정)은 관리자 / 삭제는 본인·관리자.
-- ※ Supabase MCP apply_migration으로 원격에 이미 적용됨. 이 파일은 저장소 기록용.

create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  child_age_months int,
  category text,
  title text not null,
  body text not null,
  is_public boolean not null default false,   -- 글쓴이가 선택(기본 비공개)
  status text not null default 'open',          -- open | answered
  answer text,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consultations enable row level security;

create index if not exists consultations_user_idx on public.consultations(user_id);
create index if not exists consultations_pub_idx  on public.consultations(is_public, created_at desc);

drop policy if exists consult_select on public.consultations;
create policy consult_select on public.consultations for select
  using ( is_public = true or auth.uid() = user_id or is_admin() );

drop policy if exists consult_insert on public.consultations;
create policy consult_insert on public.consultations for insert
  with check ( auth.uid() = user_id );

drop policy if exists consult_admin_update on public.consultations;
create policy consult_admin_update on public.consultations for update
  using ( is_admin() ) with check ( is_admin() );

drop policy if exists consult_delete on public.consultations;
create policy consult_delete on public.consultations for delete
  using ( auth.uid() = user_id or is_admin() );

create or replace function public.consult_touch_updated() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists consult_set_updated on public.consultations;
create trigger consult_set_updated before update on public.consultations
  for each row execute function public.consult_touch_updated();

grant select on public.consultations to anon, authenticated;
grant insert, update, delete on public.consultations to authenticated;
