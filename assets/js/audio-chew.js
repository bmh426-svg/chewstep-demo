// ─────────────────────────────────────────────────────────────
// audio-chew.js — 마이크 기반 "씹는 소리" 감지기 (영상과 독립)
//
// 왜 필요한가: jawOpen(영상)은 얼굴이 가려지거나 고개를 숙이면 신호가
// 같이 죽는다(같은 landmark에서 나오므로). 마이크는 완전히 다른 센서라,
// 얼굴이 안 보여도 씹는 소리가 나면 신호가 살아 있다 → 퓨전 시 가림에 강해짐.
//
// ⚠ 한계(정직하게): 바삭한 음식은 잘 잡히지만, 무른 이유식은 소리가
//    약할 수 있다. 그래서 metrics에 바로 섞지 말고 먼저 "신호가 보이는지"
//    검증(audio-test.html)한 뒤 퓨전 여부를 판단한다.
//
// ── 계약 ────────────────────────────────────────────────────
//   async init(stream)   : 오디오 트랙이 있는 MediaStream을 물려 그래프 구성
//   sample() -> {           // 매 영상 프레임에서 "현재 오디오 상태" 스냅샷
//       level:   0~1,       // 정규화된 밴드 에너지(그래프용, 자동 스케일)
//       raw:     0~1,       // 정규화 전 밴드 에너지
//       ratio:   number,    // 배경 대비 배율(온셋 판정 근거)
//       active:  boolean,   // 지금 "씹는 소리 burst" 중인지
//       chew:    number,    // 오디오 기준 누적 씹기 횟수
//       chewed:  boolean,   // 이 스냅샷 직전에 1회가 카운트됐는지
//   }
//   reset()              : 카운트/상태 초기화
//   close()              : AudioContext 해제
//
// 마이크는 영상 프레임 루프와 무관하게 자체 rAF로 항상 최신값을 갱신하고,
// sample()은 그 최신값을 읽기만 한다(타임라인 불일치 신경 안 써도 됨).
// ─────────────────────────────────────────────────────────────

export const AUDIO_DEFAULTS = {
  fftSize: 2048,        // 주파수 분해능(48kHz 기준 bin ≈ 23Hz)
  bandLoHz: 1500,       // 씹기 "바삭" 성분이 몰리는 대역 하한
  bandHiHz: 6000,       // 상한 — 말소리(대개 <1kHz 강세)와 분리하려 중고역 사용
  envAttack: 0.35,      // 엔벨로프 상승 평활(클수록 빠르게 반응)
  envRelease: 0.12,     // 하강 평활(작을수록 천천히 떨어짐)
  floorRise: 0.002,     // 배경 소음 바닥 상승 속도(느리게)
  floorFall: 0.05,      // 배경 바닥 하강 속도(조용해지면 빠르게 따라내림)
  onRatio: 2.6,         // level/floor 가 이 배 넘으면 burst 시작(온셋)
  offRatio: 1.4,        // 이 배 아래로 떨어지면 burst 종료
  minChewGapMs: 150,    // 절대 디바운스(이보다 붙은 온셋은 한 방으로 취급)

  // ── 리듬 게이트(핵심): "규칙적으로 연속된 소리"만 씹기로 인정 ──
  // 씹기는 대개 0.2~1.4초 간격으로 반복된다. 이 케이던스 밴드 안에서
  // 온셋이 rhythmNeed번 연속돼야 "씹는 중"으로 락(lock)되고 카운트 시작.
  // → 박수·말 한마디 같은 고립된 소리는 리듬을 못 만들어 걸러진다.
  ioiMinMs: 200,        // 씹기 간격 하한(이보다 빠르면 씹기 아님/떨림)
  ioiMaxMs: 1400,       // 씹기 간격 상한(이보다 느리면 리듬 끊김)
  rhythmNeed: 2,        // 케이던스 밴드 안 연속 온셋 수 → 이만큼 모여야 카운트 시작
  rhythmHoldMs: 2500,   // 이 시간 동안 새 온셋 없으면 리듬 해제(다시 처음부터)

  peakDecay: 0.995,     // 그래프 자동 스케일용 피크 감쇠
};

