/**
 * In-process async job manager for live image-ads generation.
 *
 * Single-instance MVP only: jobs live in memory and are NOT durable
 * across restart, deploy, or instance replacement. A lost job is
 * reported as unknown (404) — it is never silently re-run.
 *
 * Invariants:
 * - One job runs the paid generation function exactly once.
 * - Polling (getJob) never triggers generation.
 * - No automatic retries of paid work.
 * - At most `maxConcurrent` (default 1) generations run at once.
 * - Queue depth, retained results, and job lifetime are bounded.
 * - Client-visible errors are sanitized: no stacks, keys, or prompts.
 */
import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Shape returned by the existing live generation outcome. */
export interface GenerationOutcome {
  status: number;
  payload: unknown;
}

export type JobRunner = (body: unknown) => Promise<GenerationOutcome>;

export interface JobSnapshot {
  jobId: string;
  status: JobStatus;
  /** Present only when succeeded (200 or 206 live payload). */
  result?: unknown;
  /** Upstream status for partial success (206), when applicable. */
  resultStatus?: number;
  /** Present only when failed; sanitized, safe for clients. */
  error?: { code: string; message: string };
  /** Upstream outcome status when failed (e.g. 422, 502, 504). */
  errorStatus?: number;
  createdAt: number;
  updatedAt: number;
}

export interface JobManagerOptions {
  maxConcurrent?: number;
  /** Maximum jobs waiting (queued, not yet running). */
  maxQueueDepth?: number;
  /** Maximum finished jobs retained for polling. */
  maxRetainedJobs?: number;
  /** Finished jobs expire this long after completion (ms). */
  resultTtlMs?: number;
  now?: () => number;
}

export class QueueFullError extends Error {
  readonly code = 'QUEUE_FULL';
  constructor() {
    super('Too many generations are waiting. Please try again shortly.');
    this.name = 'QueueFullError';
  }
}

interface InternalJob {
  id: string;
  status: JobStatus;
  body: unknown;
  runner: JobRunner;
  result?: unknown;
  resultStatus?: number;
  error?: { code: string; message: string };
  errorStatus?: number;
  createdAt: number;
  updatedAt: number;
  started: boolean;
  waiters: Array<(snap: JobSnapshot) => void>;
}

const SAFE_FALLBACK = 'Generation failed. Please try again.';

function sanitizeOutcomeError(payload: unknown): { code: string; message: string } {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.issues) && record.issues.length > 0) {
      const messages = record.issues
        .map((i) => (typeof i === 'object' && i !== null ? String((i as Record<string, unknown>).message ?? '') : ''))
        .filter(Boolean)
        .join(' ')
        .slice(0, 400);
      if (messages) return { code: 'VALIDATION_FAILED', message: messages };
    }
    const err = record.error;
    if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>;
      const code = typeof e.code === 'string' && /^[A-Z0-9_]{3,48}$/.test(e.code) ? e.code : 'GENERATION_FAILED';
      const message = typeof e.message === 'string' && e.message.length > 0 ? e.message.slice(0, 400) : SAFE_FALLBACK;
      return { code, message };
    }
  }
  return { code: 'GENERATION_FAILED', message: SAFE_FALLBACK };
}

export class ImageAdsJobManager {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly queue: string[] = [];
  private readonly maxConcurrent: number;
  private readonly maxQueueDepth: number;
  private readonly maxRetainedJobs: number;
  private readonly resultTtlMs: number;
  private readonly now: () => number;
  private running = 0;

  constructor(options: JobManagerOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
    this.maxQueueDepth = Math.max(0, options.maxQueueDepth ?? 8);
    this.maxRetainedJobs = Math.max(1, options.maxRetainedJobs ?? 50);
    this.resultTtlMs = Math.max(1000, options.resultTtlMs ?? 10 * 60 * 1000);
    this.now = options.now ?? Date.now;
  }

  get activeCount(): number { return this.running; }
  get queuedCount(): number { return this.queue.length; }
  get size(): number { return this.jobs.size; }

  /** Create a job and schedule its single execution. Throws QueueFullError. */
  submit(body: unknown, runner: JobRunner): JobSnapshot {
    this.sweep();
    // Admission control: only waiting jobs count against queue depth;
    // a job that can start immediately is never rejected for queueing.
    if (this.running >= this.maxConcurrent && this.queue.length >= this.maxQueueDepth) throw new QueueFullError();
    const job: InternalJob = {
      id: randomUUID(),
      status: 'queued',
      body,
      runner,
      createdAt: this.now(),
      updatedAt: this.now(),
      started: false,
      waiters: [],
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.pump();
    return this.snapshot(job);
  }

  /**
   * Submit and wait for completion through the same queue/concurrency
   * gate. Used by the legacy synchronous route so it cannot bypass
   * paid-work limits. Throws QueueFullError when full.
   */
  async submitAndWait(body: unknown, runner: JobRunner): Promise<JobSnapshot> {
    const snap = this.submit(body, runner);
    const job = this.jobs.get(snap.jobId);
    if (!job || job.status === 'succeeded' || job.status === 'failed') return snap;
    return new Promise((resolve) => { job.waiters.push(resolve); });
  }

  /** Poll a job. Never starts or re-runs generation. Unknown/expired -> null. */
  getJob(id: string): JobSnapshot | null {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    this.sweep();
    const job = this.jobs.get(id);
    return job ? this.snapshot(job) : null;
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const nextId = this.queue.shift();
      if (nextId === undefined) break;
      const job = this.jobs.get(nextId);
      if (!job || job.started) continue;
      job.started = true;
      job.status = 'running';
      job.updatedAt = this.now();
      this.running += 1;
      void this.execute(job);
    }
  }

  private async execute(job: InternalJob): Promise<void> {
    try {
      const outcome = await job.runner(job.body);
      if (outcome.status === 200 || outcome.status === 206) {
        job.status = 'succeeded';
        job.result = outcome.payload;
        job.resultStatus = outcome.status;
      } else {
        job.status = 'failed';
        job.errorStatus = outcome.status;
        job.error = sanitizeOutcomeError(outcome.payload);
        console.error(`[image-ads-job] job failed code=${job.error.code} upstreamStatus=${outcome.status}`);
      }
    } catch {
      job.status = 'failed';
      job.error = { code: 'GENERATION_FAILED', message: SAFE_FALLBACK };
      console.error('[image-ads-job] job runner threw unexpectedly');
    } finally {
      job.updatedAt = this.now();
      // Drop the request body (may carry a product image) once finished.
      job.body = undefined;
      this.running -= 1;
      const snap = this.snapshot(job);
      const waiters = job.waiters.splice(0);
      this.trimRetained();
      this.pump();
      for (const resolve of waiters) resolve(snap);
    }
  }

  private snapshot(job: InternalJob): JobSnapshot {
    const snap: JobSnapshot = {
      jobId: job.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
    };
    if (job.status === 'succeeded') { snap.result = job.result; snap.resultStatus = job.resultStatus; }
    if (job.status === 'failed' && job.error) { snap.error = job.error; snap.errorStatus = job.errorStatus; }
    return snap;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, job] of this.jobs) {
      const finished = job.status === 'succeeded' || job.status === 'failed';
      if (finished && now - job.updatedAt > this.resultTtlMs) this.jobs.delete(id);
    }
    this.trimRetained();
  }

  private trimRetained(): void {
    const finished = [...this.jobs.values()]
      .filter((j) => j.status === 'succeeded' || j.status === 'failed')
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (finished.length > this.maxRetainedJobs) {
      const oldest = finished.shift();
      if (oldest) this.jobs.delete(oldest.id);
    }
  }
}
