'use strict';

const state = {
  requirement: '',
  capabilities: new Set(['slot-guard']),
  allCapabilities: [],
  results: [],
  selected: null, // { id, version }
  approvals: [],
};

const $ = (id) => document.getElementById(id);

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('is-visible'));
  $(`screen-${name}`).classList.add('is-visible');
  document.querySelectorAll('.step').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.screen === name);
  });
  if (name === 'contract') {
    renderContractPicker();
    loadContract();
  }
  if (name === 'verification') {
    renderVerificationPicker();
    loadVerification();
    renderBookingStatus();
  }
}

document.querySelectorAll('.step').forEach((el) => {
  el.addEventListener('click', () => showScreen(el.dataset.screen));
});

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data && data.error && data.error.message ? data.error.message : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

async function init() {
  try {
    const sample = await api('/api/sample-requirement');
    $('requirement').value = sample.requirement;
    state.requirement = sample.requirement;
  } catch {
    $('requirement').value = 'Prevent double-booking for a barbershop using fixed 30-minute appointment slots.';
  }
  $('requirement').addEventListener('input', (event) => {
    state.requirement = event.target.value;
  });
  state.requirement = $('requirement').value;

  $('sample-btn').addEventListener('click', async () => {
    const sample = await api('/api/sample-requirement');
    $('requirement').value = sample.requirement;
    state.requirement = sample.requirement;
    state.capabilities = new Set([sample.capability]);
    renderPills();
  });

  const caps = await api('/api/capabilities').catch(() => ({ capabilities: [] }));
  state.allCapabilities = caps.capabilities || [];
  if (!state.allCapabilities.includes('slot-guard')) state.allCapabilities.unshift('slot-guard');
  renderPills();

  $('search-btn').addEventListener('click', runSearch);
  $('query').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runSearch();
  });
  await runSearch();
  await refreshApprovals();
}

function renderPills() {
  const box = $('capability-pills');
  box.innerHTML = '';
  for (const cap of state.allCapabilities) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill';
    btn.textContent = cap;
    btn.setAttribute('aria-pressed', state.capabilities.has(cap) ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (state.capabilities.has(cap)) state.capabilities.delete(cap);
      else state.capabilities.add(cap);
      renderPills();
    });
    box.appendChild(btn);
  }
}

