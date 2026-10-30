import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,symlinkSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after,test} from 'node:test';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const server=join(repo,'apps/mcp-server/dist/index.js');
const certified=join(repo,'packages/registry/src/inventory.ts');
const originalBytes=readFileSync(certified);
const originalHash=createHash('sha256').update(originalBytes).digest('hex');
assert.equal(originalHash,'3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0');
const cleanup=[];
after(()=>{for(const path of cleanup)rmSync(path,{recursive:true,force:true});});
function project(){
  const root=mkdtempSync(join(tmpdir(),'silkweb-mcp-install-'));
  cleanup.push(root);
  writeFileSync(join(root,'package.json'),JSON.stringify({
    name:'mcp-installer-target',private:true,type:'module',
    dependencies:{},
  }));
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify({
    compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',
      rootDir:'src',outDir:'dist'},
    include:['src/**/*.ts'],
  }));
  return root;
}
async function withClient(root,options,fn){
  const client=new Client({name:'mcp-install-isolation-test',version:'0.1.0'});
  const env={...process.env,
    SILKWEB_ALLOW_INSTALL: options.enabled?'1':'0',
    SILKWEB_TARGET_WORKSPACE:root,
    SILKWEB_REPO_ROOT:repo,
    SILKWEB_AUDIT_LOG:options.audit??join(root,'audit.jsonl'),
  };
  const transport=new StdioClientTransport({
    command:process.execPath,args:[server],env,
  });
  await client.connect(transport);
  try{return await fn(client);}
  finally{await client.close();}
}
async function call(client,args){
  const r=await client.callTool({name:'install_verified_component',
    arguments:{id:'inventory-reservation',version:'0.1.0',...args}});
  let body={};
  try{body=JSON.parse(r.content?.find(c=>c.type==='text')?.text??'{}');}
  catch{body={};}
  return {error:r.isError===true,body,raw:String(r.content?.[0]?.text??'')};
}
test('tool is NOT advertised unless explicitly enabled; original four tools remain',async()=>{
  const root=project();
  await withClient(root,{enabled:false},async client=>{
    const listed=await client.listTools();
    assert.deepEqual(listed.tools.map(t=>t.name).sort(),[
      'get_verified_component_source','inspect_verified_component',
      'ping','search_verified_components',
    ]);
    assert(!existsSync(join(root,'src')));
  });
});
test('enabled dry-run advertises tool and writes NOTHING',async()=>{
  const root=project();
  await withClient(root,{enabled:true},async client=>{
    const listed=await client.listTools();
    assert.equal(listed.tools.length,5);
    assert(listed.tools.some(t=>t.name==='install_verified_component'));
    const r=await call(client,{dryRun:true});
    assert.equal(r.error,false,r.raw);
    assert.equal(r.body.status,'dry-run');
    assert.equal(r.body.component,'inventory-reservation@0.1.0');
    assert.deepEqual(r.body.files.map(f=>f.path),['src/silkweb/inventory.ts']);
    assert.equal(r.body.files[0].sha256,originalHash);
    assert(!existsSync(join(root,'src')));
    assert(!existsSync(join(root,'.silkweb')));
  });
});
test('real deterministic MCP install is byte-identical, audited, and repeat-safe',async()=>{
  const root=project();
  await withClient(root,{enabled:true},async client=>{
    const first=await call(client,{dryRun:false});
    assert.equal(first.error,false,first.raw);
    assert.equal(first.body.status,'installed-source');
    assert.equal(first.body.files.length,1);
    assert.equal(first.body.files[0].action,'create');
    assert.deepEqual(readFileSync(join(root,'src/silkweb/inventory.ts')),originalBytes);
    const auditPath=join(root,'.silkweb/installations/inventory-reservation@0.1.0.json');
    assert(existsSync(auditPath));
    const report=JSON.parse(readFileSync(auditPath,'utf8'));
    assert.equal(report.certifiedSourceHash,
      'd3fb569a111d1856ad5031e1271cd7059d4eb7d3432d0692cc3756c6c889f5cf');
    assert.equal(report.files[0].sha256,originalHash);
    const repeat=await call(client,{});
    assert.equal(repeat.error,false,repeat.raw);
    assert.equal(repeat.body.status,'installed-source');
    assert.equal(repeat.body.files[0].action,'unchanged');
    assert.deepEqual(readFileSync(join(root,'src/silkweb/inventory.ts')),originalBytes);
  });
  const log=readFileSync(join(root,'audit.jsonl'),'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x));
  assert.equal(log.filter(x=>x.tool==='install_verified_component'&&x.status==='success').length,2);
  assert(log.every(x=>!JSON.stringify(x).includes('export function')));
});
test('collision and modified destination fail closed; never overwrite',async()=>{
  const root=project();
  mkdirSync(join(root,'src/silkweb'),{recursive:true});
  const destination=join(root,'src/silkweb/inventory.ts');
  const modified='// This file belongs to the user; no overwrite\n';
  writeFileSync(destination,modified);
  await withClient(root,{enabled:true},async client=>{
    const result=await call(client,{});
    assert.equal(result.error,true);
    assert.match(result.raw,/DESTINATION_CONFLICT/);
  });
  assert.equal(readFileSync(destination,'utf8'),modified);
  assert(!existsSync(join(root,'.silkweb')));
});
test('missing target opt-in and source-repository targets refuse all writes',async()=>{
  const outside=project();
  // Keep MCP audit output OUTSIDE the source checkout even while
  // deliberately attempting a protected-root installation.
  await withClient(repo,{
    enabled:true,
    audit:join(outside,'protected-target-audit.jsonl'),
  },async client=>{
    const r=await call(client,{});
    assert.equal(r.error,true);
    assert.match(r.raw,/PROTECTED_TARGET/);
  });
  await withClient(outside,{enabled:true},async client=>{
    const r=await client.callTool({name:'install_verified_component',arguments:{
      id:'inventory-reservation',version:'999.0.0'}});
    assert.equal(r.isError,true);
    assert.match(String(r.content?.[0]?.text),/COMPONENT_NOT_FOUND/);
    assert(!existsSync(join(outside,'src')));
  });
});
test('symlink target within project is rejected and no outside files are changed',async t=>{
  const root=project();
  const outside=project();
  mkdirSync(join(root,'src'),{recursive:true});
  try{symlinkSync(outside,join(root,'src/silkweb'),process.platform==='win32'?'junction':'dir');}
  catch(e){if(e.code==='EPERM'){t.skip('Symlink privileges unavailable');return;}throw e;}
  await withClient(root,{enabled:true},async client=>{
    const r=await call(client,{});
    assert.equal(r.error,true);
    assert.match(r.raw,/SYMLINK_REJECTED/);
  });
  assert(!existsSync(join(outside,'inventory.ts')));
});
