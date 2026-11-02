'use strict';
/* SilkWeb Image Ads MVP — Create / Generating / Results flow. */

const $ = (s) => document.querySelector(s);

const FALLBACK_OBJECTIVES = [
  { id: 'drive-sales', name: 'Drive Sales', blurb: 'Turn interest into orders.' },
  { id: 'build-awareness', name: 'Build Awareness', blurb: 'Introduce the product widely.' },
  { id: 'launch-product', name: 'Launch a Product', blurb: 'Announce something new.' },
];
const DEFAULT_OBJECTIVE = 'drive-sales';
const MAX_IMAGE_BYTES = 1536 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const GENERATING_MESSAGES = ['Composing layouts…', 'Writing copy…', 'Exporting PNGs…'];

let objectives = FALLBACK_OBJECTIVES;
let uploadedDataUrl = '';
let uploadedFileName = '';
let lastRequest = null;
let demoAccessCode = '';
let messageTimer = 0;
let pollTimer = 0;
let activeGeneration = 0;
const POLL_INTERVAL_MS = 2000;

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const config = await res.json();
    if (config && config.imageAds && Array.isArray(config.imageAds.objectives) && config.imageAds.objectives.length === 3) {
      objectives = config.imageAds.objectives;
    }
    if (config && typeof config.version === 'string') {
      $('#footer-note').textContent = `Studio ${config.version} · local draft engine`;
    }
  } catch {
    /* Offline config: fall back to built-in objectives. */
  }
}

function renderObjectives() {
  const grid = $('#objective-grid');
  grid.innerHTML = '';
  for (const objective of objectives) {
    const id = `objective-${objective.id}`;
    const label = document.createElement('label');
    label.className = 'objective-card';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'objective';
    input.value = objective.id;
    input.checked = objective.id === DEFAULT_OBJECTIVE;
    input.id = id;
    const body = document.createElement('span');
    body.className = 'objective-body';
    const name = document.createElement('strong');
    name.textContent = objective.name;
    const blurb = document.createElement('small');
    blurb.textContent = objective.blurb || '';
    body.append(name, blurb);
    label.append(input, body);
    grid.append(label);
  }
}

function showScreen(name) {
  for (const screen of ['create', 'generating', 'results']) {
    $('#screen-' + screen).hidden = screen !== name;
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showError(message) {
  const box = $('#form-errors');
  box.textContent = message;
  box.hidden = false;
}

function clearError() {
  const box = $('#form-errors');
  box.textContent = '';
  box.hidden = true;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function setUploadPreview(dataUrl, fileName) {
  uploadedDataUrl = dataUrl;
  uploadedFileName = fileName;
  const preview = $('#upload-preview');
  preview.src = dataUrl;
  preview.hidden = false;
  preview.alt = fileName ? `Uploaded product preview: ${fileName}` : 'Uploaded product preview';
  $('#upload-empty').hidden = true;
  $('#upload-actions').hidden = false;
}

function clearUpload() {
  uploadedDataUrl = '';
  uploadedFileName = '';
  $('#product-image').value = '';
  $('#upload-preview').removeAttribute('src');
  $('#upload-preview').hidden = true;
  $('#upload-empty').hidden = false;
  $('#upload-actions').hidden = true;
}

async function handleFile(file) {
  clearError();
  if (!file) return;
  if (!ACCEPTED_TYPES.includes(file.type)) {
    showError('That file type is not supported. Use PNG, JPEG, or WebP.');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showError('That image is larger than 1.5 MB. Choose a smaller file.');
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    setUploadPreview(dataUrl, file.name);
  } catch {
    showError('Could not read that image. Try a different file.');
  }
}

function selectedObjective() {
  const checked = document.querySelector('input[name="objective"]:checked');
  return checked ? checked.value : DEFAULT_OBJECTIVE;
}

function startGeneratingMessages() {
  stopGeneratingMessages();
  const status = $('#generating-status');
  let index = 0;
  status.textContent = GENERATING_MESSAGES[0];
  messageTimer = window.setInterval(() => {
    index = (index + 1) % GENERATING_MESSAGES.length;
    status.textContent = GENERATING_MESSAGES[index];
  }, 1400);
}

function stopGeneratingMessages() {
  if (messageTimer) window.clearInterval(messageTimer);
  messageTimer = 0;
}

function showGeneratingError(message) {
  stopGeneratingMessages();
  $('#generating-status').textContent = 'Something went wrong.';
  $('#generating-error-text').textContent = message;
  $('#generating-error').hidden = false;
  $('#retry-btn').focus();
}

async function postAds(endpoint, request, extraHeaders) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(request),
  });
  const payload = await res.json().catch(() => null);
  return { res, payload };
}

