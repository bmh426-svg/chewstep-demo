// Chewstep 데일리 E2E 스모크 (프로덕션 chewstep.com → qwfsk)
// 점검: 메인/데모 접속 · 로그인 · 부모 라우팅 · 데모→결과화면 · 제품추천/JS 404 ·
//       prep/pitch 접근 · 콘솔·네트워크 오류 · 문의 함수 응답(dryRun).
// 안전: 테스트가 만든 demo_children/demo_responses는 실행 후 정리(테스트 계정 + 실행시각 스코프).
//       실제 문의 메일 발송은 여기서 하지 않음(dryRun). 운영 데이터 삭제 테스트 없음.
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "https://chewstep.com";
const SUPA_URL = process.env.SUPABASE_URL || "https://qwfskemfsrkmlrdttvqy.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_5cL015aIZo-fRKwXM16RkQ_NbzkzibH";
const E2E_EMAIL = process.env.E2E_EMAIL || "chewstep.e2e@gmail.com";
const E2E_PW = process.env.E2E_PASSWORD || "chewstep-e2e-1234";
const E2E_USER_ID = process.env.E2E_USER_ID || "9d1799f0-af75-4683-ba7a-38efe1055925"; // chewstep.e2e (qwfsk)
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || ""; // 정리용(GitHub Actions 시크릿). 없으면 정리 스킵.

// 무해한(기대되는) 콘솔/네트워크 잡음 필터
const BENIGN = /favicon|gtag|googletag|analytics|doubleclick|kakao|hotjar|INFO:|XNNPACK|TensorFlow|delegate|Deprecation|preload|the server responded|ResizeObserver/i;

