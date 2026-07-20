-- ============================================================================
-- Chewstep · 감사 로그(audit_logs) 뼈대 v1
-- 브랜치: feature/admin-auth   |  날짜: 2026-07-20
-- 목적: 운영·보안 이벤트 기록(append-only). 행동로그(페이지/클릭)는 기존 journey_events 담당.
-- 원칙: 클라이언트 직접 쓰기/수정/삭제 전면 차단 → SECURITY DEFINER 함수로만 기록.
--       조회는 관리자(is_admin)만. 가장 중요한 role/활성 변경은 서버 트리거가 자동 기록.
-- ============================================================================

-- ── 1) 테이블 ──────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email   text,          -- 조회 편의용 이메일 스냅샷
  action        text not null, -- login_success | logout | role_change | account_toggle
                               -- | comment_create | analysis_view | analysis_update | data_delete ...
  target_type   text,          -- 'profile' | 'demo_response' | 'inquiry' | ...
  target_id     text,          -- 대상 식별자(uuid/bigint 혼용 → text)
  metadata      jsonb,
  ip            text,
  user_agent    text
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx  on public.audit_logs (action);
create index if not exists audit_logs_actor_idx   on public.audit_logs (actor_user_id);

-- ── 2) RLS: 조회는 관리자만, 쓰기 정책은 두지 않음(=append-only, 함수로만 기록) ──
alter table public.audit_logs enable row level security;
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs
  for select to authenticated using (public.is_admin());
-- INSERT/UPDATE/DELETE 정책 없음 → 클라이언트가 직접 손댈 수 없음. 아래 함수로만 기록.

-- ── 3) 기록 함수: 클라이언트가 호출(로그인/로그아웃/댓글 등). actor는 위조 불가 ──
create or replace function public.log_audit(
  p_action      text,
  p_target_type text default null,
  p_target_id   text default null,
  p_metadata    jsonb default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then
    return;  -- 비로그인 상태의 임의 기록은 무시(로그인실패 등은 추후 서버훅에서)
  end if;
  insert into public.audit_logs (actor_user_id, actor_email, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    p_action, p_target_type, p_target_id, p_metadata
  );
end $$;
revoke all on function public.log_audit(text,text,text,jsonb) from public;
grant execute on function public.log_audit(text,text,text,jsonb) to authenticated;

-- ── 4) 서버 자동 기록: role/is_active 변경(가장 중요한 보안 이벤트) ─────────────
create or replace function public.audit_profile_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (new.role is distinct from old.role) then
    insert into public.audit_logs(actor_user_id, actor_email, action, target_type, target_id, metadata)
    values (auth.uid(), (select email from public.profiles where id=auth.uid()),
            'role_change', 'profile', new.id::text,
            jsonb_build_object('from', old.role, 'to', new.role, 'target_email', new.email));
  end if;
  if (new.is_active is distinct from old.is_active) then
    insert into public.audit_logs(actor_user_id, actor_email, action, target_type, target_id, metadata)
    values (auth.uid(), (select email from public.profiles where id=auth.uid()),
            'account_toggle', 'profile', new.id::text,
            jsonb_build_object('is_active', new.is_active, 'target_email', new.email));
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_profile on public.profiles;
create trigger trg_audit_profile after update on public.profiles
  for each row execute function public.audit_profile_change();

-- ============================================================================
-- 검증(별도): select action,actor_email,metadata,created_at from audit_logs order by created_at desc;
-- ============================================================================
