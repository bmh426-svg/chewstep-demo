// video-meta.js — 업로드된 영상의 표시 비율·회전 정보를 확인한다.
// ─────────────────────────────────────────────────────────────────────
// 배경 (2026-07-28 · 사용자 테스트 피드백 #2)
//   세로로 촬영한 영상을 올렸는데 분석 화면에서 위아래가 잘렸고, 아이 얼굴이 프레임을
//   벗어나 얼굴 인식이 되지 않았는데도 경고 없이 분석이 진행됐다.
//
// 두 가지를 확인한다.
//   ① 표시 비율 — video.videoWidth/videoHeight (브라우저가 회전을 적용한 뒤의 값)
//      → 이 값으로 영상 영역의 aspect-ratio 를 맞추면 잘리지 않는다.
//   ② 회전 메타데이터 — MP4/MOV 의 tkhd 변환 행렬에서 읽는다(베스트 에포트).
//      회전이 90/270° 인데 표시 비율이 가로면, 브라우저가 회전을 적용하지 않은 것이다.
//      이 경우 프레임 속 얼굴이 누워 있어 얼굴 검출이 실패한다 → 사용자에게 알려야 한다.
//
// 회전 파싱은 실패해도 무해하다(rotation=null). 실제 게이팅은 프리플라이트의
// 얼굴 검출률이 담당한다(video-preflight.js) — 여기 값은 안내 문구를 정확하게 만드는 용도.

/* ── MP4/MOV 박스 워커로 moov > trak > tkhd 를 찾아 회전각을 읽는다 ──
   tkhd 레이아웃(ISO/IEC 14496-12):
     version(1) flags(3)
     v0: creation(4) modification(4) track_ID(4) reserved(4) duration(4)   = 20
     v1: creation(8) modification(8) track_ID(4) reserved(4) duration(8)   = 32
     이어서 reserved(8) layer(2) alternate_group(2) volume(2) reserved(2)  = 16
     이어서 matrix 9 x int32 — a,b,u, c,d,v, x,y,w  (a·b·c·d = 16.16 고정소수점)
   회전각 = atan2(b, a) */
function findRotationInMp4(buf) {
  const dv = new DataView(buf);
  const len = dv.byteLength;

  function walk(start, end) {
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off);
      const type = String.fromCharCode(dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7));
      let head = 8;
      if (size === 1) {                       // 64비트 확장 크기
        if (off + 16 > end) return null;
        const hi = dv.getUint32(off + 8), lo = dv.getUint32(off + 12);
        size = hi * 4294967296 + lo; head = 16;
      } else if (size === 0) {
        size = end - off;                     // 마지막 박스 = 끝까지
      }
      if (size < head || off + size > end) return null;   // 잘린 버퍼 — 여기서 중단

      if (type === "tkhd") {
        const c = off + head;
        const version = dv.getUint8(c);
        const matrix = c + 4 + (version === 1 ? 32 : 20) + 16;
        if (matrix + 36 > end) return null;
        const a = dv.getInt32(matrix) / 65536;
        const b = dv.getInt32(matrix + 4) / 65536;
        const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI);
        return ((deg % 360) + 360) % 360;
      }
      // 컨테이너 박스만 내려간다
      if (type === "moov" || type === "trak") {
        const r = walk(off + head, off + size);
        if (r != null) return r;
      }
      off += size;
    }
    return null;
  }
  try { return walk(0, len); } catch (e) { return null; }
}

/* 파일 뒤쪽 조각은 박스 경계에서 시작하지 않는다(대개 mdat 중간).
   그대로 walk 하면 첫 4바이트를 크기로 잘못 읽고 바로 포기하므로,
   'moov' 타입 문자열을 찾아 그 박스 시작점(-4)부터 다시 읽는다. */
function findRotationResync(buf) {
  const bytes = new Uint8Array(buf);
  for (let i = 4; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x6d && bytes[i + 1] === 0x6f && bytes[i + 2] === 0x6f && bytes[i + 3] === 0x76) {   // "moov"
      const r = findRotationInMp4(buf.slice(i - 4));
      if (r != null) return r;
    }
  }
  return null;
}

/* 파일 앞부분만 읽어 회전각을 구한다.
   moov 가 파일 뒤쪽에 있는 경우(스트리밍용 배치가 아닌 경우)도 있어 실패할 수 있다 →
   앞 4MB 에서 못 찾으면 뒤 4MB 도 한 번 본다. 그래도 없으면 null. */
export async function readRotation(file) {
  if (!file || !file.slice) return null;
  const CHUNK = 4 * 1024 * 1024;
  try {
    const head = await file.slice(0, Math.min(CHUNK, file.size)).arrayBuffer();
    const r = findRotationInMp4(head);
    if (r != null) return r;
    if (file.size > CHUNK) {
      const tail = await file.slice(Math.max(0, file.size - CHUNK)).arrayBuffer();
      return findRotationResync(tail);
    }
  } catch (e) { /* 파싱 불가 — 안내 문구만 덜 구체적어진다 */ }
  return null;
}

/* 영상 요소에서 표시 비율 정보를 뽑는다. */
export function displayGeometry(videoEl) {
  const w = videoEl ? videoEl.videoWidth : 0;
  const h = videoEl ? videoEl.videoHeight : 0;
  if (!w || !h) return { width: 0, height: 0, ratio: null, orientation: "unknown" };
  const ratio = w / h;
  return {
    width: w, height: h, ratio: ratio,
    orientation: ratio > 1.05 ? "landscape" : (ratio < 0.95 ? "portrait" : "square"),
  };
}

/* 회전 메타는 세로인데 표시가 가로 → 브라우저가 회전을 적용하지 않았다는 신호.
   이때 프레임 속 얼굴이 누워 있어 얼굴 검출이 거의 실패한다. */
export function rotationMismatch(geometry, rotation) {
  if (rotation == null || !geometry || !geometry.ratio) return false;
  const quarterTurn = (rotation === 90 || rotation === 270);
  return quarterTurn && geometry.orientation === "landscape";
}

/* 영상 파일을 열어 표시 비율·길이·회전을 한 번에 확인한다.
   원본은 저장하지 않는다 — objectURL 은 호출부가 해제한다(반환값에 담아 준다). */
export async function probeVideo(file, videoEl) {
  const rotation = await readRotation(file);
  const geometry = displayGeometry(videoEl);
  const duration = (videoEl && isFinite(videoEl.duration)) ? videoEl.duration : null;
  return {
    ...geometry,
    duration: duration,
    rotation: rotation,
    rotationMismatch: rotationMismatch(geometry, rotation),
  };
}
