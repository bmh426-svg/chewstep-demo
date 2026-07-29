// observe.js — 영상 landmark 시계열 → **자동 판정이 확실한 관찰 지표만** 추출
// ─────────────────────────────────────────────────────────────────────
// B단계 ② (2026-07-29)
//   입력: demo.html 이 이미 저장하는 시계열(demo_responses.video_series)
//         { t[], jaw_open[], jaw_left[], jaw_right[], tongue_out[] }  (얼굴 검출 프레임만, 12fps)
//   → 과거 기록에도 소급 적용할 수 있다(원본 영상 없이 재계산 가능).
//
// ★ 자동 추출하는 것 (기술적으로 비교적 확실한 것만)
//     usable_video_ratio      분석에 쓸 수 있었던 비율
//     face_segments           얼굴이 보인 구간
//     chew_bursts             씹기 움직임이 이어진 구간
//     chew_burst_*_sec        씹기 지속 시간
//     long_processing         씹지 않고 시간이 흐른 긴 구간 ('처리 시간이 긴 구간')
//     laterality              좌우 움직임 경향
//     processed / skipped / effective_fps
//
// ★ 자동 판정하지 않는 것 (NEVER_AUTO) — 사용자 지시
//     실제 삼킴 · 뱉음 · 입안에 음식이 남아 있는 상태 · 혀와 입천장으로 으깨는 행동 ·
//     사레 · 정확한 한입 크기
//   턱 움직임만으로는 구분이 불가능하다. 예를 들어 '긴 무저작 구간'은
//     ① 입에 물고 있음  ② 이미 삼키고 다음 한입을 기다림  ③ 얼굴이 조금 돌아감
//   중 어느 것이든 될 수 있다. 그래서 이 모듈은 사실만 말한다 —
//   "8.4초 동안 씹는 움직임이 없었다". 그것이 머금음인지는 태그(사람)가 결정한다.
//   NEVER_AUTO 키가 출력에 섞이면 verify/observation-rules-check.mjs 가 실패한다.
//
// import 없음(순수 함수) — node 에서 직접 검증한다.
// 검증: cd verify && node observation-rules-check.mjs

/* 이 모듈이 절대 만들어서는 안 되는 사실 — meal-context.js TAG_ONLY_FACTS 와 짝을 이룬다. */
export const NEVER_AUTO = [
  "swallowed", "swallowed_ok", "spit", "spit_after_chew", "spit_immediately",
  "pocketing", "residue_in_mouth", "tongue_mash", "choke_sign", "bite_size", "no_chew_swallow",
];

/* 문턱값 — demo.html 의 실시간 검출과 같은 값을 쓴다(다르면 화면 숫자와 어긋난다).
   OPEN/CLOSE 는 히스테리시스, MIN_CHEW_DT 는 지터 중복 카운트 방지. */
export const T = {
  OPEN: 0.11,
  CLOSE: 0.07,
  MIN_CHEW_DT: 0.15,
  BURST_GAP: 1.2,      // 씹기 사이 간격이 이보다 길면 다른 버스트로 본다
  LONG_PROCESS: 4.0,   // 씹지 않고 흐른 시간이 이보다 길면 '처리 시간이 긴 구간'
  FACE_GAP: 0.5,       // 시계열 t 간격이 이보다 크면 얼굴을 놓친 것으로 본다
  NOMINAL_FPS: 12,     // 샘플링 목표(demo.html SAMPLE_DT = 1/12)
  MIN_SAMPLES: 24,     // 이보다 적으면 구간 해석을 하지 않는다(2초 미만)
  LATERAL_DIFF: 20,    // 좌우 비율이 50에서 이만큼 벗어나면 '한쪽 경향'
};

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/* ── 씹기 사이클 검출 ──
   demo.html 과 같은 방식: 열림(>=OPEN) → 닫힘(<=CLOSE) 전이를 1회로 센다.
   시계열은 '얼굴이 검출된 프레임만' 담고 있으므로, 얼굴을 놓친 구간을 건너뛸 때
   상태를 닫힘으로 초기화한다(놓친 사이에 벌어진 입을 씹기로 오카운트하지 않게). */
function detectChews(t, jaw) {
  const chews = [];
  let state = "closed", last = -1e9;
  for (let i = 0; i < t.length; i++) {
    if (i > 0 && (t[i] - t[i - 1]) > T.FACE_GAP) state = "closed";
    const jo = jaw[i] == null ? 0 : jaw[i];
    if (state === "closed" && jo >= T.OPEN) state = "open";
    else if (state === "open" && jo <= T.CLOSE) {
      state = "closed";
      if (t[i] - last >= T.MIN_CHEW_DT) { chews.push(r2(t[i])); last = t[i]; }
    }
  }
  return chews;
}

