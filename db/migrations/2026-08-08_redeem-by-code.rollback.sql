-- 롤백: 2026-08-08_redeem-by-code.sql
-- 기존 redeem_child_access_code(p_org, p_code) 는 건드리지 않았으므로 두 함수만 지운다.
begin;
drop function if exists public.redeem_child_access_code_by_code(text, text, boolean);
drop function if exists public.preview_child_access_code(text);
commit;
