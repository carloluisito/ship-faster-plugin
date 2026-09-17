<#
Runs the skill evals from Windows through WSL, where the eval sandbox works.

  .\plugins\ship-faster\tests\evals.ps1                 every case
  .\plugins\ship-faster\tests\evals.ps1 review          one case
  .\plugins\ship-faster\tests\evals.ps1 ship release    several cases, one harness run each
  .\plugins\ship-faster\tests\evals.ps1 'kickoff*'      a glob (the harness takes * and ?, not {a,b})
  .\plugins\ship-faster\tests\evals.ps1 -MaxCost 20     cost ceiling for each harness run
  .\plugins\ship-faster\tests\evals.ps1 -Setup          one-time: installs bubblewrap, socat, the pinned claude CLI, and the eval user

The evals run as a dedicated WSL user (default sfeval) whose home has no Docker Desktop
symlinks, with a copy of this machine's Claude login placed in its own config directory.
That copy is refreshed on every run because the two sides rotate the same login.
#>
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Case = @(),
  [double]$MaxCost = 10,
  [string]$Runs = '',
  [switch]$KeepTemp,
  [switch]$Setup,
  [string]$Distro = 'Ubuntu',
  [string]$User = 'sfeval',
  [string]$ClaudeVersion = '2.1.273'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$configDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$credentials = Join-Path $configDir '.credentials.json'
if (-not (Test-Path $credentials)) { throw "no Claude login found at $credentials; run claude and log in first" }

$repoWsl = (& wsl.exe -d $Distro -- wslpath -a $repo.Replace('\', '/')).Trim()
$credentialsWsl = (& wsl.exe -d $Distro -- wslpath -a $credentials.Replace('\', '/')).Trim()

if ($Setup) {
  $setup = @(
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq && apt-get install -y -qq bubblewrap socat",
    "npm install -g @anthropic-ai/claude-code@$ClaudeVersion",
    "id $User >/dev/null 2>&1 || useradd -m -s /bin/bash $User",
    "echo setup done"
  ) -join ' && '
  & wsl.exe -d $Distro -u root -- bash -c $setup
  if ($LASTEXITCODE -ne 0) { throw "setup failed (exit $LASTEXITCODE)" }
}

$refresh = "install -d -m 700 -o $User -g $User /home/$User/.claude-eval && install -m 600 -o $User -g $User '$credentialsWsl' /home/$User/.claude-eval/.credentials.json"
& wsl.exe -d $Distro -u root -- bash -c $refresh
if ($LASTEXITCODE -ne 0) { throw "could not copy the login into WSL (exit $LASTEXITCODE)" }

$envPrefix = "export CLAUDE_CONFIG_DIR=/home/$User/.claude-eval EVAL_MAX_COST=$MaxCost"
if ($Runs) { $envPrefix += " EVAL_RUNS=$Runs" }
if ($KeepTemp) { $envPrefix += " EVAL_KEEP_TEMP=1" }
$caseArgs = ($Case | Where-Object { $_ } | ForEach-Object { "'" + ($_ -replace "'", '') + "'" }) -join ' '
$run = "$envPrefix && bash '$repoWsl/plugins/ship-faster/tests/evals.sh' $caseArgs"
& wsl.exe -d $Distro -u $User -- bash -c $run
exit $LASTEXITCODE
