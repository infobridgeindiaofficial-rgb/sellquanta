# StockPilot one-click launcher.
#  - starts the existing backend (node server/index.mjs, port 8787) and frontend (Vite, port 5173) only if they are not already running
#  - waits until both answer, then opens StockPilot in the default browser
#  - never touches the data: it only starts the same programs "npm run dev" starts
# ASCII only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [int]$BackendPort = 8787,    # server/index.mjs listens on 127.0.0.1:8787 (the frontend calls this address)
  [int]$FrontendPort = 5173,   # client dev server: vite --host 127.0.0.1 --port 5173
  [switch]$NoBrowser           # used by tests
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot
$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Stop-WithError($text) {
  Write-Host ""
  Write-Host "  SellQuanta could not start." -ForegroundColor Red
  Write-Host "  $text" -ForegroundColor Red
  Write-Host ""
  exit 1
}

# Only one launcher at a time: a second double-click waits, then finds everything already running.
$mutex = New-Object System.Threading.Mutex($false, "Local\StockPilotLauncher-$BackendPort-$FrontendPort")
try { $haveLock = $mutex.WaitOne(120000) } catch [System.Threading.AbandonedMutexException] { $haveLock = $true }
if (-not $haveLock) { Stop-WithError "Another SellQuanta launcher is still busy. Wait a moment and try again." }

function Test-PortOpen([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if ($pending.AsyncWaitHandle.WaitOne(700) -and $client.Connected) { return $true }
    return $false
  } catch { return $false } finally { $client.Close() }
}

function Get-Page([string]$Url) {
  try { return Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 } catch { return $null }
}

# down = nothing there, ready = StockPilot answering, other = something else (or an older StockPilot) owns the port
function Get-BackendState {
  if (-not (Test-PortOpen $BackendPort)) { return "down" }
  $page = Get-Page "$BackendUrl/api/backup-info"
  if ($page -and $page.Content -match '"keepDays"') { return "ready" }
  return "other"
}
# The backend never reloads its code while running. If server\*.mjs changed after the running backend started (or it is an older
# build that cannot say when it started), it is out of date: its routes may be missing (the app then shows "Request failed: 404").
function Test-BackendStale {
  $page = Get-Page "$BackendUrl/api/server-info"
  if (-not $page) { return $true }
  try { $started = [DateTime]::Parse(($page.Content | ConvertFrom-Json).startedAt).ToUniversalTime() } catch { return $true }
  $newest = Get-ChildItem (Join-Path $Root "server") -Filter *.mjs | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  return ($newest.LastWriteTimeUtc -gt $started)
}

# Stop the out-of-date backend (only if it really is this project's server\index.mjs) so a fresh one can be started. Data is not touched:
# every save is one complete, atomic file replace, so stopping between requests cannot leave a half-written file.
function Stop-StaleBackend {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $BackendPort -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $true }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  if (-not $proc -or $proc.CommandLine -notmatch 'server[\\/]index\.mjs') { return $false }
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  if ($parent -and $parent.Name -eq "cmd.exe" -and $parent.CommandLine -match 'SellQuanta Backend') { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
  return (Wait-Until { -not (Test-PortOpen $BackendPort) } 15 "backend stop")
}

# Recognises "this is our own Vite/React page" by structure (the #root mount div and the main.jsx entry script that
# client/index.html always has), NOT by the page <title>, which is just cosmetic branding text and changes on a
# rebrand - matching on it made this check permanently fail the moment the title text stopped saying "StockPilot",
# even though Vite was serving the page correctly (root cause of "Waiting for the screen" never finishing).
function Get-FrontendState {
  if (-not (Test-PortOpen $FrontendPort)) { return "down" }
  $page = Get-Page "$FrontendUrl/"
  if ($page -and $page.Content -match 'id="root"' -and $page.Content -match 'main\.jsx') { return "ready" }
  return "other"
}

function Wait-Until([scriptblock]$Check, [int]$Seconds, [string]$What) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Check) { Write-Host ""; return $true }
    Write-Host "." -NoNewline
    Start-Sleep -Milliseconds 700
  }
  Write-Host ""
  return $false
}

