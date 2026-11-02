import {
  inspectTrustedComponent,
  searchTrusted,
  type TrustedSelection,
} from './librarian.js';

/**
 * Read-only data-intelligence lookup over the certified registry.
 *
 * There is no separate data-contract store: the only data
 * intelligence this server can serve is the schema and business-rule
 * context already bound to verified registry manifests (for example
 * the booking-schema invariants). Business rules without a manifest
 * and currently valid evidence are reported unavailable — never
 * invented to fill a gap.
 */

export const DATA_CAPABILITY_HINTS: readonly string[] = [
  'booking-schema',
  'sqlite-ddl',
  'booking-validation',
  'slot-constraints',
  'booking-creation',
  'slot-guard',
  'booking-cancellation',
];

export const DATA_LOOKUP_DEFAULT_LIMIT = 3;
export const DATA_LOOKUP_MAX_LIMIT = 10;
export const DATA_RULES_PER_COMPONENT = 12;

export interface DataLookupComponent {
  id: string;
  version: string;
  capabilities: string[];
  rules: string[];
  truncated: boolean;
}

export interface DataLookupResult {
  available: boolean;
  topic: string | null;
  components: DataLookupComponent[];
  checkedCapabilities: string[];
  note: string;
  totalTrusted: number;
  rejected: Array<{ id: string; version: string; code: string }>;
}

export interface DataLookupArgs {
  topic?: string;
  limit?: number;
}

function toComponent(selection: TrustedSelection, id: string, version: string): DataLookupComponent {
  const contract = inspectTrustedComponent(selection, id, version);
  const rules = contract.invariants.slice(0, DATA_RULES_PER_COMPONENT);
  return {
    id: contract.id,
    version: contract.version,
    capabilities: [...contract.capabilities],
    rules,
    truncated: contract.invariants.length > rules.length,
  };
}

/**
 * Retrieve available registry-backed data intelligence.
 * Topic search uses the same trust gate as every other lookup; the
 * topic-free form returns the data-relevant capability subset.
 * Never fabricates rules for unmatched topics.
 */
export function dataLookup(selection: TrustedSelection, args: DataLookupArgs): DataLookupResult {
  const limitRaw = args.limit ?? DATA_LOOKUP_DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(DATA_LOOKUP_MAX_LIMIT, Math.floor(limitRaw)));
  const topic = args.topic !== undefined && args.topic.trim().length > 0 ? args.topic.trim() : null;
  const rejected = selection.rejected.map(({ id, version, code }) => ({ id, version, code }));

  if (topic !== null) {
    const found = searchTrusted(selection, { query: topic, limit });
    const components = found.components.map((summary) => toComponent(selection, summary.id, summary.version));
    if (components.length > 0) {
      return {
        available: true,
        topic,
        components,
        checkedCapabilities: [...DATA_CAPABILITY_HINTS],
        note:
          `Registry-backed data context from ${components.length} verified ` +
          `component(s) matching ${JSON.stringify(topic)}. Rules are manifest ` +
          `invariants with currently valid evidence; nothing was invented.`,
        totalTrusted: selection.trusted.length,
        rejected,
      };
    }
    return {
      available: false,
      topic,
      components: [],
      checkedCapabilities: [...DATA_CAPABILITY_HINTS],
      note:
        `No registry-backed data intelligence matches ${JSON.stringify(topic)}. ` +
        `Only manifest-backed schema and business-rule context with currently ` +
        `valid evidence is served; no rules were invented for this topic.`,
      totalTrusted: selection.trusted.length,
      rejected,
    };
  }

  const relevant = selection.trusted
    .filter((manifest) => manifest.capabilities.some((cap) => DATA_CAPABILITY_HINTS.includes(cap)))
    .slice(0, limit);
  const components = relevant.map((manifest) => toComponent(selection, manifest.id, manifest.version));
  if (components.length > 0) {
    return {
      available: true,
      topic: null,
      components,
      checkedCapabilities: [...DATA_CAPABILITY_HINTS],
      note:
        `Registry-backed data context from ${components.length} verified ` +
        `component(s) covering schema and business-rule capabilities. Rules ` +
        `are manifest invariants with currently valid evidence.`,
      totalTrusted: selection.trusted.length,
      rejected,
    };
  }
  return {
    available: false,
    topic: null,
    components: [],
    checkedCapabilities: [...DATA_CAPABILITY_HINTS],
    note:
      'No registry-backed data intelligence is currently available: no trusted ' +
      'component covers the data capabilities. Nothing was invented.',
    totalTrusted: selection.trusted.length,
    rejected,
  };
}
