<#
.SYNOPSIS
  Print resident memory (MB) per StoreCentral service. Read-only.

.DESCRIPTION
  Output columns: name, rss_mb_after_boot, rss_mb_after_smoke.

  -Local   Reads the working set of the process that listens on each dev port
           (backend 9000, seller-hub 7005, storefront 8000, pos 8001) from the
           OS process list (Get-NetTCPConnection + Get-Process). It prints only
           port, process name, PID and MB. It never reads command lines or
           environment, and never stops, starts or signals anything.
           A port that is not listening prints "not running".

  -Smoke   Optional. Without it the script is a pure read and after_smoke is
           just the current value read a second time. With it, the script
           sends exactly one GET to each service URL between the two reads
           (backend /health, seller-hub /health, storefront /, pos /), then
           reads again. Only use -Smoke against servers you own and are happy
           to touch.

  Without -Local the script reads `docker stats --no-stream` for the compose
  stack (container names storecentral-<service>-1). Docker is optional; a
  missing docker or stopped container prints "not running".

.EXAMPLE
  powershell -File deploy/measure-memory.ps1 -Local
  powershell -File deploy/measure-memory.ps1 -Local -Smoke
#>
param(
  [switch]$Local,
  [switch]$Smoke
)

$ErrorActionPreference = "Continue"

$services = @(
  @{ Name = "backend";    Port = 9000; Url = "http://localhost:9000/health" },
  @{ Name = "seller-hub"; Port = 7005; Url = "http://localhost:7005/health" },
  @{ Name = "storefront"; Port = 8000; Url = "http://localhost:8000/" },
  @{ Name = "pos";        Port = 8001; Url = "http://localhost:8001/" }
)

function Get-LocalMb($port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop | Select-Object -First 1
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction Stop
    return @{ Mb = [math]::Round($proc.WorkingSet64 / 1MB, 0); Pid = $proc.Id; Proc = $proc.ProcessName }
  } catch {
    return $null
  }
}

function Get-DockerMb($name) {
  try {
    $line = docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" 2>$null |
      Where-Object { $_ -like "storecentral-$name-*" } | Select-Object -First 1
    if (-not $line) { return $null }
    $usage = ($line -split " ")[1]
    if ($usage -match "^([\d.]+)(GiB|MiB|KiB|B)$") {
      $n = [double]$Matches[1]
      switch ($Matches[2]) {
        "GiB" { $n = $n * 1024 }
        "KiB" { $n = $n / 1024 }
        "B"   { $n = $n / 1MB }
      }
      return @{ Mb = [math]::Round($n, 0); Pid = "-"; Proc = "container" }
    }
  } catch { }
  return $null
}

function Read-Service($svc) {
  if ($Local) { return Get-LocalMb $svc.Port }
  return Get-DockerMb $svc.Name
}

$rows = @()
foreach ($svc in $services) {
  $first = Read-Service $svc
  if (-not $first) {
    $rows += [pscustomobject]@{ name = $svc.Name; rss_mb_after_boot = "not running"; rss_mb_after_smoke = "not running"; detail = "" }
    continue
  }
  if ($Smoke) {
    try { Invoke-WebRequest -Uri $svc.Url -UseBasicParsing -TimeoutSec 10 | Out-Null } catch { }
  }
  $second = Read-Service $svc
  if (-not $second) { $second = $first }
  $detail = if ($Local) { "port $($svc.Port), $($first.Proc), PID $($first.Pid)" } else { "container" }
  $rows += [pscustomobject]@{ name = $svc.Name; rss_mb_after_boot = $first.Mb; rss_mb_after_smoke = $second.Mb; detail = $detail }
}

$rows | Format-Table -AutoSize
exit 0