try {
  Say ""
  Say "  SellQuanta" "Cyan"
  Say "  ----------"

  # --- prerequisites
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithError "Node.js was not found. Install Node.js, then double-click this again."
  }
  if (-not (Test-Path (Join-Path $Root "node_modules\express")) -or -not (Test-Path (Join-Path $Root "client\node_modules\vite\bin\vite.js"))) {
    Stop-WithError "SellQuanta's programs are not installed yet. Double-click INSTALL-FIRST-TIME.bat once, then try again."
  }

  # --- what is already running?
  $backend = Get-BackendState
  $frontend = Get-FrontendState
  if ($backend -eq "other") {
    Stop-WithError "Port $BackendPort is in use by something that is not this version of SellQuanta. If an old SellQuanta window is still open, close it and try again."
  }
  if ($frontend -eq "other") {
    Stop-WithError "Port $FrontendPort is in use by something that is not SellQuanta. Close that program and try again."
  }

  if ($backend -eq "ready" -and (Test-BackendStale)) {
    Say "  The running backend is older than the SellQuanta code on disk - restarting it." "Yellow"
    if (-not (Stop-StaleBackend)) { Stop-WithError "The old backend on port $BackendPort could not be stopped. Close the window named 'SellQuanta Backend' and try again." }
    $backend = "down"
  }

  if ($backend -eq "ready" -and $frontend -eq "ready") {
    Say "  SellQuanta is already running - opening it." "Green"
  } else {
    # --- start only what is missing, each in its own minimised window (close a window to stop that part)
    if ($backend -eq "down") {
      Say "  Starting the SellQuanta backend..."
      Start-Process -FilePath "cmd.exe" -WorkingDirectory $Root -WindowStyle Minimized `
        -ArgumentList "/k", "title SellQuanta Backend & set PORT=$BackendPort& node server\index.mjs" | Out-Null
    } else {
      Say "  Backend already running."
    }
    if ($frontend -eq "down") {
      Say "  Starting the SellQuanta screen..."
      Start-Process -FilePath "cmd.exe" -WorkingDirectory (Join-Path $Root "client") -WindowStyle Minimized `
        -ArgumentList "/k", "title SellQuanta Frontend & node node_modules\vite\bin\vite.js --host 127.0.0.1 --port $FrontendPort --strictPort" | Out-Null
    } else {
      Say "  Screen already running."
    }

    Write-Host "  Waiting for SellQuanta to be ready" -NoNewline
    if (-not (Wait-Until { (Get-BackendState) -eq "ready" } 45 "backend")) {
      Stop-WithError "The backend did not start within 45 seconds. Look at the minimised window named 'SellQuanta Backend' for the reason."
    }
    Write-Host "  Backend ready." -ForegroundColor Green
    Write-Host "  Waiting for the screen" -NoNewline
    if (-not (Wait-Until { (Get-FrontendState) -eq "ready" } 60 "frontend")) {
      # Reachable-but-not-recognised fallback: if the structural check above still hasn't matched after 60 seconds,
      # but something is genuinely answering plain HTTP on the port, open it anyway instead of failing outright - so
      # the launcher can never sit waiting forever (or dead-end with an error) once Vite is actually reachable.
      $fallback = Get-Page $FrontendUrl
      if (-not ($fallback -and [int]$fallback.StatusCode -eq 200)) {
        Stop-WithError "The screen did not start within 60 seconds. Look at the minimised window named 'SellQuanta Frontend' for the reason."
      }
      Say "  The screen is answering but did not match the expected page - opening it anyway." "Yellow"
    }
    Say "  Ready." "Green"
  }

  if ($NoBrowser) {
    Say "  (browser not opened: -NoBrowser)"
  } else {
    Say "  Opening $FrontendUrl in your browser."
    Start-Process $FrontendUrl
  }
  Start-Sleep -Seconds 2
  exit 0
}
finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
