// 실제 문의 메일 발송 테스트 (주기/수동 전용 — 데일리에서 분리).
// 실제로 Resend 발송(emailed:true)까지 확인하고, 남는 inquiries 행은 정리.
const { test, expect, request } = require("@playwright/test");

const SUPA_URL = process.env.SUPABASE_URL || "https://qwfskemfsrkmlrdttvqy.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_5cL015aIZo-fRKwXM16RkQ_NbzkzibH";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || "";
const MARK = "e2e-email-weekly";

test("실제 문의 메일 발송(Resend) 확인", async () => {
  const api = await request.newContext();
  const r = await api.post(`${SUPA_URL}/functions/v1/send-inquiry`, {
    headers: { apikey: ANON, "Content-Type": "application/json" },
    data: { type: "inquiry", email: "algo426@naver.com", message: "[E2E 주기] 실제 발송 테스트 — 자동 정리됨", source: MARK },
  });
  expect(r.ok(), "send-inquiry 200").toBeTruthy();
  const body = await r.json();
  expect(body.ok, "ok:true").toBeTruthy();
  expect(body.emailed, "실제 발송 emailed:true (SMTP/Resend 정상)").toBeTruthy();
  await api.dispose();

  // 남긴 inquiries 행 정리 (source 마커 스코프 — 운영 데이터 불가침)
  if (SERVICE_ROLE) {
    const admin = await request.newContext({ baseURL: SUPA_URL, extraHTTPHeaders: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } });
    const d = await admin.delete(`/rest/v1/inquiries?source=eq.${MARK}`, { headers: { Prefer: "return=representation" } });
    console.log(`🧹 정리: inquiries ${d.ok() ? (await d.json()).length : "ERR"}건(source=${MARK})`);
    await admin.dispose();
  } else {
    console.warn("⚠ SUPABASE_SERVICE_ROLE 없음 → inquiries 정리 스킵.");
  }
});
