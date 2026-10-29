param([string]$RepositoryRoot = 'C:\AI2026\chat-marketplace-controls')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $RepositoryRoot
$env:NODE_ENV = 'test'
$env:COMMERCE_REFERENCE_TEST_KEY = 'allow'
Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:RUN_LIVE_GEMINI -ErrorAction SilentlyContinue
$logDirectory = Join-Path $PSScriptRoot '.'
$suiteLog = Join-Path $logDirectory 'full-npm-test-2026-10-25.log'
$suiteExit = 1
$startedAt = [DateTimeOffset]::UtcNow.ToString('o')
$testedHead = git rev-parse HEAD
@{ command = 'npm test'; head = $testedHead; startedAt = $startedAt; pid = $PID } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDirectory 'full-npm-test-2026-10-25.started.json')
try {
  npm test *> $suiteLog
  $suiteExit = $LASTEXITCODE
} catch {
  'The validation runner stopped unexpectedly.' | Add-Content -LiteralPath $suiteLog
} finally {
  Set-Content -LiteralPath (Join-Path $logDirectory 'full-npm-test-2026-10-25.exit.txt') -Value $suiteExit
  @{ command = 'npm test'; head = $testedHead; startedAt = $startedAt;
    finishedAt = [DateTimeOffset]::UtcNow.ToString('o'); exitCode = $suiteExit } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDirectory 'full-npm-test-2026-10-25.finished.json')
}
exit $suiteExit
