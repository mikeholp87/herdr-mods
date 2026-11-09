# Installs the hover-focus mod into the Herdr app home on Windows.
#   .\install.ps1 [-Layout NAME] [-AppHome DIR]
# -Layout NAME  also point that layout's pane header at the mod (a backup is kept) and switch to it.
param(
  [string]$Layout = "",
  [string]$AppHome = ""
)
$ErrorActionPreference = "Stop"

if (-not $AppHome) {
  $AppHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME ".config\herdr-app" }
}
if (-not (Test-Path -LiteralPath $AppHome -PathType Container)) {
  throw "Herdr app home not found: $AppHome. Start Herdr once, or pass -AppHome DIR (or set HERDR_APP_HOME)."
}

$src = Join-Path $PSScriptRoot "mods\hover-focus"
$dst = Join-Path $AppHome "mods\hover-focus"
New-Item -ItemType Directory -Force -Path (Join-Path $AppHome "mods") | Out-Null
if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
Copy-Item -LiteralPath $src -Destination $dst -Recurse
Write-Host "installed: $dst"

$herdr = Get-Command herdr-app -ErrorAction SilentlyContinue
$env:HERDR_APP_HOME = $AppHome
if ($herdr) { & herdr-app check $dst } else { Write-Host "note: herdr-app not on PATH, skipped 'herdr-app check'" }

if ($Layout) {
  $file = Join-Path $AppHome "layouts\$Layout.json"
  if (-not (Test-Path -LiteralPath $file)) { throw "no such layout: $file" }
  Copy-Item -LiteralPath $file -Destination "$file.bak-before-hover-focus" -Force
  $json = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json

  # Every object whose "header" has a "content" is a pane header: point it at the mod.
  function Update-Headers($node) {
    if ($node -is [System.Management.Automation.PSCustomObject]) {
      $h = $node.PSObject.Properties["header"]
      if ($h -and $h.Value -is [System.Management.Automation.PSCustomObject] -and $h.Value.PSObject.Properties["content"]) {
        $h.Value.content = [pscustomobject]@{ mod = "hover-focus" }
        foreach ($p in @{ reveal = "always"; height = 30; position = "top" }.GetEnumerator()) {
          if ($h.Value.PSObject.Properties[$p.Key]) { $h.Value.($p.Key) = $p.Value }
          else { $h.Value | Add-Member -NotePropertyName $p.Key -NotePropertyValue $p.Value }
        }
      }
      foreach ($prop in $node.PSObject.Properties) { Update-Headers $prop.Value }
    } elseif ($node -is [System.Collections.IEnumerable] -and $node -isnot [string]) {
      foreach ($item in $node) { Update-Headers $item }
    }
  }
  Update-Headers $json

  $text = $json | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "layout updated: $file (backup: $file.bak-before-hover-focus)"
  if ($herdr) { & herdr-app do layout.switch --name $Layout }
} else {
  Write-Host "next: point a layout's pane header at the mod (see README), or re-run with -Layout NAME"
}
