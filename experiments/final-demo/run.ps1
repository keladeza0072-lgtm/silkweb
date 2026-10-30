# SILKWEB-DEMO-001: ONE EXPLICIT BILLABLE MUSE RUN. Not invoked by prepare/CI.
param([ValidateRange(1,50)][int]$MaxModelSteps=30)
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root=Join-Path $HOME "Projects/silkweb-final-demo-20261030"
$op=Join-Path $root "operator"
$metaPath=Join-Path $op "preflight.json"
function Refuse([string]$reason){throw "SILKWEB-DEMO-001 REFUSED: $reason"}
if(-not(Test-Path $metaPath)){Refuse "Offline preparation missing"}
$info=Get-Content $metaPath -Raw | ConvertFrom-Json
if($info.trial -ne "SILKWEB-DEMO-001" -or $info.sourceRepo -ne $repo -or $info.root -ne $root){Refuse "Wrong demo metadata"}
$recordPath=Join-Path $op "run.json"
$stdout=Join-Path $op "muse.jsonl"
$stderr=Join-Path $op "muse.stderr.log"
$buildOut=Join-Path $op "build.stdout.log"
$buildErr=Join-Path $op "build.stderr.log"
$phase3Path=Join-Path $op "phase3-verification.json"
$phase3Error=Join-Path $op "phase3.stderr.log"
$evaluation=Join-Path $op "evaluation.json"
foreach($file in @($recordPath,$stdout,$stderr,$buildOut,$buildErr,$phase3Path,$phase3Error,$evaluation,$info.auditLog)){
  if(Test-Path $file){Refuse "Existing trial output (no overwrite): $file"}
}
$head=(& git -C $repo rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $head -ne $info.sourceCommit){Refuse "Source commit changed"}
$dirty=@(& git -C $repo status --porcelain)
if($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0){Refuse "Source checkout dirty"}
foreach($entry in $info.pinnedSha256.PSObject.Properties){
  $file=Join-Path $repo $entry.Name.Replace("/","\")
  if(-not(Test-Path $file)){Refuse "Pinned file missing: $($entry.Name)"}
  $sha=(Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
  if($sha -ne $entry.Value){Refuse "Pinned input modified: $($entry.Name)"}
}
$promptSha=(Get-FileHash -Algorithm SHA256 $info.promptPath).Hash.ToLowerInvariant()
if($promptSha -ne $info.promptSha256){Refuse "Frozen prompt changed"}
$workspace=$info.candidate
$initial=(& git -C $workspace rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $initial -ne $info.starterCommit){Refuse "Starter changed"}
$changes=@(& git -C $workspace status --porcelain)
if($LASTEXITCODE -ne 0 -or $changes.Count -ne 0){Refuse "Candidate already modified"}
if((Test-Path (Join-Path $workspace "src/silkweb")) -or (Test-Path (Join-Path $workspace ".silkweb"))){Refuse "Candidate already installed"}
if(-not(Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))){Refuse "Run npm.cmd ci in candidate first"}
if(-not(Test-Path $info.mcpEntry)){Refuse "MCP build missing"}
if(-not(Test-Path $info.cli)){Refuse "Installer CLI missing"}
$settings=Get-Content (Join-Path $info.configRoot "muse/settings.json") -Raw | ConvertFrom-Json
if($settings.mcpServers.silkweb.args[0] -ne $info.mcpEntry -or
 $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
 $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $info.auditLog){Refuse "MCP wiring drift"}
if(-not(Test-Path (Join-Path $info.configRoot "muse/auth.json")) -and [string]::IsNullOrWhiteSpace($env:META_API_KEY)){Refuse "Missing isolated Muse authentication"}
if(-not(Get-Command muse.cmd -ErrorAction SilentlyContinue)){Refuse "Muse CLI unavailable"}
$session=[guid]::NewGuid().ToString()
$record=[ordered]@{
  trial="SILKWEB-DEMO-001";classification="GUIDED_FINAL_PRODUCT_DEMO_NOT_A_B"
  stage="launched";model="muse-spark-1.3";provider="meta";reasoningEffort="high"
  maxModelSteps=$MaxModelSteps;mcpEnabled=$true;sourceCommit=$head
  starterCommit=$initial;promptSha256=$promptSha;sessionId=$session
  startedAt=(Get-Date).ToUniversalTime().ToString("o")
}
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
$flags=@(
 "exec","--json","--provider","meta","--model","muse-spark-1.3",
 "--preset","native-basic","--workspace",$workspace,"--trust-workspace",
 "--reasoning-effort","high","--max-model-steps",[string]$MaxModelSteps,
 "--no-parallel-tool-calls","--disable-web-tools","--disable-reminders",
 "--no-foreign-personal-context","--disable-request-user-input",
 "--approval-mode","never","--approval-judge","off",
 "--session-id",$session,"--prompt-file",$info.promptPath
)
Write-Host "=== ONE BILLABLE SILKWEB-DEMO-001 MUSE SPARK 1.3/HIGH SESSION ==="
Write-Host "Max steps: $MaxModelSteps (NOT A HARD DOLLAR CAP); no automatic retries."
$priorXdg=$env:XDG_CONFIG_HOME
$oldErrorPreference=$ErrorActionPreference
$timer=[Diagnostics.Stopwatch]::StartNew()
$museExit=$null
try{
  $env:XDG_CONFIG_HOME=$info.configRoot
  Push-Location $workspace
  try{
    $ErrorActionPreference="Continue"
    & muse.cmd @flags 1> $stdout 2> $stderr
    $museExit=$LASTEXITCODE
  }finally{Pop-Location}
}finally{
  $ErrorActionPreference=$oldErrorPreference
  $timer.Stop()
  if($null -eq $priorXdg){Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue}
  else{$env:XDG_CONFIG_HOME=$priorXdg}
}
$record.stage="muse-completed"
$record.museExitCode=$museExit
$record.codingSeconds=[math]::Round($timer.Elapsed.TotalSeconds,3)
$record.finishedAt=(Get-Date).ToUniversalTime().ToString("o")
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host "MUSE DONE: exit=$museExit codingSeconds=$($record.codingSeconds)"
Push-Location $workspace
try{
 $pref=$ErrorActionPreference
 try{
  $ErrorActionPreference="Continue"
  & npm.cmd run build 1> $buildOut 2> $buildErr
  $buildExit=$LASTEXITCODE
 }finally{$ErrorActionPreference=$pref}
}finally{Pop-Location}
$record.buildExitCode=$buildExit
$record.stage="build-completed"
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host "BUILD: exit=$buildExit"
$pref=$ErrorActionPreference
try{
 $ErrorActionPreference="Continue"
 & node $info.cli verify-integration booking-reservation-kernel@0.2.0 --project $workspace --entry src/server.ts --test tests/booking-integration.test.mjs --json 1> $phase3Path 2> $phase3Error
 $phase3Exit=$LASTEXITCODE
}finally{$ErrorActionPreference=$pref}
$record.phase3ExitCode=$phase3Exit
$record.stage="phase3-completed"
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host "PHASE 3 VALIDATION: exit=$phase3Exit"
$pref=$ErrorActionPreference
try{
 $ErrorActionPreference="Continue"
 & node (Join-Path $PSScriptRoot "evaluate.mjs")
 $evaluationExit=$LASTEXITCODE
}finally{$ErrorActionPreference=$pref}
$record.evaluationExitCode=$evaluationExit
$record.stage="evaluated"
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host "INDEPENDENT DEMO EVALUATION: exit=$evaluationExit"
Write-Host "Preserve all evidence. Never silently rerun this attempt."
