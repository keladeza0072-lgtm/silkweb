import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * Opt-in MCP audit events. Disabled unless SILKWEB_AUDIT_LOG is set.
 * A successful retrieval records file names, sizes, and SHA-256 digests
 * (NOT source text). Stored outside agent workspaces for independent
 * comparison with actual integrated source and Muse session traces.
 */
export interface AuditEvent {
  tool: 'search_verified_components' | 'inspect_verified_component' | 'get_verified_component_source' | 'install_verified_component';
  status: 'success' | 'failure';
  component?: string;
  query?: string;
  capabilities?: string[];
  totalTrusted?: number;
  resultIds?: string[];
  verificationSourceHash?: string;
  truncated?: boolean;
  files?: Array<{ path: string; chars: number; sha256: string; truncated: boolean }>;
  installStatus?: 'dry-run' | 'installed-source';
  installedFileCount?: number;
  errorCode?: string;
}

let sequence = 0;

export function auditEvent(record: AuditEvent): void {
  const configured = process.env.SILKWEB_AUDIT_LOG;
  if (!configured) return;
  if (!isAbsolute(configured)) {
    throw new Error('SILKWEB_AUDIT_LOG must be an absolute path outside agent workspaces');
  }
  const file = resolve(configured);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    sequence: ++sequence,
    ...record,
  }) + '\n', 'utf8');
}

export function sourceDigest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