test.describe.serial("Chewstep 데일리 스모크", () => {
  let context, page;
  const consoleErrors = [];
  const failedReq = [];
  let runStartISO;

  test.beforeAll(async ({ browser }) => {
    runStartISO = new Date(Date.now() - 60000).toISOString(); // 정리 기준: 실행 1분 전부터
    context = await browser.newContext({ permissions: ["camera", "microphone"], baseURL: BASE });
    page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error" && !BENIGN.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e.message).slice(0, 200)));
    page.on("response", (r) => { const s = r.status(); const u = r.url();
      if (s >= 400 && !BENIGN.test(u) && (u.includes("chewstep.com") || u.endsWith(".js") || u.includes("/functions/") || u.includes("/rest/"))) failedReq.push(s + " " + u); });
    page.on("requestfailed", (r) => { const u = r.url(); if (!BENIGN.test(u)) failedReq.push("FAILED " + u + " (" + (r.failure()?.errorText || "") + ")"); });
  });

  test.afterAll(async () => {
    // ── 안전 정리: 테스트 계정(chewstep.e2e) + 이번 실행 이후 생성분만 삭제 ──
    if (SERVICE_ROLE) {
      const api = await request.newContext({ baseURL: SUPA_URL, extraHTTPHeaders: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } });
      // 필터: user_id = 테스트계정 AND created_at >= 실행시각 (이중 스코프 → 운영/타 사용자 데이터 불가침)
      const scope = `user_id=eq.${E2E_USER_ID}&created_at=gte.${encodeURIComponent(runStartISO)}`;
      const d1 = await api.delete(`/rest/v1/demo_responses?${scope}`, { headers: { Prefer: "return=representation" } });
      const d2 = await api.delete(`/rest/v1/demo_children?${scope}`, { headers: { Prefer: "return=representation" } });
      const n1 = d1.ok() ? (await d1.json()).length : "ERR";
      const n2 = d2.ok() ? (await d2.json()).length : "ERR";
      console.log(`🧹 정리: demo_responses ${n1}건 · demo_children ${n2}건 삭제(chewstep.e2e, ${runStartISO} 이후)`);
      await api.dispose();
    } else {
      console.warn("⚠ SUPABASE_SERVICE_ROLE 없음 → 테스트 데이터 정리 스킵(로컬은 수동 정리).");
    }
    await context?.close();
  });

  const loginIfGate = async () => {
    const m = page.locator(".cs-modal.open");
    if ((await m.count()) && (await m.isVisible().catch(() => false))) {
      await page.fill(".cs-modal.open input[name=email]", E2E_EMAIL);
      await page.fill(".cs-modal.open input[name=password]", E2E_PW);
      await page.click(".cs-modal.open .cs-eform button[type=submit]");
      await m.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
    }
  };

  test("핵심 사용자 흐름", async ({ browser }) => {
    // 1) 메인 페이지
    await test.step("메인 페이지 정상 접속", async () => {
      const resp = await page.goto("/", { waitUntil: "load" });
      expect(resp.status(), "홈 200").toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
    });

    // 2) 부모 라우팅: login.html 로그인 → /demo.html (별도 컨텍스트=깨끗한 로그인)
    await test.step("로그인 + 부모 페이지 라우팅(login.html→/demo.html)", async () => {
      const c2 = await browser.newContext({ baseURL: BASE });
      const p2 = await c2.newPage();
      await p2.goto("/login.html", { waitUntil: "load" });
      await p2.fill("#email", E2E_EMAIL); await p2.fill("#pw", E2E_PW); await p2.click("#submitBtn");
      await p2.waitForURL(/\/demo\.html/, { timeout: 20000 });
      expect(p2.url()).toContain("/demo.html");
      await c2.close();
    });

    // 3) 데모 접속 + 로그인 + 입력 → 4) 결과화면
    await test.step("데모 접속·로그인·입력 → 결과화면 표시", async () => {
      await page.goto("/demo.html", { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await loginIfGate();  // 로그인 모달이 로드 시 뜨면 처리
      // 인트로(월령 입력)가 보이면 진행 → 이후 모달이 뜰 수도 있음
      if (await page.locator("#introStart").isVisible().catch(() => false)) {
        await page.fill("#introAge", "16"); await page.click("#introStart");
        await page.waitForTimeout(600); await loginIfGate();
      }
      // 아이 화면: 기존 아이 있으면 '새 분석'으로 재사용(신규 생성 최소화), 없으면 등록
      await page.waitForSelector("#screenChild.active", { timeout: 20000 });
      // 목록/폼은 비동기 렌더 → 새분석 버튼 또는 등록폼이 나타날 때까지 대기
      await page.waitForSelector("#screenChild.active button[data-act='new'], #screenChild.active #childName", { state: "visible", timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(400);
      const reuse = page.locator("#screenChild.active button[data-act='new']").first();
      if (await reuse.count()) {
        await reuse.scrollIntoViewIfNeeded().catch(() => {});
        await reuse.click({ force: true });
      } else {
        const addBtn = page.locator("#childAddNew");
        if ((await addBtn.count()) && (await addBtn.isVisible().catch(() => false))) await addBtn.click();
        await page.waitForSelector("#childName", { state: "visible", timeout: 10000 });
        await page.fill("#childName", "E2E테스트아이");
        await page.fill("#childAge", "16");
        await page.evaluate(() => {
          const r = document.querySelector("#screenChild.active input[type=radio]");
          if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        });
        await page.click("#childSave");
      }

      // 설문(있으면) 6스텝 자동응답 → 업로드 화면 (재사용 아이는 설문을 건너뛸 수 있음)
      await page.waitForSelector("#screenSurvey.active, #screenUpload.active", { timeout: 15000 });
      if (await page.locator("#screenSurvey.active").count()) {
      await page.waitForSelector('input[name="concern"]', { timeout: 8000 });
      for (let s = 1; s <= 6; s++) {
        await page.evaluate(() => {
          const vis = [...document.querySelectorAll(".sv-step")].find((e) => e.style.display !== "none"); if (!vis) return;
          const labelText = (r) => ((r.closest("label") || r.parentElement || {}).textContent || "");
          const seen = new Set();
          vis.querySelectorAll("input[type=radio]").forEach((r) => {
            if (seen.has(r.name)) return; seen.add(r.name);
            // 같은 그룹에서 '아니오'(안전) 옵션 우선 → 안전 게이팅 미발동, 정상 결과+제품추천 경로 검증
            const group = [...vis.querySelectorAll('input[type=radio][name="' + (window.CSS && CSS.escape ? CSS.escape(r.name) : r.name) + '"]')];
            const safe = group.find((x) => labelText(x).includes("아니오"));
            const pick = safe || r;
            pick.checked = true; pick.dispatchEvent(new Event("change", { bubbles: true }));
          });
          const cs = new Set(); vis.querySelectorAll("input[type=checkbox]").forEach((c) => { if (!cs.has(c.name)) { cs.add(c.name); c.checked = true; } });
          const liked = document.querySelector("#r_liked"); if (liked) liked.value = "계란찜";
          const prac = document.querySelector("#r_practice"); if (prac) prac.value = "소고기";
        });
        await page.click(".sv-next"); await page.waitForTimeout(350);
        if (await page.evaluate(() => !!document.querySelector("#screenUpload.active"))) break;
      }
      }
      await page.waitForSelector("#screenUpload.active", { timeout: 12000 });

      // 이전 영상 업로드 경로 → 합성 webm 주입 → 분석
      const prev = page.locator("#choosePrev"); if (await prev.count()) await prev.click();
      await page.waitForSelector("#file", { state: "attached", timeout: 8000 });
      await page.evaluate(async () => {
        const cv = document.createElement("canvas"); cv.width = 320; cv.height = 240; const c = cv.getContext("2d"); let k = 0, raf = 0;
        const dr = () => { c.fillStyle = "#222"; c.fillRect(0, 0, 320, 240); c.fillStyle = "#6cf"; c.fillRect(k++ % 280, 100, 40, 40); raf = requestAnimationFrame(dr); }; dr();
        const vs = cv.captureStream(15); const ac = new AudioContext(); const nb = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
        const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const n = ac.createBufferSource(); n.buffer = nb; n.loop = true; const g = ac.createGain(); g.gain.value = .3;
        const dest = ac.createMediaStreamDestination(); n.connect(g); g.connect(dest); n.start();
        const mix = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        const rec = new MediaRecorder(mix, { mimeType: "video/webm;codecs=vp8,opus" }); const ch = [];
        rec.ondataavailable = (e) => e.data.size && ch.push(e.data); const done = new Promise((r) => (rec.onstop = r));
        rec.start(); await new Promise((r) => setTimeout(r, 3500)); rec.stop(); await done; cancelAnimationFrame(raf); try { ac.close(); } catch (e) {}
        const f = new File([new Blob(ch, { type: "video/webm" })], "e2e.webm", { type: "video/webm" });
        const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById("file"); inp.files = dt.files;
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      // 결과화면 도달 + 리포트 렌더
      await page.waitForSelector("#screenResult.active", { timeout: 45000 });
      await page.waitForFunction(() => { const s = document.getElementById("secReport"); return s && s.style.display !== "none" && s.innerText.length > 50; }, null, { timeout: 20000 });
      expect(await page.locator("#screenResult.active").count()).toBeGreaterThan(0);
    });

    // 5) 제품추천 영역(배포되어 있으면) + 관련 JS 404 없음
    await test.step("제품추천 영역 + JS 404 없음", async () => {
      const api = await request.newContext();
      const prodDeployed = (await api.get(`${BASE}/assets/js/products.js`)).status() === 200;
      await api.dispose();
      if (prodDeployed) {
        const prod = await page.waitForFunction(() => { const s = document.getElementById("secProducts"); return s && s.style.display !== "none" && s.innerText.trim().length > 0; }, null, { timeout: 12000 }).then(() => true).catch(() => false);
        expect(prod, "결과화면 제품추천(#secProducts) 노출").toBeTruthy();
      } else {
        console.warn("ℹ 제품추천(products.js) 미배포(WIP) — 이 항목 스킵. 배포되면 자동 검증됨.");
        test.info().annotations.push({ type: "skipped", description: "products.js 미배포(WIP)" });
      }
      // 배포된 JS 중 404 없어야(미배포 WIP는 애초에 요청 안 됨)
      expect(failedReq.filter((x) => /\.js(\?|$| )/.test(x)), "JS 파일 404 없음").toEqual([]);
    });

    // 6) prep.html / pitch.html 접근 (미배포면 스킵 — request로 확인해 page 오류수집 미오염)
    await test.step("prep.html · pitch.html 접근", async () => {
      const api = await request.newContext();
      for (const path of ["/prep.html", "/pitch.html"]) {
        const r = await api.get(`${BASE}${path}`);
        if (r.status() === 404) { console.warn(`ℹ ${path} 미배포(WIP) — 스킵. 배포되면 자동 검증됨.`); test.info().annotations.push({ type: "skipped", description: path + " 미배포" }); continue; }
        expect(r.status(), path + " 200").toBeLessThan(400);
        expect((await r.text()).length, path + " 내용 있음").toBeGreaterThan(500);
      }
      await api.dispose();
    });

    // 7) 문의 함수 응답(dryRun — 실제 메일/저장 없음)
    await test.step("문의 함수 정상 응답(dryRun)", async () => {
      const api = await request.newContext();
      const r = await api.post(`${SUPA_URL}/functions/v1/send-inquiry`, {
        headers: { apikey: ANON, "Content-Type": "application/json" },
        data: { type: "inquiry", dryRun: true, message: "e2e-daily dryRun", source: "e2e-daily" },
      });
      expect(r.ok(), "send-inquiry 200").toBeTruthy();
      const body = await r.json();
      expect(body.ok, "ok:true").toBeTruthy();
      expect(body.dryRun, "dryRun 확인").toBeTruthy();
      await api.dispose();
    });

    // 8) 콘솔/네트워크 오류 없음(전체 흐름 누적)
    await test.step("콘솔 오류 · 네트워크 실패 없음", async () => {
      expect(consoleErrors, "콘솔 에러").toEqual([]);
      expect(failedReq, "네트워크 4xx/실패").toEqual([]);
    });
  });
});
