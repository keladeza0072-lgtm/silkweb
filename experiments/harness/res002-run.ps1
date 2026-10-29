# RES-002: one-shot B/C Muse coding run, frozen preflight, no automatic retry.
# Conditions get IDENTICAL prompts and starter; ONLY C has repaired Silk Web.
# The maximum number of model steps is NOT a hard dollar cap.
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("B","C")][string]$Condition,
  [ValidateRange(1,100)][int]$MaxModelSteps=70
)
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root=Join-Path $HOME "Projects/res002-fair-20261029"
$op=Join-Path $root "operator"
$workspace=Join-Path $root $Condition
$metaPath=Join-Path $op "preflight.json"
$recordPath=Join-Path $op ("run-"+$Condition+".json")
$stdout=Join-Path $op ("run-"+$Condition+".jsonl")
$stderr=Join-Path $op ("run-"+$Condition+".stderr.log")
$buildOut=Join-Path $op ("build-"+$Condition+".stdout.log")
$buildErr=Join-Path $op ("build-"+$Condition+".stderr.log")
$qualityPath=Join-Path (Join-Path $root "reports") ($Condition+"-quality.json")
function Refuse([string]$s) { throw "RES-002 refused: $s" }
if (-not (Test-Path $metaPath)) { Refuse "Run res002-prepare.mjs first" }
$info=Get-Content $metaPath -Raw | ConvertFrom-Json
if ($info.benchmark -ne "RES-002" -or $info.sourceRepo -ne $repo) {
  Refuse "Wrong preparation record"
}
foreach ($path in @($recordPath,$stdout,$stderr,$buildOut,$buildErr,$qualityPath)) {
  if (Test-Path $path) { Refuse ("existing result "+$path+". Never rerun silently.") }
}
if ($Condition -eq "C") {
  $bPath=Join-Path $op "run-B.json"
  if (-not (Test-Path $bPath)) { Refuse "B must finish before C" }
  $bRecord=Get-Content $bPath -Raw | ConvertFrom-Json
  if ($bRecord.stage -ne "evaluated") { Refuse "B run not fully evaluated" }
  if (Test-Path $info.mcpAuditLog) { Refuse "C audit already exists" }
}
$head=(& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $info.sourceCommit) {
  Refuse "Source revision drift after preparation"
}
$dirty=@(& git -C $repo status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) {
  Refuse "Source worktree dirty after preparation"
}
foreach($entry in $info.pinnedFilesSha256.PSObject.Properties) {
  $file=Join-Path $repo $entry.Name.Replace("/","\")
  if (-not (Test-Path $file)) { Refuse ("Missing frozen file "+$entry.Name) }
  $observed=(Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
  if ($observed -ne $entry.Value) {
    Refuse ("Frozen input changed: "+$entry.Name)
  }
}
$promptHash=(Get-FileHash -Algorithm SHA256 $info.promptPath).Hash.ToLowerInvariant()
if ($promptHash -ne $info.promptSha256) { Refuse "Prompt not frozen" }
$conditionInfo=$info.conditions.PSObject.Properties[$Condition].Value
if ($conditionInfo.workspace -ne $workspace) { Refuse "Workspace path drift" }
$initialCommit=(& git -C $workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $initialCommit -ne $conditionInfo.initialCommit) {
  Refuse "Candidate baseline drift"
}
$candidateChanges=@(& git -C $workspace status --porcelain)
if ($LASTEXITCODE -ne 0 -or $candidateChanges.Count -ne 0) {
  Refuse "Candidate already modified before paid run"
}
$settingsRoot=$info.configRoots.PSObject.Properties[$Condition].Value
$settings=Get-Content (Join-Path $settingsRoot "muse/settings.json") -Raw | ConvertFrom-Json
if ($Condition -eq "B") {
  if (@($settings.mcpServers.PSObject.Properties).Count -ne 0) {
    Refuse "B must have zero MCP servers"
  }
} else {
  $expectedMcp=Join-Path $repo "apps/mcp-server/dist/index.js"
  if ($settings.mcpServers.silkweb.args[0] -ne $expectedMcp -or
      $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
      $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $info.mcpAuditLog) {
    Refuse "C not wired to audited certified server"
  }
}
$auth=Join-Path $settingsRoot "muse/auth.json"
if (-not (Test-Path $auth) -and [string]::IsNullOrWhiteSpace($env:META_API_KEY)) {
  Refuse "Isolated Muse profile missing credentials"
}
if (-not (Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))) {
  Refuse "Run npm.cmd ci in BOTH candidate workspaces first"
}
if (-not (Get-Command muse.cmd -ErrorAction SilentlyContinue)) {
  Refuse "Muse CLI not available"
}
$session=[guid]::NewGuid().ToString()
$record=[ordered]@{
  benchmark="RES-002"
  condition=$Condition
  stage="launched"
  runId=$session
  model="muse-spark-1.3"
  reasoningEffort="high"
  maxModelSteps=$MaxModelSteps
  mcpEnabled=($Condition -eq "C")
  taskPromptSha256=$promptHash
  startingGitCommit=$initialCommit
  sourceCommit=$head
  evaluatorSha256=$info.pinnedFilesSha256.'experiments/harness/res001-evaluate.mjs'
  startedAt=(Get-Date).ToUniversalTime().ToString("o")
  codingSeconds=$null
  museExitCode=$null
}
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
$flags=@(
  "exec","--json",
  "--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic","--workspace",$workspace,
  "--trust-workspace","--reasoning-effort","high",
  "--max-model-steps",[string]$MaxModelSteps,
  "--no-parallel-tool-calls","--disable-web-tools",
  "--disable-reminders","--no-foreign-personal-context",
  "--disable-request-user-input","--approval-mode","never",
  "--approval-judge","off","--session-id",$session,
  "--prompt-file",$info.promptPath
)
Write-Host ("=== RES-002 "+$Condition+" Muse Spark 1.3/high ===")
Write-Host ("Silk Web enabled: "+($Condition -eq "C"))
Write-Host ("Frozen task SHA256: "+$promptHash)
Write-Host ("Paid Muse coding starts; "+$MaxModelSteps+" steps is NOT a hard spending cap")
$previousXdg=$env:XDG_CONFIG_HOME
$prevPreference=$ErrorActionPreference
$timer=[Diagnostics.Stopwatch]::StartNew()
$museExit=$null
try {
  $env:XDG_CONFIG_HOME=$settingsRoot
  Push-Location $workspace
  try {
    $ErrorActionPreference="Continue"
    & muse.cmd @flags 1> $stdout 2> $stderr
    $museExit=$LASTEXITCODE
  } finally { Pop-Location }
} finally {
  $ErrorActionPreference=$prevPreference
  $timer.Stop()
  if ($null -eq $previousXdg) {
    Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue
  } else { $env:XDG_CONFIG_HOME=$previousXdg }
}
foreach ($path in @($stdout,$stderr)) {
  if (Test-Path $path) {
    $body=Get-Content $path -Raw
    [IO.File]::WriteAllText($path,$body,(New-Object System.Text.UTF8Encoding($false)))
  }
}
$record.stage="muse-completed"
$record.museExitCode=$museExit
$record.codingSeconds=[math]::Round($timer.Elapsed.TotalSeconds,3)
$record.finishedAt=(Get-Date).ToUniversalTime().ToString("o")
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("MUSE DONE: exit="+$museExit+", codingSeconds="+$record.codingSeconds)
if ($museExit -ne 0) {
  Write-Host "Muse nonzero exit: keep logs, no quality inference, no automatic rerun."
  exit 1
}
$dist=Join-Path $workspace "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
$buildExit=$null
Push-Location $workspace
try {
  $p=$ErrorActionPreference
  try {
    $ErrorActionPreference="Continue"
    & npm.cmd run build 1> $buildOut 2> $buildErr
    $buildExit=$LASTEXITCODE
  } finally { $ErrorActionPreference=$p }
} finally { Pop-Location }
$record.buildExitCode=$buildExit
if ($buildExit -eq 0) {
  & node $info.evaluatorPath --candidate $workspace --report $qualityPath
  $record.evaluatorExitCode=$LASTEXITCODE
  if (Test-Path $qualityPath) {
    $quality=Get-Content $qualityPath -Raw | ConvertFrom-Json
    $record.passedChecks=$quality.passed
    $record.totalChecks=$quality.checks
    $record.weightedScore=$quality.weightedScore
  } else { $record.weightedScore=$null }
} else {
  $record.evaluatorExitCode=$null
  $record.passedChecks=0
  $record.totalChecks=41
  $record.weightedScore=0
  Write-Host "Failed to compile; quality score = 0 / 100."
}
$record.stage="evaluated"
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("RES-002 "+$Condition+" quality="+$record.weightedScore+"/100")
Write-Host ("Report: "+$recordPath)
Write-Host "Do not rerun or edit the task/evaluator. Preserve all run evidence."
