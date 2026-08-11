-- 2026-08-11 · 운영자(chewstep_staff)가 브라우저에서 리포트 미디어를 올릴 수 있게 한다
--
-- 지금까지의 문제
--   storage.objects 에 **INSERT 정책이 하나도 없었다**(SELECT 4개만 있었다).
--   그래서 업로드는 service_role 키로만 가능했고, 운영자가 화면에서 영상을 올릴 방법이 없었다.
--   할일 문서가 "원본→Storage(service_role)"로 정한 것은 **원본 360** 이야기이고,
--   보호자에게 보낼 클립·썸네일까지 로컬 스크립트로만 올리게 되면 운영 도구를 만들 수 없다.
--
-- 이 파일이 하는 일
--   `reports` · `child-crops` · `thumbnails` 세 버킷에 대해 **chewstep_staff 에게만**
--   INSERT/UPDATE/DELETE 를 연다. 읽기(SELECT)는 이미 st_*_staff 정책으로 열려 있었다.
--
-- 🚫 `original-360` 은 일부러 제외한다
--   원본은 편집 전 아동 얼굴이 그대로 담긴 자산이고, 보관·파기 규칙이 가장 엄격하다(retention_policies).
--   업로드 경로를 넓히면 실수로 올라간 원본이 파기 배치 밖에 남을 수 있다.
--   원본은 계속 service_role(수집 파이프라인)만 다룬다.
--
-- 보호자 노출과는 무관하다
--   보호자는 이 버킷을 직접 못 읽는다. 재생은 엣지함수 get-report-media-url 이
--   report_media.visible_to_guardian · report.status='published' · 보호자 여부 · 수신선택을
--   모두 확인한 뒤 짧은 만료 서명 URL 을 발급하는 경로로만 가능하다. 이 정책은 그 경로를 건드리지 않는다.
--
-- 되돌리기: 2026-08-11_storage-staff-upload.rollback.sql

begin;

-- 올리기
create policy st_report_staff_ins on storage.objects
  for insert to authenticated
  with check (bucket_id in ('reports','child-crops','thumbnails') and is_chewstep_staff());

-- 덮어쓰기(같은 경로 재업로드 · x-upsert)
create policy st_report_staff_upd on storage.objects
  for update to authenticated
  using      (bucket_id in ('reports','child-crops','thumbnails') and is_chewstep_staff())
  with check (bucket_id in ('reports','child-crops','thumbnails') and is_chewstep_staff());

-- 잘못 올린 파일 치우기. 파기 배치(scheduled_delete_at)와 별개로 운영자가 즉시 지울 수 있어야 한다.
create policy st_report_staff_del on storage.objects
  for delete to authenticated
  using (bucket_id in ('reports','child-crops','thumbnails') and is_chewstep_staff());

commit;
