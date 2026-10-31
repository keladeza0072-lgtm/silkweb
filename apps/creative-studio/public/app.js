'use strict';
/* Creative Studio frontend: one coherent campaign workflow.
   Brief (natural language + deterministic elicitation) → Campaign
   review (approved library pickers + validation) → Concepts (single
   POST /api/concepts/generate per click, explicit states, no auto
   retries) → deterministic Evaluation + Policy → Landing preview →
   Image slots (not connected, honest placeholders). */

const REVIEW_FIELDS = ['brand', 'product', 'audience', 'objective', 'offer', 'creativeDirection'];
const CHANNEL_ID = 'channel';

const state = {
  description: '',
  answers: {},
  qIndex: 0,
  plan: null,
  brief: null,
  styles: [],
  frameworks: [],
  modes: [],
  fields: [],
  policyChecks: [],
  examples: [],
  maxQuestions: 3,
  styleId: 'problem-solution',
  frameworkId: 'auto',
  modeId: null,
  modeReason: '',
  reviewValid: false,
  generationConnected: false,
  genState: 'idle',
  genError: null,
  concepts: [],
  selectedConcept: null,
  evaluations: [],
  policies: [],
  landing: null,
  previewWidth: 'desktop',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchJson(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function setConnection(connected, label) {
  state.generationConnected = connected;
  const el = document.getElementById('connection-label');
  if (el) el.textContent = label;
  const dot = document.getElementById('connection-dot');
  if (dot) dot.className = connected ? 'dot dot-on' : 'dot dot-off';
}

function fieldLabel(id) {
  if (id === CHANNEL_ID) return 'Channel (optional)';
  const meta = state.fields.find((f) => f.id === id);
  return meta ? meta.label : id;
}

/* ---------- brief + elicitation ---------- */

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

function seedBriefFromPlan() {
  state.brief = { ...(state.plan ? state.plan.values : {}), [CHANNEL_ID]: (state.brief && state.brief[CHANNEL_ID]) || '' };
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
  state.concepts = [];
  state.evaluations = [];
  state.policies = [];
  state.landing = null;
  try {
    state.plan = await analyze(description, {}, undefined, state.maxQuestions);
    state.modeId = state.plan.recommendedPhotographyMode.mode;
    state.modeReason = state.plan.recommendedPhotographyMode.reason;
    renderConceptsIdle();
    renderEvaluationIdle();
    renderLandingIdle();
    renderImages();
    if (state.plan.questions.length === 0) {
      document.getElementById('clarify-block').hidden = true;
      seedBriefFromPlan();
      renderReview();
      document.getElementById('section-campaign').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      document.getElementById('clarify-block').hidden = false;
      renderQuestion();
      document.getElementById('clarify-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    box.hidden = false;
    box.textContent = err instanceof Error ? err.message : 'Could not reach the local server. Is it running?';
  }
}

function currentQuestion() {
  if (!state.plan || !Array.isArray(state.plan.questions)) return null;
  return state.plan.questions[state.qIndex] || null;
}

function renderQuestion() {
  const q = currentQuestion();
  const progress = document.getElementById('clarify-progress');
  if (!q) {
    document.getElementById('clarify-block').hidden = true;
    seedBriefFromPlan();
    renderReview();
    document.getElementById('section-campaign').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const remaining = Math.max(0, questionBudget() - state.qIndex);
  if (remaining <= 0) {
    try {
      state.plan = await analyze(state.description, state.answers, undefined, 0);
    } catch { /* review renders from the last good plan */ }
    document.getElementById('clarify-block').hidden = true;
    seedBriefFromPlan();
    renderReview();
    document.getElementById('section-campaign').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (state.qIndex < state.plan.questions.length) {
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
    renderQuestion();
  } else {
    try {
      state.plan = await analyze(state.description, state.answers, undefined, 0);
    } catch { /* review renders from the last good plan */ }
    document.getElementById('clarify-block').hidden = true;
    seedBriefFromPlan();
    renderReview();
    document.getElementById('section-campaign').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ---------- campaign review ---------- */

function sourceBadge(source) {
  if (source === 'supplied') return '<span class="badge badge-supplied">Supplied</span>';
  if (source === 'assumed') return '<span class="badge badge-assumed">Assumed</span>';
  return '<span class="badge badge-missing">Missing</span>';
}

function renderReview() {
  if (!state.brief && state.plan) seedBriefFromPlan();
  if (!state.brief) return;
  const box = document.getElementById('brief-review');
  box.textContent = '';
  const sources = (state.plan && state.plan.sources) || {};
  [...REVIEW_FIELDS, CHANNEL_ID].forEach((id) => {
    const wrap = document.createElement('div');
    wrap.className = 'review-field';
    const head = document.createElement('div');
    head.className = 'review-head';
    const label = document.createElement('label');
    label.setAttribute('for', `review-${id}`);
    label.textContent = fieldLabel(id);
    const badge = document.createElement('span');
    badge.innerHTML = sourceBadge(state.brief[id] ? (sources[id] || 'supplied') : 'missing');
    head.append(label, badge);
    const input = id === 'creativeDirection' ? document.createElement('textarea') : document.createElement('input');
    if (id !== 'creativeDirection') input.type = 'text';
    else input.rows = 2;
    input.id = `review-${id}`;
    input.name = id;
    input.value = state.brief[id] || '';
    const meta = state.fields.find((f) => f.id === id);
    input.maxLength = meta ? meta.maxLength : (id === CHANNEL_ID ? 80 : 200);
    input.placeholder = id === CHANNEL_ID ? 'e.g. Instagram (optional)' : '';
    input.addEventListener('input', () => {
      state.brief[id] = input.value;
      state.reviewValid = false;
      updateCampaignCta();
    });
    wrap.append(head, input);
    box.append(wrap);
  });
  renderAssumptions();
  renderStyles();
  renderFrameworks();
  renderModes();
  updateCampaignCta();
}

function renderAssumptions() {
  const box = document.getElementById('assumptions-box');
  box.textContent = '';
  if (!state.plan || !Array.isArray(state.plan.assumptions)) return;
  const title = document.createElement('h3');
  title.textContent = 'Assumptions we are making';
  const ul = document.createElement('ul');
  state.plan.assumptions.forEach((a) => {
    const li = document.createElement('li');
    li.textContent = `${a.field === 'styleId' ? 'Style' : 'Photography mode'}: ${a.value} — ${a.reason}`;
    ul.append(li);
  });
  box.append(title, ul);
}

function pickCard(item, selected, onPick, extraSmall) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'choice-card';
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', selected ? 'true' : 'false');
  const name = document.createElement('strong');
  name.textContent = item.name;
  const tag = document.createElement('small');
  tag.textContent = item.tagline + (extraSmall ? ` ${extraSmall}` : '');
  card.append(name, tag);
  card.addEventListener('click', onPick);
  return card;
}

function renderStyles() {
  const grid = document.getElementById('style-grid');
  if (!grid) return;
  grid.textContent = '';
  state.styles.forEach((style) => {
    grid.append(pickCard(style, style.id === state.styleId, () => {
      state.styleId = style.id;
      state.reviewValid = false;
      updateCampaignCta();
      renderStyles();
    }));
  });
}

function renderFrameworks() {
  const grid = document.getElementById('framework-grid');
  if (!grid) return;
  grid.textContent = '';
  const auto = { id: 'auto', name: 'Auto', tagline: 'Let the brief decide the best fit.' };
  [auto, ...state.frameworks].forEach((fw) => {
    grid.append(pickCard(fw, fw.id === state.frameworkId, () => {
      state.frameworkId = fw.id;
      state.reviewValid = false;
      updateCampaignCta();
      renderFrameworks();
    }));
  });
}

function renderModes() {
  const row = document.getElementById('mode-row');
  if (!row) return;
  row.textContent = '';
  state.modes.forEach((mode) => {
    row.append(pickCard(mode, mode.id === state.modeId, () => {
      state.modeId = mode.id;
      state.reviewValid = false;
      updateCampaignCta();
      renderModes();
    }, mode.description));
  });
  const reason = document.getElementById('mode-reason');
  if (reason) reason.textContent = state.modeReason || '';
}

function readReviewBrief() {
  return {
    brand: (state.brief.brand || '').trim(),
    product: (state.brief.product || '').trim(),
    audience: (state.brief.audience || '').trim(),
    objective: (state.brief.objective || '').trim(),
    offer: (state.brief.offer || '').trim(),
    creativeDirection: (state.brief.creativeDirection || '').trim(),
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

function updateCampaignCta() {
  renderConceptsIdle();
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
      try {
        const overrides = {};
        REVIEW_FIELDS.forEach((f) => { if ((brief[f] || '').trim()) overrides[f] = brief[f]; });
        state.plan = await analyze(state.description, state.answers, overrides, 0);
        const channel = (state.brief && state.brief[CHANNEL_ID]) || '';
        state.brief = { ...state.plan.values, [CHANNEL_ID]: channel };
      } catch { /* validated brief stands on its own */ }
      result.className = 'form-result ok';
      result.textContent = 'Campaign is valid. Request concepts below whenever ready.';
      renderConceptsIdle();
      document.getElementById('section-concepts').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      state.reviewValid = false;
      showReviewErrors(data.issues || [{ field: 'body', message: 'Campaign was rejected by the server.' }]);
      result.className = 'form-result bad';
      result.textContent = 'Campaign needs attention — see the messages above.';
      renderConceptsIdle();
    }
  } catch {
    state.reviewValid = false;
    result.className = 'form-result bad';
    result.textContent = 'Could not reach the local server. Is it running?';
  }
}

/* ---------- campaign context ---------- */

function buildFacts(brief) {
  const facts = [];
  const push = (label, value) => { if (value && String(value).trim()) facts.push(`${label}: ${String(value).trim()}`); };
  push('Product', brief.product);
  push('Audience', brief.audience);
  push('Objective', brief.objective);
  push('Brand', brief.brand);
  push('Offer', brief.offer);
  push('Channel', brief.channel);
  push('Creative direction', brief.creativeDirection);
  return facts;
}

function buildCampaign() {
  const brief = {
    brand: (state.brief.brand || '').trim(),
    product: (state.brief.product || '').trim(),
    audience: (state.brief.audience || '').trim(),
    objective: (state.brief.objective || '').trim(),
    offer: (state.brief.offer || '').trim(),
    creativeDirection: (state.brief.creativeDirection || '').trim(),
    channel: ((state.brief && state.brief[CHANNEL_ID]) || '').trim(),
  };
  const campaign = {
    description: state.description,
    product: brief.product,
    objective: brief.objective,
    facts: buildFacts(brief),
    assumptions: [],
  };
  if (brief.channel) campaign.channel = brief.channel;
  if (brief.audience) campaign.audience = brief.audience;
  if (brief.brand) campaign.brand = brief.brand;
  if (brief.offer) campaign.offer = brief.offer;
  if (brief.creativeDirection) campaign.creativeDirection = brief.creativeDirection;
  if (state.styleId) campaign.preferredStyleId = state.styleId;
  if (state.frameworkId && state.frameworkId !== 'auto') campaign.preferredFrameworkId = state.frameworkId;
  return campaign;
}

/* ---------- copy controls ---------- */

async function copyText(text, btn) {
  const done = () => {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
  };
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { /* clipboard unavailable */ }
    ta.remove();
  }
}

function copyBtn(label, text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-small btn-ghost';
  btn.textContent = label;
  btn.addEventListener('click', () => copyText(text, btn));
  return btn;
}

function styleName(id) {
  const s = state.styles.find((x) => x.id === id);
  return s ? s.name : id;
}

function frameworkName(id) {
  const f = state.frameworks.find((x) => x.id === id);
  return f ? `${f.name} · ${f.tagline}` : id;
}

/* ---------- concepts ---------- */

function renderConceptsIdle() {
  const btn = document.getElementById('generate-btn');
  btn.disabled = !state.reviewValid;
  const status = document.getElementById('concepts-status');
  if (!state.brief) {
    status.className = 'status-line';
    status.textContent = 'Describe your brief above to begin.';
  } else if (!state.reviewValid) {
    status.className = 'status-line';
    status.textContent = 'Validate your campaign to unlock generation.';
  } else if (state.genState !== 'success') {
    status.className = 'status-line';
    status.textContent = state.generationConnected
      ? 'Ready — one request makes exactly one provider call.'
      : 'Provider not configured: requesting will show how to enable it, without charging anything.';
  }
}

function conceptCard(concept, index) {
  const card = document.createElement('article');
  card.className = 'concept-card';
  const head = document.createElement('div');
  head.className = 'concept-head';
  const title = document.createElement('h3');
  title.textContent = `Concept ${index + 1}: ${concept.angle}`;
  const pick = document.createElement('label');
  pick.className = 'concept-pick';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'landing-concept';
  radio.value = concept.id;
  radio.checked = state.selectedConcept === concept.id;
  radio.addEventListener('change', () => {
    state.selectedConcept = concept.id;
    state.landing = null;
    renderLandingIdle();
  });
  const pickText = document.createElement('span');
  pickText.textContent = 'Use for landing page';
  pick.append(radio, pickText);
  head.append(title, pick);
  card.append(head);

  const dl = document.createElement('dl');
  dl.className = 'concept-fields';
  const rows = [
    ['Headline', concept.headline],
    ['Primary copy', concept.primaryCopy],
    ['Call to action', concept.cta],
    ['Style', styleName(concept.styleId)],
    ['Copy approach', frameworkName(concept.frameworkId)],
    ['Visual direction', concept.visualDirection],
    ['Photography prompt', concept.photographyPrompt],
  ];
  rows.forEach(([term, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  });
  card.append(dl);

  const controls = document.createElement('div');
  controls.className = 'concept-controls';
  controls.append(
    copyBtn('Copy headline', concept.headline),
    copyBtn('Copy ad copy', `${concept.headline}\n\n${concept.primaryCopy}\n\n${concept.cta}`),
    copyBtn('Copy all', [
      `Angle: ${concept.angle}`, `Headline: ${concept.headline}`,
      `Primary copy: ${concept.primaryCopy}`, `CTA: ${concept.cta}`,
      `Style: ${styleName(concept.styleId)}`, `Framework: ${concept.frameworkId}`,
      `Visual direction: ${concept.visualDirection}`,
      `Photography prompt: ${concept.photographyPrompt}`,
    ].join('\n')),
  );
  card.append(controls);
  return card;
}

function selectedConceptObj() {
  return state.concepts.find((c) => c.id === state.selectedConcept) || state.concepts[0] || null;
}

async function onGenerate() {
  const btn = document.getElementById('generate-btn');
  const status = document.getElementById('concepts-status');
  const list = document.getElementById('concepts-list');
  state.genState = 'loading';
  state.genError = null;
  btn.disabled = true;
  status.className = 'status-line info';
  status.textContent = 'Requesting two concepts — one provider call, no retries…';
  list.textContent = '';
  try {
    // Exactly one request per click. Failures never retried automatically.
    const { status: code, data } = await fetchJson('/api/concepts/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCampaign()),
    });
    if (code === 200 && data.ok) {
      state.genState = 'success';
      state.concepts = data.concepts;
      state.selectedConcept = data.concepts[0].id;
      state.evaluations = [];
      state.policies = [];
      state.landing = null;
      status.className = 'status-line ok';
      status.textContent = `Two concepts generated by ${data.provider || 'the configured provider'}.`;
      list.textContent = '';
      data.concepts.forEach((c, i) => list.append(conceptCard(c, i)));
      document.getElementById('evaluate-btn').disabled = false;
      document.getElementById('landing-btn').disabled = false;
      renderEvaluationIdle();
      renderLandingIdle();
      renderImages();
    } else if (data && data.error && data.error.code === 'PROVIDER_UNAVAILABLE') {
      state.genState = 'unconfigured';
      status.className = 'status-line warn';
      status.textContent = 'Concept generation is not configured on this server. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY, then restart the server and try again — nothing was charged and nothing was retried.';
    } else {
      state.genState = 'error';
      const detail = (data && data.error && `${data.error.code}: ${data.error.message}`) ||
        (data && data.issues && data.issues.map((i) => i.message).join(' ')) ||
        `Request failed (HTTP ${code}).`;
      state.genError = detail;
      status.className = 'status-line bad';
      status.textContent = `Generation failed — ${detail} Fix the cause and request again manually if you wish.`;
    }
  } catch {
    state.genState = 'error';
    status.className = 'status-line bad';
    status.textContent = 'Could not reach the local server. Is it running? No request was retried.';
  } finally {
    btn.disabled = !state.reviewValid || state.genState === 'loading';
  }
}

/* ---------- evaluation ---------- */

function renderEvaluationIdle() {
  const btn = document.getElementById('evaluate-btn');
  btn.disabled = state.concepts.length !== 2;
  const status = document.getElementById('evaluation-status');
  if (state.concepts.length !== 2) {
    status.className = 'status-line';
    status.textContent = 'Generate concepts first — evaluation scores real concepts only.';
  } else if (state.evaluations.length === 0) {
    status.className = 'status-line';
    status.textContent = 'Ready — evaluation runs locally in code, never in a model.';
  }
}

function bandClass(band) {
  if (band === 'Ready') return 'band-ready';
  if (band === 'Nearly ready') return 'band-near';
  if (band === 'Needs work') return 'band-work';
  return 'band-blocked';
}

async function onEvaluate() {
  const btn = document.getElementById('evaluate-btn');
  const status = document.getElementById('evaluation-status');
  btn.disabled = true;
  status.className = 'status-line info';
  status.textContent = 'Scoring against seven weighted checks…';
  try {
    const { status: code, data } = await fetchJson('/api/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaign: buildCampaign(), concepts: state.concepts }),
    });
    if (code === 200 && data.ok) {
      state.evaluations = data.evaluations;
      state.policies = data.policies;
      status.className = 'status-line ok';
      status.textContent = 'Scored locally with deterministic rules — no model evaluated this work.';
      renderEvaluations();
      renderPolicies();
    } else {
      status.className = 'status-line bad';
      status.textContent = `Evaluation failed (HTTP ${code}). Generate fresh concepts and try again.`;
    }
  } catch {
    status.className = 'status-line bad';
    status.textContent = 'Could not reach the local server. Is it running?';
  } finally {
    btn.disabled = state.concepts.length !== 2;
  }
}

function renderEvaluations() {
  const list = document.getElementById('evaluation-list');
  list.textContent = '';
  state.evaluations.forEach((ev, i) => {
    const card = document.createElement('article');
    card.className = 'eval-card';
    const head = document.createElement('div');
    head.className = 'eval-head';
    const title = document.createElement('h3');
    title.textContent = `Concept ${i + 1}`;
    const score = document.createElement('p');
    score.className = 'eval-score';
    const band = document.createElement('span');
    band.className = `band ${bandClass(ev.band)}`;
    band.textContent = `${ev.overall} · ${ev.band}`;
    score.append(band);
    head.append(title, score);
    card.append(head);
    const ul = document.createElement('ul');
    ul.className = 'criteria';
    ev.criteria.forEach((c) => {
      const li = document.createElement('li');
      const top = document.createElement('div');
      top.className = 'criterion-top';
      const label = document.createElement('strong');
      label.textContent = c.label;
      const meta = document.createElement('span');
      meta.className = 'criterion-meta';
      meta.textContent = `${c.score}/100 · weight ${c.weight}%`;
      top.append(label, meta);
      const bar = document.createElement('div');
      bar.className = 'score-bar';
      const fill = document.createElement('span');
      fill.style.width = `${c.score}%`;
      bar.append(fill);
      const detail = document.createElement('p');
      detail.className = 'criterion-detail';
      detail.textContent = c.detail;
      const action = document.createElement('p');
      action.className = 'criterion-action';
      action.textContent = `Next: ${c.action}`;
      li.append(top, bar, detail, action);
      ul.append(li);
    });
    card.append(ul);
    const method = document.createElement('p');
    method.className = 'hint';
    method.textContent = ev.method;
    card.append(method);
    list.append(card);
  });
}

function renderPolicies() {
  const box = document.getElementById('policy-list');
  box.textContent = '';
  state.policies.forEach((policy, i) => {
    const card = document.createElement('article');
    card.className = 'policy-card';
    const title = document.createElement('h3');
    title.textContent = `Policy checklist · Concept ${i + 1}`;
    card.append(title);
    const ul = document.createElement('ul');
    ul.className = 'check-list';
    policy.items.forEach((item) => {
      const li = document.createElement('li');
      li.className = item.status === 'pass' ? 'check-met' : 'check-unmet';
      const mark = document.createElement('span');
      mark.className = 'check-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = item.status === 'pass' ? '✓' : '!';
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = item.label;
      const small = document.createElement('small');
      small.textContent = item.note;
      text.append(strong, document.createElement('br'), small);
      li.append(mark, text);
      ul.append(li);
    });
    card.append(ul);
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = policy.disclaimer;
    card.append(note);
    box.append(card);
  });
}

/* ---------- landing preview ---------- */

function renderLandingIdle() {
  const btn = document.getElementById('landing-btn');
  btn.disabled = !selectedConceptObj();
  const status = document.getElementById('landing-status');
  const wrap = document.getElementById('landing-wrap');
  if (!selectedConceptObj()) {
    status.className = 'status-line';
    status.textContent = 'Generate concepts first, then preview the page for your chosen direction.';
    wrap.hidden = true;
  } else if (!state.landing) {
    status.className = 'status-line';
    status.textContent = 'Ready — the preview is assembled from your brief, nothing invented.';
    wrap.hidden = true;
  }
}

async function onLanding() {
  const concept = selectedConceptObj();
  if (!concept) return;
  const btn = document.getElementById('landing-btn');
  const status = document.getElementById('landing-status');
  btn.disabled = true;
  status.className = 'status-line info';
  status.textContent = 'Assembling preview from brief facts…';
  try {
    const { status: code, data } = await fetchJson('/api/landing/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaign: buildCampaign(), concept }),
    });
    if (code === 200 && data.ok) {
      state.landing = data.landing;
      status.className = 'status-line ok';
      status.textContent = 'Preview assembled — supporting points repeat brief facts only.';
      renderLanding();
    } else {
      status.className = 'status-line bad';
      status.textContent = `Preview failed (HTTP ${code}).`;
    }
  } catch {
    status.className = 'status-line bad';
    status.textContent = 'Could not reach the local server. Is it running?';
  } finally {
    btn.disabled = !selectedConceptObj();
  }
}

function renderLanding() {
  const wrap = document.getElementById('landing-wrap');
  const page = document.getElementById('landing-page');
  const landing = state.landing;
  if (!landing) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.classList.toggle('mobile', state.previewWidth === 'mobile');
  page.textContent = '';
  const brand = document.createElement('p');
  brand.className = 'lp-brand';
  brand.textContent = landing.brand;
  const hero = document.createElement('h3');
  hero.className = 'lp-hero';
  hero.textContent = landing.headline;
  const sub = document.createElement('p');
  sub.className = 'lp-sub';
  sub.textContent = landing.subhead;
  const cta = document.createElement('p');
  cta.className = 'lp-cta-row';
  const ctaBtn = document.createElement('span');
  ctaBtn.className = 'lp-cta';
  ctaBtn.textContent = landing.cta;
  cta.append(ctaBtn);
  page.append(brand, hero, sub, cta);
  const factsTitle = document.createElement('h4');
  factsTitle.className = 'lp-section-title';
  factsTitle.textContent = 'What we know';
  page.append(factsTitle);
  if (landing.benefits.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'lp-benefits';
    landing.benefits.forEach((b) => {
      const li = document.createElement('li');
      li.textContent = b;
      ul.append(li);
    });
    page.append(ul);
  } else {
    const empty = document.createElement('p');
    empty.className = 'lp-empty';
    empty.textContent = 'No verified facts supplied yet — add product facts to the brief to strengthen this page. Nothing was invented to fill it.';
    page.append(empty);
  }
  if (landing.audienceLine) {
    const aud = document.createElement('p');
    aud.className = 'lp-note-line';
    aud.textContent = landing.audienceLine;
    page.append(aud);
  }
  if (landing.goalLine) {
    const goal = document.createElement('p');
    goal.className = 'lp-note-line';
    goal.textContent = landing.goalLine;
    page.append(goal);
  }
  const foot = document.createElement('p');
  foot.className = 'lp-foot';
  foot.textContent = `Direction: ${styleName(landing.styleId)} · ${frameworkName(landing.frameworkId)}`;
  page.append(foot);
  document.getElementById('landing-method').textContent = landing.method;
}

/* ---------- image slots ---------- */

function renderImages() {
  const list = document.getElementById('images-list');
  const status = document.getElementById('images-status');
  list.textContent = '';
  status.className = 'status-line';
  status.textContent = state.concepts.length === 2
    ? 'Prompts are ready below. Generation itself is not connected — no image has been made.'
    : 'Image slots activate with real photography prompts once concepts exist.';
  for (let i = 0; i < 2; i += 1) {
    const li = document.createElement('li');
    li.className = 'slot slot-image';
    const title = document.createElement('h4');
    title.textContent = `Image slot ${i + 1}`;
    li.append(title);
    const ph = document.createElement('div');
    ph.className = 'image-ph';
    ph.setAttribute('aria-hidden', 'true');
    ph.textContent = 'No image — provider not connected';
    li.append(ph);
    const concept = state.concepts[i];
    if (concept) {
      const label = document.createElement('p');
      label.className = 'slot-prompt-label';
      label.textContent = `Photography prompt · Concept ${i + 1}`;
      const prompt = document.createElement('p');
      prompt.className = 'slot-prompt';
      prompt.textContent = concept.photographyPrompt;
      li.append(label, prompt, copyBtn('Copy prompt', concept.photographyPrompt));
    } else {
      const waiting = document.createElement('p');
      waiting.textContent = 'Awaiting concepts — the photography prompt will appear here.';
      li.append(waiting);
    }
    const gen = document.createElement('button');
    gen.type = 'button';
    gen.className = 'btn btn-small';
    gen.textContent = 'Generate image';
    gen.addEventListener('click', () => onImageGenerate(i, gen));
    li.append(gen);
    const msg = document.createElement('p');
    msg.className = 'hint';
    msg.id = `image-msg-${i}`;
    li.append(msg);
  }
}

async function onImageGenerate(slot, btn) {
  const msg = document.getElementById(`image-msg-${slot}`);
  btn.disabled = true;
  msg.textContent = 'Checking image provider…';
  try {
    // Integration boundary: a later milestone implements this route.
    const { data } = await fetchJson('/api/images/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot, conceptId: state.concepts[slot] ? state.concepts[slot].id : null }),
    });
    msg.textContent = (data && data.error && `${data.error.code}: ${data.error.message} No charge was made.`) ||
      'Image generation is not connected yet. No image was generated.';
  } catch {
    msg.textContent = 'Could not reach the local server. No image was generated.';
  } finally {
    btn.disabled = false;
  }
}

/* ---------- init ---------- */

async function init() {
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
      renderQuestion();
    } else {
      document.getElementById('clarify-block').hidden = true;
      document.getElementById('campaign-description').focus();
    }
  });
  document.getElementById('r-validate').addEventListener('click', onValidate);
  document.getElementById('generate-btn').addEventListener('click', onGenerate);
  document.getElementById('evaluate-btn').addEventListener('click', onEvaluate);
  document.getElementById('landing-btn').addEventListener('click', onLanding);
  document.getElementById('view-desktop').addEventListener('click', () => setPreviewWidth('desktop'));
  document.getElementById('view-mobile').addEventListener('click', () => setPreviewWidth('mobile'));
  if (state.description) document.getElementById('campaign-description').value = state.description;

  try {
    const [{ data: health }, { data: config }] = await Promise.all([
      fetchJson('/api/health'),
      fetchJson('/api/config'),
    ]);
    state.styles = Array.isArray(config.styles) ? config.styles : [];
    state.frameworks = Array.isArray(config.frameworks) ? config.frameworks : [];
    state.modes = Array.isArray(config.photographyModes) ? config.photographyModes : [];
    state.fields = Array.isArray(config.briefFields) ? config.briefFields : [];
    state.examples = Array.isArray(config.examplePrompts) ? config.examplePrompts : [];
    state.policyChecks = Array.isArray(config.policyChecks) ? config.policyChecks : [];
    if (config.elicitation && Number.isInteger(config.elicitation.maxQuestions)) {
      state.maxQuestions = config.elicitation.maxQuestions;
    }
    if (!state.styles.some((s) => s.id === state.styleId) && state.styles.length > 0) {
      state.styleId = state.styles[0].id;
    }
    if (!state.modeId && state.modes.length > 0) state.modeId = state.modes[0].id;
    setConnection(
      Boolean(health && health.generationConnected),
      health && health.generationConnected
        ? 'Concept generation: configured'
        : 'Concept generation: not configured',
    );
  } catch {
    setConnection(false, 'Server unreachable — is it running?');
  }
  renderExamples();
  renderConceptsIdle();
  renderEvaluationIdle();
  renderLandingIdle();
  renderImages();
}

function setPreviewWidth(width) {
  state.previewWidth = width;
  document.getElementById('view-desktop').classList.toggle('seg-active', width === 'desktop');
  document.getElementById('view-mobile').classList.toggle('seg-active', width === 'mobile');
  document.getElementById('view-desktop').setAttribute('aria-pressed', String(width === 'desktop'));
  document.getElementById('view-mobile').setAttribute('aria-pressed', String(width === 'mobile'));
  if (state.landing) renderLanding();
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();
