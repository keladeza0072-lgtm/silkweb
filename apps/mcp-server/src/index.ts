import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { auditEvent, sourceDigest } from './audit.js';
import {
  LibrarianError,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SOURCE_DEFAULT_MAX_BYTES_PER_FILE,
  SOURCE_DEFAULT_MAX_TOTAL_BYTES,
  SOURCE_HARD_MAX_BYTES_PER_FILE,
  SOURCE_HARD_MAX_TOTAL_BYTES,
  inspectTrustedComponent,
  searchTrusted,
  selectTrustedComponents,
  sourceTrustedComponent,
} from './librarian.js';

const componentSummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  stack: z.string(),
  summary: z.string(),
});

const searchOutputSchema = z.object({
  components: z.array(componentSummarySchema),
  totalTrusted: z.number(),
  rejected: z.array(z.object({ id: z.string(), version: z.string(), code: z.string() })),
});

const contractOutputSchema = z.object({
  id: z.string(),
  version: z.string(),
  sourcePath: z.string(),
  capabilities: z.array(z.string()),
  invariants: z.array(z.string()),
  dependencies: z.array(z.object({ id: z.string(), version: z.string() })),
  runtime: z.object({
    stack: z.string(),
    node: z.string(),
    dependencies: z.record(z.string(), z.string()),
  }),
  verification: z.object({
    status: z.string(),
    testCommand: z.string(),
    sourceHash: z.string().optional(),
    evidence: z.string(),
  }),
  evidence: z.record(z.string(), z.unknown()),
  testScope: z.object({
    command: z.string(),
    commandKey: z.string(),
    files: z.array(z.string()),
    limitations: z.string(),
  }),
  limitations: z.string(),
});

const sourceOutputSchema = z.object({
  id: z.string(),
  version: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      bytes: z.number(),
      truncated: z.boolean(),
      content: z.string(),
    }),
  ),
  totalBytes: z.number(),
  truncated: z.boolean(),
});

function toToolError(error: unknown): Error {
  if (error instanceof LibrarianError) return new Error(`[${error.code}] ${error.message}`);
  return new Error(`[LIBRARIAN_ERROR] ${error instanceof Error ? error.message : String(error)}`);
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'silkweb', version: '0.1.0' });

  server.registerTool(
    'ping',
    {
      description: 'Read-only Silk Web connectivity check; makes no API calls.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        ok: z.literal(true),
        service: z.literal('silkweb'),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const output = { ok: true as const, service: 'silkweb' as const };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'search_verified_components',
    {
      description:
        'Search ONLY verified registry components with currently valid evidence. ' +
        'Optional exact stack, AND-semantics capabilities, and conservative natural-language aliases ' +
        'for booking, reservation and appointment queries. ' +
        'Deterministic (id, version) order. Never executes code or AI calls.',
      inputSchema: z.object({
        capabilities: z.array(z.string().min(1)).optional(),
        stack: z.string().min(1).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
      }),
      outputSchema: searchOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const selection = await selectTrustedComponents();
        const output = searchTrusted(selection, args);
        auditEvent({
          tool: 'search_verified_components',
          status: 'success',
          query: args.query?.slice(0, 160),
          capabilities: args.capabilities,
          totalTrusted: output.totalTrusted,
          resultIds: output.components.map(item => item.id + '@' + item.version),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error: unknown) {
        throw toToolError(error);
      }
    },
  );

  server.registerTool(
    'inspect_verified_component',
    {
      description:
        'Return the contract of exactly one verified component (exact id and version): ' +
        'invariants, dependencies, runtime requirements, verification status, actual evidence ' +
        'metadata, executed test scope, and known limitations. Fails closed for missing, ' +
        'unverified, stale, or invalid components. Read-only; never executes code.',
      inputSchema: z.object({
        id: z.string().min(1),
        version: z.string().min(1),
      }),
      outputSchema: contractOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const selection = await selectTrustedComponents();
        const output = inspectTrustedComponent(selection, args.id, args.version);
        auditEvent({
          tool: 'inspect_verified_component',
          status: 'success',
          component: args.id + '@' + args.version,
          verificationSourceHash: output.verification.sourceHash,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error: unknown) {
        throw toToolError(error);
      }
    },
  );

  server.registerTool(
    'get_verified_component_source',
    {
      description:
        'Return bounded source code for exactly one verified component, including required ' +
        'local source dependencies, with repo-relative file paths. Fails closed — no source ' +
        'is returned for missing, unverified, stale, or invalid components, and paths ' +
        'outside the allowlisted component sources (including experiments/harness) are never read.',
      inputSchema: z.object({
        id: z.string().min(1),
        version: z.string().min(1),
        maxBytesPerFile: z
          .number()
          .int()
          .min(1)
          .max(SOURCE_HARD_MAX_BYTES_PER_FILE)
          .default(SOURCE_DEFAULT_MAX_BYTES_PER_FILE),
        maxTotalBytes: z
          .number()
          .int()
          .min(1)
          .max(SOURCE_HARD_MAX_TOTAL_BYTES)
          .default(SOURCE_DEFAULT_MAX_TOTAL_BYTES),
      }),
      outputSchema: sourceOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const selection = await selectTrustedComponents();
        const output = sourceTrustedComponent(selection, args.id, args.version, args);
        auditEvent({
          tool: 'get_verified_component_source',
          status: 'success',
          component: args.id + '@' + args.version,
          truncated: output.truncated,
          files: output.files.map(file => ({
            path: file.path,
            chars: file.bytes,
            sha256: sourceDigest(file.content),
            truncated: file.truncated,
          })),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error: unknown) {
        throw toToolError(error);
      }
    },
  );

  return server;
}

// Important: stdout is reserved exclusively for JSON-RPC messages.
// In particular, never use console.log in the MCP server.
void serveStdio(createServer);
