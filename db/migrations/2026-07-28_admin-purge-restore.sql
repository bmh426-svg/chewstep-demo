-- 2026-07-28 · 관리자 기록 삭제/복원 (더미·테스트 데이터 정리용)
--
-- 왜 RPC로 감싸는가 (그냥 .delete() 로도 되는데):
--   1) 한 번에 지울 수 있는 건수에 상한(50)을 둔다 → '전체선택 → 전멸' 사고 차단
--   2) demo_responses 와 연관 journey_events 를 한 트랜잭션에서 함께 정리
--   3) 무엇을 지웠는지 audit_logs 에 id 목록까지 남긴다 (audit_logs 는 append-only)
--   4) 복원 경로를 함께 제공 → 삭제가 '되돌릴 수 있는' 작업이 된다
--
-- ⚠ Free 플랜에는 PITR/자동백업이 없다. 관리자 UI는 삭제 직전 JSON 백업을
--    반드시 내려받게 되어 있고, admin_restore_demo_responses 가 그 파일을 되돌린다.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1) 삭제: 분석 기록 + (선택) 연관 여정 로그
-- ─────────────────────────────────────────────────────────────
create or replace function public.admin_purge_demo_responses(
  p_ids          uuid[],
  p_purge_events boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n        int;
  v_sessions text[];
  v_events   int := 0;
begin
  if not public.is_admin() then
    raise exception '관리자만 삭제할 수 있습니다.' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception '삭제할 기록을 선택해 주세요.' using errcode = '22023';
  end if;
  -- 안전 상한: 한 번에 50건. 더 지우려면 나눠서 실행(그만큼 확인을 더 거치게 된다).
  if array_length(p_ids, 1) > 50 then
    raise exception '한 번에 최대 50건까지만 삭제할 수 있습니다. (요청 %건)', array_length(p_ids, 1)
      using errcode = '22023';
  end if;

  -- 지울 기록들이 쓰던 session_id 를 먼저 모아 둔다(삭제 후에는 알 수 없으므로)
  select array_agg(distinct session_id) into v_sessions
  from public.demo_responses
  where id = any(p_ids) and session_id is not null;

  delete from public.demo_responses where id = any(p_ids);
  get diagnostics v_n = row_count;

  -- 연관 여정 로그: 같은 session_id 를 쓰는 '남아 있는' 기록이 없을 때만 지운다.
  -- (한 세션에서 분석을 두 번 했고 하나만 지우는 경우, 남은 기록의 타임라인을 보존)
  if p_purge_events and v_sessions is not null then
    delete from public.journey_events e
    where e.session_id = any(v_sessions)
      and not exists (
        select 1 from public.demo_responses d where d.session_id = e.session_id
      );
    get diagnostics v_events = row_count;
  end if;

  insert into public.audit_logs (actor_user_id, actor_email, action, target_type, metadata)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    'data_delete',
    'demo_response',
    jsonb_build_object(
      'deleted',        v_n,
      'events_deleted', v_events,
      'ids',            to_jsonb(p_ids),
      'text',           v_n || '건 삭제' || case when v_events > 0 then ' · 여정로그 ' || v_events || '건' else '' end
    )
  );

  return jsonb_build_object('deleted', v_n, 'events_deleted', v_events);
end $$;

revoke all on function public.admin_purge_demo_responses(uuid[], boolean) from public, anon;
grant execute on function public.admin_purge_demo_responses(uuid[], boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) 복원: 삭제 직전 내려받은 JSON 백업을 되돌린다
--    같은 id 가 이미 있으면 건너뛴다(중복 복원 안전).
--    여정 로그는 복원 대상이 아니다 — 삭제 전 백업에도 포함되지 않는다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.admin_restore_demo_responses(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception '관리자만 복원할 수 있습니다.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception '복원 파일 형식이 올바르지 않습니다(배열이 아님).' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception '한 번에 최대 200건까지만 복원할 수 있습니다.' using errcode = '22023';
  end if;

  insert into public.demo_responses
  select * from jsonb_populate_recordset(null::public.demo_responses, p_rows)
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;

  insert into public.audit_logs (actor_user_id, actor_email, action, target_type, metadata)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    'data_restore',
    'demo_response',
    jsonb_build_object('restored', v_n, 'submitted', jsonb_array_length(p_rows),
                       'text', v_n || '건 복원(요청 ' || jsonb_array_length(p_rows) || '건)')
  );

  return jsonb_build_object('restored', v_n, 'submitted', jsonb_array_length(p_rows));
end $$;

revoke all on function public.admin_restore_demo_responses(jsonb) from public, anon;
grant execute on function public.admin_restore_demo_responses(jsonb) to authenticated;

commit;
