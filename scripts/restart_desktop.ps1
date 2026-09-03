# Reliable FuturesTerminal desktop restart (dev)
param(
    [int]$Port = 8765,
    [string]$Root = ""
)

if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$Py = Join-Path $Root ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $Py)) {
    Write-Error "Missing $Py"
    exit 1
}

function Get-OurProcesses {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -eq "python.exe" -or $_.Name -eq "pythonw.exe") -and
            ($_.CommandLine -match "desktop_app\.py|gateway\.main|--gateway-internal")
        }
}

Write-Host "[1/3] Stopping..."
Get-OurProcesses | ForEach-Object {
    Write-Host "  kill PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "[2/3] Waiting for port $Port..."
for ($i = 0; $i -lt 24; $i++) {
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { break }
    Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 1

Write-Host "[3/3] Starting..."
Start-Process -FilePath $Py -ArgumentList @("desktop_app.py", "--no-update-check") -WorkingDirectory $Root

Start-Sleep -Seconds 4
$desktop = Get-OurProcesses | Where-Object { $_.CommandLine -match "desktop_app\.py" }
if ($desktop) {
    $desktopPid = ($desktop | Select-Object -First 1).ProcessId
    Write-Host "OK restarted (PID $desktopPid)"
    exit 0
}

Write-Host "ERROR: desktop_app not running. Try run_desktop.bat" -ForegroundColor Red
exit 1
