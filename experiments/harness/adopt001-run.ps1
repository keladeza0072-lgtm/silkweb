# ADOPT-001 one-shot guided Muse source-adoption trial.
# NOT RES-001, NOT an A/B speed/cost benchmark.
# MaxModelSteps is NOT a hard monetary spending cap.
param([ValidateRange(1,40)][int]$MaxModelSteps=20)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root = Join-Path $HOME "Projects/silkweb-adoption-probe-20261029"
$op = Join-Path $root "operator"
$metaPath = Join-Path $op "preflight.json"
$recordPath = Join-Path $op "run.json"
$stdout = Join-Path $op "run.jsonl"
$stderr = Join-Path $op "run.stderr.log"
$buildOut = Join-Path $op "build.stdout.log"
$buildErr = Join-Path $op "build.stderr.log"
$evalPath = Join-Path $op "evaluation.json"
function Refuse([string]$s) { throw "ADOPT-001 refused: $s" }
if (-not (Test-Path $metaPath)) { Refuse "Run adopt001-prepare.mjs first" }
$info = Get-Content $metaPath -Raw | ConvertFrom-Json
if ($info.trial -ne "ADOPT-001" -or $info.sourceRepo -ne $repo) { Refuse "Wrong preflight" }
if ($info.candidate -ne (Join-Path $root "candidate")) { Refuse "Candidate path changed" }
foreach ($path in @($recordPath,$stdout,$stderr,$buildOut,$buildErr,$evalPath,$info.auditLog)) {
  if (Test-Path $path) { Refuse ("Existing output " + $path + ". Do not retry silently.") }
}
$head = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $info.sourceCommit) {
  Refuse "Source revision changed since preparation"
}
foreach ($entry in $info.pinnedSha256.PSObject.Properties) {
  $path = Join-Path $repo $entry.Name.Replace("/","\")
  $hash = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
  if ($hash -ne $entry.Value) { Refuse ("Certified source/evidence drift: " + $entry.Name) }
}
$promptHash = (Get-FileHash -Algorithm SHA256 $info.promptPath).Hash.ToLowerInvariant()
if ($promptHash -ne $info.promptSha256) { Refuse "Task prompt modified" }
$settingsPath = Join-Path $info.configRoot "muse/settings.json"
$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
$expectedMcp = Join-Path $repo "apps/mcp-server/dist/index.js"
if ($settings.mcpServers.silkweb.args[0] -ne $expectedMcp -or
    $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
    $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $info.auditLog) {
  Refuse "MCP settings not wired to the audited repaired server"
}
$auth = Join-Path $info.configRoot "muse/auth.json"
if (-not (Test-Path $auth) -and [string]::IsNullOrWhiteSpace($env:META_API_KEY)) {
  Refuse "Meta authentication absent from isolated profile. No paid call initiated."
}
$workspace = $info.candidate
if (-not (Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))) {
  Refuse "Run npm.cmd ci in the candidate folder first"
}
foreach ($rel in @("src/probe.ts","src/verified")) {
  if (Test-Path (Join-Path $workspace $rel)) {
    Refuse ("Preexisting agent work: " + $rel)
  }
}
if (-not (Get-Command muse.cmd -ErrorAction SilentlyContinue)) { Refuse "Muse CLI missing" }

$sessionId = [guid]::NewGuid().ToString()
$record = [ordered]@{
  trial = "ADOPT-001"
  classification = "GUIDED_ADOPTION_PROBE_NOT_BENCHMARK"
  stage = "launched"
  sourceCommit = $head
  sessionId = $sessionId
  model = "muse-spark-1.3"
  reasoningEffort = "high"
  maxModelSteps = $MaxModelSteps
  mcpEnabled = $true
  promptSha256 = $info.promptSha256
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
$flags = @(
  "exec","--json", "--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic", "--workspace",$workspace,"--trust-workspace",
  "--reasoning-effort","high", "--max-model-steps",[string]$MaxModelSteps,
  "--no-parallel-tool-calls","--disable-web-tools","--disable-reminders",
  "--no-foreign-personal-context","--disable-request-user-input",
  "--approval-mode","never","--approval-judge","off",
  "--session-id",$sessionId, "--prompt-file",$info.promptPath
)
Write-Host "=== ADOPT-001 GUIDED MUSE TRIAL (BILLABLE) ==="
Write-Host "Source commit: $head"
Write-Host "Max model steps: $MaxModelSteps (NOT a hard dollar cap)"
Write-Host "Repaired MCP, fresh candidate, separate audit"
$prevXdg = $env:XDG_CONFIG_HOME
$prevPreference = $ErrorActionPreference
$timer = [Diagnostics.Stopwatch]::StartNew()
$museExit = $null
try {
  $env:XDG_CONFIG_HOME = $info.configRoot
  Push-Location $workspace
  try {
    $ErrorActionPreference = "Continue"
    & muse.cmd @flags 1> $stdout 2> $stderr
    $museExit = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  $ErrorActionPreference = $prevPreference
  $timer.Stop()
  if ($null -eq $prevXdg) { Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue }
  else { $env:XDG_CONFIG_HOME = $prevXdg }
}
foreach ($path in @($stdout,$stderr)) {
  if (Test-Path $path) {
    $body = Get-Content $path -Raw
    [IO.File]::WriteAllText($path,$body,(New-Object System.Text.UTF8Encoding($false)))
  }
}
$record.stage = "muse-completed"
$record.museExitCode = $museExit
$record.codingSeconds = [math]::Round($timer.Elapsed.TotalSeconds,3)
$record.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("MUSE DONE: exit=" + $museExit + " codingSeconds=" + $record.codingSeconds)
Push-Location $workspace
try {
  $previousBuildPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & npm.cmd run build 1> $buildOut 2> $buildErr
    $buildExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousBuildPreference }
} finally { Pop-Location }
$record.buildExitCode = $buildExit
Write-Host ("BUILD DONE: exit=" + $buildExit)
& node (Join-Path $repo "experiments/harness/adopt001-evaluate.mjs")
$record.evaluatorExitCode = $LASTEXITCODE
$record.stage = "evaluated"
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("ADOPT-001 DONE: evaluatorExit=" + $record.evaluatorExitCode)
Write-Host "Do not rerun. Preserve results, including failures."
