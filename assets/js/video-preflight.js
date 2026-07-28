// video-preflight.js — 분석을 시작하기 '전에' 영상 품질을 확인한다.
// ─────────────────────────────────────────────────────────────────────
// 배경 (2026-07-28 · 사용자 테스트 피드백 #2·#5)
//   얼굴이 잘리거나 인식되지 않은 영상도 일반 분석 결과처럼 출력됐다.
//   보호자는 부정확한 결과를 정상 결과로 오해한다.
//   기존 구조는 영상을 끝까지 재생·분석한 뒤(finish()) 품질을 판정했고,
//   품질이 낮아도(low_face) 결과 화면을 그렸다.
//
// 그래서 재생 전에 영상 전체에 걸쳐 표본 프레임을 뽑아 먼저 확인한다.
//   · 얼굴 검출률
//   · 턱·입 주변 랜드마크 검출률
//   · 얼굴이 프레임 안에 들어온 비율
//   · 영상 밝기
//   · 영상 길이
//   · 씹기 동작으로 판단할 수 있는 프레임 수
// 기준 미달이면 일반 결과를 만들지 않고 '분석 제한' 상태로 안내한다.
//
// 표본만 보므로 전체 재생보다 훨씬 빠르다(기본 12점). 원본 영상은 저장하지 않는다.

/* ── 판정 기준 ── 이 표만 고치면 게이팅 강도가 바뀝니다.
   ⚠ 2026-07-28 사용자 지시: 실기기 촬영본으로 오탐·미탐을 확인하기 전까지 **숫자를 바꾸지 않는다.**
      아래 값은 '품질 충분(pass)' 의 기준선이며, 3단계 판정 도입 시에도 그대로 유지했습니다. */
export const THRESHOLDS = {
  minDuration: 3,          // 초 — 이보다 짧으면 씹기 패턴을 볼 수 없다
  minFaceRate: 0.4,        // 표본 중 얼굴이 검출된 비율
  minMouthRate: 0.4,       // 표본 중 입·턱 주변 랜드마크까지 잡힌 비율
  minInFrameRate: 0.6,     // 얼굴이 검출된 표본 중, 얼굴이 프레임 안에 온전히 들어온 비율
  minBrightness: 0.10,     // 0~1 — 이보다 어두우면 검출이 불안정하다
  minChewableFrames: 3,    // 턱 움직임을 읽을 수 있는 표본 수
  samples: 12,             // 영상 전체에 걸쳐 뽑는 표본 수
  seekTimeout: 1500,       // ms — 한 표본의 시크 대기 상한
};

/* ── 하드 차단 바닥(BLOCK) ── 3단계 판정용으로 신설(2026-07-28).
   THRESHOLDS 는 그대로 두고, 그 '아래'에 진행 자체를 막는 바닥만 추가했습니다.

     품질 충분(pass)   : THRESHOLDS 를 모두 충족 → 정상 진행
     경계(warn)        : BLOCK 은 넘지만 THRESHOLDS 미달 → 경고 후 사용자가 계속 진행 가능
     매우 낮음(block)  : BLOCK 미달 → 진행 차단(결과를 만들지 않는다)

   경계 구간을 만든 이유: 얼굴이 30% 정도만 보이는 영상은 지표 신뢰가 낮지만
   보호자가 "그래도 보고 싶다"고 판단할 수 있는 수준이다. 반대로 얼굴이 거의 안 잡힌
   영상(<15%)은 어떤 결과도 근거가 없어 막는 것이 맞다.
   길이·디코딩 실패는 경계가 성립하지 않아 항상 차단이다. */
export const BLOCK_THRESHOLDS = {
  minFaceRate: 0.15,       // 이보다 낮으면 씹기를 논할 근거가 없다
  minMouthRate: 0.10,      // 입·턱이 거의 안 보이면 턱 움직임을 읽을 수 없다
  minInFrameRate: 0.25,    // 얼굴이 대부분 잘려 있으면 랜드마크가 의미를 잃는다
  minBrightness: 0.04,     // 사실상 암전
  minChewableFrames: 1,    // 턱벌림을 한 번도 읽지 못하면 씹기 판단 불가
};

/* 3단계 판정 결과 라벨 */
export const TIER = { PASS: "pass", WARN: "warn", BLOCK: "block" };

// MediaPipe FaceLandmarker 468점 중 입·턱 주변 대표 인덱스
//   13/14 위·아래 입술 중앙 · 61/291 입꼬리 · 152 턱끝 · 17 아랫입술 아래
const MOUTH_IDX = [13, 14, 61, 291, 152, 17];

