#!/usr/bin/env node
/**
 * Prepare isolated Muse MCP settings with NO model inference.
 *
 * Does not read/copy/modify personal Muse settings or credentials.
 * B has no configured servers; C has only the frozen local Silk Web MCP.
 * An operator must subsequently run Muse's echo provider to verify that
 * the actual installed Muse Code honors XDG_CONFIG_HOME on this OS.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(m) { throw new Error('RES-001 MCP SETUP: ' + m); }
const opts = process.argv.slice(2);
if (opts.length !== 2 || opts[0] !== '--root' || !isAbsolute(opts[1])) {
  fail('usage: node experiments/harness/res001-configure-mcp.mjs --root ABSOLUTE_PREPARED_ROOT');
}
const root = resolve(opts[1]);
const sourceRepo = fileURLToPath(new URL('../../', import.meta.url));
const operator = join(root, 'operator');
const preflight = join(operator, 'preflight.json');
if (!existsSync(preflight)) fail('missing preparation record; run res001-prepare.mjs first');
const info = JSON.parse(readFileSync(preflight, 'utf8'));
if (info.benchmark !== 'RES-001' || !info.conditions?.B || !info.conditions?.C) {
  fail('invalid preflight record');
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
if (git(sourceRepo, 'status', '--porcelain')) fail('source checkout has local changes');
if (git(sourceRepo, 'rev-parse', 'HEAD') !== info.sourceCommit) {
  fail('source changed since preparation; do NOT silently change MCP/evaluator sources');
}
for (const kind of ['B', 'C']) {
  const directory = join(root, kind);
  if (info.conditions[kind].workspace !== directory) fail(kind + ' workspace path mismatch');
  if (!existsSync(directory) || !existsSync(join(directory, 'package-lock.json'))) {
    fail(kind + ' starter missing');
  }
  if (git(directory, 'rev-parse', 'HEAD') !== info.conditions[kind].initialCommit) {
    fail(kind + ' starter HEAD changed');
  }
  if (git(directory, 'status', '--porcelain')) fail(kind + ' starter has local changes');
  if (existsSync(join(directory, '.mcp.json'))) fail(kind + ' has unexpected project MCP config');
}
const mcpEntry = join(sourceRepo, 'apps', 'mcp-server', 'dist', 'index.js');
const registryEntry = join(sourceRepo, 'packages', 'registry', 'dist', 'index.js');
if (!existsSync(mcpEntry) || !existsSync(registryEntry)) {
  fail('MCP or registry build missing: run npm.cmd run check under packages/registry then apps/mcp-server');
}
const bConfig = { schema_version: 1, mcpServers: {} };
const cConfig = {
  schema_version: 1,
  mcpServers: {
    silkweb: {
      type: 'stdio',
      command: process.execPath,
      args: [mcpEntry],
      enabled: true,
      required: true,
      env: {
        SILKWEB_REPO_ROOT: sourceRepo,
        SILKWEB_AUDIT_LOG: info.auditLogForC,
      },
    },
  },
};
const paths = {};
for (const [kind, value] of [['B', bConfig], ['C', cConfig]]) {
  const configRoot = join(operator, 'muse-config-' + kind);
  const dest = join(configRoot, 'muse', 'settings.json');
  if (existsSync(dest)) fail('refusing to overwrite existing config: ' + dest);
  mkdirSync(join(configRoot, 'muse'), { recursive: true });
  writeFileSync(dest, JSON.stringify(value, null, 2) + '\n');
  paths[kind] = configRoot;
}
const out = {
  benchmark: 'RES-001',
  stage: 'MCP settings prepared, echo validation pending, NO model inference',
  preparedSourceCommit: info.sourceCommit,
  configRootB: paths.B,
  configRootC: paths.C,
  visibleServersB: [],
  visibleServersC: ['silkweb'],
  cAuditLog: info.auditLogForC,
};
writeFileSync(join(operator, 'mcp-configuration.json'), JSON.stringify(out, null, 2) + '\n');
process.stdout.write(
  'RES-001 MCP CONFIGURATION PASS\n' +
  'Muse B XDG_CONFIG_HOME: ' + paths.B + '\n' +
  'Muse C XDG_CONFIG_HOME: ' + paths.C + '\n' +
  'B servers: NONE\n' +
  'C servers: silkweb (required, audited)\n' +
  'No personal settings or credentials copied; no inference invoked.\n',
);
