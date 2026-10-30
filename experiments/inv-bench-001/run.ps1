# INV-BENCH-001 — one explicitly authorized paid Muse session.
# B first (no Silk Web), C second (certified Silk Web MCP). Same prompt,
# same starter Git commit, same flags. NEVER automatically retry or overwrite.
# MAX STEPS IS NOT A DOLLAR CAP; review available credits between B and C.
param(
  [Parameter(Mandatory=$true)][ValidateSet("B","C")][string]$Condition,
  [ValidateRange(1,90)][int]$MaxModelSteps=55
)
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root=Join-Path $HOME "Projects/inv-bench-001-20261030"
$op=Join-Path $root "operator"
$infoPath=Join-Path $op "preflight.json"
function Refuse([string]$msg) {throw "INV-BENCH-001 REFUSED: $msg"}
if(-not (Test-Path $infoPath)){Refuse "Missing offline preparation"}
$meta=Get-Content $infoPath -Raw | ConvertFrom-Json
if($meta.benchmark -ne "INV-BENCH-001" -or $meta.sourceRepo -ne $repo -or
  $meta.root -ne $root){Refuse "Wrong paired preflight"}
$ws=Join-Path $root $Condition
$conditionInfo=$meta.candidates.PSObject.Properties[$Condition].Value
if($conditionInfo.workspace -ne $ws){Refuse "Candidate workspace path drift"}
$recordPath=Join-Path $op ("run-"+$Condition+".json")
$stdout=Join-Path $op ("muse-"+$Condition+".jsonl")
$stderr=Join-Path $op ("muse-"+$Condition+".stderr.log")
$buildOut=Join-Path $op ("build-"+$Condition+".stdout.log")
$buildErr=Join-Path $op ("build-"+$Condition+".stderr.log")
$reportPath=Join-Path $op ("evaluation-"+$Condition+".json")
foreach($path in @($recordPath,$stdout,$stderr,$buildOut,$buildErr,$reportPath)){
  if(Test-Path $path){Refuse "Run file exists; no overwrite: $path"}
}
if($Condition -eq "C"){
  if(-not (Test-Path (Join-Path $op "run-B.json"))){
    Refuse "Complete B before C"}
  $br=Get-Content (Join-Path $op "run-B.json") -Raw | ConvertFrom-Json
  if($br.stage -ne "evaluated"){Refuse "B run must be fully evaluated before C"}
  if(Test-Path $meta.auditLog){Refuse "C MCP audit already exists"}
}
$head=(& git -C $repo rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $head -ne $meta.sourceCommit){Refuse "Source commit changed"}
$dirty=@(& git -C $repo status --porcelain)
if($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0){Refuse "Source checkout dirty"}
foreach($entry in $meta.hashes.PSObject.Properties){
  $file=Join-Path $repo $entry.Name.Replace("/","\")
  if(-not(Test-Path $file)){Refuse "Missing frozen source $($entry.Name)"}
  $observed=(Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
  if($observed -ne $entry.Value){Refuse "Frozen source changed $($entry.Name)"}
}
$taskSha=(Get-FileHash -Algorithm SHA256 $meta.taskPath).Hash.ToLowerInvariant()
if($taskSha -ne $meta.taskSha256){Refuse "Shared task was modified"}
$baseline=(& git -C $ws rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $baseline -ne $conditionInfo.initialCommit){
  Refuse "Initial candidate Git commit changed"}
$changed=@(& git -C $ws status --porcelain)
if($LASTEXITCODE -ne 0 -or $changed.Count -ne 0){Refuse "Candidate already edited"}
if(Test-Path (Join-Path $ws "src/server.ts")){Refuse "Application already authored"}
if(-not(Test-Path (Join-Path $ws "node_modules/typescript/bin/tsc"))){
  Refuse "Install pinned dependencies in BOTH candidates first"}
if(-not(Get-Command muse.cmd -ErrorAction SilentlyContinue)){
  Refuse "Muse CLI not installed"}
$configRoot=$meta.configRoots.PSObject.Properties[$Condition].Value
$settings=Get-Content (Join-Path $configRoot "muse/settings.json") -Raw | ConvertFrom-Json
if($Condition -eq "B"){
  if(@($settings.mcpServers.PSObject.Properties).Count -ne 0){
    Refuse "B must have NO MCP servers"}
}else{
  $mcp=Join-Path $repo "apps/mcp-server/dist/index.js"
  if(-not(Test-Path $mcp)){Refuse "C missing built MCP server"}
  if($settings.mcpServers.silkweb.args[0] -ne $mcp -or
     $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
     $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $meta.auditLog){
    Refuse "C must use audited frozen certified MCP"}
}
$auth=Join-Path $configRoot "muse/auth.json"
if(-not(Test-Path $auth) -and [string]::IsNullOrWhiteSpace($env:META_API_KEY)){
  Refuse "Isolated Muse authentication missing"}
$session=[guid]::NewGuid().ToString()
$rec=[ordered]@{
  benchmark="INV-BENCH-001";condition=$Condition;stage="launched"
  model="muse-spark-1.3";provider="meta";reasoningEffort="high"
  maxModelSteps=$MaxModelSteps;sessionId=$session
  sourceCommit=$head;taskSha256=$taskSha
  initialCommit=$baseline;mcpEnabled=($Condition -eq "C")
  startedAt=(Get-Date).ToUniversalTime().ToString("o")
  museExitCode=$null;codingSeconds=$null
}
$rec | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
$flags=@(
  "exec","--json","--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic","--workspace",$ws,"--trust-workspace",
  "--reasoning-effort","high","--max-model-steps",[string]$MaxModelSteps,
  "--no-parallel-tool-calls","--disable-web-tools","--disable-reminders",
  "--no-foreign-personal-context","--disable-request-user-input",
  "--approval-mode","never","--approval-judge","off",
  "--session-id",$session,"--prompt-file",$meta.taskPath
)
Write-Host ("=== INV-BENCH-001 "+$Condition+" MUSE SPARK 1.3/HIGH ===")
Write-Host ("Silk Web MCP enabled: "+($Condition -eq "C"))
Write-Host ("Task SHA256: "+$taskSha)
Write-Host ("Billed Muse starts; "+$MaxModelSteps+" steps is NOT a spending cap")
$oldXdg=$env:XDG_CONFIG_HOME
$oldPreference=$ErrorActionPreference
$timer=[Diagnostics.Stopwatch]::StartNew()
$museExit=$null
try{
  $env:XDG_CONFIG_HOME=$configRoot
  Push-Location $ws
  try{
    $ErrorActionPreference="Continue"
    & muse.cmd @flags 1> $stdout 2> $stderr
    $museExit=$LASTEXITCODE
  }finally{Pop-Location}
}finally{
  $ErrorActionPreference=$oldPreference
  $timer.Stop()
  if($null -eq $oldXdg){Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue}
  else{$env:XDG_CONFIG_HOME=$oldXdg}
}
foreach($p in @($stdout,$stderr)){
  if(Test-Path $p){
    $body=Get-Content $p -Raw
    [IO.File]::WriteAllText($p,$body,(New-Object System.Text.UTF8Encoding($false)))
  }
}
$rec.museExitCode=$museExit
$rec.codingSeconds=[math]::Round($timer.Elapsed.TotalSeconds,3)
$rec.stage="muse-completed"
$rec.finishedAt=(Get-Date).ToUniversalTime().ToString("o")
$rec | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("MUSE DONE: condition="+$Condition+" exit="+$museExit+" codingSeconds="+$rec.codingSeconds)
if($museExit -ne 0){
  $rec.stage="evaluated";$rec.buildExitCode=$null;$rec.evaluatorExitCode=$null
  $rec.quality=0
  $rec | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
  Write-Host "Muse failed. No build/quality claim; original attempt preserved."
  exit 1
}
$dist=Join-Path $ws "dist"
if(Test-Path $dist){Remove-Item $dist -Recurse -Force}
Push-Location $ws
try{
  $oldPreference=$ErrorActionPreference
  try{
    $ErrorActionPreference="Continue"
    & npm.cmd run build 1> $buildOut 2> $buildErr
    $buildExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$oldPreference}
}finally{Pop-Location}
$rec.buildExitCode=$buildExit
$rec.stage="built"
$rec | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("BUILD DONE: condition="+$Condition+" exit="+$buildExit)
if($buildExit -eq 0){
  $oldPreference=$ErrorActionPreference
  try{
    $ErrorActionPreference="Continue"
    & node $meta.evaluatorPath --workspace $ws --report $reportPath
    $evalExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$oldPreference}
}else{
  $evalExit=$null
  Write-Host "Compilation failed; measured quality is ZERO."
}
$rec.evaluatorExitCode=$evalExit
$rec.quality=0
$rec.passedChecks=0
$rec.totalChecks=20
if(Test-Path $reportPath){
  $q=Get-Content $reportPath -Raw | ConvertFrom-Json
  $rec.quality=$q.score
  $rec.passedChecks=$q.passedChecks
  $rec.totalChecks=$q.expectedChecks
}
$rec.stage="evaluated"
$rec | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("INV-BENCH-001 "+$Condition+" quality="+$rec.quality+"/100 checks="+$rec.passedChecks+"/20")
Write-Host ("Run record: "+$recordPath)
Write-Host "Preserve this attempt; no automatic rerun and no score alteration."
if($buildExit -ne 0 -or $evalExit -ne 0){exit 1}
