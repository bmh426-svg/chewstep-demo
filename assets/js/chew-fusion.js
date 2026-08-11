// 영상과 오디오가 만든 저작 후보를 동일 시간축에서 합친다.
// 두 센서가 같은 순간을 잡으면 1회로 병합하고, 영상 사이에서 빠진
// 리듬성 오디오 후보만 보완한다. 총횟수끼리 max/교체하지 않는 것이 핵심이다.

export const CHEW_FUSION_DEFAULTS = Object.freeze({
  matchToleranceSec: 0.22,
  audioContextSec: 0.9,
  crossDedupeSec: 0.28,
  dedupeSec: 0.08,
  minAudioSequenceEvents: 3,
  ioiMinSec: 0.2,
  ioiMaxSec: 1.4,
});

function eventTime(v) {
  return typeof v === "number" ? v : v && Number(v.t);
}

export function normalizeChewEvents(values, dedupeSec = CHEW_FUSION_DEFAULTS.dedupeSec) {
  const sorted = (Array.isArray(values) ? values : [])
    .map(eventTime)
    .filter(Number.isFinite)
    .filter((t) => t >= 0)
    .sort((a, b) => a - b);
  const out = [];
  for (const t of sorted) {
    if (!out.length || t - out[out.length - 1] > dedupeSec) out.push(t);
  }
  return out;
}

function nearestDistance(t, values) {
  let best = Infinity;
  for (const v of values) {
    const d = Math.abs(t - v);
    if (d < best) best = d;
    if (v > t && d > best) break;
  }
  return best;
}

// 시간 순서를 보존하면서 매칭 수를 최대화하고, 같은 매칭 수에서는 총 시간차가
// 가장 작은 조합을 고른다. 영상부터 훑는 greedy가 가까운 후보를 선점해 발생시키는
// 2→3 과대계수를 막는다.
function optimalPairs(video, audio, tolerance) {
  const n = video.length, m = audio.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  dp[0][0] = { count: 0, cost: 0, pairs: [] };
  const better = (a, b) => !b || a.count > b.count || (a.count === b.count && a.cost < b.cost);
  const put = (i, j, candidate) => { if (better(candidate, dp[i][j])) dp[i][j] = candidate; };
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const cur = dp[i][j]; if (!cur) continue;
    if (i < n) put(i + 1, j, cur);
    if (j < m) put(i, j + 1, cur);
    if (i < n && j < m) {
      const d = Math.abs(video[i] - audio[j]);
      if (d <= tolerance) put(i + 1, j + 1, { count: cur.count + 1, cost: cur.cost + d, pairs: cur.pairs.concat([[i, j]]) });
    }
  }
  return dp[n][m].pairs;
}

function rhythmicAudioIndexes(audio, cfg) {
  const accepted = new Set();
  let start = 0;
  const flush = (end) => {
    if (end - start + 1 >= cfg.minAudioSequenceEvents) for (let i = start; i <= end; i++) accepted.add(i);
  };
  for (let i = 1; i < audio.length; i++) {
    const gap = audio[i] - audio[i - 1];
    if (gap < cfg.ioiMinSec || gap > cfg.ioiMaxSec) { flush(i - 1); start = i; }
  }
  if (audio.length) flush(audio.length - 1);
  return accepted;
}

export function fuseChewEvents(videoValues, audioValues, options = {}) {
  const cfg = { ...CHEW_FUSION_DEFAULTS, ...options };
  const video = normalizeChewEvents(videoValues, cfg.dedupeSec);
  const audio = normalizeChewEvents(audioValues, cfg.dedupeSec);
  const usedAudio = new Set();
  const usedVideo = new Set();
  const events = [];
  const pairs = optimalPairs(video, audio, cfg.matchToleranceSec);
  for (const [vi, ai] of pairs) {
    usedVideo.add(vi); usedAudio.add(ai);
    events.push({ t: +((video[vi] + audio[ai]) / 2).toFixed(3), source: "both" });
  }
  for (let i = 0; i < video.length; i++) if (!usedVideo.has(i)) events.push({ t: +video[i].toFixed(3), source: "video" });

  const audioOnlyAccepted = [];
  const rejectedAudio = [];
  const rhythmic = rhythmicAudioIndexes(audio, cfg);

  for (let i = 0; i < audio.length; i++) {
    if (usedAudio.has(i)) continue;
    const at = audio[i];
    // 얼굴이 약한 구간의 충분한 오디오 리듬, 또는 영상 저작 후보에서 가까운
    // 오디오 후보만 보완한다. 멀리 떨어진 식기/말소리는 기본적으로 버린다.
    const distanceFromVideo = nearestDistance(at, video);
    const inVideoContext = video.length > 0 && distanceFromVideo > cfg.crossDedupeSec && distanceFromVideo <= cfg.audioContextSec;
    const audioOnlyContext = (video.length === 0 || options.allowRhythmicAudioOnly === true) && rhythmic.has(i);
    if (rhythmic.has(i) && (audioOnlyContext || inVideoContext)) {
      audioOnlyAccepted.push(+at.toFixed(3));
      events.push({ t: +at.toFixed(3), source: "audio" });
    } else {
      rejectedAudio.push(+at.toFixed(3));
    }
  }

  events.sort((a, b) => a.t - b.t);
  return {
    count: events.length,
    events,
    videoCount: video.length,
    audioCount: audio.length,
    matched: pairs.length,
    videoOnly: events.filter((e) => e.source === "video").length,
    audioOnlyAccepted: audioOnlyAccepted.length,
    rejectedAudio: rejectedAudio.length,
    videoTimes: video,
    audioTimes: audio,
  };
}
