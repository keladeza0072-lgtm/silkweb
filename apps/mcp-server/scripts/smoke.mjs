import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const serverFile = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const client = new Client({ name: 'silkweb-local-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverFile]
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const ping = listed.tools.find((tool) => tool.name === 'ping');
  assert.ok(ping, 'MCP tools/list did not contain ping');

  const result = await client.callTool({ name: 'ping', arguments: {} });
  assert.notEqual(result.isError, true, 'MCP ping returned an error');

  // Assert the text result for legacy-client interoperability as well as JSON structure.
  const text = result.content.find((block) => block.type === 'text')?.text;
  assert.ok(text, 'MCP ping response did not contain a text block');
  const output = JSON.parse(text);
  assert.deepEqual(output, { ok: true, service: 'silkweb' });
  if (result.structuredContent != null) {
    assert.deepEqual(result.structuredContent, output);
  }

  process.stdout.write(`PASS MCP initialization, tools/list and ping: ${JSON.stringify(output)}\n`);
} catch (error) {
  process.stderr.write(`FAIL MCP local smoke test: ${String(error)}\n`);
  process.exitCode = 1;
} finally {
  await client.close();
}
