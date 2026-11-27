<#
.SYNOPSIS
  Downloads (if missing) and starts the pinned Meilisearch server for local dev.

.DESCRIPTION
  Binary:  <Root>\.meilisearch\meilisearch.exe  (official release asset, SHA-256 checked)
  Data:    <Root>\.meilisearch\data
  Listens: 127.0.0.1:7700
  Key:     MEILISEARCH_API_KEY from the environment, else from
           <Root>\apps\backend\.env. Nothing is generated: if no key is set
           the script exits with a message. The key is the master key and is
           backend-only, never expose it to the browser.

.PARAMETER Root
  Directory that holds .meilisearch\ and apps\backend\.env. Defaults to the
  repo root that contains this script. Pass another checkout's root to reuse
  its downloaded binary.

.PARAMETER Foreground
  Run in the foreground instead of a detached background process.
#>
param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

# Keep in sync with the image tag in deploy/docker-compose.yml.
$Version = 'v1.58.0'
$Asset = 'meilisearch-windows-amd64.exe'
# SHA-256 of the asset; matches the digest GitHub shows for the release asset.
$Sha256 = '9199197db4a260ca079296de89364a1e2e725703dcefc44340c36f62d3bcf8fe'
$Url = "https://github.com/meilisearch/meilisearch/releases/download/$Version/$Asset"

$Dir = Join-Path $Root '.meilisearch'
$Exe = Join-Path $Dir 'meilisearch.exe'
$Data = Join-Path $Dir 'data'

# Resolve the master key: environment first, then apps/backend/.env.
$Key = $env:MEILISEARCH_API_KEY
if (-not $Key) {
  $EnvFile = Join-Path $Root 'apps\backend\.env'
  if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match '^\s*MEILISEARCH_API_KEY\s*=' } | Select-Object -Last 1
    if ($line) { $Key = ($line -replace '^\s*MEILISEARCH_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'") }
  }
}
if (-not $Key) {
  Write-Error "MEILISEARCH_API_KEY is not set. Set it in the environment or in apps/backend/.env (see apps/backend/.env.template), then run this script again."
  exit 1
}

if (-not (Test-Path $Exe)) {
  New-Item -ItemType Directory -Force $Dir | Out-Null
  $tmp = "$Exe.download"
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
  if ($actual -ne $Sha256) {
    Remove-Item $tmp -Force
    Write-Error "SHA-256 mismatch for $Asset. Expected $Sha256, got $actual. Download discarded."
    exit 1
  }
  Move-Item $tmp $Exe -Force
}

New-Item -ItemType Directory -Force $Data | Out-Null

$args = @('--db-path', $Data, '--http-addr', '127.0.0.1:7700', '--master-key', $Key, '--no-analytics')
if ($Foreground) {
  & $Exe @args
} else {
  $p = Start-Process -FilePath $Exe -ArgumentList $args -WindowStyle Hidden -PassThru
  Write-Host "Meilisearch $Version started (pid $($p.Id)) on http://127.0.0.1:7700"
}