/* ── 얼굴이 보인 구간 ── 시계열의 시간 간격이 벌어진 곳을 경계로 나눈다. */
function faceSegments(t) {
  const segs = [];
  if (!t.length) return segs;
  let start = t[0];
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] > T.FACE_GAP) {
      segs.push({ start: r1(start), end: r1(t[i - 1]), dur: r1(t[i - 1] - start) });
      start = t[i];
    }
  }
  segs.push({ start: r1(start), end: r1(t[t.length - 1]), dur: r1(t[t.length - 1] - start) });
  return segs.filter((s) => s.dur > 0);
}

/* ── 씹기 버스트 ── 연속된 씹기를 하나의 '한입 처리'로 묶는다.
   한입당 씹기 횟수·지속 시간이 여기서 나온다(보호자가 체감하는 단위). */
function chewBursts(chews) {
  const out = [];
  let cur = null;
  chews.forEach((c) => {
    if (cur && (c - cur.end) <= T.BURST_GAP) { cur.end = c; cur.chews++; return; }
    if (cur) out.push(cur);
    cur = { start: c, end: c, chews: 1 };
  });
  if (cur) out.push(cur);
  return out.map((b) => ({
    start: r1(b.start), end: r1(b.end), chews: b.chews,
    dur: r1(Math.max(0, b.end - b.start)),
  }));
}

/* ── 처리 시간이 긴 구간 ──
   얼굴이 보이는데 씹기 전이가 없는 긴 구간. 무엇 때문인지는 판정하지 않는다.
   얼굴을 놓친 구간(face gap)은 제외한다 — 안 보이는 동안을 '안 씹었다'고 할 수 없다. */
function longProcessing(t, chews, segs) {
  const out = [];
  segs.forEach((s) => {
    const inSeg = chews.filter((c) => c >= s.start && c <= s.end);
    const marks = [s.start].concat(inSeg, [s.end]);
    for (let i = 1; i < marks.length; i++) {
      const gap = marks[i] - marks[i - 1];
      if (gap >= T.LONG_PROCESS)
        out.push({ start: r1(marks[i - 1]), end: r1(marks[i]), dur: r1(gap) });
    }
  });
  return out;
}

/* ── 좌우 경향 ── 평균 jawLeft/jawRight 비율. 어느 쪽 치아로 씹는지가 아니라
   '턱이 어느 쪽으로 더 움직였는지'다 — 문장에도 그렇게 쓴다. */
function laterality(jl, jr) {
  let sl = 0, sr = 0;
  for (let i = 0; i < jl.length; i++) { sl += jl[i] || 0; sr += jr[i] || 0; }
  const tot = sl + sr;
  if (tot < 1e-6) return { left_pct: null, tendency: "unknown", note: "좌우 움직임이 거의 감지되지 않았어요" };
  const left = Math.round(sl / tot * 100);
  const off = Math.abs(left - 50);
  return {
    left_pct: left,
    right_pct: 100 - left,
    tendency: off < T.LATERAL_DIFF ? "balanced" : (left > 50 ? "left" : "right"),
  };
}

/* ── 신뢰도 ──
   표본이 적거나 분석 가능 비율이 낮으면 구간 해석의 신뢰도가 떨어진다.
   숫자를 감추는 대신 신뢰도를 함께 넘겨, 리포트가 어디까지 말할지 결정하게 한다. */
function confidenceOf(usable, samples, observed) {
  if (!samples || observed <= 0) return 0;
  const byUsable = Math.max(0, Math.min(1, usable));
  const bySpan = Math.max(0, Math.min(1, observed / 20));      // 20초를 충분으로 본다
  const bySample = Math.max(0, Math.min(1, samples / (T.NOMINAL_FPS * 15)));
  return r2(byUsable * 0.5 + bySpan * 0.25 + bySample * 0.25);
}

/* ── 본체 ──
   input:
     series  { t[], jaw_open[], jaw_left[], jaw_right[], tongue_out[] }
     summary { detect_rate?, observed_sec?, duration_sec?, quality? }  (있으면 우선 사용)
   output: 자동 추출 지표 + 각 항목의 근거가 되는 구간. NEVER_AUTO 키는 담지 않는다. */