/* 얼굴이 프레임 안에 온전히 들어왔는지 —
   정규화 좌표가 0~1 밖으로 나가면 그만큼 화면 밖(=잘림)이다.
   세로 영상이 잘려 위아래가 날아간 경우가 여기서 잡힌다. */
function faceInFrame(landmarks, margin = 0.02) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const inside = minX >= -margin && minY >= -margin && maxX <= 1 + margin && maxY <= 1 + margin;
  return { inside, box: { minX, minY, maxX, maxY } };
}

/* 프레임 평균 밝기(0~1). 캔버스를 작게 줄여 빠르게 훑는다. */
function frameBrightness(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) {       // 성긴 표본 — 밝기는 정밀도가 필요 없다
      sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      n++;
    }
    return n ? (sum / n) / 255 : null;
  } catch (e) { return null; }
}

/* 지정 시각으로 시크하고 프레임이 준비될 때까지 기다린다.
   seeked 가 오지 않는 브라우저·코덱도 있어 타임아웃으로 빠져나온다. */
function seekTo(video, t, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; cleanup(); resolve(ok); };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    function cleanup() {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      clearTimeout(timer);
    }
    const timer = setTimeout(() => finish(false), timeout);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try { video.currentTime = t; } catch (e) { finish(false); }
  });
}

/* ── 프리플라이트 실행 ──
   video : 이미 src 가 걸려 메타데이터까지 읽힌 <video> (재생 중이 아니어야 한다)
   fl    : MediaPipe FaceLandmarker (runningMode:"VIDEO")
   opts  : { samples, onProgress(done, total) }
   반환  : { ok, reason, metrics{...}, message }  — ok=false 면 분석을 시작하지 않는다 */
export async function runPreflight(video, fl, opts) {
  const o = opts || {};
  const T = THRESHOLDS;
  const samples = o.samples || T.samples;
  const duration = (video && isFinite(video.duration)) ? video.duration : 0;
  const vw = video ? video.videoWidth : 0;
  const vh = video ? video.videoHeight : 0;

  const metrics = {
    duration: duration ? +duration.toFixed(2) : 0,
    width: vw, height: vh,
    sampled: 0, faces: 0, mouths: 0, inFrame: 0, chewable: 0,
    faceRate: 0, mouthRate: 0, inFrameRate: 0, brightness: null,
    faceBoxAvg: null,
  };

  // 길이는 프레임을 보지 않고도 판정할 수 있다 — 먼저 끊는다.
  if (!duration || duration < T.minDuration) return decide(metrics);
  if (!vw || !vh) return decide(metrics);

  // 분석용 캔버스(원본 크기) + 밝기용 축소 캔버스
  const big = document.createElement("canvas"); big.width = vw; big.height = vh;
  const bctx = big.getContext("2d", { willReadFrequently: false });
  const small = document.createElement("canvas"); small.width = 64; small.height = 64;
  const sctx = small.getContext("2d", { willReadFrequently: true });

  // 영상 앞뒤 끝은 빈 프레임이 많아 5%~95% 구간에서 균등하게 뽑는다.
  const times = [];
  for (let i = 0; i < samples; i++) {
    times.push(duration * (0.05 + 0.90 * (i / Math.max(1, samples - 1))));
  }

  let brightSum = 0, brightN = 0, jawSum = 0, jawMin = 1, jawMax = 0;
  let boxSum = { w: 0, h: 0, n: 0 };
  let ts = 0;   // detectForVideo 는 단조 증가 타임스탬프를 요구한다

  const wasMuted = video.muted;
  video.muted = true;
  try { video.pause(); } catch (e) { /* 이미 정지 */ }

  for (let i = 0; i < times.length; i++) {
    const ok = await seekTo(video, times[i], T.seekTimeout);
    if (!ok) continue;
    metrics.sampled++;
    try { bctx.drawImage(video, 0, 0, vw, vh); } catch (e) { continue; }

    // 밝기 — 축소 캔버스에 다시 그려 빠르게
    try {
      sctx.drawImage(video, 0, 0, small.width, small.height);
      const b = frameBrightness(sctx, small.width, small.height);
      if (b != null) { brightSum += b; brightN++; }
    } catch (e) { /* 밝기 실패는 치명적이지 않다 */ }

    let res = null;
    ts += 40;
    try { res = fl.detectForVideo(big, ts); } catch (e) { res = null; }

    const lms = res && res.faceLandmarks && res.faceLandmarks[0];
    if (lms && lms.length) {
      metrics.faces++;
      const fit = faceInFrame(lms);
      if (fit.inside) metrics.inFrame++;
      boxSum.w += (fit.box.maxX - fit.box.minX);
      boxSum.h += (fit.box.maxY - fit.box.minY);
      boxSum.n++;
      // 입·턱 랜드마크가 모두 프레임 안에 있는지 — 입이 잘리면 씹기를 읽을 수 없다
      const mouthOk = MOUTH_IDX.every((idx) => {
        const p = lms[idx];
        return p && p.x >= -0.02 && p.x <= 1.02 && p.y >= -0.02 && p.y <= 1.02;
      });
      if (mouthOk) metrics.mouths++;
      // 턱벌림(jawOpen)을 읽을 수 있으면 씹기 판단이 가능한 프레임
      const bs = res.faceBlendshapes && res.faceBlendshapes[0];
      if (bs) {
        const jaw = bs.categories.find((c) => c.categoryName === "jawOpen");
        if (jaw) {
          metrics.chewable++;
          jawSum += jaw.score;
          if (jaw.score < jawMin) jawMin = jaw.score;
          if (jaw.score > jawMax) jawMax = jaw.score;
        }
      }
    }
    if (typeof o.onProgress === "function") o.onProgress(i + 1, times.length);
  }

  video.muted = wasMuted;
  try { video.currentTime = 0; } catch (e) { /* 무해 */ }

  const s = Math.max(1, metrics.sampled);
  metrics.faceRate = +(metrics.faces / s).toFixed(3);
  metrics.mouthRate = +(metrics.mouths / s).toFixed(3);
  metrics.inFrameRate = metrics.faces ? +(metrics.inFrame / metrics.faces).toFixed(3) : 0;
  metrics.brightness = brightN ? +(brightSum / brightN).toFixed(3) : null;
  metrics.jawRange = metrics.chewable ? +(jawMax - jawMin).toFixed(3) : 0;
  metrics.faceBoxAvg = boxSum.n ? { w: +(boxSum.w / boxSum.n).toFixed(3), h: +(boxSum.h / boxSum.n).toFixed(3) } : null;

  return decide(metrics);
}

