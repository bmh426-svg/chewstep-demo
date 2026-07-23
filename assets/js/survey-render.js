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
  return `<div class="q-title" style="margin:20px 0 4px;color:var(--brand-deep,#5f7a4f);font-weight:800;letter-spacing:.01em">${esc(t)}</div>`;
}

let _mount = null, _ageMonths = null;

// 섹션 소개 문구(설명)
function lede(t) {
  return `<p style="margin:2px 0 6px;font-size:13px;line-height:1.55;color:var(--ink-soft,#667)">${esc(t)}</p>`;
}
// 한 스텝(첫 스텝만 보이고 나머지는 숨김)
function step(n, title, inner, intro) {
  return `<div class="sv-step" data-step="${n}"${n > 1 ? ' style="display:none"' : ""}>${head(title)}${intro ? lede(intro) : ""}${inner}</div>`;
}

// 앱과 동일한 단계형(스텝) 설문. 각 스텝은 한 관점씩 보여주고 '다음'으로 진행한다.
// 고민(concern) 선택 시 조건부 심화문항(deepMount)이 1스텝 안에서 즉시 렌더된다(웹·앱 공용 로직).
// opts: { ageMonths, recipe, concern, onComplete(answers), onSkip() }
export function renderSurvey(mount, o) {
  _mount = mount; o = o || {};
  _ageMonths = (o.ageMonths != null) ? o.ageMonths : null;
  const onComplete = typeof o.onComplete === "function" ? o.onComplete : function () {};
  const onSkip = typeof o.onSkip === "function" ? o.onSkip : function () {};

  mount.innerHTML =
    step(1, "① 기본 정보", "" +
      qBlock("가장 고민되는 식사 문제는 무엇인가요?", radios("concern", S.CONCERN)) +
      qBlock("이런 모습이 얼마나 자주 있나요?", radios("symptom_freq", S.FREQ)) +
      `<div id="deepMount"></div>`,
      "가장 큰 고민을 고르면, 그에 맞는 질문이 이어서 나와요.") +
    step(2, "② 식감과 입자", "" +
      qBlock("주로 먹는 음식 형태는?", radios("food_form", S.FOOD)) +
      qBlock("무리 없이 먹는 가장 단단한 음식은?", radios("chew_ceiling", S.CEILING)) +
      qBlock("특히 어려워하는 것은?", checks("hard_textures", S.HARD), "(여러 개 선택 가능)") +
      qBlock("어려운 음식에서 보이는 모습은?", radios("behavior", S.BEHAVIOR)) +
      qBlock("한 끼 식사 시간은?", radios("meal_time", S.MEALTIME))) +
    step(3, "③ 식사 환경 · 부모 관점", "" +
      qBlock("직전 식사·간식과의 간격은?", radios("interval", S.INTERVAL)) +
      qBlock("기대보다 실제로 먹은 양은?", radios("portion_gap", S.PORTION)) +
      qBlock("안 먹는 음식을 다시 시도한 횟수는?", radios("retry_count", S.RETRY)) +
      qBlock("거부할 때 주로 어떻게 하나요?", radios("refusal_response", S.RESPONSE))) +
    step(4, "④ 안전 확인",
      S.SAFETY.map((s) => qBlock(s.q, radios(s.id, S.YN))).join("")) +
    step(5, "⑤ 식감 연결 레시피", "" +
      qBlock("요즘 잘 먹는 음식", `<input id="r_liked" type="text" maxlength="40" class="cs-inp" placeholder="예: 계란찜" value="${esc((o.recipe && o.recipe.liked) || "")}"/>`, "(선택)") +
      qBlock("연습하고 싶은(안 먹는) 음식", `<input id="r_practice" type="text" maxlength="40" class="cs-inp" placeholder="예: 소고기" value="${esc((o.recipe && o.recipe.practice) || "")}"/>`, "(선택)"),
      "두 음식을 적어 주시면, 결과에서 이 둘을 이어 주는 ‘연결 레시피’를 만들어 드려요.") +
    step(6, "⑥ 마무리", "" +
      qBlock("가장 알고 싶은 점이 있다면 적어 주세요.", `<textarea id="want_to_know" class="ta" placeholder="예: 잘 씹고 있는 건지 궁금해요"></textarea>`, "(선택)")) +
    // ── 스텝 내비게이션 ──
    `<div class="sv-nav" style="margin-top:26px;display:flex;gap:12px;align-items:center;justify-content:space-between;">
       <button type="button" class="btn-ghost sv-prev" style="visibility:hidden;">← 이전</button>
       <div class="sv-progress" style="font-size:13px;font-weight:700;color:var(--ink-faint,#889);letter-spacing:.02em;"><span id="svStepNow">1</span> / <span id="svStepTotal">6</span></div>
       <button type="button" class="btn-primary sv-next">다음 →</button>
     </div>
     <div style="text-align:center;margin-top:12px;">
       <button type="button" class="sv-skip" style="background:none;border:none;color:var(--ink-faint,#889);text-decoration:underline;cursor:pointer;font:600 13px/1 var(--sans);">설문 건너뛰고 영상 올리기</button>
     </div>`;

  // 레시피 입력칸 스타일
  mount.querySelectorAll(".cs-inp").forEach((el) => {
    el.style.cssText = "width:100%;font:500 14px/1.5 var(--sans);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:11px 13px;outline:none;margin-top:6px;";
    el.addEventListener("focus", () => { el.style.borderColor = "var(--brand)"; el.style.boxShadow = "0 0 0 3px rgba(130,154,109,.12)"; });
    el.addEventListener("blur", () => { el.style.borderColor = "var(--line)"; el.style.boxShadow = "none"; });
  });

  // 고민 → 조건부 심화문항
  mount.querySelectorAll('input[name="concern"]').forEach((r) => r.addEventListener("change", renderDeep));
  if (o.concern) { const r = mount.querySelector('input[name="concern"][value="' + o.concern + '"]'); if (r) r.checked = true; }
  renderDeep();

  // ── 스텝 진행 로직 ──
  const steps = Array.prototype.slice.call(mount.querySelectorAll(".sv-step"));
  const total = steps.length;
  const prevBtn = mount.querySelector(".sv-prev");
  const nextBtn = mount.querySelector(".sv-next");
  const nowEl = mount.querySelector("#svStepNow");
  mount.querySelector("#svStepTotal").textContent = String(total);
  let cur = 1;
  const show = (i) => {
    cur = Math.max(1, Math.min(total, i));
    steps.forEach((s) => { s.style.display = (Number(s.dataset.step) === cur) ? "" : "none"; });
    prevBtn.style.visibility = cur === 1 ? "hidden" : "visible";
    nextBtn.textContent = cur === total ? "완료 · 영상 올리기 →" : "다음 →";
    nowEl.textContent = String(cur);
    try { mount.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
  };
  prevBtn.addEventListener("click", () => show(cur - 1));
  nextBtn.addEventListener("click", () => { if (cur === total) onComplete(collectSurveyAnswers()); else show(cur + 1); });
  mount.querySelector(".sv-skip").addEventListener("click", () => onSkip());
  show(1);
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
  const recipe = { liked: text("r_liked") || "", practice: text("r_practice") || "" };  // 식감 연결 레시피용 (앱과 동일 구조)

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
    recipe: recipe,
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
