-- 롤백: 2026-08-11_storage-staff-upload.sql
--
-- 되돌리면 업로드는 다시 **service_role 키로만** 가능해진다.
-- 운영자 화면에서 영상을 올리는 경로가 닫히므로, 대체 경로(로컬 업로드 스크립트)가 있는지 먼저 확인할 것.
-- 읽기(st_report_staff 등 SELECT 정책)는 이 파일이 만든 것이 아니므로 건드리지 않는다.
begin;
drop policy if exists st_report_staff_del on storage.objects;
drop policy if exists st_report_staff_upd on storage.objects;
drop policy if exists st_report_staff_ins on storage.objects;
commit;
