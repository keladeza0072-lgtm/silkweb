/**
 * Demo access protection for paid generation (hackathon deployment).
 *
 * The secret is read only from SILKWEB_DEMO_ACCESS_CODE on the server.
 * It is never sent to the browser, logged, or given a hardcoded default:
 * when it is absent/empty, paid generation fails closed (503).
 * Comparison hashes both values with SHA-256 and uses timingSafeEqual,
 * so neither length nor prefix timing is leaked. Inputs are bounded.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const DEMO_ACCESS_HEADER = 'x-silkweb-demo-code';
export const MAX_DEMO_CODE_LENGTH = 128;
export const DEFAULT_MAX_DEMO_JOBS = 3;

type Env = Record<string, string | undefined>;

export type DemoAccessResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: string; message: string };

const UNAVAILABLE: DemoAccessResult = {
  ok: false,
  status: 503,
  code: 'DEMO_GENERATION_UNAVAILABLE',
  message: 'Paid generation is unavailable.',
};

const DENIED: DemoAccessResult = {
  ok: false,
  status: 401,
  code: 'DEMO_ACCESS_DENIED',
  message: 'Missing or invalid demo access code.',
};

/** Extract the bounded header value; arrays/duplicates are rejected. */
export function demoCodeFromHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > MAX_DEMO_CODE_LENGTH) return undefined;
  return value;
}

export function checkDemoAccess(provided: unknown, env: Env = process.env): DemoAccessResult {
  const expected = env.SILKWEB_DEMO_ACCESS_CODE;
  if (typeof expected !== 'string' || expected.length === 0 || expected.length > MAX_DEMO_CODE_LENGTH) {
    return UNAVAILABLE;
  }
  if (typeof provided !== 'string' || provided.length === 0 || provided.length > MAX_DEMO_CODE_LENGTH) {
    return DENIED;
  }
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b) ? { ok: true } : DENIED;
}

/**
 * Per-process cap on accepted paid jobs (SILKWEB_MAX_DEMO_JOBS, default 3).
 * NOT a persistent spending cap: deploys/restarts reset the count, and it
 * does not enforce any financial cost limit.
 */
export function resolveMaxDemoJobs(env: Env = process.env): number {
  const raw = env.SILKWEB_MAX_DEMO_JOBS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_DEMO_JOBS;
  if (!/^\d+$/.test(raw.trim())) return DEFAULT_MAX_DEMO_JOBS;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_MAX_DEMO_JOBS;
}

export class DemoJobCap {
  private accepted = 0;
  private readonly fixedMax?: number;

  constructor(options: { maxJobs?: number; env?: Env } = {}) {
    if (options.maxJobs !== undefined) {
      this.fixedMax = Math.max(0, Math.floor(options.maxJobs));
    } else if (options.env !== undefined) {
      this.fixedMax = resolveMaxDemoJobs(options.env);
    }
  }

  get max(): number {
    return this.fixedMax ?? resolveMaxDemoJobs();
  }

  get acceptedCount(): number {
    return this.accepted;
  }

  isExhausted(): boolean {
    return this.accepted >= this.max;
  }

  /** Reserve a slot for a job about to be accepted. Only accepted jobs count. */
  tryAcquire(): boolean {
    if (this.isExhausted()) return false;
    this.accepted += 1;
    return true;
  }

  /** Release a reservation when submission was not accepted (e.g. queue full). */
  release(): void {
    if (this.accepted > 0) this.accepted -= 1;
  }

  reset(): void {
    this.accepted = 0;
  }
}
