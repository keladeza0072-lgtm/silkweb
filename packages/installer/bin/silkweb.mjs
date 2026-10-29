#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InstallError, applyInstall, assertSupportedRuntime, discoverRepoRoot,
  loadRegistryLibrary, planInstall,
} from '../src/install.mjs';
import { verifyIntegration } from '../src/verify.mjs';

const HELP = `Silk Web verified implementation CLI (Node.js 24+)

Usage:
  silkweb install <id@version> [--project <path>] [--into <relative/path>] [--dry-run] [--json]
  silkweb verify-integration <id@version> [--project <path>] [--into <relative/path>]
      [--entry src/your-entry.ts] [--test tests/your-integration.test.mjs] [--json]
  silkweb --help

Options:
  --project <path>       Target project root (default: current directory)
  --into <relative/path> Installed TypeScript source directory (default: src/silkweb)
  --registry-root <path> Explicit Silk Web checkout (normally auto-discovered)
  --entry <path>         Name an application src/*.ts entry for static import reachability
  --test <path>          Explicit target tests/*.test.mjs file, repeat up to 16 times
  --dry-run              Install preview ONLY (no source mutation)
  --json                 Emit machine-readable JSON on stdout

Install preserves certified source bytes and writes an installation audit.
Verify rechecks the certificate and installed hashes, compiles using the
target's existing local TypeScript compiler, and optionally tests the app.

Without --entry AND --test, verify NEVER claims integration-verified.
Behavioral tests must be explicitly selected by the operator.
No npm scripts, shell commands, or paid model calls are executed by this CLI.
`;

function parseArgs(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return null;
  const command=args[0];
  if (!['install','verify-integration'].includes(command) || !args[1] || args[1].startsWith('--')) {
    throw new InstallError('USAGE_ERROR', 'Expected silkweb install|verify-integration <id@version>. Use --help.');
  }
  const result={
    command, spec:args[1],project:process.cwd(),into:'src/silkweb',
    dryRun:false,json:false,tests:[],
  };
  const seen=new Set();
  for(let i=2;i<args.length;i++){
    const token=args[i];
    if(token==='--test'){
      if(command!=='verify-integration'){
        throw new InstallError('USAGE_ERROR','--test is only valid with verify-integration');
      }
      const value=args[++i];
      if(!value||value.startsWith('--')||result.tests.length>=16){
        throw new InstallError('USAGE_ERROR','Invalid --test path or more than 16 selected tests');
      }
      result.tests.push(value);
      continue;
    }
    if(seen.has(token)) throw new InstallError('USAGE_ERROR','Duplicate option: '+token);
    seen.add(token);
    if(token==='--dry-run'){
      if(command!=='install')throw new InstallError('USAGE_ERROR','--dry-run applies to install only');
      result.dryRun=true;
    }else if(token==='--json'){
      result.json=true;
    }else if(['--project','--into','--registry-root','--entry'].includes(token)){
      const value=args[++i];
      if(!value||value.startsWith('--'))throw new InstallError('USAGE_ERROR','Missing value for '+token);
      if(token==='--project')result.project=value;
      else if(token==='--into')result.into=value;
      else if(token==='--registry-root')result.registryRoot=value;
      else if(token==='--entry'){
        if(command!=='verify-integration')throw new InstallError('USAGE_ERROR','--entry applies to verify-integration only');
        result.entry=value;
      }
    }else throw new InstallError('USAGE_ERROR','Unknown option: '+token);
  }
  return result;
}

function printInstall(result, args) {
  if(args.json) {
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }else{
    process.stdout.write(`${result.status}: ${result.component}\n`);
    for(const f of result.files){
      process.stdout.write(`  ${f.action}: ${f.destination} (${f.sha256.slice(0,12)}…)\n`);
    }
    process.stdout.write(`Audit report: ${result.reportPath}${args.dryRun?' (preview only)':''}\n`);
    process.stdout.write('Note: Registry certification verified; target build and application tests not yet verified.\n');
  }
}

function printVerify(result,args){
  if(args.json){
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }else{
    process.stdout.write(`${result.status}: ${result.component}\n`);
    for(const c of result.checks){
      process.stdout.write(`  ${c.passed?'PASS':'FAIL'}: ${c.id}${c.exitCode===undefined?'':' exit='+c.exitCode}\n`);
    }
    process.stdout.write('Assurance: '+result.assurance+'\n');
    if(result.verificationReportPath)process.stdout.write('Verification report: '+result.verificationReportPath+'\n');
  }
  if(!result.passed)process.exitCode=1;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  if(!args){process.stdout.write(HELP);return;}
  assertSupportedRuntime();
  const repoRoot=args.registryRoot
    ? resolve(args.registryRoot):discoverRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const lib=await loadRegistryLibrary(repoRoot);
  if(args.command==='install'){
    const plan=planInstall({
      repoRoot,projectRoot:args.project,spec:args.spec,into:args.into,lib,
    });
    printInstall(applyInstall(plan,{dryRun:args.dryRun}),args);
  }else{
    const result=verifyIntegration({
      repoRoot,projectRoot:args.project,spec:args.spec,into:args.into,
      entry:args.entry,tests:args.tests,lib,
    });
    printVerify(result,args);
  }
}
main().catch(error=>{
  const code=error instanceof InstallError ? error.code:'UNEXPECTED_ERROR';
  process.stderr.write(`silkweb: ${code}: ${error.message}\n`);
  process.exitCode=1;
});
