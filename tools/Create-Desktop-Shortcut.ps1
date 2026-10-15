# Creates a "SellQuanta" shortcut on the Desktop that runs the existing Launch-StockPilot.bat launcher, unchanged -
# this only sets the shortcut's own name/icon/description; it never touches the launcher, ports or app behavior.
# ASCII only (Windows PowerShell 5.1).
param([string]$Folder = [Environment]::GetFolderPath("Desktop"))   # -Folder is only used for testing

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root "Launch-StockPilot.bat"
$icon = Join-Path $root "tools\SellQuanta.ico"
if (-not (Test-Path $target)) { Write-Host "Launch-StockPilot.bat was not found next to this tool." -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Folder)) { Write-Host "Folder not found: $Folder" -ForegroundColor Red; exit 1 }

$shortcutPath = Join-Path $Folder "SellQuanta.lnk"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcutPath)
$link.TargetPath = $target
$link.WorkingDirectory = $root
$link.Description = "Start SellQuanta and open it in your browser"
if (Test-Path $icon) { $link.IconLocation = "$icon,0" }
$link.WindowStyle = 1
$link.Save()

Write-Host "Shortcut created: $shortcutPath" -ForegroundColor Green
Write-Host "Double-click 'SellQuanta' on your Desktop to start the app."