/* ── 판정 (3단계) ─────────────────────────────────────────────────
   반환: { tier, ok, canProceed, reason, metrics, checks[] }
     tier       : "pass" | "warn" | "block"
     ok         : tier === "pass"        (기존 호출부 호환)
     canProceed : tier !== "block"       — warn 이면 사용자가 계속 진행할 수 있다
     checks     : 항목별 기준값·실측값·통과여부 (테스트 리포트용)

   판정 순서가 곧 안내 문구의 우선순위다(가장 근본적인 원인부터). */
export function decide(metrics) {
  const T = THRESHOLDS, B = BLOCK_THRESHOLDS;
  const m = metrics || {};

  // 항목별 근거를 남긴다 — 실기기 검증에서 "왜 이렇게 판정됐나"를 추적하려면 필요하다
  const checks = [
    { key: "duration", label: "영상 길이", value: m.duration, pass: T.minDuration, block: null, unit: "초" },
    { key: "faceRate", label: "얼굴 검출률", value: m.faceRate, pass: T.minFaceRate, block: B.minFaceRate, unit: "" },
    { key: "inFrameRate", label: "프레임 내 비율", value: m.inFrameRate, pass: T.minInFrameRate, block: B.minInFrameRate, unit: "" },
    { key: "mouthRate", label: "입·턱 검출률", value: m.mouthRate, pass: T.minMouthRate, block: B.minMouthRate, unit: "" },
    { key: "brightness", label: "밝기", value: m.brightness, pass: T.minBrightness, block: B.minBrightness, unit: "" },
    { key: "chewable", label: "씹기 판단 가능 표본", value: m.chewable, pass: T.minChewableFrames, block: B.minChewableFrames, unit: "개" },
  ].map((c) => Object.assign(c, {
    okPass: c.value != null && c.value >= c.pass,
    okBlock: c.block == null ? (c.value != null && c.value >= c.pass) : (c.value != null && c.value >= c.block),
  }));

  const out = (tier, reason) => ({
    tier, ok: tier === TIER.PASS, canProceed: tier !== TIER.BLOCK, reason, metrics: m, checks,
  });

  // ① 경계가 성립하지 않는 항목 — 길이·디코딩은 항상 차단
  if (!m.duration || m.duration < T.minDuration) return out(TIER.BLOCK, "too_short");
  if (!m.sampled) return out(TIER.BLOCK, "undecodable");

  // ② 하드 차단 바닥 — 어떤 결과도 근거가 없는 수준
  const dark = m.brightness != null && m.brightness < B.minBrightness;
  if (m.faceRate < B.minFaceRate) return out(TIER.BLOCK, dark ? "too_dark" : "no_face");
  if (m.inFrameRate < B.minInFrameRate) return out(TIER.BLOCK, "face_cropped");
  if (m.mouthRate < B.minMouthRate) return out(TIER.BLOCK, "mouth_hidden");
  if (dark) return out(TIER.BLOCK, "too_dark");
  if (m.chewable < B.minChewableFrames) return out(TIER.BLOCK, "no_chew_signal");

  // ③ 품질 충분 기준(THRESHOLDS) 미달 → 경계: 경고하고 사용자 판단에 맡긴다
  if (m.faceRate < T.minFaceRate) return out(TIER.WARN, "no_face");
  if (m.inFrameRate < T.minInFrameRate) return out(TIER.WARN, "face_cropped");
  if (m.mouthRate < T.minMouthRate) return out(TIER.WARN, "mouth_hidden");
  if (m.brightness != null && m.brightness < T.minBrightness) return out(TIER.WARN, "too_dark");
  if (m.chewable < T.minChewableFrames) return out(TIER.WARN, "no_chew_signal");

  return out(TIER.PASS, "pass");
}

