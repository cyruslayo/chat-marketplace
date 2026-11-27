# Runs K copies of the ten-file batch concurrently, with the fetch-failure probe, for N rounds.
param([int]$Copies = 2, [int]$Rounds = 3)
$ErrorActionPreference = "Continue"
$env:NODE_ENV = "test"
Remove-Item env:LLM_API_KEY -ErrorAction SilentlyContinue
$root = "C:\AI2026\chat-marketplace-ae-maint"
$logDir = Join-Path $root ".scratch\app-expansion\batch05probe"
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
for ($round = 1; $round -le $Rounds; $round++) {
  $procs = @()
  for ($k = 1; $k -le $Copies; $k++) {
    $log = Join-Path $logDir "c$round-$k.log"
    $argList = @("--import", "tsx", "--import", "./scratch-fetch-cause.ts", "--test") + $files
    $procs += Start-Process -FilePath "node" -ArgumentList $argList -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -NoNewWindow
  }
  foreach ($p in $procs) { $p.WaitForExit() }
  for ($k = 1; $k -le $Copies; $k++) {
    $text = (Get-Content (Join-Path $logDir "c$round-$k.log") -Raw) + (Get-Content (Join-Path $logDir "c$round-$k.log.err") -Raw)
    $notOk = ([regex]::Matches($text, "(?m)^not ok ")).Count
    Write-Output "round $round copy $k notOk=$notOk"
    $text -split "`n" | Where-Object { $_ -match "FETCH_FAILED" } | Select-Object -First 10
    $text -split "`n" | Where-Object { $_ -match "^not ok " } | Select-Object -First 10
  }
}