export class AudioChewDetector {
  constructor(opts = {}) {
    this.cfg = { ...AUDIO_DEFAULTS, ...opts };
    this._ctx = null; this._analyser = null; this._src = null;
    this._freq = null; this._raf = 0; this._loBin = 0; this._hiBin = 0;
    this._now = () => (this._ctx ? this._ctx.currentTime * 1000 : 0); // Date 미사용(오디오 시계)
    this.reset();
  }

  get id() { return "audio-band-onset"; }
  get version() { return `audio-chew@1/${this.cfg.bandLoHz}-${this.cfg.bandHiHz}Hz`; }

  reset() {
    this._env = 0; this._floor = 0.01; this._peak = 0.02;
    this._state = "quiet"; this._lastChewMs = -1e9;
    this.chew = 0; this._chewedFlag = false; this._onsetFlag = false;
    this._lastOnsetMs = -1e9; this._streak = 0; this._locked = false;
    this._lastRatio = 0; this._lastLevel = 0; this._lastRaw = 0;
  }

  async init(stream) {
    if (this._ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this._ctx = new AC();
    if (this._ctx.state === "suspended") { try { await this._ctx.resume(); } catch (e) {} }
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = this.cfg.fftSize;
    this._analyser.smoothingTimeConstant = 0; // 우리가 직접 평활 → 라이브러리 평활 끔
    this._src = this._ctx.createMediaStreamSource(stream);
    this._src.connect(this._analyser); // 스피커로 안 내보냄(하울링 방지)
    this._freq = new Uint8Array(this._analyser.frequencyBinCount);

    const nyquist = this._ctx.sampleRate / 2;
    const binHz = nyquist / this._analyser.frequencyBinCount;
    this._loBin = Math.max(1, Math.floor(this.cfg.bandLoHz / binHz));
    this._hiBin = Math.min(this._analyser.frequencyBinCount - 1, Math.ceil(this.cfg.bandHiHz / binHz));

    const tick = () => { this._compute(); this._raf = requestAnimationFrame(tick); };
    this._raf = requestAnimationFrame(tick);
  }

  // ── 업로드 영상 오디오: 파일 전체를 '오프라인'으로 훑어 씹기 횟수를 센다 ──
  // 왜 오프라인인가: 실시간 분석은 _compute가 requestAnimationFrame(메인스레드)에 의존하는데,
  // 업로드 분석은 MediaPipe(얼굴 검출)가 매 프레임 메인스레드를 점유해 오디오 샘플링이 굶주린다
  // → 짧은 씹기 버스트를 놓친다. 파일은 전체가 이미 있으니 OfflineAudioContext로 밴드패스 렌더 후
  //   시간영역 포락선에 동일한 온셋/리듬 게이트를 돌리면 부하와 무관하게 결정적으로 셀 수 있다.
  //   또한 decodeAudioData 경로라 iOS에서도 createMediaElementSource보다 안정적이다.
  // 입력: AudioBuffer(디코딩된 오디오). 반환: 누적 씹기 횟수(this.chew).
  async analyzeBuffer(audioBuffer) {
    this.reset();
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC || !audioBuffer || !audioBuffer.length) return 0;
    const sr = audioBuffer.sampleRate;
    // 1.5~6kHz만 통과(하이패스→로우패스) → 말소리(<1kHz) 배제, 씹기 '바삭' 대역 강조
    const oac = new OAC(1, audioBuffer.length, sr);
    const src = oac.createBufferSource(); src.buffer = audioBuffer;
    const hp = oac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = this.cfg.bandLoHz; hp.Q.value = 0.7;
    const lp = oac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = this.cfg.bandHiHz; lp.Q.value = 0.7;
    src.connect(hp); hp.connect(lp); lp.connect(oac.destination);
    src.start();
    let rendered;
    try { rendered = await oac.startRendering(); } catch (e) { return 0; }
    const x = rendered.getChannelData(0);

    // 밴드 통과 신호의 RMS 포락선을 ~12ms 홉으로 만들어 동일 상태머신에 투입(홉 시각=파일 시계)
    const hop = Math.max(64, Math.round(sr * 0.012));
    const win = hop * 2;
    for (let i = 0; i + win <= x.length; i += hop) {
      let s = 0;
      for (let j = 0; j < win; j++) { const v = x[i + j]; s += v * v; }
      const raw = Math.min(1, Math.sqrt(s / win) * 4);   // RMS 정규화(경험적 스케일)
      this._step(raw, (i / sr) * 1000);
    }
    return this.chew;
  }

