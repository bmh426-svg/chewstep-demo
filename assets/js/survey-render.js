// survey-render.js — survey-v3-schema.js를 소비해 웹 데모 설문을 렌더/수집한다.
// 저장 구조는 스키마의 ANSWERS_SHAPE 그대로: { food_texture, concern_type, concern_text, survey, safety_alert }
// (앱 chewstep-mobile과 동일 구조 → demo_responses.answers 통합)
import S from "/assets/js/survey-v3-schema.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const val = (o) => (typeof o === "object" ? o.v : o);
const txt = (o) => (typeof o === "object" ? o.t : o);

function radios(name, opts) {
  return `<div class="opts">` + opts.map((o) => `<label class="opt"><input type="radio" name="${name}" value="${esc(val(o))}"/><span>${esc(txt(o))}</span></label>`).join("") + `</div>`;
}
function checks(name, opts) {
  return `<div class="opts">` + opts.map((o) => `<label class="opt"><input type="checkbox" name="${name}" value="${esc(val(o))}"/><span>${esc(txt(o))}</span></label>`).join("") + `</div>`;
}
function qBlock(title, inner, sub) {
  return `<div class="q"><div class="q-title">${esc(title)}${sub ? ` <span style="font-weight:600;color:var(--ink-faint)">${esc(sub)}</span>` : ""}</div>${inner}</div>`;
}
function head(t) {
  return `<div class="q-title" style="margin:20px 0 4px;color:var(--brand-deep,#0a7d57);font-weight:800;letter-spacing:.01em">${esc(t)}</div>`;
}

let _mount = null, _ageMonths = null;

export function renderSurvey(mount, o) {
  _mount = mount; o = o || {};
  _ageMonths = (o.ageMonths != null) ? o.ageMonths : null;
  mount.innerHTML =
    head("① 기본 정보") +
    qBlock("가장 고민되는 식사 문제는 무엇인가요?", radios("concern", S.CONCERN)) +
    qBlock("이런 모습이 얼마나 자주 있나요?", radios("symptom_freq", S.FREQ)) +
    `<div id="deepMount"></div>` +
    head("② 식감과 입자") +
    qBlock("주로 먹는 음식 형태는?", radios("food_form", S.FOOD)) +
    qBlock("무리 없이 먹는 가장 단단한 음식은?", radios("chew_ceiling", S.CEILING)) +
    qBlock("특히 어려워하는 것은?", checks("hard_textures", S.HARD), "(여러 개 선택 가능)") +
    qBlock("어려운 음식에서 보이는 모습은?", radios("behavior", S.BEHAVIOR)) +
    qBlock("한 끼 식사 시간은?", radios("meal_time", S.MEALTIME)) +
    head("③ 식사 환경 · 부모 관점") +
    qBlock("직전 식사·간식과의 간격은?", radios("interval", S.INTERVAL)) +
    qBlock("기대보다 실제로 먹은 양은?", radios("portion_gap", S.PORTION)) +
    qBlock("안 먹는 음식을 다시 시도한 횟수는?", radios("retry_count", S.RETRY)) +
    qBlock("거부할 때 주로 어떻게 하나요?", radios("refusal_response", S.RESPONSE)) +
    head("④ 안전 확인") +
    S.SAFETY.map((s) => qBlock(s.q, radios(s.id, S.YN))).join("") +
    head("⑤ 마무리 (선택)") +
    qBlock("가장 알고 싶은 점이 있다면 적어 주세요.", `<textarea id="want_to_know" class="ta" placeholder="예: 잘 씹고 있는 건지 궁금해요"></textarea>`, "(선택)");

  mount.querySelectorAll('input[name="concern"]').forEach((r) => r.addEventListener("change", renderDeep));
  if (o.concern) { const r = mount.querySelector('input[name="concern"][value="' + o.concern + '"]'); if (r) r.checked = true; }
  renderDeep();
}

// 고민(concern) 선택 시 3단계 조건부 세트를 딥다이브 자리에 렌더
function renderDeep() {
  const dm = _mount && _mount.querySelector("#deepMount");
  if (!dm) return;
  const c = _mount.querySelector('input[name="concern"]:checked');
  const v = c ? c.value : null;
  const set = v && S.SETS[v];
  if (!set) { dm.innerHTML = ""; return; }
  dm.innerHTML = head("조금 더 자세히") +
    set.map((item) => qBlock(item.q, radios("deep_" + item.id, item.opts))).join("") +
    (v === "other" ? qBlock("어떤 상황인지 적어 주세요.", `<textarea id="deep_otherText" class="ta" placeholder="자유롭게 적어 주세요"></textarea>`, "(선택)") : "");
}

// 스키마 ANSWERS_SHAPE 구조로 수집
export function collectSurveyAnswers() {
  const m = _mount; if (!m) return null;
  const pick = (n) => { const el = m.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : null; };
  const picks = (n) => Array.prototype.slice.call(m.querySelectorAll('input[name="' + n + '"]:checked')).map((e) => e.value);
  const text = (id) => { const el = m.querySelector("#" + id); return el && el.value.trim() ? el.value.trim() : null; };

  const concernV = pick("concern");
  const concernObj = S.CONCERN.find((c) => c.v === concernV);
  const food_form = pick("food_form");

  const deep = {};
  const set = concernV && S.SETS[concernV];
  if (set) { set.forEach((item) => { const v = pick("deep_" + item.id); if (v != null) deep[item.id] = v; }); if (concernV === "other") { const ot = text("deep_otherText"); if (ot) deep.otherText = ot; } }

  const safety = { s1: pick("s1"), s2: pick("s2"), s3: pick("s3") };
  const safety_alert = ["s1", "s2", "s3"].some((k) => safety[k] === "예");
  const want = text("want_to_know");

  const survey = {
    age_months: _ageMonths,
    concern: concernV,
    symptom_freq: pick("symptom_freq"),
    want_to_know: want || "",
    lens01: { food_form: food_form, chew_ceiling: pick("chew_ceiling"), hard_textures: picks("hard_textures"), behavior: pick("behavior"), meal_time: pick("meal_time") },
    lens02: { interval: pick("interval") },
    lens03: { portion_gap: pick("portion_gap") },
    lens04: { retry_count: pick("retry_count") },
    lens05: { refusal_response: pick("refusal_response") },
    deep: deep,
    safety: safety,
    routine: {},
  };

  return {
    food_texture: food_form,                        // legacy · compare/result 사용
    concern_type: concernObj ? concernObj.t : null,  // legacy · 결과 표시(한글 라벨)
    concern_text: want,
    child_age_months: _ageMonths,                    // 결과 렌더 호환(월령)
    survey: survey,
    safety_alert: safety_alert,
  };
}
