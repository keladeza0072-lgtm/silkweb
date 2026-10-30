'use strict';
/* Creative Studio Milestone 1 frontend: renders config-driven style/mode
   pickers, validates the brief locally, and mirrors server validation.
   No generation calls exist in this milestone. */

const state = { styles: [], modes: [], fields: [], generationConnected: false };

async function fetchJson(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function setConnection(label) {
  const el = document.getElementById('connection-label');
  if (el) el.textContent = label;
}

function renderStyles() {
  const grid = document.getElementById('style-grid');
  grid.textContent = '';
  state.styles.forEach((style, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'choice-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', index === 0 ? 'true' : 'false');
    card.dataset.styleId = style.id;
    const name = document.createElement('strong');
    name.textContent = style.name;
    const tag = document.createElement('small');
    tag.textContent = (style.placeholder ? 'Temporary slot — ' : '') + style.tagline;
    card.append(name, tag);
    card.addEventListener('click', () => {
      grid.querySelectorAll('.choice-card').forEach((c) => c.setAttribute('aria-checked', 'false'));
      card.setAttribute('aria-checked', 'true');
    });
    grid.append(card);
  });
}

function renderModes() {
  const row = document.getElementById('mode-row');
  row.textContent = '';
  state.modes.forEach((mode, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'choice-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', index === 0 ? 'true' : 'false');
    card.dataset.modeId = mode.id;
    const name = document.createElement('strong');
    name.textContent = mode.name;
    const desc = document.createElement('small');
    desc.textContent = mode.description;
    card.append(name, desc);
    card.addEventListener('click', () => {
      row.querySelectorAll('.choice-card').forEach((c) => c.setAttribute('aria-checked', 'false'));
      card.setAttribute('aria-checked', 'true');
    });
    row.append(card);
  });
}

function selectedOf(container, key) {
  const el = container.querySelector('[aria-checked="true"]');
  return el ? el.dataset[key] : undefined;
}

function readBrief() {
  const value = (id) => document.getElementById(id).value;
  return {
    brand: value('brand'),
    product: value('product'),
    audience: value('audience'),
    objective: value('objective'),
    offer: value('offer'),
    creativeDirection: value('creativeDirection'),
    styleId: selectedOf(document.getElementById('style-grid'), 'styleId'),
    photographyMode: selectedOf(document.getElementById('mode-row'), 'modeId'),
  };
}

/** Client-side mirror of the server rules so typos are caught instantly. */
function validateLocally(brief) {
  const issues = [];
  const required = ['brand', 'product', 'audience', 'objective'];
  for (const field of required) {
    if (!brief[field] || !brief[field].trim()) issues.push({ field, message: `${field} is required.` });
  }
  for (const meta of state.fields) {
    const text = (brief[meta.id] || '').trim();
    if (text.length > meta.maxLength) {
      issues.push({ field: meta.id, message: `${meta.label} must be ${meta.maxLength} characters or fewer.` });
    }
  }
  if (!brief.styleId) issues.push({ field: 'styleId', message: 'Choose one of the six listed advertising styles.' });
  if (!brief.photographyMode) issues.push({ field: 'photographyMode', message: 'Choose a photography mode.' });
  return issues;
}

function showErrors(issues) {
  const box = document.getElementById('form-errors');
  document.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (issues.length === 0) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = issues.map((i) => i.message).join(' ');
  for (const issue of issues) {
    const input = document.getElementById(issue.field);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  box.focus?.();
}

async function onSubmit(event) {
  event.preventDefault();
  const result = document.getElementById('form-result');
  const brief = readBrief();
  const local = validateLocally(brief);
  showErrors(local);
  if (local.length > 0) {
    result.className = 'form-result bad';
    result.textContent = 'Brief needs attention — see the messages above.';
    return;
  }
  result.className = 'form-result';
  result.textContent = 'Validating…';
  try {
    const { status, data } = await fetchJson('/api/briefs/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(brief),
    });
    if (status === 200 && data.ok) {
      result.className = 'form-result ok';
      result.textContent =
        'Brief is valid and saved for this session only. Generation is not connected, so no concepts or images were produced.';
      showErrors([]);
    } else {
      showErrors(data.issues || [{ field: 'body', message: 'Brief was rejected by the server.' }]);
      result.className = 'form-result bad';
      result.textContent = 'Server validation found problems — see above.';
    }
  } catch {
    result.className = 'form-result bad';
    result.textContent = 'Could not reach the local server. Is it running?';
  }
}

async function init() {
  document.getElementById('brief-form').addEventListener('submit', onSubmit);
  document.getElementById('brief-form').addEventListener('reset', () => {
    showErrors([]);
    const result = document.getElementById('form-result');
    result.className = 'form-result';
    result.textContent = '';
  });
  try {
    const [{ data: health }, { data: config }] = await Promise.all([
      fetchJson('/api/health'),
      fetchJson('/api/config'),
    ]);
    state.styles = Array.isArray(config.styles) ? config.styles : [];
    state.modes = Array.isArray(config.photographyModes) ? config.photographyModes : [];
    state.fields = Array.isArray(config.briefFields) ? config.briefFields : [];
    state.generationConnected = config.generationConnected === true;
    setConnection(
      health && health.generationConnected
        ? 'Model: connected'
        : 'Model: not connected',
    );
  } catch {
    setConnection('Model: not connected (server unreachable)');
  }
  if (state.styles.length === 0) {
    document.getElementById('style-grid').innerHTML =
      '<p class="panel-sub">Style options unavailable — start the local server and reload.</p>';
  } else {
    renderStyles();
  }
  if (state.modes.length === 0) {
    document.getElementById('mode-row').innerHTML =
      '<p class="panel-sub">Photography modes unavailable — start the local server and reload.</p>';
  } else {
    renderModes();
  }
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();
