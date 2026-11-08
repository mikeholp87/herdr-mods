# Claude Code token use from the local session logs: the last 5 hours and today.
# Reads ~/.claude/projects/*/*.jsonl only; prints one JSON line. No network.
$ErrorActionPreference = 'SilentlyContinue'
$now = [DateTime]::UtcNow
$since5 = $now.AddHours(-5)
$today = [DateTime]::Now.Date.ToUniversalTime()
$oldest = if ($since5 -lt $today) { $since5 } else { $today }
$root = Join-Path $env:USERPROFILE '.claude\projects'
$seen = @{}
$h5 = 0L; $day = 0L; $first5 = $null
Get-ChildItem -Path $root -Filter *.jsonl -Recurse -File | Where-Object { $_.LastWriteTimeUtc -ge $oldest } | ForEach-Object {
  foreach ($line in [System.IO.File]::ReadLines($_.FullName)) {
    if ($line -notlike '*"usage"*' -or $line -notlike '*"type":"assistant"*') { continue }
    try { $j = $line | ConvertFrom-Json } catch { continue }
    $u = $j.message.usage
    if (-not $u -or -not $j.timestamp) { continue }
    $id = $j.message.id
    if ($id -and $seen.ContainsKey($id)) { continue }
    if ($id) { $seen[$id] = 1 }
    $t = ([DateTime]$j.timestamp).ToUniversalTime()
    $n = [long]$u.input_tokens + [long]$u.output_tokens + [long]$u.cache_creation_input_tokens
    if ($t -ge $today) { $day += $n }
    if ($t -ge $since5) { $h5 += $n; if (-not $first5 -or $t -lt $first5) { $first5 = $t } }
  }
}
@{ h5 = $h5; day = $day; first5 = if ($first5) { $first5.ToString('o') } else { $null } } | ConvertTo-Json -Compress
