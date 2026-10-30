# SW-MULTI-001: ONE explicit billable Muse authoring task at a time.
# Never invoked during offline preparation, CI, or independent evaluation.
param(
  [Parameter(Mandatory=$true)][ValidateSet("inventory","webhooks")][string]$Task,
  [ValidateRange(1,70)][int]$MaxModelSteps=35
)
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root=Join-Path $HOME "Projects/silkweb-multidomain-20261030"
$op=Join-Path $root "operator"
$metaPath=Join-Path $op "preflight.json"
function Refuse([string]$reason){throw "SW-MULTI-001 REFUSED: $reason"}
if(-not(Test-Path $metaPath)){Refuse "Offline preparation missing"}
$info=Get-Content $metaPath -Raw | ConvertFrom-Json
if($info.suite -ne "SW-MULTI-001" -or $info.sourceRepo -ne $repo -or $info.root -ne $root){
  Refuse "Wrong frozen authoring suite"
}
$t=$info.tasks.$Task
if($null -eq $t -or $t.candidate -ne (Join-Path $root $Task)){
  Refuse "Invalid task metadata"
}
$workspace=$t.candidate
$recordPath=Join-Path $op ("run-"+$Task+".json")
$stdout=Join-Path $op ("muse-"+$Task+".jsonl")
$stderr=Join-Path $op ("muse-"+$Task+".stderr.log")
$buildOut=Join-Path $op ("build-"+$Task+".stdout.log")
$buildErr=Join-Path $op ("build-"+$Task+".stderr.log")
$evaluation=Join-Path $op ("evaluation-"+$Task+".json")
foreach($path in @($recordPath,$stdout,$stderr,$buildOut,$buildErr,$evaluation,$t.auditLog)){
  if(Test-Path $path){Refuse "Existing run artifact; no retry and no overwrite: $path"}
}
$head=(& git -C $repo rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $head -ne $info.sourceCommit){Refuse "Source revision drift"}
$dirty=@(& git -C $repo status --porcelain)
if($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0){Refuse "Source checkout dirty"}
foreach($entry in $info.pinnedSha256.PSObject.Properties){
  $file=Join-Path $repo $entry.Name.Replace("/","\")
  if(-not(Test-Path $file)){Refuse "Pinned source missing: $($entry.Name)"}
  $observed=(Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
  if($observed -ne $entry.Value){Refuse "Frozen source or tests changed: $($entry.Name)"}
}
$hash=(Get-FileHash -Algorithm SHA256 $t.promptPath).Hash.ToLowerInvariant()
if($hash -ne $t.promptSha256){Refuse "Prompt changed"}
$initial=(& git -C $workspace rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $initial -ne $t.starterCommit){Refuse "Candidate baseline drift"}
$modified=@(& git -C $workspace status --porcelain)
if($LASTEXITCODE -ne 0 -or $modified.Count -ne 0){Refuse "Candidate was already edited"}
if(Test-Path (Join-Path $workspace ("src/"+$t.entry))){Refuse "Requested source already exists"}
if(-not(Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))){
  Refuse "First install candidate dependencies with npm.cmd ci"
}
if(-not(Test-Path (Join-Path $repo "apps/mcp-server/dist/index.js"))){
  Refuse "MCP server build missing"
}
if(-not(Test-Path (Join-Path $t.configRoot "muse/auth.json")) -and
   [string]::IsNullOrWhiteSpace($env:META_API_KEY)){
  Refuse "Muse authentication absent"
}
if(-not(Get-Command muse.cmd -ErrorAction SilentlyContinue)){
  Refuse "Muse CLI unavailable"
}
$settings=Get-Content (Join-Path $t.configRoot "muse/settings.json") -Raw | ConvertFrom-Json
$entry=(Join-Path $repo "apps/mcp-server/dist/index.js")
if($settings.mcpServers.silkweb.args[0] -ne $entry -or
  $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
  $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $t.auditLog){
  Refuse "MCP audit wiring changed"
}
$session=[guid]::NewGuid().ToString()
$run=[ordered]@{
  suite="SW-MULTI-001";task=$Task;stage="launched"
  model="muse-spark-1.3";provider="meta";reasoningEffort="high"
  maxModelSteps=$MaxModelSteps
  sourceCommit=$head;starterCommit=$initial
  promptSha256=$hash;sessionId=$session
  startedAt=(Get-Date).ToUniversalTime().ToString("o")
}
$run | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
$flags=@(
  "exec","--json","--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic","--workspace",$workspace,"--trust-workspace",
  "--reasoning-effort","high","--max-model-steps",[string]$MaxModelSteps,
  "--no-parallel-tool-calls","--disable-web-tools","--disable-reminders",
  "--no-foreign-personal-context","--disable-request-user-input",
  "--approval-mode","never","--approval-judge","off",
  "--session-id",$session,"--prompt-file",$t.promptPath
)
Write-Host ("=== SW-MULTI-001 "+$Task+" MUSE SPARK 1.3/HIGH BILLABLE SESSION ===")
Write-Host ("Max steps "+$MaxModelSteps+" is NOT a hard spending cap.")
$oldXdg=$env:XDG_CONFIG_HOME
$prior=$ErrorActionPreference
$watch=[Diagnostics.Stopwatch]::StartNew()
$museExit=$null
try{
  $env:XDG_CONFIG_HOME=$t.configRoot
  Push-Location $workspace
  try{
    $ErrorActionPreference="Continue"
    & muse.cmd @flags 1> $stdout 2> $stderr
    $museExit=$LASTEXITCODE
  }finally{Pop-Location}
}finally{
  $ErrorActionPreference=$prior
  $watch.Stop()
  if($null -eq $oldXdg){Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue}
  else{$env:XDG_CONFIG_HOME=$oldXdg}
}
$run.stage="muse-completed"
$run.museExitCode=$museExit
$run.codingSeconds=[math]::Round($watch.Elapsed.TotalSeconds,3)
$run.finishedAt=(Get-Date).ToUniversalTime().ToString("o")
$run | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("MUSE DONE: task="+$Task+" exit="+$museExit+" codingSeconds="+$run.codingSeconds)
Push-Location $workspace
try{
  $prior=$ErrorActionPreference
  try{
    $ErrorActionPreference="Continue"
    & npm.cmd run build 1> $buildOut 2> $buildErr
    $buildExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$prior}
}finally{Pop-Location}
$run.buildExitCode=$buildExit
$run.stage="build-completed"
$run | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("TARGET BUILD: task="+$Task+" exit="+$buildExit)
$prior=$ErrorActionPreference
try{
  $ErrorActionPreference="Continue"
  & node (Join-Path $PSScriptRoot "evaluate.mjs") --task $Task
  $evalExit=$LASTEXITCODE
}finally{$ErrorActionPreference=$prior}
$run.evaluationExitCode=$evalExit
$run.stage="evaluated"
$run | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("HELD-OUT EVALUATION: task="+$Task+" exit="+$evalExit)
Write-Host "Preserve every attempt, including failures; never rerun silently."
if($evalExit -ne 0){exit 1}