export function extractObservations(input) {
  const o = input || {};
  const s = o.series || {};
  const sum = o.summary || {};
  const t = Array.isArray(s.t) ? s.t : [];
  const jaw = Array.isArray(s.jaw_open) ? s.jaw_open : [];
  const jl = Array.isArray(s.jaw_left) ? s.jaw_left : [];
  const jr = Array.isArray(s.jaw_right) ? s.jaw_right : [];

  const processed = t.length;
  const observed = (sum.observed_sec != null) ? Number(sum.observed_sec)
                 : (processed > 1 ? r1(t[processed - 1] - t[0]) : 0);
  // 목표 샘플 수 대비 실제로 얼굴이 잡힌 프레임 — 건너뛴 프레임이 skipped
  const expected = Math.max(processed, Math.round(observed * T.NOMINAL_FPS));
  const skipped = Math.max(0, expected - processed);
  const usable = (sum.detect_rate != null) ? (Number(sum.detect_rate) / 100)
               : (expected > 0 ? processed / expected : 0);
  const effective_fps = observed > 0 ? r1(processed / observed) : 0;

  const enough = processed >= T.MIN_SAMPLES;
  const chews = enough ? detectChews(t, jaw) : [];
  const segs = enough ? faceSegments(t) : [];
  const bursts = enough ? chewBursts(chews) : [];
  const longs = enough ? longProcessing(t, chews, segs) : [];
  const durs = bursts.map((b) => b.dur).filter((d) => d > 0);

  const out = {
    // 커버리지
    usable_video_ratio: r2(Math.max(0, Math.min(1, usable))),
    observed_sec: observed,
    duration_sec: (sum.duration_sec != null) ? Number(sum.duration_sec) : null,
    processed: processed,
    skipped: skipped,
    effective_fps: effective_fps,
    // 구간
    face_segments: segs,
    face_segment_count: segs.length,
    chew_count: chews.length,
    chews_per_min: observed > 0 ? r1(chews.length / observed * 60) : 0,
    chew_bursts: bursts,
    chew_burst_count: bursts.length,
    chew_burst_mean_sec: durs.length ? r1(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
    chew_burst_max_sec: durs.length ? r1(Math.max.apply(null, durs)) : null,
    chews_per_burst_mean: bursts.length ? r1(bursts.reduce((a, b) => a + b.chews, 0) / bursts.length) : null,
    long_processing: longs,
    long_processing_count: longs.length,
    long_processing_max_sec: longs.length ? r1(Math.max.apply(null, longs.map((l) => l.dur))) : null,
    // 경향
    laterality: laterality(jl, jr),
    // 품질
    confidence: confidenceOf(usable, processed, observed),
    enough_samples: enough,
  };
  /* 방어 — 실수로 금지 항목을 추가하면 여기서 잡힌다(개발 중 조용히 새는 것을 막는다). */
  NEVER_AUTO.forEach((k) => { if (k in out) delete out[k]; });
  return out;
}

/* 사람이 읽는 요약 — 리포트의 '영상 관찰' 근거 문장으로 쓰인다.
   해석을 섞지 않는다. "8.4초 동안 씹는 움직임이 없었어요"까지가 이 함수의 한계다. */
export function describeObservations(obs) {
  const o = obs || {};
  const lines = [];
  if (!o.enough_samples) {
    lines.push({ key: "usable_video_ratio", text: "분석에 쓸 수 있는 구간이 너무 짧아 영상 지표는 쓰지 않았어요." });
    return lines;
  }
  lines.push({
    key: "usable_video_ratio",
    text: `전체 영상 중 <b>${Math.round(o.usable_video_ratio * 100)}%</b>를 분석에 사용했어요(약 ${o.observed_sec}초 · 초당 ${o.effective_fps}프레임).`,
  });
  if (o.chew_count > 0)
    lines.push({
      key: "chew_count",
      text: `씹는 움직임이 <b>${o.chew_count}회</b> 관찰됐어요(분당 약 ${o.chews_per_min}회).`,
    });
  if (o.chew_burst_count > 0)
    lines.push({
      key: "chew_bursts",
      text: `이어서 씹은 구간이 <b>${o.chew_burst_count}번</b> 있었고, 한 번에 평균 <b>${o.chew_burst_mean_sec}초</b>씩 씹었어요(한 구간 최대 ${o.chew_burst_max_sec}초).`,
    });
  if (o.long_processing_count > 0)
    lines.push({
      key: "long_processing",
      text: `씹는 움직임 없이 <b>${T.LONG_PROCESS}초 이상</b> 지나간 구간이 <b>${o.long_processing_count}번</b> 있었어요(가장 긴 구간 ${o.long_processing_max_sec}초).`,
    });
  if (o.face_segment_count > 1)
    lines.push({
      key: "face_segments",
      text: `얼굴이 보인 구간이 <b>${o.face_segment_count}개</b>로 나뉘어, 중간에 화면에서 벗어난 시간이 있었어요.`,
    });
  const L = o.laterality || {};
  if (L.left_pct != null && L.tendency !== "balanced")
    lines.push({
      key: "laterality",
      text: `턱이 <b>${L.left_pct}:${L.right_pct}</b>로 한쪽으로 더 움직이는 경향이 보였어요.`,
    });
  else if (L.left_pct != null)
    lines.push({ key: "laterality", text: `턱 움직임은 <b>${L.left_pct}:${L.right_pct}</b>로 양쪽이 비슷했어요.` });
  return lines;
}

export default { T, NEVER_AUTO, extractObservations, describeObservations };
