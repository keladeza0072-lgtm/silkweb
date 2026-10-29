# RES-001 one-shot paid Muse launch; this script is operator-only.
# MaxModelSteps caps model steps, NOT dollars. No automatic retries.
param(
  [Parameter(Mandatory=$true)][ValidateSet("B","C")][string]$Condition,
  [ValidateRange(1,200)][int]$MaxModelSteps = 70
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root = Join-Path $HOME "Projects/res001-preflight-20261029"
$operator = Join-Path $root "operator"
$workspace = Join-Path $root $Condition
$preflightPath = Join-Path $operator "preflight.json"
$configPath = Join-Path $operator "mcp-configuration.json"
$promptPath = Join-Path $operator "PROMPT.md"
$recordPath = Join-Path $operator ("run-" + $Condition + ".json")
$stdoutPath = Join-Path $operator ("run-" + $Condition + ".jsonl")
$stderrPath = Join-Path $operator ("run-" + $Condition + ".stderr.log")
$buildOutPath = Join-Path $operator ("build-" + $Condition + ".stdout.log")
$buildErrPath = Join-Path $operator ("build-" + $Condition + ".stderr.log")
$reportPath = Join-Path (Join-Path $root "reports") ($Condition + "-quality.json")
$evaluator = Join-Path $repo "experiments/harness/res001-evaluate.mjs"
$configRoot = Join-Path $operator ("muse-config-" + $Condition)
function Refuse([string]$message) { throw "RES-001 launch refused: $message" }

if (-not (Test-Path $preflightPath) -or -not (Test-Path $configPath)) {
  Refuse "Missing prepared workspaces/MCP config."
}
$preflight = Get-Content $preflightPath -Raw | ConvertFrom-Json
$config = Get-Content $configPath -Raw | ConvertFrom-Json
if ($preflight.benchmark -ne "RES-001" -or $config.benchmark -ne "RES-001") {
  Refuse "Wrong benchmark metadata."
}
if ($Condition -eq "B" -and @($config.visibleServersB).Count -ne 0) {
  Refuse "B MCP inventory is not empty."
}
if ($Condition -eq "C" -and (@($config.visibleServersC) -join ",") -ne "silkweb") {
  Refuse "C is not configured for Silk Web."
}
if ($Condition -eq "C" -and -not (Test-Path (Join-Path $operator "run-B.json"))) {
  Refuse "B must run first."
}
foreach ($path in @($recordPath,$stdoutPath,$stderrPath,$buildOutPath,$buildErrPath,$reportPath)) {
  if (Test-Path $path) { Refuse ("existing output: " + $path) }
}
$settingsPath = Join-Path $configRoot "muse/settings.json"
if (-not (Test-Path $settingsPath)) { Refuse "Muse settings absent." }
foreach ($entry in $preflight.filesSha256.PSObject.Properties) {
  $path = Join-Path $repo ($entry.Name.Replace("/", "\"))
  if (-not (Test-Path $path)) { Refuse ("missing frozen source " + $entry.Name) }
  $observed = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
  if ($observed -ne $entry.Value) { Refuse ("frozen source changed: " + $entry.Name) }
}
$promptSha = (Get-FileHash -Algorithm SHA256 $promptPath).Hash.ToLowerInvariant()
if ($promptSha -ne $preflight.taskPromptSha256) { Refuse "Prompt bytes changed." }
$baseline = $preflight.conditions.PSObject.Properties[$Condition].Value
$gitHead = (& git -C $workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $gitHead -ne $baseline.initialCommit) {
  Refuse "Starter HEAD mismatch."
}
$dirty = @(& git -C $workspace status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
  Refuse "Starter modified before run."
}
if (-not (Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))) {
  Refuse "Install pinned dependencies with npm.cmd ci first."
}
if ($Condition -eq "C" -and (Test-Path (Join-Path $operator "C-mcp-audit.jsonl"))) {
  Refuse "Existing C audit log risks contamination."
}
if (-not (Get-Command muse.cmd -ErrorAction SilentlyContinue)) {
  Refuse "Muse CLI not found."
}
$sessionId = [guid]::NewGuid().ToString()
$launch = [ordered]@{
  benchmark = "RES-001"
  condition = $Condition
  stage = "launched"
  sessionId = $sessionId
  model = "muse-spark-1.3"
  reasoningEffort = "high"
  maxModelSteps = $MaxModelSteps
  provider = "meta"
  preset = "native-basic"
  approvalMode = "never"
  parallelToolCalls = $false
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommitAtPreparation = $preflight.sourceCommit
  startingGitCommit = $gitHead
  taskPromptSha256 = $promptSha
  evaluatorSha256 = $preflight.filesSha256.'experiments/harness/res001-evaluate.mjs'
  mcpEnabled = ($Condition -eq "C")
  stdoutJsonl = $stdoutPath
  stderrLog = $stderrPath
}
$launch | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath

$flags = @(
  "exec","--json",
  "--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic",
  "--workspace",$workspace,
  "--trust-workspace",
  "--reasoning-effort","high",
  "--max-model-steps", [string]$MaxModelSteps,
  "--no-parallel-tool-calls",
  "--disable-web-tools","--disable-reminders",
  "--no-foreign-personal-context",
  "--disable-request-user-input",
  "--approval-mode","never","--approval-judge","off",
  "--session-id",$sessionId,
  "--prompt-file",$promptPath
)
$previousXdg = $env:XDG_CONFIG_HOME
$previousErrorPreference = $ErrorActionPreference
$clock = [Diagnostics.Stopwatch]::StartNew()
$museExit = $null
Write-Host ("PAID RUN: " + $Condition + " / muse-spark-1.3 / high / max " + $MaxModelSteps + " steps")
Write-Host ("JSONL: " + $stdoutPath)
Write-Host "Step limit is NOT a hard dollar spending limit."
try {
  $env:XDG_CONFIG_HOME = $configRoot
  Push-Location $workspace
  try {
    # Windows PowerShell 5.1 may surface native stderr as PowerShell
    # errors even when redirected. Do not abort the evidence recording.
    $ErrorActionPreference = "Continue"
    & muse.cmd @flags 1> $stdoutPath 2> $stderrPath
    $museExit = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  $ErrorActionPreference = $previousErrorPreference
  $clock.Stop()
  if ($null -eq $previousXdg) {
    Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue
  } else {
    $env:XDG_CONFIG_HOME = $previousXdg
  }
}
# Powershell 5.1 may redirect native stdout as UTF-16; normalize to UTF-8.
# This retains the JSONL event content and makes later parsing portable.
if (Test-Path $stdoutPath) {
  $jsonText = Get-Content $stdoutPath -Raw
  [IO.File]::WriteAllText($stdoutPath,$jsonText,(New-Object System.Text.UTF8Encoding($false)))
}
if (Test-Path $stderrPath) {
  $stderrText = Get-Content $stderrPath -Raw
  [IO.File]::WriteAllText($stderrPath,$stderrText,(New-Object System.Text.UTF8Encoding($false)))
}
$launch.stage = "muse-completed"
$launch.museExitCode = $museExit
$launch.codingSeconds = [math]::Round($clock.Elapsed.TotalSeconds,3)
$launch.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
$launch | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("MUSE DONE: exit=" + $museExit + ", codingSeconds=" + $launch.codingSeconds)

# Build both candidates afresh, after coding time is recorded.
$dist = Join-Path $workspace "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Push-Location $workspace
try {
  & npm.cmd run build 1> $buildOutPath 2> $buildErrPath
  $buildExit = $LASTEXITCODE
} finally { Pop-Location }
$launch.buildExitCode = $buildExit
if ($buildExit -eq 0) {
  & node $evaluator --candidate $workspace --report $reportPath
  $launch.evaluatorExitCode = $LASTEXITCODE
  if (Test-Path $reportPath) {
    $quality = Get-Content $reportPath -Raw | ConvertFrom-Json
    $launch.passedChecks = $quality.passed
    $launch.totalChecks = $quality.checks
    $launch.weightedScore = $quality.weightedScore
  }
} else {
  $launch.evaluatorExitCode = $null
  $launch.passedChecks = 0
  $launch.totalChecks = 41
  $launch.weightedScore = 0
  Write-Host "Candidate did not compile; quality recorded as 0/100."
}
$launch.stage = "evaluated"
$launch | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("FINAL " + $Condition + ": score " + $launch.weightedScore + "/100")
Write-Host ("Record: " + $recordPath)
Write-Host "Never silently rerun or replace benchmark evidence."
