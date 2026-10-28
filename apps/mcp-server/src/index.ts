import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
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
        'When implementing features such as booking schemas, validation, scheduling guards, ' +
        'or other reusable logic, consider searching Silk Web for existing verified components ' +
        'before writing equivalent code. Returns only components with currently valid evidence. ' +
        'Supports optional exact stack, AND-semantics capabilities, and case-insensitive query. ' +
        'Inspect promising matches before reuse. Results use deterministic (id, version) order. ' +
        'Read-only; no code execution or AI calls.',
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
        'After discovering a candidate component, inspect its exact id and version to determine ' +
        'whether its contract fits the task. Returns invariants, dependencies, runtime requirements, ' +
        'verification status, evidence, executed test scope, and known limitations. ' +
        'Review compatibility and limitations before retrieving or reusing source. ' +
        'Fails closed for missing, unverified, stale, or invalid components. Read-only.',
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
        'After inspecting and selecting a suitable verified component, retrieve its source ' +
        'by exact id and version for integration into the coding task. Returns bounded source ' +
        'with required local dependencies and repo-relative paths. Retrieval does not modify ' +
        'project files; the coding agent must integrate and test the implementation. ' +
        'Fails closed for missing, unverified, stale, or invalid components and never reads ' +
        'outside allowlisted component sources, including experiments or harness files.',
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
