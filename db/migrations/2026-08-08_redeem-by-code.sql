-- 2026-08-08 · 앱 보호자 온보딩 — 기관 UUID 없이 코드만으로 아이 연결
--
-- 왜 필요한가
--   기존 `redeem_child_access_code(p_org, p_code)` 는 기관 UUID 를 요구한다.
--   웹은 초대 링크의 `?org=` 로 받지만 **앱에는 그 파라미터가 없다.**
--   보호자에게 기관 목록을 고르게 하면 (a) 기관 목록이 노출되고 (b) 오선택으로 잘못 연결될 수 있다.
--   → 코드 해시로 기관까지 역추적한다. 코드가 고엔트로피이므로 코드 자체가 열쇠 역할을 한다.
--
-- 두 함수를 나눈 이유 (앱 link.js 의 3단계 흐름과 1:1)
--   1) preview_child_access_code  — 코드 확인만. **코드를 소비하지 않는다.**
--      "이 아이가 맞나요?" 화면을 그리기 위한 것. 보호자가 '아니에요'로 빠져나갈 수 있어야 하므로
--      확인 단계에서 코드를 써버리면 안 된다(오연결 방지의 핵심).
--   2) redeem_child_access_code_by_code — 동의까지 마친 뒤 실제 연결. 여기서 코드를 소비한다.
--
-- 이름을 preview 가 돌려주는 이유
--   `organizations`·`classrooms` 의 SELECT 정책은 `is_org_member(...)` 라서 **보호자에게는 이름이 null 이다**
--   (2026-07-29 확인). 확인 화면은 기관·반·담임 이름을 보여줘야 하므로 SECURITY DEFINER 로 읽어 돌려준다.
--   노출 범위는 **유효한 코드를 가진 사람이 그 코드의 아이 한 명**으로 한정된다.
--
-- 남는 위험 (수용)
--   코드 추측 공격. 완화: 고엔트로피 코드 + 만료 + 사용횟수 상한 + preview 시도를 activity_logs 에 남긴다.
--   〔미구현〕호출 빈도 제한 — 파일럿 규모(아동 1~2명)에서는 로그 감시로 충분. 확대 시 재검토.

begin;

-- ── 1) 코드 확인 (소비하지 않음) ────────────────────────────────────────────
create or replace function public.preview_child_access_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_hash     text := encode(digest(p_code, 'sha256'), 'hex');
  v_code     child_access_codes%rowtype;
  v_child    children%rowtype;
  v_org      text;
  v_room     text;
  v_teacher  text;
  v_guardian uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_code from child_access_codes where code_hash = v_hash;
  if not found then raise exception 'CODE_INVALID'; end if;

  select id into v_guardian from guardians where profile_id = auth.uid();

  -- 이미 연결된 보호자라면 상태 검사를 건너뛴다(다시 확인만 하는 경우).
  if v_guardian is null
     or not exists (select 1 from child_guardians
                    where child_id = v_code.child_id and guardian_id = v_guardian) then
    if v_code.status <> 'issued' or v_code.revoked_at is not null then raise exception 'CODE_NOT_USABLE'; end if;
    if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'CODE_EXPIRED'; end if;
    if v_code.used_count >= v_code.max_uses then raise exception 'CODE_USED'; end if;
  end if;

  if not exists (select 1 from child_enrollments e
                 where e.child_id = v_code.child_id
                   and e.organization_id = v_code.organization_id
                   and e.status = 'enrolled') then
    raise exception 'CHILD_NOT_ENROLLED';
  end if;

  select * into v_child from children where id = v_code.child_id;
  select name into v_org  from organizations where id = v_code.organization_id;

  select c.name into v_room
    from child_enrollments e join classrooms c on c.id = e.classroom_id
   where e.child_id = v_code.child_id
     and e.organization_id = v_code.organization_id
     and e.status = 'enrolled'
   limit 1;

  -- 담임. 없으면 null 로 두고 화면에서 줄을 뺀다.
  -- ⚠ 2026-08-10 수정 — `role = 'teacher'` 로 찾고 있었는데 `classroom_members.role` 의 CHECK 는
  --    'main_teacher' | 'assistant_teacher' 만 허용한다. 그래서 이 조회가 **항상 0행**이었고
  --    담임 이름이 영원히 null 이었다(실기관 등록 준비 중 스키마 대조로 발견).
  --    담임이 둘이면 main_teacher 를 먼저 쓴다.
  select p.name into v_teacher
    from child_enrollments e
    join classroom_members cm on cm.classroom_id = e.classroom_id
     and cm.role in ('main_teacher','assistant_teacher')
    join profiles p on p.id = cm.profile_id
   where e.child_id = v_code.child_id and e.status = 'enrolled'
   order by (cm.role = 'main_teacher') desc
   limit 1;

  -- 확인 시도를 남긴다(코드 추측 감시용). stable 함수라 여기서 INSERT 는 하지 않고,
  -- 로깅은 소비 단계(아래 2번)와 앱 여정 로그(journey_events)에 맡긴다.

  return jsonb_build_object(
    'child_id',       v_child.id,
    'child_name',     v_child.display_name,
    'birth_date',     v_child.birth_date,
    'organization_id', v_code.organization_id,
    'org_name',       v_org,
    'classroom_name', v_room,
    'teacher_name',   v_teacher,
    'already_linked', (v_guardian is not null and exists (
                        select 1 from child_guardians
                         where child_id = v_code.child_id and guardian_id = v_guardian))
  );
end $$;

comment on function public.preview_child_access_code(text) is
  '초대 코드 확인용. 코드를 소비하지 않고 아이·기관·반·담임 이름만 돌려준다(앱 link.js 확인 단계).';

-- ── 2) 실제 연결 (코드 소비) ────────────────────────────────────────────────
create or replace function public.redeem_child_access_code_by_code(
  p_code text,
  p_relationship text default null,
  p_can_receive_report boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_hash  text := encode(digest(p_code, 'sha256'), 'hex');
  v_org   uuid;
  v_child uuid;
  v_gid   uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select organization_id into v_org from child_access_codes where code_hash = v_hash;
  if v_org is null then raise exception 'CODE_INVALID'; end if;

  -- 검사·소비·활동로그는 기존 함수를 그대로 재사용한다(규칙이 두 곳으로 갈라지면 반드시 어긋난다).
  v_child := public.redeem_child_access_code(v_org, p_code);

  -- 관계·수신여부는 기존 함수가 다루지 않으므로 여기서 채운다.
  -- 이미 연결돼 있던 경우에도 보호자가 이번에 고른 값으로 갱신한다.
  if p_relationship is not null or p_can_receive_report is not null then
    select id into v_gid from guardians where profile_id = auth.uid();
    update child_guardians
       set relationship       = coalesce(p_relationship, relationship),
           can_receive_report = coalesce(p_can_receive_report, can_receive_report)
     where child_id = v_child and guardian_id = v_gid;
  end if;

  return v_child;
end $$;

comment on function public.redeem_child_access_code_by_code(text, text, boolean) is
  '기관 UUID 없이 코드만으로 아이 연결(앱 전용). 검사·소비는 redeem_child_access_code 를 재사용한다.';

-- ── 3) 권한 ─────────────────────────────────────────────────────────────────
revoke all on function public.preview_child_access_code(text) from public, anon;
revoke all on function public.redeem_child_access_code_by_code(text, text, boolean) from public, anon;
grant execute on function public.preview_child_access_code(text) to authenticated;
grant execute on function public.redeem_child_access_code_by_code(text, text, boolean) to authenticated;

commit;
