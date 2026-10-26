import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestSchema, type RegistryManifest } from './manifest.js';

/**
 * Deterministic registry loader: reads every `*.json` file in a directory
 * (sorted by filename), validates each against the manifest schema, and
 * filters by exact version, stack, capabilities and dependencies.
 *
 * Determinism: directory entries are sorted, output order is always
 * `(id, version)` ascending, and filtering never depends on read order.
 */

export class RegistryLoadError extends Error {
  readonly code = 'REGISTRY_LOAD_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'RegistryLoadError';
  }
}

const byIdThenVersion = (a: RegistryManifest, b: RegistryManifest): number =>
  a.id === b.id ? (a.version < b.version ? -1 : a.version > b.version ? 1 : 0) : a.id < b.id ? -1 : 1;

/**
 * Load and validate every manifest in `dir`. Throws RegistryLoadError
 * naming every file that is unreadable, unparsable, or schema-invalid.
 */
export function loadRegistry(dir: string): RegistryManifest[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch (error: unknown) {
    throw new RegistryLoadError(`cannot read registry dir ${dir}: ${String(error)}`);
  }
  const manifests: RegistryManifest[] = [];
  const failures: string[] = [];
  for (const name of entries) {
    const file = join(dir, name);
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const parsed = manifestSchema.safeParse(raw);
      if (!parsed.success) {
        failures.push(
          `${name}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`,
        );
        continue;
      }
      manifests.push(parsed.data);
    } catch (error: unknown) {
      failures.push(`${name}: ${String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new RegistryLoadError(
      `invalid manifest(s) in ${dir}:\n${failures.join('\n')}`,
    );
  }
  return manifests.sort(byIdThenVersion);
}

export interface RegistryQuery {
  /** Exact id match. */
  id?: string;
  /** Exact version match (no ranges, no semver coercion). */
  version?: string;
  /** Exact stack match (e.g. "node24+sqlite"). */
  stack?: string;
  /** Manifest must provide every listed capability. */
  capabilities?: string[];
  /** Manifest must declare every listed {id, version} dependency exactly. */
  dependencies?: Array<{ id: string; version: string }>;
}

/**
 * Filter manifests by exact version, stack, capabilities and dependencies.
 * Result is sorted by (id, version). All capability/dependency entries must
 * be present (AND semantics); version and stack use exact equality.
 */
export function filterRegistry(
  manifests: readonly RegistryManifest[],
  query: RegistryQuery,
): RegistryManifest[] {
  return manifests
    .filter((manifest) => {
      if (query.id !== undefined && manifest.id !== query.id) return false;
      if (query.version !== undefined && manifest.version !== query.version) return false;
      if (query.stack !== undefined && manifest.runtime.stack !== query.stack) return false;
      if (query.capabilities !== undefined) {
        for (const capability of query.capabilities) {
          if (!manifest.capabilities.includes(capability)) return false;
        }
      }
      if (query.dependencies !== undefined) {
        for (const wanted of query.dependencies) {
          const found = manifest.dependencies.some(
            (declared) => declared.id === wanted.id && declared.version === wanted.version,
          );
          if (!found) return false;
        }
      }
      return true;
    })
    .slice()
    .sort(byIdThenVersion);
}
