/**
 * Deterministic discovery/ranking over an ALREADY verified manifest collection.
 * No model calls, network calls, file access, certification or side effects.
 * This module MUST NOT be given unchecked registry manifests by the MCP route.
 */
export interface DiscoveryComponent {
  id: string;
  version: string;
  capabilities: string[];
  invariants: string[];
  runtime: {
    stack: string;
    node: string;
    dependencies: Record<string, string>;
  };
}

export interface DiscoveryQuery {
  query?: string;
  stack?: string;
  capabilities?: string[];
  /** Target Node runtime, e.g. v24.15.0; exact minimum-version comparison. */
  nodeVersion?: string;
  /** Every declared runtime package must be present at its exact version. */
  installedDependencies?: Record<string, string>;
}

export interface MatchExplanation {
  score: number;
  matchedTerms: string[];
  signals: string[];
}

export interface DiscoveryHit<T extends DiscoveryComponent> {
  manifest: T;
  match?: MatchExplanation;
}

/** Only known, deliberately curated paraphrases; no embeddings/LLM guesses. */
const ALIASES: Record<string, string> = {
  appointment:'booking', appointments:'booking',
  reservation:'booking', reservations:'booking', bookings:'booking',
  reserve:'booking', reserving:'booking',
  cancel:'cancellation', cancels:'cancellation', cancelled:'cancellation',
  canceled:'cancellation', cancelling:'cancellation', canceling:'cancellation',
  validators:'validation', validator:'validation', validate:'validation',
  validating:'validation', validated:'validation',
  schemas:'schema', tables:'schema', table:'schema',
  slots:'slot', mins:'minute', minutes:'minute',
  schedules:'schedule', scheduling:'schedule', guards:'guard',
  concurrent:'atomic', concurrently:'atomic', concurrency:'atomic',
  race:'atomic', races:'atomic', parallel:'atomic', simultaneous:'atomic',
  retries:'idempotency', retry:'idempotency', replay:'idempotency',
  replays:'idempotency', replayed:'idempotency', idempotent:'idempotency',
  idempotence:'idempotency',
};

const STOP = new Set([
  'a','an','the','for','of','and','or','to','with','that','which',
  'i','we','our','my','me','you','your','want','need','needs',
  'find','please','looking','look','help','can','be','is','are',
  'api','apis','http','rest','endpoint','endpoints','backend','server',
  'app','apps','application','applications','code','module','modules',
  'library','libraries','implement','implementation','build','building',
  'create','creating','using','use','feature','features','component','components',
  'support','supports','handling','handle','handles','safely','safe',
  'request','requests','when','while','where','who','how',
  'two','multiple','same','different','customer','customers','user','users',
  'system','service','services','function','functions','solution',
  'prevent','avoiding','avoid','double','duplicate','exactly','once','time',
]);

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function terms(value: string): string[] {
  return [...new Set(words(value).map(w=>ALIASES[w] ?? w).filter(w=>!STOP.has(w)))];
}

function conceptsFromPhrases(query: string): string[] {
  const patterns: Array<[RegExp,string]> = [
    [/\b(?:double[- ]book(?:ing|ings)?|duplicate (?:active )?(?:slot|booking)s?)\b/i, 'atomic'],
    [/\b(?:exactly[- ]once|repeat(?:ed)? (?:calls?|requests?))\b/i, 'idempotency'],
    [/\b(?:cancel|void) (?:a |the )?(?:booking|reservation|appointment)\b/i, 'cancellation'],
  ];
  return patterns.filter(([re])=>re.test(query)).map(([,term])=>term);
}

function queryTerms(query: string): string[] {
  return [...new Set([...terms(query),...conceptsFromPhrases(query)])];
}