async function runSearch() {
  const box = $('results');
  box.innerHTML = '<div class="empty">Searching the certified registry…</div>';
  const params = new URLSearchParams();
  for (const cap of state.capabilities) params.append('capability', cap);
  const query = $('query').value.trim();
  if (query) params.set('query', query);
  try {
    const result = await api(`/api/search?${params.toString()}`);
    state.results = result.components || [];
    $('deterministic-note').textContent = result.deterministicNote || '';
    if (state.results.length === 0) {
      box.innerHTML = `<div class="empty">No certified components match these capability tags (trusted total: ${result.totalTrusted}). ` +
        'Try removing a tag — only components that declare “verified” and pass current validation are ever listed.</div>';
      return;
    }
    box.innerHTML = '';
    for (const comp of state.results) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        `<div><strong>${esc(comp.id)}</strong> <span class="mono">@${esc(comp.version)}</span> ` +
        `<span class="badge ok">certification eligible</span></div>` +
        `<div class="note">${esc(comp.summary)}</div>` +
        `<div class="note">Capabilities: ${comp.capabilities.map((c) => `<span class="mono">${esc(c)}</span>`).join(', ')} · stack <span class="mono">${esc(comp.stack)}</span></div>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = state.selected && state.selected.id === comp.id ? 'Selected ✓ — review contract' : 'Select and review contract';
      btn.addEventListener('click', () => {
        state.selected = { id: comp.id, version: comp.version };
        showScreen('contract');
      });
      card.appendChild(btn);
      box.appendChild(card);
    }
  } catch (error) {
    box.innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

function selectedIdentity() {
  if (state.selected) return state.selected;
  if (state.results.length > 0) return { id: state.results[0].id, version: state.results[0].version };
  return { id: 'booking-slot-guard', version: '0.1.0' };
}

function renderContractPicker() {
  const box = $('contract-picker');
  const current = selectedIdentity();
  box.innerHTML = `<span class="note">Reviewing:</span> <strong>${esc(current.id)}</strong> <span class="mono">@${esc(current.version)}</span>`;
}

async function loadContract() {
  const box = $('contract');
  const current = selectedIdentity();
  box.innerHTML = '<div class="empty">Loading the certified contract…</div>';
  try {
    const contract = await api(`/api/contract?id=${encodeURIComponent(current.id)}&version=${encodeURIComponent(current.version)}`);
    renderContract(box, contract);
  } catch (error) {
    box.innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

function kvRow(term, value) {
  return `<dt>${esc(term)}</dt><dd>${value}</dd>`;
}

function renderContract(box, contract) {
  const deps = contract.dependencies.length === 0
    ? '<span class="note">none</span>'
    : `<ul class="tight">${contract.dependencies.map((d) => `<li><span class="mono">${esc(d.id)}@${esc(d.version)}</span></li>`).join('')}</ul>`;
  const runtimeDeps = Object.entries(contract.runtime.dependencies || {});
  const gate = contract.trusted
    ? '<span class="badge ok">passes current trust gate</span>'
    : '<span class="badge fail">does NOT pass the current trust gate</span>';
  box.innerHTML =
    `<div class="card"><h2>${esc(contract.id)} <span class="mono">@${esc(contract.version)}</span> ${gate}</h2>` +
    `<dl class="kv">` +
    kvRow('Source', `<span class="mono">${esc(contract.sourcePath)}</span>`) +
    kvRow('Capabilities', contract.capabilities.map((c) => `<span class="mono">${esc(c)}</span>`).join(', ')) +
    kvRow('Runtime', `<span class="mono">${esc(contract.runtime.stack)}</span> · node <span class="mono">${esc(contract.runtime.node)}</span>`) +
    kvRow('Runtime deps', runtimeDeps.length === 0 ? '<span class="note">none</span>' : runtimeDeps.map(([k, v]) => `<span class="mono">${esc(k)}@${esc(v)}</span>`).join(', ')) +
    kvRow('Source hash', `<span class="hash">${esc(contract.verification.sourceHash || '—')}</span>`) +
    kvRow('Evidence', `<span class="mono">${esc(contract.verification.evidence)}</span>`) +
    `</dl>` +
    `<h2>Dependencies</h2>${deps}` +
    `<h2>Invariants</h2><ul class="tight">${contract.invariants.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` +
    `<h2>Known limitations</h2><p>${esc(contract.limitations)}</p>` +
    `</div>` +
    `<div class="card" id="approve-card"><h2>Approve contract</h2>` +
    `<p class="note">Approval records the requirement text, capability, exact component identity, source hash, ` +
    `evidence fingerprint, and approval time in a local gitignored file. It records your review — ` +
    `it does not retroactively enforce a gate in the existing booking app.</p>` +
    `<label class="checkline"><input type="checkbox" id="ack"> ` +
    `<span>I acknowledge the limitations above, including the fixed-30-minute constraint and the sequential same-process concurrency testing limitation.</span></label>` +
    `<div class="row"><button id="approve-btn" class="btn btn-primary" type="button">Approve Contract</button></div>` +
    `<div id="approve-result" aria-live="polite"></div></div>`;

  $('approve-btn').addEventListener('click', async () => {
    const acknowledged = $('ack').checked;
    const out = $('approve-result');
    out.innerHTML = '';
    if (!acknowledged) {
      out.innerHTML = '<div class="error">You must acknowledge the limitations before approving.</div>';
      return;
    }
    if (!state.requirement.trim()) {
      out.innerHTML = '<div class="error">Enter a requirement on screen 1 before approving.</div>';
      return;
    }
    try {
      const view = await api('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requirementText: state.requirement,
          capability: [...state.capabilities][0] || 'slot-guard',
          id: contract.id,
          version: contract.version,
          acknowledgedLimitations: true,
        }),
      });
      out.innerHTML = `<div class="card"><span class="badge ok">approved</span> ` +
        `<span class="mono">${esc(view.id)}</span> at ${esc(view.approvedAt)}<br>` +
        `<span class="note">Fingerprint <span class="hash">${esc(view.artifactFingerprint)}</span></span></div>`;
      await refreshApprovals();
    } catch (error) {
      out.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    }
  });
}

async function refreshApprovals() {
  try {
    const data = await api('/api/approvals');
    state.approvals = data.approvals || [];
  } catch {
    state.approvals = [];
  }
}

function renderVerificationPicker() {
  const box = $('verification-picker');
  const current = selectedIdentity();
  box.innerHTML = `<span class="note">Verifying:</span> <strong>${esc(current.id)}</strong> <span class="mono">@${esc(current.version)}</span> ` +
    `<button class="btn btn-ghost" id="verify-btn" type="button">Re-check now</button>`;
  $('verify-btn').addEventListener('click', loadVerification);
}

async function loadVerification() {
  const box = $('verification');
  const current = selectedIdentity();
  box.innerHTML = '<div class="empty">Running the live trust-gate check…</div>';
  try {
    const view = await api(`/api/verification?id=${encodeURIComponent(current.id)}&version=${encodeURIComponent(current.version)}`);
    renderVerification(box, view);
  } catch (error) {
    let detail = '';
    try {
      const res = await fetch(`/api/verification?id=${encodeURIComponent(current.id)}&version=${encodeURIComponent(current.version)}`);
      const data = await res.json().catch(() => ({}));
      if (data && data.verification) {
        renderVerification(box, data.verification);
        return;
      }
    } catch { /* fall through */ }
    box.innerHTML = `<div class="error">${esc(error.message)}${detail}</div>`;
  }
}

function renderVerification(box, view) {
  if (!view.found) {
    box.innerHTML = `<div class="error">Unknown component ${esc(view.id)}@${esc(view.version)} — no manifest declares it. ` +
      'Invalid or missing evidence never appears as valid certification.</div>';
    return;
  }
  const contract = view.contract;
  const evidence = contract.evidence || {};
  const status = view.certified
    ? '<span class="badge ok">CERTIFIED — passing current validation</span>'
    : '<span class="badge fail">NOT CERTIFIED — failing current validation</span>';
  const approvals = (view.approvals || []).map((a) => {
    const badge = a.stale ? '<span class="badge warn">STALE</span>' : '<span class="badge ok">current</span>';
    return `<li>${badge} <span class="mono">${esc(a.id)}</span> — ${esc(a.requirementText)} ` +
      `<span class="note">(${esc(a.approvedAt)}${a.staleReason ? `; ${esc(a.staleReason)}` : ''})</span></li>`;
  });
  box.innerHTML =
    `<div class="card"><h2>${esc(view.id)} <span class="mono">@${esc(view.version)}</span> ${status}</h2>` +
    `<dl class="kv">` +
    kvRow('Outcome', `<strong>${esc(evidence.outcome ?? 'no evidence')}</strong>`) +
    kvRow('Executed at', `<span class="mono">${esc(evidence.executedAt ?? '—')}</span>`) +
    kvRow('Test command', `<span class="mono">${esc(evidence.testCommand ?? contract.verification.testCommand)}</span>`) +
    kvRow('Test files', Array.isArray(evidence.testFiles) && evidence.testFiles.length > 0
      ? `<ul class="tight">${evidence.testFiles.map((f) => `<li><span class="mono">${esc(f)}</span></li>`).join('')}</ul>` : '—') +
    kvRow('Runtime', `<span class="mono">node ${esc(evidence.nodeVersion ?? '?')} · sqlite ${esc(evidence.sqliteVersion ?? '?')}</span>`) +
    kvRow('Source hash', `<span class="hash">${esc(evidence.sourceHash ?? '—')}</span>`) +
    kvRow('Artifact fingerprint', `<span class="hash">${esc(evidence.artifactFingerprint ?? '—')}</span>`) +
    kvRow('Gate verdict', `<span class="mono">${esc(contract.validation.code)}</span> — ${esc(contract.validation.reason)}`) +
    `</dl>` +
    `<h2>Recorded limitations</h2><p>${esc(evidence.limitations || contract.limitations)}</p>` +
    `<h2>Your approvals for this component</h2>` +
    (approvals.length === 0
      ? '<div class="empty">No approvals recorded for this component yet. Approve its contract on screen 2.</div>'
      : `<ul class="tight">${approvals.join('')}</ul>`) +
    `</div>`;
}

async function renderBookingStatus() {
  const el = $('booking-status');
  el.textContent = 'Booking demo status: checking…';
  try {
    const status = await api('/api/booking-status');
    el.textContent = status.running
      ? `Booking demo status: RUNNING at ${status.url} (checked just now).`
      : `Booking demo status: not running (checked just now at ${status.url}). Start it separately with "npm start" in apps/booking-app.`;
  } catch {
    el.textContent = 'Booking demo status: could not be checked.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().then(() => {
    loadContract();
    loadVerification();
  }).catch((error) => {
    $('results').innerHTML = `<div class="error">${esc(error.message)}</div>`;
  });
});
