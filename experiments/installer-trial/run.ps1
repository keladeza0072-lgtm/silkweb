# MUSE-INSTALL-001: one guided, billable Muse Spark 1.3 adoption experiment.
# NO automatic retry. --max-model-steps is NOT a hard monetary cap.
param([ValidateRange(1,40)][int]$MaxModelSteps=20)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$root = Join-Path $HOME "Projects/muse-installer-trial-20261029"
$op = Join-Path $root "operator"
$metaPath = Join-Path $op "preflight.json"
$recordPath = Join-Path $op "run.json"
$stdout = Join-Path $op "muse.jsonl"
$stderr = Join-Path $op "muse.stderr.log"
$buildOut = Join-Path $op "build.stdout.log"
$buildErr = Join-Path $op "build.stderr.log"
$evaluation = Join-Path $op "evaluation.json"
function Refuse([string]$message) { throw "MUSE-INSTALL-001 REFUSED: $message" }
if (-not (Test-Path $metaPath)) { Refuse "Run prepare.mjs first" }
$info = Get-Content $metaPath -Raw | ConvertFrom-Json
if ($info.trial -ne "MUSE-INSTALL-001" -or $info.sourceRepo -ne $repo) { Refuse "Wrong or changed preflight" }
foreach ($path in @($recordPath,$stdout,$stderr,$buildOut,$buildErr,$evaluation,$info.auditLog)) {
  if (Test-Path $path) { Refuse ("Existing trial output: " + $path + ". Never overwrite/retry silently.") }
}
$head = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $info.sourceCommit) { Refuse "Source branch changed after preflight" }
$changes = @(& git -C $repo status --porcelain)
if ($LASTEXITCODE -ne 0 -or $changes.Count -ne 0) { Refuse "Source checkout dirty" }
foreach ($entry in $info.pinnedSha256.PSObject.Properties) {
  $source = Join-Path $repo $entry.Name.Replace("/","\")
  if (-not (Test-Path $source)) { Refuse ("Missing pinned file: " + $entry.Name) }
  $sha = (Get-FileHash -Algorithm SHA256 $source).Hash.ToLowerInvariant()
  if ($sha -ne $entry.Value) { Refuse ("Pinned input changed: " + $entry.Name) }
}
$promptSha = (Get-FileHash -Algorithm SHA256 $info.promptPath).Hash.ToLowerInvariant()
if ($promptSha -ne $info.promptSha256) { Refuse "Prompt changed after preflight" }
$workspace = $info.candidate
$candidateCommit = (& git -C $workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $candidateCommit -ne $info.starterCommit) { Refuse "Starter baseline changed" }
$candidateChanges = @(& git -C $workspace status --porcelain)
if ($LASTEXITCODE -ne 0 -or $candidateChanges.Count -ne 0) { Refuse "Candidate already edited" }
if ((Test-Path (Join-Path $workspace "src/probe.ts")) -or
    (Test-Path (Join-Path $workspace "src/silkweb")) -or
    (Test-Path (Join-Path $workspace ".silkweb"))) { Refuse "Target already has installer/agent output" }
if (-not (Test-Path (Join-Path $workspace "node_modules/typescript/bin/tsc"))) {
  Refuse "Install candidate dependencies using npm.cmd ci before paid run"
}
if (-not (Test-Path $info.mcpEntry)) { Refuse "MCP server build is missing" }
if (-not (Test-Path $info.cli)) { Refuse "Installer CLI is missing" }
$settings = Get-Content (Join-Path $info.configRoot "muse/settings.json") -Raw | ConvertFrom-Json
if ($settings.mcpServers.silkweb.args[0] -ne $info.mcpEntry -or
    $settings.mcpServers.silkweb.env.SILKWEB_REPO_ROOT -ne $repo -or
    $settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG -ne $info.auditLog) {
  Refuse "Audited MCP server configuration changed"
}
$authPath = Join-Path $info.configRoot "muse/auth.json"
if (-not (Test-Path $authPath) -and [string]::IsNullOrWhiteSpace($env:META_API_KEY)) {
  Refuse "Isolated Muse profile has no auth; no paid call initiated"
}
if (-not (Get-Command muse.cmd -ErrorAction SilentlyContinue)) {
  Refuse "Muse CLI unavailable"
}
$session = [guid]::NewGuid().ToString()
$record = [ordered]@{
  trial = "MUSE-INSTALL-001"
  classification = "GUIDED_INSTALLER_ADOPTION_NOT_A_B_BENCHMARK"
  stage = "launched"
  model = "muse-spark-1.3"
  provider = "meta"
  reasoningEffort = "high"
  maxModelSteps = $MaxModelSteps
  mcpEnabled = $true
  sourceCommit = $head
  starterCommit = $candidateCommit
  promptSha256 = $promptSha
  sessionId = $session
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
$flags = @(
  "exec","--json","--provider","meta","--model","muse-spark-1.3",
  "--preset","native-basic","--workspace",$workspace,"--trust-workspace",
  "--reasoning-effort","high","--max-model-steps",[string]$MaxModelSteps,
  "--no-parallel-tool-calls","--disable-web-tools","--disable-reminders",
  "--no-foreign-personal-context","--disable-request-user-input",
  "--approval-mode","never","--approval-judge","off",
  "--session-id",$session,"--prompt-file",$info.promptPath
)
Write-Host "=== MUSE-INSTALL-001: ONE BILLABLE MUSE RUN ==="
Write-Host "Pinned source commit: $head"
Write-Host "Isolated target: $workspace"
Write-Host "Max model steps: $MaxModelSteps (NOT a hard dollar cap)"
Write-Host "MCP search+inspect enabled; installer is source delivery path"
$previousXdg = $env:XDG_CONFIG_HOME
$oldErrorPreference = $ErrorActionPreference
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$museExitCode = $null
try {
  $env:XDG_CONFIG_HOME = $info.configRoot
  Push-Location $workspace
  try {
    $ErrorActionPreference = "Continue"
    & muse.cmd @flags 1> $stdout 2> $stderr
    $museExitCode = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  $ErrorActionPreference = $oldErrorPreference
  $stopwatch.Stop()
  if ($null -eq $previousXdg) { Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue }
  else { $env:XDG_CONFIG_HOME = $previousXdg }
}
$record.stage = "muse-completed"
$record.museExitCode = $museExitCode
$record.codingSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds,3)
$record.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("MUSE DONE: exit=" + $museExitCode + " codingSeconds=" + $record.codingSeconds)
Push-Location $workspace
try {
  $previousBuildErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & npm.cmd run build 1> $buildOut 2> $buildErr
    $buildExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousBuildErrorPreference }
} finally { Pop-Location }
$record.buildExitCode = $buildExit
Write-Host ("LOCAL BUILD: exit=" + $buildExit)
& node (Join-Path $PSScriptRoot "evaluate.mjs")
$record.evaluatorExitCode = $LASTEXITCODE
$record.stage = "evaluated"
$record | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $recordPath
Write-Host ("TRIAL EVALUATED: exit=" + $record.evaluatorExitCode)
Write-Host "Preserve results even if evaluation failed. Do not rerun this trial."
