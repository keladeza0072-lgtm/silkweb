/**
 * Creative-library contract for Milestones 2A–2B.
 *
 * Holds the explicitly configured, approved definitions for the six
 * active advertising styles and four copywriting frameworks selected
 * in CREATIVE_LIBRARY_V1.md (the source of truth). Unknown
 * identifiers are always rejected — nothing is invented here.
 *
 * The configuration interface ({ styles, frameworks } with at least
 * id + name per entry) is preserved from Milestone 2A: minimal
 * entries still configure the library, while the approved V1 entries
 * below carry the full purpose/composition/copy/visual/usage/
 * restriction detail consumed by recommendation and by future live
 * concept providers.
 */

export interface AdvertisingStyleDefinition {
  id: string;
  name: string;
  /** Why this style exists (V1 "Purpose"). */
  purpose?: string;
  /** How a concept in this style is composed (V1 "Composition"). */
  composition?: string;
  /** Copy rules for this style (V1 "Copy"). */
  copyRules?: string;
  /** Visual guidance for this style (V1 composition, visual half). */
  visualDirection?: string;
  /** When this style is appropriate (V1 usage + selection rules). */
  usage?: string;
  /** Factual and advertising restrictions (V1 "Restriction"). */
  restrictions?: string;
}

export interface CopywritingFrameworkDefinition {
  id: string;
  name: string;
  /** Ordered copy structure, e.g. "Attention -> Interest -> Desire -> Action". */
  structure?: string;
  /** When to apply this framework (V1 usage line). */
  applicationRules?: string;
  /** Factual restrictions (V1 restriction line). */
  restrictions?: string;
}

export interface LibraryConfiguration {
  styles: AdvertisingStyleDefinition[];
  frameworks: CopywritingFrameworkDefinition[];
}

/** Library source tag for the active six-plus-four selection. */
export const CREATIVE_LIBRARY_VERSION = 'v1';

/** Stable ids of the six active V1 advertising styles, in V1 order. */
export const ACTIVE_STYLE_IDS: readonly string[] = [
  'problem-solution',
  'notification-offer',
  'chat-script',
  'whiteboard',
  'before-after',
  'editorial',
];

/** Stable ids of the four active V1 copywriting frameworks, in V1 order. */
export const ACTIVE_FRAMEWORK_IDS: readonly string[] = [
  'aida',
  'pas',
  'bab',
  'fab',
];

/**
 * The six approved advertising-style definitions, verbatim from
 * CREATIVE_LIBRARY_V1.md. `usage` restates each style's V1 purpose
 * plus the evidence gate from the selection rules (offer or
 * supportable transformation where required).
 */
