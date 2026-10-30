/**
 * Creative-library contract for Milestone 2A.
 *
 * The final six advertising-style definitions and the four
 * research-based copywriting frameworks are NOT defined here:
 * this module only holds explicitly configured, approved
 * definitions. Unknown identifiers are always rejected.
 */

export interface AdvertisingStyleDefinition {
  id: string;
  name: string;
}

export interface CopywritingFrameworkDefinition {
  id: string;
  name: string;
}

export interface LibraryConfiguration {
  styles: AdvertisingStyleDefinition[];
  frameworks: CopywritingFrameworkDefinition[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

let approvedStyleIds = new Set<string>();
let approvedFrameworkIds = new Set<string>();

function checkDefinition(
  entry: unknown,
  kind: string,
  seen: Set<string>,
): string | null {
  if (typeof entry !== 'object' || entry === null) return `${kind} definitions must be objects.`;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id.trim())) {
    return `${kind} definition ids must be 1-64 chars of letters, digits, "-" or "_".`;
  }
  if (typeof record.name !== 'string' || !record.name.trim()) {
    return `${kind} definition "${String(record.id)}" must carry a non-empty name.`;
  }
  if (seen.has(record.id.trim())) return `Duplicate ${kind} definition id "${record.id.trim()}".`;
  seen.add(record.id.trim());
  return null;
}

/**
 * Replace the approved library with explicitly supplied definitions.
 * Throws on malformed configuration — never silently accepts it.
 */
export function configureCreativeLibrary(config: LibraryConfiguration): void {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Library configuration must be an object.');
  }
  if (!Array.isArray(config.styles) || !Array.isArray(config.frameworks)) {
    throw new Error('Library configuration needs "styles" and "frameworks" lists.');
  }
  const styleIds = new Set<string>();
  const frameworkIds = new Set<string>();
  for (const style of config.styles) {
    const problem = checkDefinition(style, 'Style', styleIds);
    if (problem) throw new Error(problem);
  }
  for (const framework of config.frameworks) {
    const problem = checkDefinition(framework, 'Framework', frameworkIds);
    if (problem) throw new Error(problem);
  }
  approvedStyleIds = styleIds;
  approvedFrameworkIds = frameworkIds;
}

/** Clear all approved definitions (tests and reconfiguration). */
export function resetCreativeLibrary(): void {
  approvedStyleIds = new Set<string>();
  approvedFrameworkIds = new Set<string>();
}

/** True only when the style id was explicitly approved. */
export function isKnownStyleId(id: unknown): boolean {
  return typeof id === 'string' && approvedStyleIds.has(id);
}

/** True only when the framework id was explicitly approved. */
export function isKnownFrameworkId(id: unknown): boolean {
  return typeof id === 'string' && approvedFrameworkIds.has(id);
}

export function knownStyleIds(): string[] {
  return [...approvedStyleIds];
}

export function knownFrameworkIds(): string[] {
  return [...approvedFrameworkIds];
}
