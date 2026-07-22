[CmdletBinding()]
param(
  [switch]$Background,
  [ValidateRange(1024, 65535)]
  [int]$Port = 8010
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $root '.env'
# Keep installed native dependencies out of OneDrive-managed source trees and
# Microsoft Store app-data redirection; either can hold package files open.
$venvRoot = Join-Path $env:USERPROFILE '.edt-runtime\ai-worker-venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'

try {
  $existingHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health/ready" -TimeoutSec 2
  if ($existingHealth.status -eq 'ready') {
    Write-Output "Native AI worker is already running at http://127.0.0.1:$Port."
    exit 0
  }
} catch {}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  throw "Port $Port is already in use by another process. Stop that process or choose a different EDT_AI_PORT before starting the native AI worker."
}

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Missing .env. Copy .env.example to .env, then run npm run demo once to generate the local credentials.'
}

# This intentionally supports only simple KEY=value entries. The local demo
# credentials are never written to logs or passed on a command line.
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Z][A-Z0-9_]*)=(.*)$') { continue }
  $name = $matches[1]
  $value = $matches[2].Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

foreach ($required in @('AI_WORKER_SHARED_SECRET', 'AI_DATABASE_PASSWORD', 'EDT_DATABASE_NAME')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($required, 'Process'))) {
    throw "$required is required. Run npm run demo once to generate local credentials."
  }
}

# Older local .env files targeted the now-removed container worker. Preserve a
# genuinely remote endpoint, but translate only the previous local default.
if ($env:OLLAMA_ENDPOINT -eq 'http://host.docker.internal:11434/api/chat') {
  $env:OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/chat'
}

$postgresPort = if ($env:EDT_AI_POSTGRES_PORT) { $env:EDT_AI_POSTGRES_PORT } else { '5433' }
$databaseName = $env:EDT_DATABASE_NAME
$escapedPassword = [uri]::EscapeDataString($env:AI_DATABASE_PASSWORD)
$env:AI_STORE_DSN = "postgresql://edt_ai_worker:$escapedPassword@127.0.0.1:$postgresPort/$databaseName"
$env:AI_DURABLE_STORE_REQUIRED = 'true'
$env:PYTHONHASHSEED = '0'

if (-not (Test-Path -LiteralPath $venvPython)) {
  $bootstrapPython = $null
  $bootstrapArguments = @()
  $pythonLauncher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pythonLauncher) {
    & $pythonLauncher.Source -3.12 -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>$null
    if ($LASTEXITCODE -eq 0) {
      $bootstrapPython = $pythonLauncher.Source
      $bootstrapArguments = @('-3.12')
    }
  }
  if (-not $bootstrapPython) {
    $systemPython = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($systemPython -and $systemPython.Source -notlike '*WindowsApps*') {
      & $systemPython.Source -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>$null
      if ($LASTEXITCODE -eq 0) { $bootstrapPython = $systemPython.Source }
    }
  }
  if (-not $bootstrapPython) {
    throw 'Python 3.12 is required for the native AI worker. Install it, reopen PowerShell, then run npm run ai:local.'
  }
  & $bootstrapPython @bootstrapArguments -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the native AI worker virtual environment.' }
}

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $venvPython -c 'import edt_ai_worker, uvicorn' 2>$null
$dependenciesReady = $LASTEXITCODE -eq 0
$ErrorActionPreference = $previousErrorAction
if (-not $dependenciesReady) {
  & $venvPython -m pip install --editable (Join-Path $root 'apps\ai-worker')
  if ($LASTEXITCODE -ne 0) { throw 'Could not install native AI worker dependencies.' }
}

$arguments = @('-m', 'uvicorn', 'edt_ai_worker.api:app', '--host', '127.0.0.1', '--port', $Port)
if ($Background) {
  $logRoot = Join-Path $env:TEMP 'enterprise-digital-twin'
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $stdout = Join-Path $logRoot 'ai-worker.stdout.log'
  $stderr = Join-Path $logRoot 'ai-worker.stderr.log'
  $process = Start-Process -FilePath $venvPython -ArgumentList $arguments -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  Write-Output "Native AI worker started on http://127.0.0.1:$Port (PID $($process.Id))."
  Write-Output "Logs: $logRoot"
  exit 0
}

Write-Output "Starting native AI worker on http://127.0.0.1:$Port. Press Ctrl+C to stop it."
& $venvPython @arguments
exit $LASTEXITCODE