export const APPROVED_ADVERTISING_STYLES: readonly AdvertisingStyleDefinition[] = [
  {
    id: 'problem-solution',
    name: 'Problem vs. Solution',
    purpose: 'Connect an identifiable problem to a relevant solution.',
    composition: 'Problem hook, product introduction, solution visual, CTA.',
    copyRules: 'Empathetic and benefit-led.',
    visualDirection:
      'Lead with the problem hook in words, introduce the product, ' +
      'then show a solution visual carrying the product, closed by a clear CTA.',
    usage:
      'Use when the campaign names a recognizable customer problem the ' +
      'product genuinely addresses. Fits most products, objectives, channels, and tones.',
    restrictions: 'Never invent pain points, efficacy, or product results.',
  },
  {
    id: 'notification-offer',
    name: 'Offer / Notification Offer',
    purpose: 'Highlight a genuine promotional incentive.',
    composition: 'Notification-inspired visual, prominent offer, clear CTA.',
    copyRules: 'Concise, specific, urgency only when substantiated.',
    visualDirection:
      'Notification-inspired visual framing the product, with the ' +
      'supplied offer stated prominently and a clear CTA.',
    usage:
      'Use only when the campaign supplies a genuine promotional ' +
      'incentive (offer present in the campaign context). Without a ' +
      'verified offer, recommend another style.',
    restrictions:
      'Only use promotions explicitly supplied by the user. Without a ' +
      'verified offer, recommend another style.',
  },
  {
    id: 'chat-script',
    name: 'WhatsApp / Chat Script',
    purpose: 'Present advertising as a relatable conversation.',
    composition: 'Chat-style bubbles, clear dialogue progression, CTA.',
    copyRules: 'Natural, conversational, concise.',
    visualDirection:
      'Chat-style message bubbles with a clear dialogue progression ' +
      'toward the CTA; keep platform chrome generic.',
    usage:
      'Use when a relatable, conversational tone fits the product, ' +
      'audience, and channel — especially social and message-led placements.',
    restrictions:
      'Do not imply fabricated messages are genuine testimonials. ' +
      'Avoid copying protected platform branding unnecessarily.',
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard',
    purpose: 'Explain a product, process, or service.',
    composition: 'Structured diagrams, short labels, clear visual hierarchy.',
    copyRules: 'Educational, direct, logically sequenced.',
    visualDirection:
      'Structured diagrams with short labels and a clear visual ' +
      'hierarchy that walks through the explanation step by step.',
    usage:
      'Use when the campaign needs to explain how a product, process, ' +
      'or service works, especially for how-to or consideration objectives.',
    restrictions:
      'Do not invent numerical claims or technical capabilities.',
  },
  {
    id: 'before-after',
    name: 'Before vs. After',
    purpose: 'Contrast a situation, process, or experience.',
    composition: 'Clear two-state comparison.',
    copyRules: 'Transformation-focused with substantiated benefits.',
    visualDirection:
      'A clear two-state comparison visual: the earlier state beside ' +
      'the later state, both grounded in supplied facts.',
    usage:
      'Use only for relevant, supportable transformations backed by ' +
      'supplied facts. Without transformation evidence, recommend another style.',
    restrictions:
      'Do not fabricate outcomes, physical transformations, performance ' +
      'improvements, or guaranteed results.',
  },
  {
    id: 'editorial',
    name: 'Editorial / Magazine',
    purpose: 'Premium photography-led brand storytelling.',
    composition:
      'Hero photography, sophisticated typography, generous negative ' +
      'space, carefully placed product and CTA.',
    copyRules: 'Elegant, concise, emotionally resonant.',
    visualDirection:
      'Hero photography with sophisticated typography, generous ' +
      'negative space, and a carefully placed product and CTA.',
    usage:
      'Use for premium, brand-led storytelling where high-quality ' +
      'photography and an elegant tone fit the product and audience.',
    restrictions:
      'Do not fabricate luxury certifications, endorsements, ' +
      'ingredients, product properties, or brand history.',
  },
];

/**
 * The four approved copywriting-framework definitions, verbatim from
 * CREATIVE_LIBRARY_V1.md.
 */
export const APPROVED_COPYWRITING_FRAMEWORKS: readonly CopywritingFrameworkDefinition[] = [
  {
    id: 'aida',
    name: 'AIDA',
    structure: 'Attention -> Interest -> Desire -> Action',
    applicationRules:
      'Use when introducing an offering and guiding interest toward a clear next action.',
    restrictions:
      'Never invent product facts or offers to fill a step; every step ' +
      'may only restate supplied facts.',
  },
  {
    id: 'pas',
    name: 'PAS',
    structure: 'Problem -> Agitation -> Solution',
    applicationRules: 'Use for recognizable customer problems.',
    restrictions:
      'Agitation must not rely on fearmongering or fabricated claims; ' +
      'never invent pain points, efficacy, or product results.',
  },
  {
    id: 'bab',
    name: 'BAB',
    structure: 'Before -> After -> Bridge',
    applicationRules: 'Use for relevant, supportable transformations.',
    restrictions:
      'After states must not imply unsupported outcomes; never ' +
      'fabricate results, improvements, or guaranteed outcomes.',
  },
  {
    id: 'fab',
    name: 'FAB',
    structure: 'Features -> Advantages -> Benefits',
    applicationRules: 'Use when actual product features are provided.',
    restrictions:
      'Never fabricate features or benefits; every feature must come ' +
      'from supplied facts.',
  },
];

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

let approvedStyleIds = new Set<string>();
let approvedFrameworkIds = new Set<string>();
let approvedStyleEntries = new Map<string, AdvertisingStyleDefinition>();
let approvedFrameworkEntries = new Map<string, CopywritingFrameworkDefinition>();

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
 * The interface is unchanged from Milestone 2A: id + name per entry
 * is sufficient; fuller V1 detail rides along when supplied.
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
  approvedStyleEntries = new Map(
    config.styles.map((style) => [style.id.trim(), { ...style, id: style.id.trim() }]),
  );
  approvedFrameworkEntries = new Map(
    config.frameworks.map((framework) => [framework.id.trim(), { ...framework, id: framework.id.trim() }]),
  );
}

