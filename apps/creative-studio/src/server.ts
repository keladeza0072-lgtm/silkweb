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
  MAX_BODY_BYTES,
  PHOTOGRAPHY_MODES,
  STYLE_SLOTS,
} from './config.js';
import { validateBrief, type BriefInput } from './validate.js';
import { validateCampaignContext } from './campaign.js';
import { generateConcepts } from './concepts.js';
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

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const STATIC_ALLOWLIST = new Set(['/index.html', '/app.js', '/styles.css']);

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  res.end(body);
}

export function serveStatic(pathname: string): { status: number; type: string; body: Buffer } | null {
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC_ALLOWLIST.has(file)) return null;
  const abs = normalize(join(PUBLIC_DIR, file));
  if (!abs.startsWith(PUBLIC_DIR) || !existsSync(abs)) return null;
  const ext = file.slice(file.lastIndexOf('.'));
  return { status: 200, type: CONTENT_TYPES[ext], body: readFileSync(abs) };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error('Request body exceeds 64KB.'));
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
  photographyModes: typeof PHOTOGRAPHY_MODES;
  briefFields: typeof BRIEF_FIELDS;
  examplePrompts: typeof EXAMPLE_PROMPTS;
  elicitation: { maxQuestions: number; questionOrder: typeof QUESTION_ORDER };
  policyChecks: typeof POLICY_CHECKS;
} {
  return {
    version: CREATIVE_STUDIO_VERSION,
    generationConnected: isLiveProviderConfigured(),
    styles: STYLE_SLOTS,
    photographyModes: PHOTOGRAPHY_MODES,
    briefFields: BRIEF_FIELDS,
    examplePrompts: EXAMPLE_PROMPTS,
    elicitation: { maxQuestions: ELICITATION_DEFAULT_MAX_QUESTIONS, questionOrder: QUESTION_ORDER },
    policyChecks: POLICY_CHECKS,
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
  server.listen(PORT, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`creative-studio listening on http://127.0.0.1:${PORT}`);
  });
}
