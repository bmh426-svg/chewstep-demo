// ============================================================================
// Chewstep B2B — Edge Function: get-report-media-url  (v0.3 · 2026-07-28)
//
// v0.3 변경(영상분석 PRD v0.2 §B-3-A ④ · 사용자 승인 2026-07-28)
//   · TTL 300초 → 900초. 보호자 기기 분석은 "영상 다운로드 + 모델 로딩(3.6~4.3초 워밍업)
//     + 최대 2분 재생 + 재시도"를 한 URL 로 버텨야 해서 5분은 부족했다(실측).
//   · 응답에 issued_at / expires_at 을 추가한다. 클라이언트가 만료 60~90초 전에
//     **선제 재발급**하려면 만료 시각을 알아야 한다. 실측에서 만료가 오류 이벤트로
//     드러나지 않는 경우가 있었다(이미 버퍼된 구간은 계속 재생 · readyState=4)
//     → 오류를 기다리는 방식은 쓸 수 없다.
//   · URL 자체는 어디에도 저장하지 않는다(요청할 때마다 새로 발급).
// 보호자가 리포트 미디어(편집영상/썸네일/리포트영상)를 볼 때, 아래를 모두 검증한 뒤
// 짧은 만료 signed URL을 발급한다. (원본 360은 절대 발급하지 않음)
//   1) 로그인(JWT) 유효
//   2) report_media.visible_to_guardian = true
//   3) report.status = 'published'
//   4) media_asset 미삭제 + 허용 타입(child_crop/thumbnail/report_video)
//   5) 호출자가 그 아이의 보호자
//   6) 보호자 수신선택(delivery_type)과 자산 타입 일치
//        meal_video → report_video·child_crop·thumbnail / thumbnail_only → thumbnail / analysis_only → 없음
// 요청: POST { "report_media_id": "<uuid>" }  ·  헤더: Authorization: Bearer <user JWT>
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SIGNED_URL_TTL = 900; // 초 (15분) — v0.3. 클라이언트는 만료 60~90초 전에 선제 재발급한다.
const BUCKET: Record<string, string> = {
  child_crop: "child-crops",
  thumbnail: "thumbnails",
  report_video: "reports",
};
const ALLOW_BY_PREF: Record<string, string[]> = {
  meal_video: ["report_video", "child_crop", "thumbnail"],
  thumbnail_only: ["thumbnail"],
  analysis_only: [],
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  // ⚠ apikey 를 빠뜨리면 브라우저에서 호출이 프리플라이트에서 막힌다.
  //   앱의 authFetch 는 apikey·Authorization·Content-Type 을 함께 보내고(auth.js),
  //   supabase-js 도 apikey·x-client-info 를 보낸다. 이 함수는 지금까지 UI 에서
  //   호출된 적이 없어 이 문제가 드러나지 않았다(2026-07-28 실측으로 발견).
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "AUTH_REQUIRED" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) JWT 검증 → 사용자 id
    const { data: u, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !u?.user) return json(401, { error: "INVALID_TOKEN" });
    const uid = u.user.id;

    const { report_media_id } = await req.json().catch(() => ({}));
    if (!report_media_id) return json(400, { error: "report_media_id_required" });

    // 2~4) report_media → report + media_asset 체인
    const { data: rm } = await admin
      .from("report_media")
      .select(
        "visible_to_guardian, reports(status, child_id), media_assets(id, asset_type, storage_path, deleted_at)",
      )
      .eq("id", report_media_id)
      .maybeSingle();
    if (!rm) return json(404, { error: "NOT_FOUND" });
    if (!rm.visible_to_guardian) return json(403, { error: "NOT_VISIBLE" });

    const report = rm.reports as unknown as { status: string; child_id: string };
    const asset = rm.media_assets as unknown as {
      id: string; asset_type: string; storage_path: string; deleted_at: string | null;
    };
    if (!report || report.status !== "published") return json(403, { error: "NOT_PUBLISHED" });
    if (!asset || asset.deleted_at) return json(404, { error: "ASSET_DELETED" });
    if (!(asset.asset_type in BUCKET)) return json(403, { error: "FORBIDDEN_TYPE" });

    // 5) 호출자가 그 아이의 보호자인가
    const { data: g } = await admin.from("guardians").select("id").eq("profile_id", uid).maybeSingle();
    if (!g) return json(403, { error: "NOT_GUARDIAN" });
    const { data: link } = await admin
      .from("child_guardians").select("id")
      .eq("child_id", report.child_id).eq("guardian_id", g.id).maybeSingle();
    if (!link) return json(403, { error: "NOT_GUARDIAN" });

    // 6) 수신선택과 자산 타입 일치
    const { data: pref } = await admin
      .from("report_delivery_preferences").select("delivery_type")
      .eq("child_id", report.child_id).eq("guardian_id", g.id).eq("is_active", true).maybeSingle();
    const dtype = pref?.delivery_type ?? "analysis_only";
    if (!(ALLOW_BY_PREF[dtype] ?? []).includes(asset.asset_type)) {
      return json(403, { error: "PREFERENCE_MISMATCH", delivery_type: dtype });
    }

    // signed URL 발급
    const bucket = BUCKET[asset.asset_type];
    const { data: signed, error: sErr } = await admin.storage
      .from(bucket).createSignedUrl(asset.storage_path, SIGNED_URL_TTL);
    if (sErr || !signed) return json(500, { error: "SIGN_FAILED", detail: sErr?.message });

    // 감사 로그
    await admin.from("activity_logs").insert({
      actor_profile_id: uid, action: "issue_signed_url",
      target_type: "media_asset", target_id: asset.id,
      metadata: { bucket, delivery_type: dtype, ttl: SIGNED_URL_TTL },
    });

    // 클라이언트 선제 재발급용 시각. URL 은 저장하지 않고, 이 시각만 메모리에 들고 있는다.
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + SIGNED_URL_TTL * 1000);
    return json(200, {
      url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  } catch (e) {
    return json(500, { error: "INTERNAL", detail: String(e) });
  }
});