/**
 * Initialize the approved V1 library: exactly the six active
 * advertising styles and four copywriting frameworks. Call once at
 * application startup; tests may reset and reconfigure freely.
 */
export function initializeApprovedCreativeLibrary(): void {
  configureCreativeLibrary({
    styles: APPROVED_ADVERTISING_STYLES.map((style) => ({ ...style })),
    frameworks: APPROVED_COPYWRITING_FRAMEWORKS.map((framework) => ({ ...framework })),
  });
}

/** True only when the library holds exactly the approved V1 selection. */
export function isApprovedLibraryActive(): boolean {
  if (approvedStyleIds.size !== ACTIVE_STYLE_IDS.length) return false;
  if (approvedFrameworkIds.size !== ACTIVE_FRAMEWORK_IDS.length) return false;
  return (
    ACTIVE_STYLE_IDS.every((id) => approvedStyleIds.has(id)) &&
    ACTIVE_FRAMEWORK_IDS.every((id) => approvedFrameworkIds.has(id))
  );
}

/** Clear all approved definitions (tests and reconfiguration). */
export function resetCreativeLibrary(): void {
  approvedStyleIds = new Set<string>();
  approvedFrameworkIds = new Set<string>();
  approvedStyleEntries = new Map<string, AdvertisingStyleDefinition>();
  approvedFrameworkEntries = new Map<string, CopywritingFrameworkDefinition>();
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

/** Full approved entry for a style id, or undefined when unknown. */
export function getStyleDefinition(id: string): AdvertisingStyleDefinition | undefined {
  const entry = approvedStyleEntries.get(id);
  return entry === undefined ? undefined : { ...entry };
}

/** Full approved entry for a framework id, or undefined when unknown. */
export function getFrameworkDefinition(id: string): CopywritingFrameworkDefinition | undefined {
  const entry = approvedFrameworkEntries.get(id);
  return entry === undefined ? undefined : { ...entry };
}

/** Full approved style entries in V1 order (only those configured). */
export function listStyleDefinitions(): AdvertisingStyleDefinition[] {
  return ACTIVE_STYLE_IDS.flatMap((id) => {
    const entry = approvedStyleEntries.get(id);
    return entry === undefined ? [] : [{ ...entry }];
  });
}

/** Full approved framework entries in V1 order (only those configured). */
export function listFrameworkDefinitions(): CopywritingFrameworkDefinition[] {
  return ACTIVE_FRAMEWORK_IDS.flatMap((id) => {
    const entry = approvedFrameworkEntries.get(id);
    return entry === undefined ? [] : [{ ...entry }];
  });
}

/**
 * Provider-facing library brief for future live concept providers.
 * Renders every approved definition plus the V1 selection rules and
 * factual restrictions as plain instructions. Text only — it never
 * contains generated concepts and never changes the two-concept
 * output schema.
 */
export function buildLibraryPromptSection(): string {
  const lines: string[] = [
    `SilkWeb Creative Library ${CREATIVE_LIBRARY_VERSION}: six active advertising styles, four copywriting frameworks.`,
    'Use only these identifiers; never invent style or framework ids.',
    '',
    '## Advertising styles',
  ];
  for (const style of APPROVED_ADVERTISING_STYLES) {
    lines.push(
      `### ${style.id} (${style.name})`,
      `Purpose: ${style.purpose}`,
      `Composition: ${style.composition}`,
      `Copy: ${style.copyRules}`,
      `Visual direction: ${style.visualDirection}`,
      `Usage: ${style.usage}`,
      `Restriction: ${style.restrictions}`,
      '',
    );
  }
  lines.push('## Copywriting frameworks');
  for (const framework of APPROVED_COPYWRITING_FRAMEWORKS) {
    lines.push(
      `### ${framework.id} (${framework.name})`,
      `Structure: ${framework.structure}`,
      `Application: ${framework.applicationRules}`,
      `Restriction: ${framework.restrictions}`,
      '',
    );
  }
  lines.push(
    '## Hard rules',
    '1. Never invent product facts, offers, discounts, testimonials, certifications, or benefits.',
    '2. Only use promotions explicitly supplied in the campaign context.',
    '3. Without a verified offer, use another style — never notification-offer.',
    '4. Never imply unsupported transformations, outcomes, or guaranteed results.',
    '5. Keep supplied facts separate from creative assumptions.',
    '6. Keep photography prompts aligned with real product facts.',
  );
  return lines.join('\n');
}
