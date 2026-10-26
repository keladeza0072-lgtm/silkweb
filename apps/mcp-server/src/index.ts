import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

function createServer(): McpServer {
  const server = new McpServer({ name: 'silkweb', version: '0.1.0' });

  server.registerTool(
    'ping',
    {
      description: 'Read-only Silk Web connectivity check; makes no API calls.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        ok: z.literal(true),
        service: z.literal('silkweb')
      }),
      annotations: { readOnlyHint: true }
    },
    async () => {
      const output = { ok: true as const, service: 'silkweb' as const };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output
      };
    }
  );

  return server;
}

// Important: stdout is reserved exclusively for JSON-RPC messages.
// In particular, never use console.log in the MCP server.
void serveStdio(createServer);

