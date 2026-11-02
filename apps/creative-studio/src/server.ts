import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIEF_FIELDS,
  CREATIVE_STUDIO_DEFAULT_PORT,
  CREATIVE_STUDIO_VERSION,
  ELICITATION_DEFAULT_MAX_QUESTIONS,
  EXAMPLE_PROMPTS,
  FRAMEWORK_SLOTS,
  MAX_BODY_BYTES,
  PHOTOGRAPHY_MODES,
  STYLE_SLOTS,
} from './config.js';
import { validateBrief, type BriefInput } from './validate.js';
import { validateCampaignContext } from './campaign.js';
import { generateConcepts } from './concepts.js';
import { evaluateConcepts, reviewPolicies } from './evaluate.js';
import { buildLandingPreview, validateLandingInput } from './landing.js';
import { initializeApprovedCreativeLibrary } from './library.js';
import { isLiveProviderConfigured, MetaMuseConceptProvider } from './provider.js';

/** Approved V1 creative library is active from startup; unknown ids stay rejected. */
initializeApprovedCreativeLibrary();
import {
  analyzeBrief,
  POLICY_CHECKS,
  QUESTION_ORDER,
  validateAnalyzeInput,
} from './elicit.js';
import {
  IMAGE_ADS_MAX_BODY_BYTES,
  IMAGE_AD_HEIGHT,
  IMAGE_AD_OBJECTIVES,
  IMAGE_AD_SUPPORTED_FORMATS,
  IMAGE_AD_WIDTH,
  imageAdsGenerateOutcome,
} from './imageAds.js';
import { imageAdsGenerateLiveOutcome } from './imageAdsLive.js';
import { MetaMuseImageAdPlanner } from './imageAdsPlan.js';
import { MetaMuseImageProvider } from './museImage.js';
import { ImageAdsJobManager, QueueFullError } from './imageAdsJobs.js';
import { checkDemoAccess, demoCodeFromHeader, DemoJobCap, DEMO_ACCESS_HEADER } from './demoAccess.js';

/**
 * Single-instance in-process jobs. NOT durable across restart/deploy:
 * a restart loses queued/running/finished jobs and polling then gets
 * 404 JOB_NOT_FOUND — generation is never silently re-run.
 * Concurrency is fixed at 1 for the MVP so paid work is strictly
 * serialized; queue depth and retained results are bounded.
 * Job IDs are unpredictable UUIDs, which only make IDs unguessable —
 * they are NOT authentication. They are bearer capabilities for polling:
 * anyone holding an ID can read that job until it expires. Paid creation
 * additionally requires the server-side demo access code (see
 * demoAccess.ts); that shared code is demo access control, not per-user
 * authentication or a spending guarantee.
 */
export const imageAdsJobManager = new ImageAdsJobManager({
  maxConcurrent: 1,
  maxQueueDepth: 8,
  maxRetainedJobs: 50,
  resultTtlMs: 10 * 60 * 1000,
});

/** The one paid generation function shared by every entry point. */
function liveImageAdsRunner(body: unknown) {
  return imageAdsGenerateLiveOutcome(body, {
    planner: new MetaMuseImageAdPlanner(),
    images: new MetaMuseImageProvider(),
  });
}

/**
 * MVP admission control for paid job creation: per-client-IP sliding
 * window. This complements (not replaces) the queue bound — the queue
 * caps waiting paid work, this caps creation bursts. In-memory only.
 */
const JOB_SUBMIT_LIMIT = 20;
const JOB_SUBMIT_WINDOW_MS = 60 * 1000;
const jobSubmitHits = new Map<string, number[]>();

