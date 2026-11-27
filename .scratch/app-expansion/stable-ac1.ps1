# Item 2 verification: 20 consecutive AC1 runs with three ten-file batches kept running throughout.
# A load copy that finishes is restarted after each AC1 pass, so every pass runs against a loaded machine.
param([int]$Passes = 20, [int]$LoadCopies = 3)
$ErrorActionPreference = "Continue"
$env:NODE_ENV = "test"
Remove-Item env:LLM_API_KEY -ErrorAction SilentlyContinue
$root = "C:\AI2026\chat-marketplace-ae-maint"
$logDir = Join-Path $root ".scratch\app-expansion\stable2"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$files = @(
  "test/after-booking-exploration.test.ts",
  "test/cancellation-always-finishes.test.ts",
  "test/cancelled-accepts-no-change.test.ts",
  "test/integrate-cancellation-application.test.ts",
  "test/render-cancellation-weaver-a2ui.test.ts",
  "test/demo-extended-cancellation-notice.test.ts",
  "test/back-office-uphold-complaint.test.ts",
  "test/schema-migrations.test.ts",
  "test/export-node-sqlite.test.ts",
  "test/state-machine-inventory.test.ts"
)
$loadArgList = @("--import", "tsx", "--test") + $files
$loadProcs = New-Object System.Collections.ArrayList
$loadRound = 0
function Start-Load {
  $script:loadRound++
  $p = Start-Process -FilePath "node" -ArgumentList $script:loadArgList -WorkingDirectory $script:root -RedirectStandardOutput (Join-Path $script:logDir "load-$($script:loadRound).log") -RedirectStandardError (Join-Path $script:logDir "load-$($script:loadRound).err") -PassThru -NoNewWindow
  [void]$script:loadProcs.Add($p)
}
for ($k = 1; $k -le $LoadCopies; $k++) { Start-Load }

$passed = 0; $failed = 0
for ($i = 1; $i -le $Passes; $i++) {
  $log = Join-Path $logDir "ac1-$i.log"
  $start = Get-Date
  npx tsx --test --test-name-pattern "AC1" test/cancellation-always-finishes.test.ts *> $log
  $secs = [int]((Get-Date) - $start).TotalSeconds
  $text = Get-Content $log -Raw
  if ($text -match "# fail 0" -and $text -match "# pass 1") { $passed++; Write-Output "pass $i/$Passes (${secs}s)" }
  else {
    $failed++; Write-Output "FAIL $i/$Passes (${secs}s)"
    $text -split "`n" | Where-Object { $_ -match "error:|not ok " } | Select-Object -First 6
  }
  # Keep every load slot busy.
  $live = @($loadProcs | Where-Object { -not $_.HasExited })
  for ($slot = $live.Count; $slot -lt $LoadCopies; $slot++) { Start-Load }
}
foreach ($p in $loadProcs) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
Write-Output "AC1 under load: passed=$passed failed=$failed"
