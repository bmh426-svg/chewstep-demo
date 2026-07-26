-- ============================================================================
-- 통합 Phase 5: get_my_landing 에 B2C 부모 분기 추가
-- 대상: qwfskemfsrkmlrdttvqy
--
-- 변경점: 기존엔 "역할/연결 없음" → guardian /report.html 로 폴백.
--         통합 후엔 그 폴백을 B2C 부모 → /demo.html 로 변경.
--         (staff/director/teacher/연결된 guardian 은 기존과 동일)
--
-- 롤백: 마지막 return 을
--   return jsonb_build_object('role','guardian','route','/report.html');
-- 으로 되돌리면 통합 전과 동일.
--
-- ⚠ 적용 시점: Phase 4(엣지함수 검증) 단계에서 적용. login.html 실시간 동작에 영향.
-- ============================================================================
create or replace function public.get_my_landing()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r text; gid uuid;
begin
  if uid is null then return jsonb_build_object('role','anon','route','/login.html'); end if;
  if exists (select 1 from chewstep_staff s where s.profile_id=uid and s.status='active') then
    return jsonb_build_object('role','staff','route','/console/'); end if;
  select om.role into r from organization_members om
    where om.profile_id=uid and om.status='active' order by (om.role='director') desc limit 1;
  if r='director' then return jsonb_build_object('role','director','route','/director/'); end if;
  if r='teacher'  then return jsonb_build_object('role','teacher','route','/teacher/'); end if;
  gid := current_guardian_id();
  if gid is not null and exists (select 1 from child_guardians cg where cg.guardian_id=gid) then
    return jsonb_build_object('role','guardian','route','/report.html'); end if;
  -- 통합(2026-07-26): 기관 소속·연결 없는 로그인 사용자 = B2C 부모 → 데모/내 아이 화면
  return jsonb_build_object('role','parent','route','/demo.html');
end $function$;
