-- ============================================================================
-- 2026-08-20 · 아이누리어린이집 오프라인 포스터 수요조사 20건 이관 (데이터)
--
-- 출처: 원내 포스터 수요조사 2026-07-22 ~ 07-31 (주관 CHEWSTEP · 협조 아이누리어린이집)
--       → `파일럿/파일럿준비/파일럿 포스터 문구.md`
--
-- ⚠ 개별 응답 원자료(반·연락처)를 보유하지 않아 아래로 넣는다.
--    · daycare_region = '세종'    ← 2026-08-20 확인(세종 국립 아이누리). daycare_key 가
--      (원이름|지역) 이라, 랜딩으로 "아이누리어린이집|세종시" 처럼 다르게 적힌 신청이
--      들어오면 그룹이 쪼개진다. 그때는 UPDATE 로 표기를 맞춰 합칠 것.
--    · child_age      = '미기재'  ← 폼 선택지 '기타' 와 구분하기 위해 다른 값을 쓴다.
--                                   (보호자가 '기타'를 고른 것이 아니라 우리가 모르는 것)
--    · contact        = null      ← 동의받지 않은 연락처를 만들어 넣지 않는다.
--
-- 재실행 안전: 같은 (source, daycare_name) 이 이미 있으면 아무것도 넣지 않는다.
-- 적용: 2026-08-20 · qwfskemfsrkmlrdttvqy (chewstep-b2b-prod) → 20행
-- ============================================================================

begin;

insert into public.lunch_demand
  (created_at, daycare_name, daycare_region, child_age, contact, contact_consent, source, note, is_test)
select
  timestamptz '2026-07-31 12:00:00+09',
  '국립아이누리어린이집',
  '세종',
  '미기재',
  null,
  false,
  'poster_survey',
  '2026-07-22~07-31 원내 포스터 수요조사 응답 20건 중 ' || g || '번. 개별 응답 원자료(지역·반·연락처) 미보유',
  false
from generate_series(1, 20) as g
where not exists (
  select 1 from public.lunch_demand
  where source = 'poster_survey' and daycare_name = '국립아이누리어린이집'
);

commit;