function compareString(a: string,b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function semverTuple(raw: string): number[] | null {
  const matched = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(raw.trim());
  return matched ? [Number(matched[1]), Number(matched[2] ?? 0), Number(matched[3] ?? 0)] : null;
}

function supportedNode(manifest: DiscoveryComponent, targetVersion: string): boolean {
  const target = semverTuple(targetVersion);
  // Conservative, do not assert compatibility for unknown version ranges.
  const requirement = /^>=\s*(\d+(?:\.\d+){0,2})$/.exec(manifest.runtime.node);
  const min = requirement ? semverTuple(requirement[1]) : null;
  if (!target || !min || target.some(v=>!Number.isSafeInteger(v)) ||
      min.some(v=>!Number.isSafeInteger(v))) return false;
  for (let i=0; i<3; i++) {
    if (target[i] !== min[i]) return target[i] > min[i];
  }
  return true;
}

function compatible<T extends DiscoveryComponent>(component:T, filters:DiscoveryQuery): boolean {
  if (filters.stack !== undefined && component.runtime.stack !== filters.stack) return false;
  if (filters.capabilities !== undefined &&
      !filters.capabilities.every(cap=>component.capabilities.includes(cap))) return false;
  if (filters.nodeVersion !== undefined && !supportedNode(component,filters.nodeVersion)) return false;
  if (filters.installedDependencies !== undefined &&
      !Object.entries(component.runtime.dependencies).every(
        ([name,version])=>filters.installedDependencies?.[name] === version)) return false;
  return true;
}

function scoreManifest(component: DiscoveryComponent, query: string): MatchExplanation | null {
  const normalized = query.toLowerCase().trim();
  const key = component.id+'@'+component.version;
  if (normalized === key || normalized === component.id) {
    return {
      score:1000,
      matchedTerms:queryTerms(normalized),
      signals:['exact-component-id'],
    };
  }
  const requested = queryTerms(normalized);
  if (!requested.length) return null; // Unknown/generic text is NOT a catalog match.
  const id = new Set(terms(component.id));
  const caps = new Set(terms(component.capabilities.join(' ')));
  const invariants = new Set(terms(component.invariants.join(' ')));
  const matched: string[] = [];
  const signals: string[] = [];
  let score = 0;
  for (const term of requested) {
    if (id.has(term)) {
      matched.push(term); score += 14; signals.push('id:'+term);
    } else if (caps.has(term)) {
      matched.push(term); score += 10; signals.push('capability:'+term);
    } else if (invariants.has(term)) {
      matched.push(term); score += 3; signals.push('invariant:'+term);
    }
  }
  // One unrelated term in a sufficiently informative long query is tolerated.
  // Two-term queries require BOTH. A vague single match never retrieves all.
  const needed = requested.length <= 2
    ? requested.length
    : Math.ceil(requested.length * 0.75);
  if (matched.length < needed) return null;
  const rawRequested = new Set(words(normalized).filter(w=>!STOP.has(w)));
  const rawId = new Set(words(component.id));
  const rawCaps = new Set(words(component.capabilities.join(' ')));
  for (const term of rawRequested) {
    if (rawId.has(term)) score += 6;
    else if (rawCaps.has(term)) score += 2;
  }
  if (normalized.includes(component.id)) score += 25;
  // Higher query coverage beats components matching only 3/4 terms.
  score += Math.round(10*matched.length/requested.length);
  return {score, matchedTerms:matched, signals:signals.slice(0,8)};
}

/**
 * Maintains original alphabetical order for inventory/filter-only queries.
 * For meaningful queries, rank by explicit ID/capability/invariant evidence,
 * stable tie-break id@version. No unverified fallback.
 */
export function discover<T extends DiscoveryComponent>(
  alreadyTrusted: readonly T[],
  options: DiscoveryQuery,
): DiscoveryHit<T>[] {
  const query = options.query?.trim() ?? '';
  const filtered = alreadyTrusted.filter(c=>compatible(c,options));
  const results: DiscoveryHit<T>[] = [];
  for (const manifest of filtered) {
    if (!query) {
      results.push({manifest});
    } else {
      const match = scoreManifest(manifest,query);
      if (match) results.push({manifest,match});
    }
  }
  return results.sort((a,b)=>{
    if (query) {
      const byScore = (b.match?.score ?? 0)-(a.match?.score ?? 0);
      if (byScore !== 0) return byScore;
    }
    return compareString(a.manifest.id+'@'+a.manifest.version,b.manifest.id+'@'+b.manifest.version);
  });
}
