# Repeats the issue-05 ten-file batch and reports the per-file counters.
param([int]$Runs = 5)
$ErrorActionPreference = "Continue"
$env:NODE_ENV = "test"
Remove-Item env:LLM_API_KEY -ErrorAction SilentlyContinue
$root = "C:\AI2026\chat-marketplace-ae-maint"
$logDir = Join-Path $root ".scratch\app-expansion\batch05"
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
for ($i = 1; $i -le $Runs; $i++) {
  $log = Join-Path $logDir "run-$i.log"
  $start = Get-Date
  npx tsx --test @files *> $log
  $code = $LASTEXITCODE
  $secs = [int]((Get-Date) - $start).TotalSeconds
  $text = Get-Content $log -Raw
  $fails = ([regex]::Matches($text, "(?m)^# fail (\d+)") | ForEach-Object { [int]$_.Groups[1].Value })
  $failSum = ($fails | Measure-Object -Sum).Sum
  $notOk = ([regex]::Matches($text, "(?m)^not ok ")).Count
  Write-Output "run $i exit=$code seconds=$secs notOk=$notOk failSum=$failSum"
  if ($failSum -gt 0) {
    $text -split "`n" | Where-Object { $_ -match "^(not ok|# Subtest:)" } | Select-Object -First 20
    $text -split "`n" | Where-Object { $_ -match "error:|Error:|expected|actual|AC1" } | Select-Object -First 30
  }
}
