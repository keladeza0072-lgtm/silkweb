import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Studio evidence reader.
 *
 * Only predefined local experiment artifacts are read. Browser input never
 * chooses a path. The raw Muse JSONL, prompts, auth files, agent messages and
 * source bodies are NEVER returned to the browser.
 *
 * This is a presentation layer, not a new evaluator: it surfaces documented
 * primary evidence and distinguishes missing from verified data.
 */
const MAX_JSON = 1024 * 1024;
const MAX_JSONL = 32 * 1024 * 1024;
const COMPONENT = 'booking-reservation-kernel@0.2.0';

export interface DashboardOptions {
  /** Unit tests only: inject a disposable, private Projects root. */
  projectsRoot?: string;
}

type AnyRecord = Record<string, unknown>;
const record = (value: unknown): value is AnyRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

function safeRead(path: string, max: number): string | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) return null;
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

function json(path: string): AnyRecord | null {
  const content = safeRead(path, MAX_JSON);
  if (content === null) return null;
  try {
    const obj: unknown = JSON.parse(content);
    return record(obj) ? obj : null;
  } catch { return null; }
}

function logs(path: string): AnyRecord[] {
  const content = safeRead(path, MAX_JSONL);
  if (content === null) return [];
  const events: AnyRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (record(value)) events.push(value);
    } catch { /* malformed lines cannot be trusted */ }
  }
  return events;
}

function runUsage(logPath: string) {
  const all = logs(logPath);
  const finals = all.filter(e => record(e['payload']) &&
    Array.isArray(e['payload']['models']));
  const models = finals.at(-1)?.['payload'];
  const candidates = record(models) && Array.isArray(models['models']) ? models['models'] : [];
  const valid = candidates.length > 0 && candidates.every(record);
  function sum(field: string): number | null {
    if (!valid || !candidates.every(e => record(e) && num(e[field]) !== null)) return null;
    return candidates.reduce<number>((a, e) => a + (num((e as AnyRecord)[field]) ?? 0), 0);
  }
  const inputTokens = sum('input_tokens');
  const cachedTokens = sum('cached_tokens');
  return {
    available:valid,
    inputTokens,
    cachedTokens,
    uncachedTokens: inputTokens !== null && cachedTokens !== null
      ? inputTokens - cachedTokens : null,
    outputTokens: sum('output_tokens'),
    reasoningTokens: sum('reasoning_tokens'),
    directlyReportedCostUsd: sum('cost_usd'),
  };
}

function percentReduction(control: number | null, treatment: number | null): number | null {
  return control !== null && treatment !== null && control > 0
    ? Number((100 * (control - treatment) / control).toFixed(2))
    : null;
}

function historicComparison(projectsRoot: string) {
  const folder = join(projectsRoot, 'res002-fair-20261029', 'operator');
  const b = json(join(folder, 'run-B.json'));
  const c = json(join(folder, 'run-C.json'));
  const bTime = num(b?.['codingSeconds']);
  const cTime = num(c?.['codingSeconds']);
  const bQuality = num(b?.['weightedScore']);
  const cQuality = num(c?.['weightedScore']);
  const comparable = !!b && !!c &&
    b['benchmark'] === 'RES-002' && c['benchmark'] === 'RES-002' &&
    b['stage'] === 'evaluated' && c['stage'] === 'evaluated' &&
    b['museExitCode'] === 0 && c['museExitCode'] === 0 &&
    b['taskPromptSha256'] === c['taskPromptSha256'] &&
    b['startingGitCommit'] === c['startingGitCommit'] &&
    bTime !== null && cTime !== null && bQuality !== null && cQuality !== null;

  if (!comparable) {
    return {
      available:false as const,
      benchmark:'RES-002',
      reason:'Complete, matched B/C run records not available on this computer.',
      caveats:['No benchmark values are generated or estimated when evidence is missing.'],
    };
  }
  const B = runUsage(join(folder,'run-B.jsonl'));
  const C = runUsage(join(folder,'run-C.jsonl'));
  return {
    available:true as const,
    benchmark:'RES-002',
    model:str(c?.['model']) ?? 'muse-spark-1.3',
    design:'One controlled matched pair; same prompt and starting Git commit.',
    control:{
      label:'Without Silk Web', quality:bQuality, codingSeconds:bTime,
      passedChecks:num(b?.['passedChecks']), totalChecks:num(b?.['totalChecks']),usage:B,
    },
    treatment:{
      label:'With Silk Web', quality:cQuality, codingSeconds:cTime,
      passedChecks:num(c?.['passedChecks']), totalChecks:num(c?.['totalChecks']),usage:C,
    },
    deltas:{
      qualityPoints:Number((cQuality! - bQuality!).toFixed(2)),
      codingTimeReductionPercent:percentReduction(bTime,cTime),
      uncachedInputReductionPercent:percentReduction(B.uncachedTokens,C.uncachedTokens),
      outputReductionPercent:percentReduction(B.outputTokens,C.outputTokens),
    },
    caveats:[
      'One paired run is not statistically conclusive.',
      'Model instructions encouraged reuse in both conditions.',
      'Token differences do not establish causation.',
      'Billing totals are not inferred from token counts or account balances.',
    ],
  };
}

