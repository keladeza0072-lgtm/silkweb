#!/usr/bin/env node
/**
 * Offline MCP discovery demo: uses the actual verified-only registry tool.
 * Never contacts Meta or modifies source, projects, or certificates.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const serverFile = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const client = new Client({ name:'silkweb-discovery-demo',version:'0.1.0' });
const transport = new StdioClientTransport({ command:process.execPath,args:[serverFile] });

async function search(args) {
  const result = await client.callTool({name:'search_verified_components',arguments:args});
  assert.notEqual(result.isError,true,'MCP discovery returned error');
  const text = result.content.find(c=>c.type==='text')?.text;
  assert.ok(text,'MCP discovery missing text');
  return JSON.parse(text);
}
try {
  await client.connect(transport);
  const query = 'concurrent bookings with retries API';
  const results = await search({
    query,
    nodeVersion:'24.15.0',
    installedDependencies:{zod:'4.6.7'},
    limit:5,
  });
  process.stdout.write('=== PHASE 2 VERIFIED DISCOVERY (NO MODEL CALLS) ===\n');
  process.stdout.write('Task: '+query+'\n');
  process.stdout.write('Target: Node v24.15.0, zod@4.6.7\n');
  process.stdout.write('Trusted catalog total: '+results.totalTrusted+'\n');
  for (const [index,component] of results.components.entries()) {
    process.stdout.write(
      (index+1)+'. '+component.id+'@'+component.version+
      '  match-score='+String(component.match?.score ?? 'unranked')+
      '  signals='+String(component.match?.signals?.join(',') ?? 'none')+'\n',
    );
  }
  const incompatible=await search({
    query, nodeVersion:'23.9.0',installedDependencies:{zod:'4.6.7'},
  });
  process.stdout.write('Incompatible Node 23 results: '+incompatible.components.length+'\n');
  const unrelated=await search({query:'interplanetary coffee roasting API'});
  process.stdout.write('Unrelated task results: '+unrelated.components.length+'\n');
  const matches=results.components.some(c=>c.id==='booking-reservation-kernel' && c.version==='0.2.0');
  assert.ok(matches,'Certified reservation kernel not discovered');
  assert.equal(incompatible.components.length,0,'Incompatible runtime was not excluded');
  assert.equal(unrelated.components.length,0,'Unrelated task was incorrectly matched');
  process.stdout.write('PASS: Ranked, compatible, certified-only discovery demonstrated.\n');
} catch (error) {
  process.stderr.write('FAIL discovery demo: '+String(error)+'\n');
  process.exitCode=1;
} finally {
  await client.close();
}
