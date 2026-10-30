'use strict';
/* Creative Studio Milestone 1.5 frontend: guided Welcome → Clarify →
   Review → Create flow over deterministic local elicitation
   (POST /api/elicit/analyze). No generation calls exist. */

const STORE_KEY = 'silkweb-creative-1.5';
const STAGES = ['welcome', 'clarify', 'review', 'create'];

const state = {
  stage: 'welcome',
  unlocked: ['welcome'],
  description: '',
  answers: {},
  qIndex: 0,
  plan: null,
  styles: [],
  modes: [],
  fields: [],
  policyChecks: [],
  examples: [],
  maxQuestions: 3,
  brief: null,
  styleId: null,
  modeId: null,
  modeReason: '',
  reviewValid: false,
};

function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({
      stage: state.stage, unlocked: state.unlocked, description: state.description,
      answers: state.answers, qIndex: state.qIndex, plan: state.plan,
      brief: state.brief, styleId: state.styleId, modeId: state.modeId,
      modeReason: state.modeReason, reviewValid: state.reviewValid,
    }));
  } catch { /* session-only state; reload without it is fine */ }
}

function restore() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    for (const k of ['stage', 'description', 'qIndex', 'plan', 'brief', 'styleId', 'modeId', 'modeReason']) {
      if (s[k] !== undefined) state[k] = s[k];
    }
    if (Array.isArray(s.unlocked)) state.unlocked = s.unlocked.filter((x) => STAGES.includes(x));
    if (s.answers && typeof s.answers === 'object') state.answers = s.answers;
    state.reviewValid = s.reviewValid === true;
    if (!STAGES.includes(state.stage)) state.stage = 'welcome';
  } catch { /* start fresh */ }
}

async function fetchJson(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function setConnection(label) {
  const el = document.getElementById('connection-label');
  if (el) el.textContent = label;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- navigation ---------- */

function unlock(stage) {
  if (!state.unlocked.includes(stage)) state.unlocked.push(stage);
}

function go(stage) {
  if (!STAGES.includes(stage)) return;
  state.stage = stage;
  unlock(stage);
  for (const name of STAGES) {
    const section = document.getElementById(`stage-${name}`);
    if (section) section.hidden = name !== stage;
  }
  document.querySelectorAll('#stepper button').forEach((btn) => {
    const name = btn.dataset.stage;
    const reached = state.unlocked.includes(name);
    btn.disabled = !reached;
    if (name === stage) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  });
  if (name_render(stage)) renderStage(stage);
  const heading = document.querySelector(`#stage-${stage} h1, #stage-${stage} h2`);
  if (heading && document.activeElement && document.activeElement !== document.body) heading.focus({ preventScroll: true });
  save();
}

function name_render() { return true; }

function renderStage(stage) {
  if (stage === 'clarify') renderQuestion();
  if (stage === 'review') renderReview();
  if (stage === 'create') renderCreate();
}

/* ---------- welcome ---------- */

function renderExamples() {
  const box = document.getElementById('example-chips');
  box.textContent = '';
  state.examples.forEach((text) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = text.length > 90 ? `${text.slice(0, 90)}…` : text;
    chip.title = text;
    chip.addEventListener('click', () => {
      document.getElementById('campaign-description').value = text;
      document.getElementById('campaign-description').focus();
    });
    box.append(chip);
  });
}

async function analyze(description, answers, overrides, maxQuestions) {
  const { status, data } = await fetchJson('/api/elicit/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description, answers, overrides, maxQuestions }),
  });
  if (status !== 200 || !data.ok) {
    const issues = Array.isArray(data.issues) ? data.issues : [];
    throw new Error(issues.length > 0 ? issues.map((i) => i.message).join(' ') : 'The local server could not analyze the description.');
  }
  return data;
}

async function onWelcomeSubmit(event) {
  event.preventDefault();
  const box = document.getElementById('welcome-error');
  const description = document.getElementById('campaign-description').value.trim();
  if (!description) {
    box.hidden = false;
    box.textContent = 'Describe your campaign in a sentence or two to begin.';
    return;
  }
  box.hidden = true;
  box.textContent = '';
  state.description = description;
  state.answers = {};
  state.qIndex = 0;
  state.reviewValid = false;
  try {
    state.plan = await analyze(description, {}, undefined, state.maxQuestions);
    state.modeId = state.plan.recommendedPhotographyMode.mode;
    state.modeReason = state.plan.recommendedPhotographyMode.reason;
    state.styleId = state.plan.recommendedStyleId;
    if (state.plan.questions.length === 0) {
      seedBriefFromPlan();
      go('review');
    } else {
      go('clarify');
    }
  } catch (err) {
    box.hidden = false;
    box.textContent = err instanceof Error ? err.message : 'Could not reach the local server. Is it running?';
  }
}