const ALLOWED_MCP = new Set([
  'search_verified_components','inspect_verified_component','get_verified_component_source',
]);

function activityEvents(path: string, origin: string) {
  return logs(path)
    .filter(e => ALLOWED_MCP.has(String(e['tool'])))
    .slice(-150)
    .map(e => ({
      origin,
      timestamp:str(e['timestamp']),
      type:'mcp',
      tool:str(e['tool']),
      status:e['status'] === 'success' ? 'success' : 'failure',
      component:str(e['component']),
      resultCount:Array.isArray(e['resultIds']) ? e['resultIds'].length : null,
      // No source bodies, prompt text, or paths from Muse events.
    }));
}

function latestVerification(projectsRoot: string) {
  const folder = join(projectsRoot,'silkweb-installer-demo','.silkweb','validations');
  if (!existsSync(folder)) return null;
  const folderStat = lstatSync(folder);
  if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) return null;
  const records = readdirSync(folder)
    .filter(x => /^[0-9a-f-]{36}\.json$/i.test(x))
    .slice(0,100)
    .map(name => json(join(folder,name)))
    .filter((x): x is AnyRecord => !!x &&
      x['schemaVersion'] === 1 && x['component'] === COMPONENT);
  records.sort((a,b)=>String(b['verifiedAt']??'').localeCompare(String(a['verifiedAt']??'')));
  const result = records[0];
  if (!result) return null;
  return {
    component:COMPONENT,
    status:str(result['status']),
    verifiedAt:str(result['verifiedAt']),
    passed:result['passed'] === true,
    checks:Array.isArray(result['checks'])
      ? result['checks'].filter(record).map(e => ({
          id:str(e['id']),passed:e['passed'] === true,
        })).slice(0,16)
      : [],
    assurance:str(result['assurance']),
  };
}

export function collectEvidence(options: DashboardOptions = {}) {
  const projectsRoot = options.projectsRoot ?? join(homedir(),'Projects');
  const adoption = join(projectsRoot,'muse-installer-trial-20261029','operator');
  const adoptionRun = json(join(adoption,'run.json'));
  const correction = json(join(adoption,'evaluation-reconciliation.json'));
  const res002 = join(projectsRoot,'res002-fair-20261029','operator');
  const B = json(join(res002,'run-B.json'));
  const C = json(join(res002,'run-C.json'));
  const timeline = [
    ...activityEvents(join(adoption,'mcp-audit.jsonl'),'MUSE-INSTALL-001'),
    ...activityEvents(join(res002,'C-mcp-audit.jsonl'),'RES-002 / Silk Web'),
  ].sort((a,b)=>String(b.timestamp??'').localeCompare(String(a.timestamp??''))).slice(0,100);

  const sessions = [
    {
      id:'MUSE-INSTALL-001',
      title:'Guided installer adoption',
      available:!!adoptionRun && adoptionRun['trial'] === 'MUSE-INSTALL-001',
      model:str(adoptionRun?.['model']),
      codingSeconds:num(adoptionRun?.['codingSeconds']),
      checksPassed:correction?.['passed'] === true ? 16 : null,
      checksTotal:correction?.['total'] === 16 ? 16 : null,
      status:correction?.['passed'] === true
        ? 'offline-reconciled' : adoptionRun ? 'recorded-not-reconciled' : 'not-connected',
      note:correction?.['passed'] === true
        ? '16/16 checks after documented offline correction; guided trial, no A/B control.'
        : 'No validated adoption reconciliation loaded. Never assume success.',
    },
    {
      id:'RES-002',
      title:'Controlled Muse coding comparison',
      available:!!B && !!C,
      model:str(C?.['model']),
      codingSeconds:num(C?.['codingSeconds']),
      checksPassed:num(C?.['passedChecks']),
      checksTotal:num(C?.['totalChecks']),
      status:B?.['stage'] === 'evaluated' && C?.['stage'] === 'evaluated'
        ? 'both-evaluated':'not-connected',
      note:'One B/C paired evaluation, not a population-wide performance claim.',
    },
  ];
  return {
    schemaVersion:1,
    source:'local-read-only-evidence',
    activity:{
      sessions,
      events:timeline,
      totalEventsShown:timeline.length,
      note:'Only whitelisted MCP audit metadata is shown. No prompt, source, token trace or authentication files are exposed.',
    },
    performance:historicComparison(projectsRoot),
    installation:latestVerification(projectsRoot),
  };
}
