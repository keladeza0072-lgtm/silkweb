#!/usr/bin/env node
/**
 * RES-001 post-run, read-only evidence inspection.
 * No model requests, no file changes, no source or prompts printed.
 *
 * Usage:
 * node experiments/harness/res001-analyze.mjs --root ABSOLUTE_PREPARED_ROOT
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--root' || !isAbsolute(args[1])) {
  throw new Error('usage: --root ABSOLUTE_PREPARED_ROOT');
}
const root = resolve(args[1]);
const operator = join(root, 'operator');
const readJson = p => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const finite = v => typeof v === 'number' && Number.isFinite(v);
function eventsFrom(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const events = [];
  let invalidLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { invalidLines++; }
  }
  if (invalidLines) process.stdout.write('WARN: ' + path + ' had ' + invalidLines + ' non-JSONL line(s)\n');
  return events;
}
const indicators = [
  'createIdempotentBooking',
  'initializeReservationKernel',
  'cancelReservation',
  'booking_idempotency_keys',
  'BEGIN IMMEDIATE',
  'PRAGMA busy_timeout',
  'IdempotencyKeyConflictError',
  'SLOT_CONFLICT',
  'IDEMPOTENCY_KEY_CONFLICT',
  'RESERVATION_BUSY',
  'replayed',
];
function sourceInventory(folder) {
  const output = [];
  function visit(dir, prefix = '') {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage'].includes(e.name)) continue;
      const rel = prefix ? prefix + '/' + e.name : e.name;
      const path = join(dir, e.name);
      if (e.isDirectory()) visit(path, rel);
      else if (e.isFile() && /\.(?:ts|js|mts|mjs)$/.test(e.name)) {
        const s = readFileSync(path, 'utf8');
        output.push({ path: rel, size: Buffer.byteLength(s), text: s });
      }
    }
  }
  visit(join(folder, 'src'), 'src');
  const combined = output.map(f => f.text).join('\n');
  return {
    sourceFiles: output.map(f => ({ path: f.path, bytes: f.size })),
    implementationMarkers: indicators.filter(x => combined.includes(x)),
  };
}
function limitedTypeDistribution(events) {
  const counts = new Map();
  for (const event of events) {
    const type = String(event.type ?? event.event ?? event.kind ?? '(no type)');
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 15)
    .map(([type, count]) => ({ type, count }));
}
// Preserve field names and context paths, never the raw text of a message.
// Some Muse events contain per-call usage; others contain cumulative usage.
// We DO NOT sum these without establishing their semantics.
const usageRE = /^(?:input_tokens|output_tokens|cached_tokens|reasoning_tokens|total_tokens|prompt_tokens|completion_tokens|uncached_input_tokens|inputTokens|outputTokens|cachedTokens|reasoningTokens|totalTokens|cost_usd|total_cost|totalCost|amount_usd|billed_usd)$/i;
function usageFieldSummary(events) {
  const paths = new Map();
  for (const event of events) {
    const stack = [{ item: event, path: '', depth: 0 }];
    let visited = 0;
    while (stack.length && ++visited <= 12000) {
      const { item, path, depth } = stack.pop();
      if (!item || typeof item !== 'object' || depth > 12) continue;
      if (Array.isArray(item)) {
        for (const entry of item.slice(0, 100)) stack.push({ item: entry, path: path + '[]', depth: depth+1 });
      } else {
        for (const [key, value] of Object.entries(item)) {
          const field = path ? path + '.' + key : key;
          if (usageRE.test(key) && finite(value)) {
            const old = paths.get(field) ?? { field, appearances: 0, first: value, last: value, min: value, max: value };
            old.appearances++;
            old.last = value;
            old.min = Math.min(old.min, value);
            old.max = Math.max(old.max, value);
            paths.set(field, old);
          }
          // Skip prose / content arrays to avoid processing arbitrary user text.
          if (!['content', 'text', 'message', 'arguments', 'input', 'output', 'delta'].includes(key)
              && value && typeof value === 'object') {
            stack.push({ item: value, path: field, depth: depth+1 });
          }
        }
      }
    }
  }
  return [...paths.values()].sort((a,b) => b.appearances - a.appearances).slice(0, 30);
}
function evaluate(label) {
  const recordPath = join(operator, 'run-' + label + '.json');
  const qualityPath = join(root, 'reports', label + '-quality.json');
  const logPath = join(operator, 'run-' + label + '.jsonl');
  const result = { condition: label };
  if (!existsSync(recordPath)) { result.error = 'run record missing'; return result; }
  const run = readJson(recordPath);
  const events = eventsFrom(logPath);
  result.stage = run.stage;
  result.sessionId = run.sessionId;
  result.museExitCode = run.museExitCode;
  result.codingSeconds = run.codingSeconds;
  result.model = run.model;
  result.reasoningEffort = run.reasoningEffort;
  result.maxModelSteps = run.maxModelSteps;
  result.eventCount = events.length;
  result.eventTypes = limitedTypeDistribution(events);
  result.usageFields = usageFieldSummary(events);
  if (existsSync(qualityPath)) {
    const q = readJson(qualityPath);
    result.quality = {
      passed: q.passed, checks: q.checks,
      weightedScore: q.weightedScore,
      weightedEarned: q.weightedEarned,
      weightedMax: q.weightedMax,
      failedChecks: (q.details ?? []).filter(x=>!x.passed)
        .map(x=>({ id:x.id, weight:x.weight, error:x.error })),
    };
  }
  result.app = sourceInventory(join(root, label));
  return result;
}

const B = evaluate('B');
const C = evaluate('C');
const audit = eventsFrom(join(operator, 'C-mcp-audit.jsonl'));
const auditCounts = {};
const sourceRetrievals = [];
for (const e of audit) {
  const key = e.tool + ':' + e.status;
  auditCounts[key] = (auditCounts[key] ?? 0) + 1;
  if (e.tool === 'get_verified_component_source') {
    sourceRetrievals.push({
      status:e.status, component:e.component,
      truncated:e.truncated, errorCode:e.errorCode,
      files:(e.files ?? []).map(f=>({
        path:f.path, chars:f.chars, sha256:f.sha256, truncated:f.truncated,
      })),
    });
  }
}
const independent = {
  auditExists: existsSync(join(operator, 'C-mcp-audit.jsonl')),
  totalAuditEvents: audit.length,
  eventCounts: auditCounts,
  sourceRetrievals,
  verifiedCompleteV2Retrieval: sourceRetrievals.some(
    e=>e.status === 'success'
      && e.component === 'booking-reservation-kernel@0.2.0'
      && e.truncated === false
      && e.files.some(f=>f.path.endsWith('/reservationKernelV2.ts') && f.truncated === false),
  ),
};
const comparison = {
  qualityDifferencePoints: B.quality && C.quality
    ? Number((C.quality.weightedScore - B.quality.weightedScore).toFixed(2)) : null,
  codingTimeDifferenceSeconds: finite(B.codingSeconds) && finite(C.codingSeconds)
    ? Number((C.codingSeconds - B.codingSeconds).toFixed(3)) : null,
  relativeTimeDifferencePercent: finite(B.codingSeconds) && finite(C.codingSeconds) && B.codingSeconds > 0
    ? Number((100 * (C.codingSeconds / B.codingSeconds - 1)).toFixed(3)) : null,
};
process.stdout.write(JSON.stringify({
  benchmark:'RES-001', classification:'READ_ONLY_POST_RUN_DIAGNOSTIC',
  B,C,independentMcpAudit:independent,comparison,
  interpretationNote:'Retrieval and marker overlap are not proof of code integration or execution. Usage values are not summed: inspect each field to distinguish per-call from cumulative statistics.',
},null,2)+'\n');