function seedBriefFromPlan() {
  state.brief = { ...state.plan.values };
}

/* ---------- clarify ---------- */

function currentQuestion() {
  if (!state.plan || !Array.isArray(state.plan.questions)) return null;
  return state.plan.questions[state.qIndex] || null;
}

function renderQuestion() {
  const q = currentQuestion();
  const progress = document.getElementById('clarify-progress');
  const card = document.getElementById('question-card');
  if (!q) {
    seedBriefFromPlan();
    go('review');
    return;
  }
  const total = state.plan.questions.length;
  progress.textContent = `Question ${state.qIndex + 1} of ${total} — you can skip anything nonessential.`;
  document.getElementById('question-prompt').textContent = q.prompt;
  document.getElementById('question-helper').textContent = q.helper || '';
  const sug = document.getElementById('question-suggestions');
  sug.textContent = '';
  (q.suggestions || []).forEach((text) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip chip-pick';
    btn.textContent = text;
    btn.addEventListener('click', () => answerQuestion(text));
    sug.append(btn);
  });
  document.getElementById('custom-answer').value = '';
  renderHeard();
}

function renderHeard() {
  const list = document.getElementById('heard-list');
  list.textContent = '';
  const values = state.plan ? state.plan.values : {};
  const labels = {};
  state.fields.forEach((f) => { labels[f.id] = f.label; });
  let heard = 0;
  for (const [field, value] of Object.entries(values)) {
    if (!value) continue;
    heard += 1;
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = `${labels[field] || field}: `;
    const span = document.createElement('span');
    span.textContent = value;
    const badge = document.createElement('span');
    badge.className = 'badge badge-supplied';
    badge.textContent = 'Supplied';
    li.append(strong, span, ' ', badge);
    list.append(li);
  }
  if (heard === 0) {
    const li = document.createElement('li');
    li.className = 'heard-empty';
    li.textContent = 'Nothing pinned down yet — your answers appear here.';
    list.append(li);
  }
}

async function answerQuestion(value) {
  const q = currentQuestion();
  if (!q) return;
  const text = String(value).trim();
  if (text) state.answers[q.field] = text.slice(0, 500);
  else state.answers[q.field] = null;
  await advance();
}

function questionBudget() {
  return Math.max(0, Math.min(3, state.maxQuestions));
}

async function advance() {
  state.qIndex += 1;
  // Lifetime cap: answered questions consume the same budget, so the
  // total asked across the whole interaction never exceeds three.
  const remaining = Math.max(0, questionBudget() - state.qIndex);
  if (remaining <= 0) {
    try {
      state.plan = await analyze(state.description, state.answers, undefined, 0);
    } catch { /* review renders from the last good plan */ }
    seedBriefFromPlan();
    go('review');
    return;
  }
  if (state.qIndex < state.plan.questions.length) {
    // Merge the fresh answer into the visible plan without re-asking.
    try {
      const next = await analyze(state.description, state.answers, undefined, state.maxQuestions);
      const seen = new Set(state.plan.questions.slice(0, state.qIndex).map((q) => q.field));
      next.questions = next.questions
        .filter((q) => !seen.has(q.field) && !(q.field in state.answers))
        .slice(0, remaining);
      state.plan.values = next.values;
      state.plan.sources = next.sources;
      state.plan.questions = [...state.plan.questions.slice(0, state.qIndex), ...next.questions];
      state.plan.readiness = next.readiness;
    } catch { /* keep walking the original question list offline of errors */ }
    go('clarify');
  } else {
    try {
      state.plan = await analyze(state.description, state.answers, undefined, 0);
    } catch { /* review renders from the last good plan */ }
    seedBriefFromPlan();
    go('review');
  }
}

/* ---------- review ---------- */

const REVIEW_FIELDS = ['brand', 'product', 'audience', 'objective', 'offer', 'creativeDirection'];

function fieldLabel(id) {
  const meta = state.fields.find((f) => f.id === id);
  return meta ? meta.label : id;
}

function sourceBadge(source) {
  if (source === 'supplied') return '<span class="badge badge-supplied">Supplied</span>';
  if (source === 'assumed') return '<span class="badge badge-assumed">Assumed</span>';
  return '<span class="badge badge-missing">Missing</span>';
}

