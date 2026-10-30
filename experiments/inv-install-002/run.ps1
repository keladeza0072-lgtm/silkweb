# INV-INSTALL-002: one explicit paid Muse session, NO automatic retries.
# R: manual certified-source retrieval. I: opt-in deterministic install tool.
# Both run the SAME frozen task, model, steps, starter and MCP Librarian.
param(
  [Parameter(Mandatory=$true)][ValidateSet("R","I")][string]$Condition,
  [ValidateRange(1,90)][int]$MaxModelSteps=55
)
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root=Join-Path $HOME "Projects/inv-install-002-20261030"
$op=Join-Path $root "operator"
$metaFile=Join-Path $op "preflight.json"
function Refuse([string]$msg){throw "INV-INSTALL-002 REFUSED: $msg"}
if(-not(Test-Path $metaFile)){Refuse "No frozen offline preflight"}
$meta=Get-Content $metaFile -Raw | ConvertFrom-Json
if($meta.benchmark -ne "INV-INSTALL-002" -or $meta.root -ne $root -or
  $meta.sourceRepo -ne $repo){Refuse "Wrong benchmark workspace"}
$workspace=Join-Path $root $Condition
$candidate=$meta.candidates.PSObject.Properties[$Condition].Value
if($candidate.workspace -ne $workspace){Refuse "Candidate binding changed"}
$runFile=Join-Path $op ("run-"+$Condition+".json")
$outFile=Join-Path $op ("muse-"+$Condition+".jsonl")
$errFile=Join-Path $op ("muse-"+$Condition+".stderr.log")
$buildOut=Join-Path $op ("build-"+$Condition+".stdout.log")
$buildErr=Join-Path $op ("build-"+$Condition+".stderr.log")
$evaluation=Join-Path $op ("evaluation-"+$Condition+".json")
$auditPath=$meta.auditLogs.PSObject.Properties[$Condition].Value
foreach($p in @($runFile,$outFile,$errFile,$buildOut,$buildErr,$evaluation,$auditPath)){
  if(Test-Path $p){Refuse "Existing run output: $p; never overwrite or retry"}
}
if($Condition -eq "I"){
  $rFile=Join-Path $op "run-R.json"
  if(-not(Test-Path $rFile)){Refuse "Manual retrieval condition R must run first"}
  $recordR=Get-Content $rFile -Raw | ConvertFrom-Json
  if($recordR.stage -ne "evaluated"){Refuse "R has not completed evaluation"}
  if($recordR.maxModelSteps -ne $MaxModelSteps -or
      $recordR.model -ne "muse-spark-1.3" -or
      $recordR.reasoningEffort -ne "high"){
    Refuse "Must use R's identical Muse model and step policy"}
}
$head=(& git -C $repo rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $head -ne $meta.sourceCommit){
  Refuse "Benchmark source commit drift"}
$dirty=@(& git -C $repo status --porcelain)
if($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0){Refuse "Benchmark source checkout dirty"}
foreach($entry in $meta.pinnedSha256.PSObject.Properties){
  $p=Join-Path $repo $entry.Name.Replace("/","\")
  if(-not(Test-Path $p)){Refuse "Frozen input missing: $($entry.Name)"}
  $digest=(Get-FileHash $p -Algorithm SHA256).Hash.ToLowerInvariant()
  if($digest -ne $entry.Value){Refuse "Frozen input changed: $($entry.Name)"}
}
$promptDigest=(Get-FileHash $meta.taskPath -Algorithm SHA256).Hash.ToLowerInvariant()
if($promptDigest -ne $meta.taskSha256){Refuse "Prompt modified after preparation"}
$evalDigest=(Get-FileHash $meta.evaluatorPath -Algorithm SHA256).Hash.ToLowerInvariant()
if($evalDigest -ne $meta.evaluatorSha256){Refuse "Independent evaluator changed"}
$baseline=(& git -C $workspace rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $baseline -ne $candidate.initialCommit){
  Refuse "Initial candidate commit not unchanged"}
$modified=@(& git -C $workspace status --porcelain)
if($LASTEXITCODE -ne 0 -or $modified.Count -gt 0){Refuse "Candidate starter already modified"}
if(Test-Path (Join-Path $workspace "src/server.ts")){Refuse "Candidate source already present"}
if(-not(Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))){
  Refuse "Run npm.cmd ci in candidate first"}
$configRoot=$meta.configRoots.PSObject.Properties[$Condition].Value
$settings=Get-Content (Join-Path $configRoot "muse/settings.json") -Raw | ConvertFrom-Json
$expectedMcp=Join-Path $repo "apps/mcp-server/dist/index.js"
$expectedInstall=if($Condition -eq "I"){"1"}else{"0"}
if(@($settings.mcpServers.PSObject.Properties).Count -ne 1 -or
   $settings.mcpServers.silkweb.args.Count -ne 1 -or
   $settings.mcpServers.silkweb.args[0] -ne $expectedMcp -or
   $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
   $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $auditPath -or
   $settings.mcpServers.silkweb.env.SILKWEB_ALLOW_INSTALL -ne $expectedInstall -or
   $settings.mcpServers.silkweb.env.SILKWEB_TARGET_WORKSPACE -ne $workspace){
   Refuse "MCP must be enabled on BOTH; only I gets installer permission"}
