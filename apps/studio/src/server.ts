import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STUDIO_DEFAULT_PORT,
  BOOKING_APP_URL,
  SAMPLE_REQUIREMENT,
  StudioError,
  checkBookingApp,
  createApproval,
  getContract,
  getVerification,
  listApprovals,
  listCapabilities,
  searchComponents,
} from './service.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const STATIC_ALLOWLIST = new Set(['/index.html', '/app.js', '/styles.css']);
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof StudioError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: String(error) } });
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
        rejectPromise(new StudioError('BODY_TOO_LARGE', 'Request body exceeds 64KB.', 413));
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

function queryList(url: URL, names: string[]): string[] {
  const values: string[] = [];
  for (const name of names) {
    for (const raw of url.searchParams.getAll(name)) {
      for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (trimmed) values.push(trimmed);
      }
    }
  }
  return values;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = (req.method ?? 'GET').toUpperCase();
  const pathname = url.pathname;

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, service: 'studio' });
    return true;
  }

  if (pathname === '/api/capabilities' && method === 'GET') {
    try {
      sendJson(res, 200, await listCapabilities());
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/search' && method === 'GET') {
    try {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw === null ? undefined : Number(limitRaw);
      sendJson(
        res,
        200,
        await searchComponents({
          capabilities: queryList(url, ['capability', 'capabilities']),
          query: url.searchParams.get('query') ?? undefined,
          stack: url.searchParams.get('stack') ?? undefined,
          limit: limit === undefined || Number.isNaN(limit) ? undefined : limit,
        }),
      );
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/contract' && method === 'GET') {
    try {
      const id = (url.searchParams.get('id') ?? '').trim();
      const version = (url.searchParams.get('version') ?? '').trim();
      if (!id || !version) {
        sendJson(res, 400, { error: { code: 'MISSING_IDENTITY', message: 'Query parameters id and version are required.' } });
        return true;
      }
      sendJson(res, 200, await getContract(id, version));
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/approvals' && method === 'GET') {
    try {
      sendJson(res, 200, await listApprovals());
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/approvals' && method === 'POST') {
    try {
      const text = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text || '{}');
      } catch {
        throw new StudioError('INVALID_JSON', 'Request body must be valid JSON.', 400);
      }
      const body = (parsed ?? {}) as Record<string, unknown>;
      const view = await createApproval({
        requirementText: typeof body['requirementText'] === 'string' ? body['requirementText'] : '',
        capability: typeof body['capability'] === 'string' ? body['capability'] : '',
        id: typeof body['id'] === 'string' ? body['id'] : '',
        version: typeof body['version'] === 'string' ? body['version'] : '',
        acknowledgedLimitations: body['acknowledgedLimitations'] === true,
      });
      sendJson(res, 201, view);
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/verification' && method === 'GET') {
    try {
      const id = (url.searchParams.get('id') ?? '').trim();
      const version = (url.searchParams.get('version') ?? '').trim();
      if (!id || !version) {
        sendJson(res, 400, { error: { code: 'MISSING_IDENTITY', message: 'Query parameters id and version are required.' } });
        return true;
      }
      const view = await getVerification(id, version);
      if (!view.found) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `Unknown component ${id}@${version}.` }, verification: view });
        return true;
      }
      sendJson(res, 200, view);
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/booking-status' && method === 'GET') {
    try {
      sendJson(res, 200, await checkBookingApp());
    } catch (error: unknown) {
      sendError(res, error);
    }
    return true;
  }

  if (pathname === '/api/sample-requirement' && method === 'GET') {
    sendJson(res, 200, { requirement: SAMPLE_REQUIREMENT, capability: 'slot-guard' });
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
    if (STATIC_ALLOWLIST.has(url.pathname) || url.pathname === '/') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
  }
  void handleApi(req, res, url).then((handled) => {
    if (!handled) {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `Unknown route ${url.pathname}.` } });
    }
  }).catch((error: unknown) => {
    sendError(res, error);
  });
});

const PORT = Number(process.env.PORT ?? String(STUDIO_DEFAULT_PORT));

// Only bind when executed directly (`node dist/server.js`); importing this
// module (e.g. socket-free tests) exposes handleApi/serveStatic without
// opening a listening socket.
const invokedAsMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  server.listen(PORT, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`studio listening on http://127.0.0.1:${PORT} (booking demo: ${BOOKING_APP_URL})`);
  });
}