function payloadMessage(payload, fallback) {
  if (payload && Array.isArray(payload.issues) && payload.issues.length > 0) {
    return payload.issues.map((i) => i.message).join(' ');
  }
  if (payload && payload.error && payload.error.message) return payload.error.message;
  return fallback;
}

function stopPolling() { if (pollTimer) window.clearTimeout(pollTimer); pollTimer = 0; }
function setQueuedStatus() { stopGeneratingMessages(); $('#generating-status').textContent = 'Your request is queued. Generation will start shortly. Keep this tab open.'; }
async function pollJob(jobId, gen) {
  let failures = 0;
  const step = async () => {
    if (gen !== activeGeneration) return;
    let res; let payload = null;
    try {
      res = await fetch('/api/image-ads/jobs/' + encodeURIComponent(jobId));
      payload = await res.json().catch(() => null);
    } catch {
      failures += 1;
      $('#generating-status').textContent = 'Connection interrupted. Checking again. Your generation has not been resubmitted.';
      pollTimer = window.setTimeout(step, POLL_INTERVAL_MS * 2);
      return;
    }
    if (gen !== activeGeneration) return;
    if (res.status === 404) {
      stopPolling(); stopGeneratingMessages(); $('#generate-btn').disabled = false;
      showGeneratingError('This generation is no longer available. It may have expired or the service restarted. Use Try again to start a new generation manually.');
      return;
    }
    if (!res.ok || !payload) {
      failures += 1;
      if (failures >= 3) $('#generating-status').textContent = 'Still checking your generation status. Your generation has not been resubmitted.';
      pollTimer = window.setTimeout(step, POLL_INTERVAL_MS * 2);
      return;
    }
    failures = 0;
    if (payload.status === 'queued') { setQueuedStatus(); pollTimer = window.setTimeout(step, POLL_INTERVAL_MS); return; }
    if (payload.status === 'running') { if (!messageTimer) startGeneratingMessages(); pollTimer = window.setTimeout(step, POLL_INTERVAL_MS); return; }
    stopPolling(); stopGeneratingMessages(); $('#generate-btn').disabled = false;
    if (payload.status === 'succeeded' && payload.result && payload.result.ok === true) { renderResults(payload.result, 'meta'); return; }
    if (payload.status === 'failed') {
      showGeneratingError((payload.error && payload.error.message) || 'SilkWeb could not create your ads. Check your input and try again.');
      if (payload.error && payload.error.code === 'PROVIDER_UNAVAILABLE') $('#draft-btn').hidden = false;
      return;
    }
    showGeneratingError('SilkWeb returned an unexpected status. Please try again.');
  };
  pollTimer = window.setTimeout(step, 800);
}
async function generateAds(request) {
  lastRequest = request;
  clearError();
  $('#generating-error').hidden = true;
  $('#draft-btn').hidden = true;
  stopPolling();
  const gen = ++activeGeneration;
  showScreen('generating');
  setQueuedStatus();
  const button = $('#generate-btn');
  button.disabled = true;
  let created = null;
  try { created = await postAds('/api/image-ads/jobs', request, demoAccessCode ? { 'x-silkweb-demo-code': demoAccessCode } : {}); } catch { created = null; }
  if (gen !== activeGeneration) return;
  if (!created) {
    stopGeneratingMessages(); button.disabled = false;
    showGeneratingError('The studio is unreachable. Check your connection and try again.');
    return;
  }
  if (created.res.status === 202 && created.payload && created.payload.jobId) {
    if (created.payload.status === 'running') startGeneratingMessages();
    pollJob(created.payload.jobId, gen);
    return;
  }
  stopGeneratingMessages(); button.disabled = false;
  if (created.res.status === 401) { showGeneratingError('Missing or invalid demo access code. Enter the demo access code and try again. No generation was started.'); return; }
  if (created.res.status === 503 && created.payload && created.payload.error && (created.payload.error.code === 'DEMO_GENERATION_UNAVAILABLE' || created.payload.error.code === 'DEMO_JOB_LIMIT_REACHED')) { showGeneratingError(payloadMessage(created.payload, 'Paid generation is unavailable. No generation was started.')); return; }
  if (created.res.status === 429) {
    showGeneratingError(payloadMessage(created.payload, 'The studio is busy right now. Please wait a moment and try again. Your request was not charged or retried automatically.'));
    return;
  }
  if (created.res.status === 503 && created.payload && created.payload.error && created.payload.error.code === 'PROVIDER_UNAVAILABLE') {
    showGeneratingError('Live generation is not configured on this studio. Ask your administrator to set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY, or preview a clearly labeled local draft instead.');
    $('#draft-btn').hidden = false;
    return;
  }
  showGeneratingError(payloadMessage(created.payload, 'SilkWeb could not create your ads. Check your input and try again.'));
}