if(-not(Test-Path $expectedMcp)){Refuse "MCP server must be built"}
if(-not(Get-Command muse.cmd -ErrorAction SilentlyContinue)){
  Refuse "Muse CLI unavailable"}
$auth=Join-Path $configRoot "muse/auth.json"
if(-not(Test-Path $auth) -and [string]::IsNullOrWhiteSpace($env:META_API_KEY)){
  Refuse "Muse authentication missing"}
$session=[guid]::NewGuid().ToString()
$record=[ordered]@{
  benchmark="INV-INSTALL-002";condition=$Condition;stage="launched"
  model="muse-spark-1.3";provider="meta";reasoningEffort="high"
  maxModelSteps=$MaxModelSteps;mcpEnabled=$true
  deterministicInstallEnabled=($Condition -eq "I")
  sessionId=$session;sourceCommit=$head;taskSha256=$promptDigest
  evaluatorSha256=$evalDigest;initialCommit=$baseline
  startedAt=(Get-Date).ToUniversalTime().ToString("o")
  museExitCode=$null;codingSeconds=$null
}
$record|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 $runFile
$flags=@(
  "exec","--json","--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic","--workspace",$workspace,"--trust-workspace",
  "--reasoning-effort","high","--max-model-steps",[string]$MaxModelSteps,
  "--no-parallel-tool-calls","--disable-web-tools","--disable-reminders",
  "--no-foreign-personal-context","--disable-request-user-input",
  "--approval-mode","never","--approval-judge","off",
  "--session-id",$session,"--prompt-file",$meta.taskPath
)
Write-Host "=== INV-INSTALL-002 $Condition MUSE SPARK 1.3/HIGH ==="
Write-Host "Silk Web verified MCP: True"
Write-Host "Deterministic install permitted: $($Condition -eq 'I')"
Write-Host "Frozen task SHA256: $promptDigest"
Write-Host "Paid Muse coding starts; $MaxModelSteps steps is NOT a credit cap"
$oldXdg=$env:XDG_CONFIG_HOME
$prior=$ErrorActionPreference
$timer=[Diagnostics.Stopwatch]::StartNew()
$museExit=$null
try{
  $env:XDG_CONFIG_HOME=$configRoot
  Push-Location $workspace
  try{
    $ErrorActionPreference="Continue"
    & muse.cmd @flags 1> $outFile 2> $errFile
    $museExit=$LASTEXITCODE
  }finally{Pop-Location}
}finally{
  $ErrorActionPreference=$prior
  $timer.Stop()
  if($null -eq $oldXdg){Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue}
  else{$env:XDG_CONFIG_HOME=$oldXdg}
}
foreach($f in @($outFile,$errFile)){
  if(Test-Path $f){
    $body=Get-Content $f -Raw
    [IO.File]::WriteAllText($f,$body,(New-Object System.Text.UTF8Encoding($false)))
  }
}
$record.museExitCode=$museExit
$record.codingSeconds=[math]::Round($timer.Elapsed.TotalSeconds,3)
$record.stage="muse-completed"
$record.finishedAt=(Get-Date).ToUniversalTime().ToString("o")
$record|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 $runFile
Write-Host "MUSE DONE: condition=$Condition exit=$museExit codingSeconds=$($record.codingSeconds)"
if($museExit -ne 0){
  $record.stage="evaluated";$record.quality=0;$record.buildExitCode=$null
  $record.evaluatorExitCode=$null
  $record|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 $runFile
  Write-Host "Muse failed. No automatic retry or inferred quality."
  exit 1
}
$dist=Join-Path $workspace "dist"
if(Test-Path $dist){Remove-Item $dist -Recurse -Force}
$buildExit=$null
Push-Location $workspace
try{
  $prior=$ErrorActionPreference
  try{
    $ErrorActionPreference="Continue"
    & npm.cmd run build 1> $buildOut 2> $buildErr
    $buildExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$prior}
}finally{Pop-Location}
$record.buildExitCode=$buildExit
$record.stage="built"
$record|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 $runFile
Write-Host "BUILD DONE: condition=$Condition exit=$buildExit"
$evalExit=$null
if($buildExit -eq 0){
  $prior=$ErrorActionPreference
  try{
    $ErrorActionPreference="Continue"
    & node $meta.evaluatorPath --workspace $workspace --report $evaluation
    $evalExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$prior}
}
$record.quality=0;$record.passedChecks=0;$record.totalChecks=20
$record.evaluatorExitCode=$evalExit
if(Test-Path $evaluation){
  $result=Get-Content $evaluation -Raw|ConvertFrom-Json
  $record.quality=$result.score
  $record.passedChecks=$result.passedChecks
  $record.totalChecks=$result.expectedChecks
}
$record.stage="evaluated"
$record|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 $runFile
Write-Host "INV-INSTALL-002 $Condition quality=$($record.quality)/100 checks=$($record.passedChecks)/20"
Write-Host "Run record: $runFile"
Write-Host "No reruns and no historical evaluator modifications."
if($buildExit -ne 0 -or $evalExit -ne 0){exit 1}