/* ── 안내 문구 ──
   사용자 요청 문안을 기준으로, 원인별로 '무엇을 다시 하면 되는지'까지 적는다.
   rotationMismatch 는 video-meta.js 가 알려준다(회전 메타와 표시 비율 불일치). */
export function preflightMessage(reason, metrics, meta) {
  const m = metrics || {};
  const pct = (v) => Math.round((v || 0) * 100);
  const rotated = meta && meta.rotationMismatch;

  const base = {
    too_short: {
      title: "영상이 너무 짧아요",
      body: `영상 길이가 ${m.duration || 0}초예요. 씹는 모습을 보려면 <b>최소 3초, 가능하면 20~30초</b> 정도가 필요해요.`,
    },
    undecodable: {
      title: "영상을 열 수 없어요",
      body: "브라우저가 이 영상을 읽지 못했어요. <b>mp4</b>로 변환해 올리거나 ‘지금 촬영’으로 다시 시도해 주세요.",
    },
    no_face: {
      title: "아이 얼굴을 찾지 못했어요",
      body: rotated
        ? "이 영상은 <b>회전 정보가 담겨 있어</b> 화면에서 아이 얼굴이 누운 상태로 읽혔어요. 그래서 얼굴을 찾지 못했어요. 촬영한 방향 그대로 보이는 영상으로 다시 올려 주세요."
        : `표본 프레임 중 얼굴이 보인 구간이 <b>${pct(m.faceRate)}%</b>뿐이에요. 아이 <b>얼굴 전체가 보이는 영상</b>을 다시 올려 주세요.`,
    },
    face_cropped: {
      // 사용자 요청 문안
      title: "아이의 얼굴이 화면에서 일부 잘렸어요",
      body: "아이의 얼굴이 화면에서 일부 잘려 분석이 어렵습니다.<br><b>얼굴 전체가 보이는 영상을 다시 올려 주세요.</b>"
        + (meta && meta.orientation === "portrait"
          ? " 세로 영상도 괜찮아요 — 얼굴 전체가 화면 <b>중앙</b>에 들어오도록 찍어 주세요."
          : ""),
    },
    mouth_hidden: {
      title: "입과 턱이 충분히 보이지 않아요",
      body: `얼굴은 보이는데 <b>입·턱 주변</b>이 가려진 구간이 많았어요(입·턱이 보인 구간 ${pct(m.mouthRate)}%). 손이나 식기로 입이 오래 가려지지 않게 찍어 주세요.`,
    },
    too_dark: {
      title: "영상이 너무 어두워요",
      body: "화면이 어두워 얼굴을 안정적으로 찾기 어려웠어요. <b>밝은 곳</b>에서 다시 찍어 주세요.",
    },
    no_chew_signal: {
      title: "씹는 움직임을 확인할 구간이 부족해요",
      body: "얼굴은 보이지만 <b>실제로 씹는 장면</b>이 담긴 구간이 부족했어요. 음식이 입에 들어가 씹는 부분이 포함된 영상을 올려 주세요.",
    },
  };
  return base[reason] || {
    title: "이 영상으로는 분석이 어려워요",
    body: "얼굴과 턱이 잘 보이는 영상으로 다시 올려 주세요.",
  };
}