function renderReview() {
  if (!state.brief && state.plan) seedBriefFromPlan();
  const box = document.getElementById('brief-review');
  box.textContent = '';
  const sources = (state.plan && state.plan.sources) || {};
  REVIEW_FIELDS.forEach((id) => {
    const wrap = document.createElement('div');
    wrap.className = 'review-field';
    const head = document.createElement('div');
    head.className = 'review-head';
    const label = document.createElement('label');
    label.setAttribute('for', `review-${id}`);
    label.textContent = fieldLabel(id);
    const badge = document.createElement('span');
    badge.innerHTML = sourceBadge(state.brief[id] ? (sources[id] || 'supplied') : 'missing');
    head.append(label, badge.span ? badge.span : badge);
    const input = id === 'creativeDirection'
      ? document.createElement('textarea')
      : document.createElement('input');
    if (id !== 'creativeDirection') input.type = 'text';
    else input.rows = 2;
    input.id = `review-${id}`;
    input.name = id;
    input.value = state.brief[id] || '';
    const meta = state.fields.find((f) => f.id === id);
    if (meta) input.maxLength = meta.maxLength;
    input.addEventListener('input', () => {
      state.brief[id] = input.value;
      state.reviewValid = false;
      updateReviewCta();
      save();
    });
    wrap.append(head, input);
    box.append(wrap);
  });
  renderAssumptions();
  renderStyles();
  renderModes();
  updateReviewCta();
  const result = document.getElementById('review-result');
  if (!state.reviewValid) {
    result.className = 'form-result';
    result.textContent = '';
  }
}

function renderAssumptions() {
  const box = document.getElementById('assumptions-box');
  box.textContent = '';
  if (!state.plan || !Array.isArray(state.plan.assumptions)) return;
  const title = document.createElement('h3');
  title.textContent = 'Assumptions (advanced settings)';
  const ul = document.createElement('ul');
  state.plan.assumptions.forEach((a) => {
    const li = document.createElement('li');
    li.textContent = `${a.field === 'styleId' ? 'Style' : 'Photography mode'}: ${a.value} — ${a.reason}`;
    ul.append(li);
  });
  box.append(title, ul);
}

function renderStyles() {
  const grid = document.getElementById('style-grid');
  if (!grid) return;
  grid.textContent = '';
  state.styles.forEach((style) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'choice-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', style.id === state.styleId ? 'true' : 'false');
    const name = document.createElement('strong');
    name.textContent = style.name;
    const tag = document.createElement('small');
    tag.textContent = (style.placeholder ? 'Temporary slot — ' : '') + style.tagline;
    card.append(name, tag);
    card.addEventListener('click', () => {
      state.styleId = style.id;
      state.reviewValid = false;
      updateReviewCta();
      renderStyles();
      save();
    });
    grid.append(card);
  });
}

function renderModes() {
  const row = document.getElementById('mode-row');
  if (!row) return;
  row.textContent = '';
  state.modes.forEach((mode) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'choice-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', mode.id === state.modeId ? 'true' : 'false');
    const name = document.createElement('strong');
    name.textContent = mode.name;
    const desc = document.createElement('small');
    desc.textContent = mode.description;
    card.append(name, desc);
    card.addEventListener('click', () => {
      state.modeId = mode.id;
      state.reviewValid = false;
      updateReviewCta();
      renderModes();
      save();
    });
    row.append(card);
  });
  const reason = document.getElementById('mode-reason');
  if (reason) reason.textContent = state.modeReason || '';
}

function readReviewBrief() {
  return {
    brand: state.brief.brand || '',
    product: state.brief.product || '',
    audience: state.brief.audience || '',
    objective: state.brief.objective || '',
    offer: state.brief.offer || '',
    creativeDirection: state.brief.creativeDirection || '',
    styleId: state.styleId,
    photographyMode: state.modeId,
  };
}

function showReviewErrors(issues) {
  const box = document.getElementById('review-errors');
  document.querySelectorAll('#brief-review [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (!issues || issues.length === 0) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = issues.map((i) => i.message).join(' ');
  issues.forEach((issue) => {
    const input = document.getElementById(`review-${issue.field}`);
    if (input) input.setAttribute('aria-invalid', 'true');
  });
}

function updateReviewCta() {
  const next = document.getElementById('r-next');
  next.disabled = !state.reviewValid;
  next.setAttribute('aria-disabled', String(!state.reviewValid));
}

async function onValidate() {
  const result = document.getElementById('review-result');
  const brief = readReviewBrief();
  result.className = 'form-result';
  result.textContent = 'Validating…';
  try {
    const { status, data } = await fetchJson('/api/briefs/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(brief),
    });
    if (status === 200 && data.ok) {
      state.reviewValid = true;
      showReviewErrors([]);
      // Refresh sources/readiness with the edited values as overrides.
      try {
        const overrides = {};
        REVIEW_FIELDS.forEach((f) => { if ((brief[f] || '').trim()) overrides[f] = brief[f]; });
        state.plan = await analyze(state.description, state.answers, overrides, 0);
        state.brief = { ...state.plan.values };
      } catch { /* validated brief stands on its own */ }
      result.className = 'form-result ok';
      result.textContent = 'Brief is valid. Continue to the Create stage when ready.';
    } else {
      state.reviewValid = false;
      showReviewErrors(data.issues || [{ field: 'body', message: 'Brief was rejected by the server.' }]);
      result.className = 'form-result bad';
      result.textContent = 'Brief needs attention — see the messages above. Optional fields never block you.';
    }
  } catch {
    state.reviewValid = false;
    result.className = 'form-result bad';
    result.textContent = 'Could not reach the local server. Is it running?';
  }
  updateReviewCta();
  save();
}