  // 오디오 자체 루프(라이브): 밴드 에너지(FFT) → 공통 스텝
  _compute() {
    this._analyser.getByteFrequencyData(this._freq);
    let sum = 0, n = 0;
    for (let i = this._loBin; i <= this._hiBin; i++) { sum += this._freq[i]; n++; }
    const raw = n ? (sum / n) / 255 : 0;
    this._step(raw, this._now());
  }

  // 공통 스텝: 엔벨로프 → 적응형 바닥 → 온셋 히스테리시스 → 리듬 게이트(라이브·오프라인 공용)
  // raw: 0~1 밴드 에너지, t: ms 시계(라이브=오디오시계, 오프라인=홉시각)
  _step(raw, t) {
    const C = this.cfg;
    // 비대칭 엔벨로프(빠르게 붙고 천천히 떨어짐)
    const a = raw > this._env ? C.envAttack : C.envRelease;
    this._env += (raw - this._env) * a;

    // 적응형 배경 바닥(조용하면 빨리 내려가고, 시끄러워도 천천히 오름)
    if (this._env < this._floor) this._floor += (this._env - this._floor) * C.floorFall;
    else this._floor += (this._env - this._floor) * C.floorRise;
    if (this._floor < 1e-4) this._floor = 1e-4;

    const ratio = this._env / this._floor;

    // 그래프 자동 스케일용 피크
    this._peak = Math.max(this._env, this._peak * C.peakDecay);
    const level = this._peak > 1e-4 ? Math.min(1, this._env / this._peak) : 0;

    // 온셋(burst) 히스테리시스 → 종료 순간을 "온셋 1개"로
    this._chewedFlag = false; this._onsetFlag = false;

    // 리듬 유지시간 초과 → 락 해제(씹기 멈춤으로 간주, 다시 처음부터)
    if (this._locked && t - this._lastOnsetMs > C.rhythmHoldMs) { this._locked = false; this._streak = 0; }

    if (this._state === "quiet" && ratio >= C.onRatio) {
      this._state = "burst";
    } else if (this._state === "burst" && ratio <= C.offRatio) {
      this._state = "quiet";
      const gap = t - this._lastOnsetMs;      // 직전 온셋과의 간격
      if (gap >= C.minChewGapMs) {
        this._onsetFlag = true;               // 그래프용(필터 전 원시 온셋)
        this._lastOnsetMs = t;

        if (gap >= C.ioiMinMs && gap <= C.ioiMaxMs) {
          // 씹기 케이던스 안 → 리듬 스트릭 누적
          this._streak++;
          if (this._streak >= C.rhythmNeed) {
            // 리듬 확정: 락 순간엔 준비 온셋들을 소급 카운트, 이후엔 1씩
            const add = this._locked ? 1 : C.rhythmNeed;
            this._locked = true;
            this.chew += add; this._lastChewMs = t; this._chewedFlag = true;
          }
        } else {
          // 케이던스 밖(너무 김/한 방) → 리듬 리셋(이 온셋이 새 시작점)
          this._streak = 1; this._locked = false;
        }
      }
    }

    this._lastRatio = ratio; this._lastLevel = level; this._lastRaw = raw;
  }

  // 영상 프레임에서 호출 → 현재 오디오 상태 스냅샷(계산은 하지 않음)
  sample() {
    return {
      level: this._lastLevel,
      raw: this._lastRaw,
      ratio: this._lastRatio,
      active: this._state === "burst",
      onset: this._onsetFlag,     // 필터 전 원시 소리 튐(그래프 참고용)
      rhythm: this._locked,       // 리듬 락 여부(씹는 중으로 판정 중)
      chew: this.chew,            // 리듬 게이트를 통과한 카운트만
      chewed: this._chewedFlag,   // 이 프레임에 카운트됐는지
    };
  }

  close() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    try { this._src && this._src.disconnect(); } catch (e) {}
    try { this._ctx && this._ctx.close(); } catch (e) {}
    this._ctx = null; this._analyser = null; this._src = null;
  }
}