async function generateDraft(request) {
  $('#generating-error').hidden = true;
  $('#draft-btn').hidden = true;
  showScreen('generating');
  startGeneratingMessages();
  try {
    const draft = await postAds('/api/image-ads/generate', request).catch(() => null);
    if (!draft) {
      showGeneratingError('The studio is unreachable. Check your connection and try again.');
      return;
    }
    if (draft.payload && draft.payload.ok === true) {
      renderResults(draft.payload, 'draft');
      return;
    }
    showGeneratingError(payloadMessage(draft.payload, 'SilkWeb could not create your draft ads. Check your input and try again.'));
  } catch {
    showGeneratingError('The studio is unreachable. Check your connection and try again.');
  } finally {
    stopGeneratingMessages();
  }
}

function adText(ad) {
  return `${ad.headline}\n${ad.body}\n${ad.cta}`;
}

function renderResults(payload, engine) {
  const grid = $('#ads-grid');
  grid.innerHTML = '';
  const isLive = engine === 'meta';
  const banner = $('#engine-banner');
  if (isLive) {
    banner.textContent = payload.partial === true
      ? `Meta-generated · partial result (${payload.ads.length} of 3).`
      : 'Meta-generated · Muse Spark copy, Muse Image photography.';
    banner.hidden = false;
  } else {
    banner.textContent = 'Local draft — deterministic preview, not Meta-generated.';
    banner.hidden = false;
  }
  payload.ads.forEach((ad, index) => {
    const card = document.createElement('article');
    card.className = 'ad-card';
    const frame = document.createElement('div');
    frame.className = 'ad-frame';
    const img = document.createElement('img');
    img.src = ad.pngDataUrl;
    img.alt = `Generated ad ${index + 1}: ${ad.headline}`;
    img.width = ad.width;
    img.height = ad.height;
    img.loading = index === 0 ? 'eager' : 'lazy';
    frame.append(img);
    const tag = document.createElement('p');
    tag.className = 'eyebrow';
    tag.textContent = isLive
      ? `${String(ad.audience || '').toUpperCase()} · ${ad.angle || `Ad ${index + 1}`}`
      : `Direction ${index + 1} · ${ad.direction}`;
    const headline = document.createElement('h3');
    headline.textContent = ad.headline;
    const body = document.createElement('p');
    body.className = 'ad-body';
    body.textContent = ad.body;
    const cta = document.createElement('p');
    cta.className = 'ad-cta-label';
    cta.textContent = `CTA: ${ad.cta}`;
    const actions = document.createElement('div');
    actions.className = 'ad-actions';
    const download = document.createElement('a');
    download.className = 'button button-primary button-small';
    download.href = ad.pngDataUrl;
    download.download = `silkweb-ad-${index + 1}.png`;
    download.textContent = 'Download PNG';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'button button-secondary button-small';
    copy.textContent = 'Copy ad text';
    copy.addEventListener('click', async () => {
      const text = adText(ad);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      copy.textContent = 'Copied ✓';
      window.setTimeout(() => { copy.textContent = 'Copy ad text'; }, 1600);
    });
    actions.append(download, copy);
    card.append(frame, tag, headline, body, cta, actions);
    grid.append(card);
  });
  if (isLive) {
    const failed = Array.isArray(payload.failures) ? payload.failures.length : 0;
    $('#results-note').textContent = payload.partial === true
      ? `Partial result: ${payload.ads.length} of 3 ads generated. ${failed > 0 ? `${failed} could not be generated and ${failed === 1 ? 'was' : 'were'} not retried automatically.` : ''} Copy and imagery are Meta-generated from your supplied facts.`
      : 'Meta-generated advertisements. Copy and imagery were produced by Meta models from your supplied product facts.';
  } else {
    const note = payload.photoComposited
      ? 'Local draft render with your uploaded product photo — not Meta-generated.'
      : 'Local draft render with a typographic product plate — not Meta-generated. Upload a PNG product photo to composite it into the creative.';
    $('#results-note').textContent = note;
  }
  showScreen('results');
  $('#results-heading').setAttribute('tabindex', '-1');
  $('#results-heading').focus({ preventScroll: true });
}