/* ---------- create ---------- */

async function renderCreate() {
  if (!state.plan) return;
  // Re-resolve readiness against the validated, possibly edited brief.
  try {
    const overrides = {};
    if (state.brief) REVIEW_FIELDS.forEach((f) => { if ((state.brief[f] || '').trim()) overrides[f] = state.brief[f]; });
    state.plan = await analyze(state.description, state.answers, overrides, 0);
  } catch { /* render the last good plan */ }
  const list = document.getElementById('readiness-list');
  list.textContent = '';
  (state.plan.readiness || []).forEach((item) => {
    const li = document.createElement('li');
    li.className = item.met ? 'check-met' : 'check-unmet';
    const mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = item.met ? '✓' : '○';
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    const small = document.createElement('small');
    small.textContent = item.detail;
    text.append(strong, document.createElement('br'), small);
    li.append(mark, text);
    list.append(li);
  });
  const policy = document.getElementById('policy-list');
  policy.textContent = '';
  (state.policyChecks.length > 0 ? state.policyChecks : (state.plan.policyChecks || [])).forEach((line) => {
    const li = document.createElement('li');
    li.className = 'check-neutral';
    const mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '–';
    const span = document.createElement('span');
    span.textContent = line;
    li.append(mark, span);
    policy.append(li);
  });
  save();
}

/* ---------- init ---------- */

async function init() {
  restore();
  document.getElementById('welcome-form').addEventListener('submit', onWelcomeSubmit);
  document.getElementById('custom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    answerQuestion(document.getElementById('custom-answer').value);
  });
  document.getElementById('q-skip').addEventListener('click', () => answerQuestion(''));
  document.getElementById('q-back').addEventListener('click', () => {
    if (state.qIndex > 0) {
      const q = state.plan.questions[state.qIndex - 1];
      if (q) delete state.answers[q.field];
      state.qIndex -= 1;
      go('clarify');
    } else {
      go('welcome');
    }
  });
  document.getElementById('r-back').addEventListener('click', () => {
    if (state.plan && state.plan.questions.length > 0) go('clarify');
    else go('welcome');
  });
  document.getElementById('r-validate').addEventListener('click', onValidate);
  document.getElementById('r-next').addEventListener('click', () => { if (state.reviewValid) go('create'); });
  document.getElementById('c-back').addEventListener('click', () => go('review'));
  document.querySelectorAll('#stepper button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.stage;
      if (name === 'create' && !state.reviewValid) return;
      if (state.unlocked.includes(name)) go(name);
    });
  });
  if (state.description) document.getElementById('campaign-description').value = state.description;

  try {
    const [{ data: health }, { data: config }] = await Promise.all([
      fetchJson('/api/health'),
      fetchJson('/api/config'),
    ]);
    state.styles = Array.isArray(config.styles) ? config.styles : [];
    state.modes = Array.isArray(config.photographyModes) ? config.photographyModes : [];
    state.fields = Array.isArray(config.briefFields) ? config.briefFields : [];
    state.examples = Array.isArray(config.examplePrompts) ? config.examplePrompts : [];
    state.policyChecks = Array.isArray(config.policyChecks) ? config.policyChecks : [];
    if (config.elicitation && Number.isInteger(config.elicitation.maxQuestions)) {
      state.maxQuestions = config.elicitation.maxQuestions;
    }
    if (!state.styleId && state.styles.length > 0) state.styleId = state.styles[0].id;
    if (!state.modeId && state.modes.length > 0) state.modeId = state.modes[0].id;
    setConnection(health && health.generationConnected ? 'Model: connected' : 'Model: not connected');
  } catch {
    setConnection('Model: not connected (server unreachable)');
  }
  renderExamples();
  go(state.unlocked.includes(state.stage) ? state.stage : 'welcome');
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();
