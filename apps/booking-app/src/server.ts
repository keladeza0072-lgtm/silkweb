import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHandler } from './app.js';
import { openDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const DEFAULT_DB = join(here, '..', 'data', 'booking.db');

const PORT = Number(process.env.PORT ?? '3000');
const DB_PATH = process.env.BOOKING_DB ?? DEFAULT_DB;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveStatic(pathname: string): { status: number; type: string; body: Buffer } | null {
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!/^\/(index\.html|app\.js|styles\.css)$/.test(file)) return null;
  const abs = normalize(join(PUBLIC_DIR, file));
  if (!abs.startsWith(PUBLIC_DIR) || !existsSync(abs)) return null;
  const ext = file.slice(file.lastIndexOf('.'));
  return { status: 200, type: CONTENT_TYPES[ext], body: readFileSync(abs) };
}

const db: DatabaseSync = openDatabase(DB_PATH);
const api = createHandler(db);

const server = createServer((req, res) => {
  if ((req.method ?? 'GET').toUpperCase() === 'GET') {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const staticFile = serveStatic(pathname);
    if (staticFile) {
      res.writeHead(staticFile.status, {
        'content-type': staticFile.type,
        'content-length': staticFile.body.length,
      });
      res.end(staticFile.body);
      return;
    }
    if (pathname === '/' || pathname === '/index.html' || pathname === '/app.js' || pathname === '/styles.css') {
      // Known static path but file missing on disk.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
  }
  void api(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`booking-app listening on http://127.0.0.1:${PORT} (db: ${DB_PATH})`);
});