function optionalValue(id) {
  const el = $(id);
  const value = el ? el.value.trim() : '';
  return value || undefined;
}

function onSubmit(event) {
  event.preventDefault();
  const productName = $('#product-name').value.trim();
  if (!productName && !uploadedDataUrl) {
    showError('Add a product image or enter a product name to continue.');
    $('#product-name').focus();
    return;
  }
  if (productName.length > 120) {
    showError('Product name must be 120 characters or fewer.');
    $('#product-name').focus();
    return;
  }
  demoAccessCode = $('#demo-access-code').value;
  if (!demoAccessCode) { showError('Enter the demo access code to generate ads.'); $('#demo-access-code').focus(); return; }
  const request = { productName, objective: selectedObjective(), productImage: uploadedDataUrl || undefined };
  const differentiator = optionalValue('#differentiator');
  const price = optionalValue('#price');
  const currency = optionalValue('#currency');
  const specialOffer = optionalValue('#special-offer');
  if (differentiator) request.differentiator = differentiator;
  if (price) request.price = price;
  if (currency) request.currency = currency;
  if (specialOffer) request.specialOffer = specialOffer;
  generateAds(request);
}

function resetToCreate() { demoAccessCode = ''; stopPolling(); activeGeneration += 1; stopGeneratingMessages();
  $('#ads-form').reset();
  clearUpload();
  clearError();
  renderObjectives();
  showScreen('create');
  $('#create-heading').setAttribute('tabindex', '-1');
  $('#create-heading').focus({ preventScroll: true });
}

$('#ads-form').addEventListener('submit', onSubmit);
$('#product-image').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  handleFile(file);
});
$('#replace-image').addEventListener('click', () => $('#product-image').click());
$('#remove-image').addEventListener('click', () => { clearUpload(); clearError(); });
$('#retry-btn').addEventListener('click', () => {
  if (lastRequest) generateAds(lastRequest);
});
$('#draft-btn').addEventListener('click', () => {
  if (lastRequest) generateDraft(lastRequest);
});
$('#start-new').addEventListener('click', resetToCreate);

renderObjectives();
loadConfig().then(() => renderObjectives());