function allowJobSubmit(req: IncomingMessage): boolean {
  const ip = req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();
  const hits = (jobSubmitHits.get(ip) ?? []).filter((t) => now - t < JOB_SUBMIT_WINDOW_MS);
  if (hits.length >= JOB_SUBMIT_LIMIT) {
    jobSubmitHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  jobSubmitHits.set(ip, hits);
  if (jobSubmitHits.size > 1000) {
    for (const [key, times] of jobSubmitHits) {
      if (times.every((t) => now - t >= JOB_SUBMIT_WINDOW_MS)) jobSubmitHits.delete(key);
    }
  }
  return true;
}

/** Per-process accepted-job cap for paid generation (default 3). */
export const demoJobCap = new DemoJobCap();

/**
 * Gate for paid generation. Checks the demo code header before any job
 * is created or model called. Never logs or echoes the submitted code.
 * No CORS headers are set anywhere, so cross-origin browsers cannot use
 * this (the custom header also forces a preflight that gets no allow).
 */
function requireDemoAccess(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('cache-control', 'no-store');
  const result = checkDemoAccess(demoCodeFromHeader(req.headers[DEMO_ACCESS_HEADER]));
  if (result.ok) return true;
  sendJson(res, result.status, { ok: false, error: { code: result.code, message: result.message } });
  return false;
}

function rejectDemoCap(res: ServerResponse): void {
  sendJson(res, 503, {
    ok: false,
    error: {
      code: 'DEMO_JOB_LIMIT_REACHED',
      message: 'Demo generation limit reached for this deployment. No generation was started. This per-process limit resets when the service restarts or redeploys.',
    },
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
};

const STATIC_ALLOWLIST = new Set([
  '/index.html',
  '/creative.html',
  '/code.html',
  '/evidence.html',
  '/research.html',
  '/app.js',
  '/styles.css',
  '/presentation.css',
  '/presentation.js',
  '/media/serum/silkweb-serum-ad-01.webp',
  '/media/serum/silkweb-serum-ad-02.webp',
  '/media/serum/silkweb-serum-ad-03.webp',
]);

/** Clean presentation routes mapped to allowlisted files only. */
const PAGE_ROUTES: Record<string, string> = {
  '/': '/index.html',
  '/creative': '/creative.html',
  '/creative/': '/creative.html',
  '/code': '/code.html',
  '/code/': '/code.html',
  '/evidence': '/evidence.html',
  '/evidence/': '/evidence.html',
  '/research': '/research.html',
  '/research/': '/research.html',
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  res.end(body);
}

export function serveStatic(pathname: string): { status: number; type: string; body: Buffer } | null {
  const file = PAGE_ROUTES[pathname] ?? pathname;
  if (!STATIC_ALLOWLIST.has(file)) return null;
  const abs = normalize(join(PUBLIC_DIR, file));
  if (!abs.startsWith(PUBLIC_DIR) || !existsSync(abs)) return null;
  const ext = file.slice(file.lastIndexOf('.'));
  return { status: 200, type: CONTENT_TYPES[ext], body: readFileSync(abs) };
}

function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectPromise(new Error(`Request body exceeds ${Math.round(maxBytes / 1024)}KB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error: unknown) => {
      rejectPromise(error);
    });
  });
}

export function healthPayload(): {
  ok: boolean;
  service: string;
  version: string;
  generationConnected: boolean;
} {
  return { ok: true, service: 'creative-studio', version: CREATIVE_STUDIO_VERSION, generationConnected: isLiveProviderConfigured() };
}

export function configPayload(): {
  version: string;
  generationConnected: boolean;
  styles: typeof STYLE_SLOTS;
  frameworks: typeof FRAMEWORK_SLOTS;
  photographyModes: typeof PHOTOGRAPHY_MODES;
  briefFields: typeof BRIEF_FIELDS;
  examplePrompts: typeof EXAMPLE_PROMPTS;
  elicitation: { maxQuestions: number; questionOrder: typeof QUESTION_ORDER };
  policyChecks: typeof POLICY_CHECKS;
  imageAds: {
    objectives: typeof IMAGE_AD_OBJECTIVES;
    defaultObjective: string;
    adWidth: number;
    adHeight: number;
    supportedFormats: readonly string[];
    adCount: number;
  };
} {
  return {
    version: CREATIVE_STUDIO_VERSION,
    generationConnected: isLiveProviderConfigured(),
    styles: STYLE_SLOTS,
    frameworks: FRAMEWORK_SLOTS,
    photographyModes: PHOTOGRAPHY_MODES,
    briefFields: BRIEF_FIELDS,
    examplePrompts: EXAMPLE_PROMPTS,
    elicitation: { maxQuestions: ELICITATION_DEFAULT_MAX_QUESTIONS, questionOrder: QUESTION_ORDER },
    policyChecks: POLICY_CHECKS,
    imageAds: {
      objectives: IMAGE_AD_OBJECTIVES,
      defaultObjective: 'drive-sales',
      adWidth: IMAGE_AD_WIDTH,
      adHeight: IMAGE_AD_HEIGHT,
      supportedFormats: IMAGE_AD_SUPPORTED_FORMATS,
      adCount: 3,
    },
  };
}

/**
 * Deterministic creative-evaluation outcome (no model involved).
 * Expects { campaign, concepts } with exactly two validated
 * concepts; returns weighted readiness scores plus the separate
 * policy checklists. Never throws — failures map to payloads.
 */
export function evaluateOutcome(parsedBody: unknown): { status: number; payload: unknown } {
  if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
    return { status: 400, payload: { ok: false, issues: [{ field: 'body', message: 'Evaluation request must be a JSON object.' }] } };
  }
  const record = parsedBody as Record<string, unknown>;
  const checkedCampaign = validateCampaignContext(record.campaign ?? {});
  if (!checkedCampaign.ok) {
    return { status: 422, payload: { ok: false, issues: checkedCampaign.issues } };
  }
  if (!Array.isArray(record.concepts) || record.concepts.length !== 2) {
    return {
      status: 422,
      payload: { ok: false, issues: [{ field: 'concepts', message: 'Evaluation needs exactly the two generated concepts.' }] },
    };
  }
  return {
    status: 200,
    payload: {
      ok: true,
      evaluations: evaluateConcepts(
        checkedCampaign.context,
        record.concepts as [Parameters<typeof evaluateConcepts>[1][0], Parameters<typeof evaluateConcepts>[1][1]],
      ),
      policies: reviewPolicies(
        checkedCampaign.context,
        record.concepts as [Parameters<typeof reviewPolicies>[1][0], Parameters<typeof reviewPolicies>[1][1]],
      ),
    },
  };
}

/**
 * Deterministic landing-preview outcome (no model involved).
 * Expects { campaign, concept }; assembles preview content from
 * supplied facts only. Never throws.
 */
export function landingOutcome(parsedBody: unknown): { status: number; payload: unknown } {
  const shape = validateLandingInput(parsedBody);
  if (!shape.ok) {
    return { status: 400, payload: { ok: false, issues: shape.issues } };
  }
  const record = parsedBody as { campaign: unknown; concept: unknown };
  const checkedCampaign = validateCampaignContext(record.campaign ?? {});
  if (!checkedCampaign.ok) {
    return { status: 422, payload: { ok: false, issues: checkedCampaign.issues } };
  }
  return {
    status: 200,
    payload: {
      ok: true,
      landing: buildLandingPreview(
        checkedCampaign.context,
        record.concept as Parameters<typeof buildLandingPreview>[1],
      ),
    },
  };
}

/**
 * Image-generation boundary for a later provider milestone.
 * No image provider ships yet, so every request gets an explicit
 * IMAGE_UNAVAILABLE — the UI must never present an image as
 * generated. The route exists so the integration point is stable.
 */
export function imagesGenerateOutcome(): { status: number; payload: unknown } {
  return {
    status: 503,
    payload: {
      ok: false,
      error: {
        code: 'IMAGE_UNAVAILABLE',
        message: 'Image generation is not connected yet. No image was generated.',
      },
      generationConnected: isLiveProviderConfigured(),
    },
  };
}

export function conceptsGenerateOutcome(parsedBody: unknown): { status: number; payload: unknown } {
  const checked = validateCampaignContext(parsedBody ?? {});
  if (!checked.ok) {
    return {
      status: 422,
      payload: { ok: false, issues: checked.issues, generationConnected: isLiveProviderConfigured() },
    };
  }
  if (!isLiveProviderConfigured()) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Live concept generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with credentials to enable it.',
        },
        generationConnected: isLiveProviderConfigured(),
      },
    };
  }
  return {
    status: 503,
    payload: {
      ok: false,
      error: {
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: 'Live provider configuration is present but live inference is not implemented in this milestone.',
      },
      generationConnected: isLiveProviderConfigured(),
    },
  };
}

/**
 * Live concept-generation outcome: validates the campaign, refuses
 * when paid inference is not explicitly enabled (both
 * SILKWEB_CREATIVE_PROVIDER=live AND MODEL_API_KEY required), and
 * otherwise makes exactly one Meta Muse Spark 1.3 request with no
 * retries. Returned concepts pass through the existing
 * orchestrator validation. Never throws — failures map to
 * explicit error payloads.
 */
export async function conceptsGenerateOutcomeLive(
  parsedBody: unknown,
  options: { timeoutMs?: number } = {},
): Promise<{ status: number; payload: unknown }> {
  const checked = validateCampaignContext(parsedBody ?? {});
  if (!checked.ok) {
    return {
      status: 422,
      payload: { ok: false, issues: checked.issues, generationConnected: isLiveProviderConfigured() },
    };
  }
  if (!isLiveProviderConfigured()) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message:
            'Live concept generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with credentials to enable it.',
        },
        generationConnected: isLiveProviderConfigured(),
      },
    };
  }
  const result = await generateConcepts(
    checked.context,
    new MetaMuseConceptProvider(),
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  );
  if (result.ok) {
    return {
      status: 200,
      payload: {
        ok: true,
        concepts: result.concepts,
        provider: result.provider,
        generationConnected: isLiveProviderConfigured(),
      },
    };
  }
  const statusByCode: Record<string, number> = {
    INVALID_CONTEXT: 422,
    PROVIDER_TIMEOUT: 504,
    RESPONSE_TOO_LARGE: 502,
    INVALID_PROVIDER_OUTPUT: 502,
    DUPLICATE_CONCEPTS: 502,
    PROVIDER_ERROR: 502,
    TEST_PROVIDER_NOT_ALLOWED: 500,
  };
  return {
    status: statusByCode[result.error.code] ?? 502,
    payload: { ok: false, error: result.error, generationConnected: isLiveProviderConfigured() },
  };
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const method = (req.method ?? 'GET').toUpperCase();
  const pathname = url.pathname;

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, healthPayload());
    return true;
  }

  if (pathname === '/api/config' && method === 'GET') {
    sendJson(res, 200, configPayload());
    return true;
  }

  if (pathname === '/api/elicit/analyze' && method === 'POST') {
    const text = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    const checked = validateAnalyzeInput(parsed);
    if (!checked.ok) {
      sendJson(res, 422, { ...checked, generationConnected: isLiveProviderConfigured() });
      return true;
    }
    const body = parsed as {
      description: string;
      answers?: Record<string, string | null>;
      overrides?: Record<string, string>;
      maxQuestions?: number;
    };
    const plan = analyzeBrief({
      description: body.description,
      answers: body.answers,
      overrides: body.overrides,
      maxQuestions: body.maxQuestions ?? ELICITATION_DEFAULT_MAX_QUESTIONS,
    });
    sendJson(res, 200, {
      ok: true,
      ...plan,
      generationConnected: isLiveProviderConfigured(),
      note: 'Deterministic local analysis only. No AI service was called and nothing was generated.',
    });
    return true;
  }

  /**
   * Pure concept-generation gate, exported for socket-free tests.
   * Validates the campaign context, then refuses: no live provider
   * implementation ships in this milestone, so a valid request still
   * gets an explicit PROVIDER_UNAVAILABLE — never test output
   * presented as AI generation.
   */
  if (pathname === '/api/concepts/generate' && method === 'POST') {
    const text = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    const outcome = await conceptsGenerateOutcomeLive(parsed);
    sendJson(res, outcome.status, outcome.payload);
    return true;
  }

  if (pathname === '/api/evaluate' && method === 'POST') {
    const text = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    const outcome = evaluateOutcome(parsed);
    sendJson(res, outcome.status, outcome.payload);
    return true;
  }

  if (pathname === '/api/landing/preview' && method === 'POST') {
    const text = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    const outcome = landingOutcome(parsed);
    sendJson(res, outcome.status, outcome.payload);
    return true;
  }

  if (pathname === '/api/images/generate' && method === 'POST') {
    await readBody(req).catch(() => '');
    const outcome = imagesGenerateOutcome();
    sendJson(res, outcome.status, outcome.payload);
    return true;
  }

  /**
   * Image Ads Milestone 1: deterministic offline generation of three
   * creative specs with real 1080 x 1350 PNG files. Accepts a larger
   * body for the optional product-image upload; oversize bodies get
   * an explicit 413 instead of a generic 500.
   */
  if (pathname === '/api/image-ads/generate' && method === 'POST') {
    let text: string;
    try {
      text = await readBody(req, IMAGE_ADS_MAX_BODY_BYTES);
    } catch {
      sendJson(res, 413, { ok: false, issues: [{ field: 'body', message: 'Request body is too large.' }] });
      return true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    const outcome = imageAdsGenerateOutcome(parsed);
    sendJson(res, outcome.status, outcome.payload);
    return true;
  }

  /**
   * Image Ads Milestone 2 live route: Muse Spark planning + Muse
   * Image generation with policy checks and PNG verification.
   * Requires SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY;
   * otherwise an explicit 503 — drafts are never labeled as
   * Meta-generated. No automatic retries.
   */
  if (pathname === '/api/image-ads/jobs' && method === 'POST') {
    if (!requireDemoAccess(req, res)) return true;
    if (demoJobCap.isExhausted()) { rejectDemoCap(res); return true; }
    let text: string;
    try { text = await readBody(req, IMAGE_ADS_MAX_BODY_BYTES); } catch { sendJson(res, 413, { ok: false, issues: [{ field: 'body', message: 'Request body is too large.' }] }); return true; }
    let parsed: unknown;
    try { parsed = JSON.parse(text || '{}'); } catch { sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] }); return true; }
    if (!isLiveProviderConfigured()) {
      sendJson(res, 503, { ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Live image-ads generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY to enable it.' }, generationConnected: false });
      return true;
    }
    if (!allowJobSubmit(req)) {
      res.setHeader('retry-after', '60');
      sendJson(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many generation requests. Please wait a minute and try again.' } });
      return true;
    }
    if (!demoJobCap.tryAcquire()) { rejectDemoCap(res); return true; }
    try {
      const snap = imageAdsJobManager.submit(parsed, liveImageAdsRunner);
      sendJson(res, 202, { ok: true, jobId: snap.jobId, status: snap.status });
    } catch (e) {
      demoJobCap.release();
      if (e instanceof QueueFullError) { res.setHeader('retry-after', '30'); sendJson(res, 429, { ok: false, error: { code: 'QUEUE_FULL', message: e.message } }); }
      else sendJson(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
    }
    return true;
  }

  if (pathname.startsWith('/api/image-ads/jobs/') && method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/api/image-ads/jobs/'.length));
    const snap = imageAdsJobManager.getJob(id);
    res.setHeader('cache-control', 'no-store');
    if (!snap) { sendJson(res, 404, { ok: false, error: { code: 'JOB_NOT_FOUND', message: 'This generation is no longer available. It may have expired or the service restarted. Please generate again manually.' } }); return true; }
    if (snap.status === 'succeeded') sendJson(res, 200, { ok: true, jobId: snap.jobId, status: snap.status, resultStatus: snap.resultStatus ?? 200, result: snap.result });
    else if (snap.status === 'failed') sendJson(res, 200, { ok: true, jobId: snap.jobId, status: snap.status, error: snap.error });
    else sendJson(res, 200, { ok: true, jobId: snap.jobId, status: snap.status });
    return true;
  }

  if (pathname === '/api/image-ads/generate-live' && method === 'POST') {
    if (!requireDemoAccess(req, res)) return true;
    if (demoJobCap.isExhausted()) { rejectDemoCap(res); return true; }
    let text: string;
    try {
      text = await readBody(req, IMAGE_ADS_MAX_BODY_BYTES);
    } catch {
      sendJson(res, 413, { ok: false, issues: [{ field: 'body', message: 'Request body is too large.' }] });
      return true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    if (!isLiveProviderConfigured()) {
      sendJson(res, 503, { ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Live image-ads generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY to enable it.' }, generationConnected: false });
      return true;
    }
    if (!allowJobSubmit(req)) {
      res.setHeader('retry-after', '60');
      sendJson(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many generation requests. Please wait a minute and try again.' } });
      return true;
    }
    try {
      if (!demoJobCap.tryAcquire()) { rejectDemoCap(res); return true; }
      const snap = await imageAdsJobManager.submitAndWait(parsed, liveImageAdsRunner).catch((e) => { if (e instanceof QueueFullError) demoJobCap.release(); throw e; });
      res.setHeader('cache-control', 'no-store');
      if (snap.status === 'succeeded') { sendJson(res, snap.resultStatus ?? 200, snap.result); }
      else { sendJson(res, snap.errorStatus ?? 502, { ok: false, error: snap.error ?? { code: 'GENERATION_FAILED', message: 'Generation failed. Please try again.' } }); }
    } catch (e) {
      if (e instanceof QueueFullError) { res.setHeader('retry-after', '30'); sendJson(res, 429, { ok: false, error: { code: 'QUEUE_FULL', message: e.message } }); }
      else { sendJson(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } }); }
    }
    return true;
  }

  if (pathname === '/api/briefs/validate' && method === 'POST') {
    const text = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 400, { ok: false, issues: [{ field: 'body', message: 'Request body must be valid JSON.' }] });
      return true;
    }
    const result = validateBrief((parsed ?? {}) as Partial<BriefInput>);
    sendJson(res, result.ok ? 200 : 422, {
      ...result,
      generationConnected: isLiveProviderConfigured(),
      note: 'Brief validated locally. Concept, image, evaluation, and landing-page generation are not connected yet.',
    });
    return true;
  }

  return false;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if ((req.method ?? 'GET').toUpperCase() === 'GET' && !url.pathname.startsWith('/api/')) {
    const staticFile = serveStatic(url.pathname);
    if (staticFile) {
      res.writeHead(staticFile.status, {
        'content-type': staticFile.type,
        'content-length': staticFile.body.length,
      });
      res.end(staticFile.body);
      return;
    }
  }
  void handleApi(req, res, url)
    .then((handled) => {
      if (!handled) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `Unknown route ${url.pathname}.` } });
      }
    })
    .catch(() => {
      sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
    });
});

const PORT = Number(process.env.PORT ?? String(CREATIVE_STUDIO_DEFAULT_PORT));

const invokedAsMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).endsWith('server.js') &&
  process.argv[1].endsWith('server.js');
if (invokedAsMain) {
  // Render and other cloud platforms need the server bound to all interfaces.
  // Local development remains bound to localhost by default.
  const HOST = process.env.HOST ??
    (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`creative-studio listening on http://${HOST}:${PORT}`);
  });
}
