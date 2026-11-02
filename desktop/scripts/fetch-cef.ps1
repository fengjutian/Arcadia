# Fetch the CEF binary distribution used by the `cef` feature.
#
# Usage:
#   pwsh -File scripts/fetch-cef.ps1                 # version from Cargo.toml
#   pwsh -File scripts/fetch-cef.ps1 -Version 156.0.15
#
# Afterwards, builds need CEF_PATH pointing at the extracted directory:
#   $env:CEF_PATH = (pwsh -File scripts/fetch-cef.ps1 -PrintPath)
#
# The distribution is ~350 MB compressed / ~1.1 GB extracted and is never
# committed: it lives under .cache/cef-sdk (git-ignored).

param(
    [string]$Version = "",
    [string]$Destination = "",
    [switch]$PrintPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $repoRoot '.cache\cef-sdk' }

# The cef crate pins the CEF binary build it can wrap (version suffix after '+').
if (-not $Version) {
    $manifest = Join-Path $repoRoot 'src-tauri\Cargo.toml'
    $line = Select-String -Path $manifest -Pattern '^\s*cef\s*=\s*\{?\s*version\s*=\s*"([^"]+)"' |
        Select-Object -First 1
    if (-not $line) { throw "cannot find the cef dependency in $manifest" }
    $crateVersion = $line.Matches[0].Groups[1].Value
    if ($crateVersion -notmatch '\+(\d+\.\d+\.\d+)') {
        throw "cef crate version '$crateVersion' has no '+CEF_VERSION' suffix"
    }
    $Version = $Matches[1]
}

Write-Host "CEF version: $Version"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$existing = Get-ChildItem $Destination -Directory -Filter "cef_binary_$Version*" -ErrorAction SilentlyContinue |
    Select-Object -First 1

if (-not $existing) {
    $index = Invoke-RestMethod 'https://cef-builds.spotifycdn.com/index.json' -TimeoutSec 120
    $target = $index.windows64.versions | Where-Object { $_.cef_version -like "$Version+*" } | Select-Object -First 1
    if (-not $target) { throw "CEF $Version is not published for windows64" }

    $file = $target.files | Where-Object { $_.type -eq 'standard' } | Select-Object -First 1
    if (-not $file) { throw "CEF $Version has no standard distribution" }

    $url = 'https://cef-builds.spotifycdn.com/' + ($file.name -replace '\+', '%2B')
    $archive = Join-Path $Destination 'cef_binary.tar.bz2'
    Write-Host ("downloading {0} ({1:N0} MB)" -f $file.name, ($file.size / 1MB))
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing -TimeoutSec 3600
    Write-Host ("downloaded in {0:N0}s" -f $timer.Elapsed.TotalSeconds)

    Write-Host 'extracting'
    tar -xjf $archive -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "tar failed with $LASTEXITCODE" }

    $existing = Get-ChildItem $Destination -Directory -Filter "cef_binary_$Version*" |
        Select-Object -First 1
    if (-not $existing) { throw 'extraction produced no cef_binary_* directory' }
}

$path = $existing.FullName
foreach ($required in 'libcef.dll', 'Release\libcef.lib', 'include\cef.h', 'CMakeLists.txt') {
    if (-not (Test-Path (Join-Path $path $required))) {
        throw "CEF distribution is incomplete: missing $required"
    }
}

if ($PrintPath) { Write-Output $path }
else {
    Write-Host "CEF_PATH=$path"
    Write-Host 'Set it for this shell with:'
    Write-Host "  `$env:CEF_PATH='$path'"
}
