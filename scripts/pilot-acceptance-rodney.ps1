[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$ShowBrowser,
  [switch]$UseExistingServer,
  [switch]$KeepServer,
  [switch]$KeepBrowserOnFailure,
  [switch]$Help
)

if ($Help) {
  Write-Output 'Usage: npm run pilot:acceptance:rodney -- [--Reset] [--ShowBrowser] [--UseExistingServer] [--KeepServer] [--KeepBrowserOnFailure]'
  exit 0
}

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo
$root = Join-Path $repo '.scratch/pilot-acceptance-rodney'
$logs = Join-Path $root 'logs'
$shots = Join-Path $root 'screenshots'
$sessions = Join-Path $root 'sessions'
$reportPath = Join-Path $root 'acceptance-report.md'
$jsonPath = Join-Path $root 'acceptance-result.json'
$origin = 'http://127.0.0.1:3000'
$script:scenarios = [System.Collections.Generic.List[object]]::new()
$script:failureSeen = $false
$script:token = $null
$script:ownedServerPid = $null
$script:ownedRodneyHomes = [System.Collections.Generic.List[string]]::new()
$script:activeHome = $null
$script:activeProfile = $null
$script:activeThreadId = $null
$script:activeScenario = 'Preflight'
$script:head = $null
$script:rodneyVersion = 'unknown'
$script:rodneyPath = $null
$script:rodneyHash = $null
$script:rodneyStartHelp = ''
$script:rodneyShowResult = ''
$script:rodneyMetadata = ''
$script:environmentLimitations = [System.Collections.Generic.List[string]]::new()
$script:accessibilityEvidence = [System.Collections.Generic.List[string]]::new()
$script:guestAThread = $null
$script:guestBThread = $null
$script:guestARequestId = $null
$script:guestBRequestId = $null
$script:guestAUnitTitle = $null
$script:guestAUnitId = $null
$script:guestACheckIn = $null
$script:guestACheckOut = $null
$script:serverOwned = $false
$script:restart = 'NOT RUN'

function Add-Scenario([string]$Name, [string]$Expected, [string]$Observed, [string]$Status = 'PASS', [string[]]$Images = @(), [string]$Diagnostic = '') {
  $script:scenarios.Add([ordered]@{ scenario=$Name; status=$Status; expected=$Expected; observed=$Observed; screenshots=$Images; diagnostic=$Diagnostic })
  if ($Status -eq 'FAIL') { $script:failureSeen = $true }
}

function Invoke-Captured([string]$File, [string[]]$Arguments, [string]$LogFile, [switch]$Sensitive) {
  $outFile = Join-Path $logs ([IO.Path]::GetRandomFileName())
  $errFile = Join-Path $logs ([IO.Path]::GetRandomFileName())
  try {
    $psi = [Diagnostics.ProcessStartInfo]::new()
    if ($File -ieq 'npm.cmd') {
      $psi.FileName = $env:ComSpec
      $psi.ArgumentList.Add('/d'); $psi.ArgumentList.Add('/c')
      $psi.ArgumentList.Add(('npm.cmd ' + ($Arguments -join ' ')))
    } else {
      $psi.FileName = if ($File -ieq 'rodney') { $script:rodneyPath } else { (Get-Command $File -ErrorAction Stop).Source }
      foreach ($arg in $Arguments) { $psi.ArgumentList.Add($arg) }
    }
    $psi.WorkingDirectory = $repo
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::new()
    $p.StartInfo = $psi
    [void]$p.Start()
    $stdoutTask = $p.StandardOutput.ReadToEndAsync()
    $stderrTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(60000)) { try { $p.Kill($true) } catch {}; throw "Command timed out after 60 seconds: $File $($Arguments -join ' ')" }
    $p.WaitForExit()
    $out = $stdoutTask.GetAwaiter().GetResult()
    $err = $stderrTask.GetAwaiter().GetResult()
    if (-not $Sensitive) {
      if ($LogFile) { Set-Content -Path (Join-Path $logs $LogFile) -Value ($out + $err) -NoNewline }
      if ($p.ExitCode -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $($p.ExitCode): $($err.Trim()) $($out.Trim())" }
    } elseif ($p.ExitCode -ne 0) { throw 'Sensitive command failed; output suppressed.' }
    return $out.Trim()
  } finally {
    Remove-Item $outFile,$errFile -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Rodney([string[]]$Arguments, [string]$LogName = '', [switch]$Sensitive) {
  if (-not $script:activeHome) { throw 'No active isolated Rodney profile.' }
  $env:RODNEY_HOME = $script:activeHome
  if ($Arguments.Count -gt 1 -and $Arguments[0] -in @('input','click','submit','select','file')) {
    Assert-RodneyActionContext $Arguments[0] $Arguments[1]
  }
  return Invoke-Captured 'rodney' $Arguments $LogName -Sensitive:$Sensitive
}

function Capture([string]$Name) {
  $path = Join-Path $shots $Name
  Invoke-Rodney @('screenshot', $path) | Out-Null
  return ".scratch/pilot-acceptance-rodney/screenshots/$Name"
}

function Assert-Rodney([string[]]$Arguments, [string]$Expected, [string]$Name) {
  try { Invoke-Rodney $Arguments | Out-Null; Add-Scenario $Name $Expected 'Assertion passed.' }
  catch {
    $img = @()
    try { $img += Capture 'failure.png' } catch {}
    $url = ''; $text = ''; $status = ''
    try { $url = Invoke-Rodney @('url') } catch {}
    try { $text = Invoke-Rodney @('text','body') } catch {}
    try { $status = Invoke-Rodney @('status') } catch {}
    if ($script:token) { $text = $text -replace [regex]::Escape([string]$script:token), '[REDACTED]' }
    Add-Scenario $Name $Expected 'Acceptance assertion failed.' 'FAIL' $img (($url + "`n" + $text + "`n" + $status).Trim())
    throw [InvalidOperationException]::new("Acceptance check failed: $Name")
  }
}

function Assert-ProductSelector([string]$Selector, [string]$Expected, [string]$Name, [string]$ImageName) {
  try {
    Invoke-Rodney @('wait',$Selector) | Out-Null
    $shot = Capture $ImageName
    Add-Scenario $Name $Expected 'Expected application surface appeared.' 'PASS' @($shot)
    return $shot
  } catch {
    $images = @(); $url=''; $visible=''; $status=''
    try { $images += Capture 'failure.png' } catch {}
    try { $url = Invoke-Rodney @('url') } catch {}
    try { $visible = Invoke-Rodney @('text','body') } catch {}
    try { $status = Invoke-Rodney @('status') } catch {}
    if ($script:token) { $visible = $visible -replace [regex]::Escape([string]$script:token), '[REDACTED]' }
    $diagnostic = (($url + "`n" + $visible + "`n" + $status).Trim())
    Add-Scenario $Name $Expected 'Expected application surface did not appear within Rodney wait.' 'FAIL' $images $diagnostic
    throw [InvalidOperationException]::new("Acceptance check failed: $Name")
  }
}

function Wait-Healthy {
  $deadline = [DateTime]::UtcNow.AddSeconds(75)
  do {
    try {
      $r = Invoke-RestMethod "$origin/healthz" -TimeoutSec 2
      if ($r.ok -eq $true) { return }
    } catch {}
    Start-Sleep -Milliseconds 400
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Pilot server did not return healthy {"ok":true} from /healthz within 75 seconds.'
}

function Start-Pilot {
  $log = Join-Path $logs 'pilot-server.log'
  $previousPort = $env:PORT
  $env:PORT = '3000'
  try { $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','pilot:local') -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError (Join-Path $logs 'pilot-server-error.log') }
  finally { if ($null -eq $previousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $previousPort } }
  $script:ownedServerPid = $proc.Id
  $script:serverOwned = $true
  Set-Content (Join-Path $logs 'pilot-server-pid.txt') "npm PID: $($proc.Id)"
  Wait-Healthy
}

function Stop-OwnedServer {
  if ($script:ownedServerPid -and -not $KeepServer) {
    & taskkill.exe /PID $script:ownedServerPid /T /F 2>$null | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      $listenerNow = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
      if (-not $listenerNow) { break }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($listenerNow) { throw 'Owned pilot listener remained after terminating its process tree.' }
    $script:ownedServerPid = $null
  }
}

function Assert-RodneyActionContext([string]$Action, [string]$Selector) {
  $currentUrl = Invoke-Captured 'rodney' @('url') ''
  $uri = $null
  if (-not [uri]::TryCreate($currentUrl,[UriKind]::Absolute,[ref]$uri) -or $uri.Authority -ne ([uri]$origin).Authority) {
    throw "Rodney is attached to unexpected origin '$currentUrl' before $Action $Selector."
  }
  if ($script:activeProfile -eq 'Operator') {
    if ($uri.AbsolutePath -notmatch '^/operator/(login|requests)(/|$)') {
      throw "Expected Operator session but Rodney is attached to '$currentUrl' before $Action $Selector."
    }
    if ($Selector -match 'composer') { throw "Refusing Guest composer action '$Selector' while Operator session is active at $currentUrl." }
    return
  }
  if ($script:activeProfile -notin @('GuestA','GuestB')) {
    throw "No verified Guest profile is active before $Action $Selector (current Rodney profile: $($script:activeProfile))."
  }
  if ($uri.AbsolutePath -match '^/operator(/|$)') {
    throw "Expected $($script:activeProfile) Guest session but Rodney is attached to Operator at $currentUrl."
  }
  if ($Selector -match 'composer' -and (Invoke-Captured 'rodney' @('js','document.querySelector("#composer-input") !== null') '') -ne 'true') {
    throw "Expected $($script:activeProfile) Guest composer at $currentUrl before entering conversation text."
  }
  $threadId = Get-GuestThread
  if (-not $threadId -or ($script:activeThreadId -and $threadId -ne $script:activeThreadId)) {
    throw "Expected $($script:activeProfile) Guest thread '$($script:activeThreadId)' but Rodney's active page has thread '$threadId' at $currentUrl."
  }
  if ($script:activeThreadId) {
    $probe = Get-ThreadStateProbe $threadId
    if ($probe.status -ne 200 -or -not $probe.body.ok -or $probe.body.threadId -ne $script:activeThreadId) {
      throw "Expected authenticated $($script:activeProfile) thread state '$($script:activeThreadId)' before $Action $Selector; the Guest state probe did not match."
    }
  }
}

function Use-RodneySession([ValidateSet('GuestA','GuestB','Operator')][string]$Name, [string]$Url = '', [string]$ExpectedThreadId = '') {
  $homeName = switch ($Name) { 'GuestA' { 'guest-a' } 'GuestB' { 'guest-b' } 'Operator' { 'operator' } }
  $profileHome = Join-Path $sessions $homeName
  New-Item -ItemType Directory -Force -Path $sessions,$profileHome | Out-Null
  $script:activeHome = $profileHome
  $script:activeProfile = $Name
  $env:RODNEY_HOME = $profileHome
  $script:ownedRodneyHomes.Add($profileHome)
  $status = Invoke-Captured 'rodney' @('status') ''
  if ($status -match 'No active browser session') {
    $startArgs = @('start'); if ($ShowBrowser) { $startArgs += '--show' }
    try { Invoke-Captured 'rodney' $startArgs "rodney-$homeName-start.log" | Out-Null }
    catch {
      if ($ShowBrowser -and $_.Exception.Message -match 'unknown flag: --show') {
        $script:environmentLimitations.Add('The resolved Rodney 0.4.0 executable rejects `start --show` although its embedded top-level help advertises it; this profile continued headless.')
        Invoke-Captured 'rodney' @('start') "rodney-$homeName-start.log" | Out-Null
      } else {
        throw
      }
    }
  } elseif ($status -notmatch 'Browser running') {
    throw "Cannot select $Name Rodney profile '$profileHome': unexpected status '$status'."
  }
  if (-not $Url) { $Url = if ($Name -eq 'Operator') { "$origin/operator/requests" } else { "$origin/" } }
  Invoke-Rodney @('open', $Url) | Out-Null
  Invoke-Rodney @('waitstable') | Out-Null
  $actualUrl = Invoke-Rodney @('url')
  $actualUri = [uri]$actualUrl
  if ($actualUri.Authority -ne ([uri]$origin).Authority) { throw "$Name profile opened an unexpected origin: $actualUrl" }
  if ($Name -eq 'Operator') {
    if ($actualUri.AbsolutePath -notmatch '^/operator/(login|requests)(/|$)') { throw "Expected Operator route but Rodney opened $actualUrl." }
    $operatorThread = Get-GuestThread
    if ($operatorThread) { throw "Operator profile '$homeName' unexpectedly contains Guest thread '$operatorThread'." }
    $script:activeThreadId = $null
  } else {
    if ($actualUri.AbsolutePath -ne '/') { throw "Expected Guest application root but $Name profile opened $actualUrl." }
    $threadId = Get-GuestThread
    if ($ExpectedThreadId -and $threadId -ne $ExpectedThreadId) {
      throw "Expected $Name isolated thread '$ExpectedThreadId' but profile '$homeName' has '$threadId' at $actualUrl."
    }
    if ($Name -eq 'GuestA' -and $script:guestBThread -and $threadId -eq $script:guestBThread) { throw 'Guest A profile resolved to Guest B thread state.' }
    if ($Name -eq 'GuestB' -and $script:guestAThread -and $threadId -eq $script:guestAThread) { throw 'Guest B profile resolved to Guest A thread state.' }
    if ($threadId) {
      $probe = Get-ThreadStateProbe $threadId
      if ($probe.status -ne 200 -or -not $probe.body.ok -or $probe.body.threadId -ne $threadId) { throw "$Name profile '$homeName' failed its authenticated thread-state verification for '$threadId'." }
    }
    $script:activeThreadId = $threadId
  }
}

function Start-Session([string]$Name, [string]$Url = "$origin/") {
  $profile = switch ($Name) { 'guest-a' { 'GuestA' } 'guest-b' { 'GuestB' } 'operator' { 'Operator' } default { throw "Unknown Rodney session name '$Name'." } }
  Use-RodneySession $profile $Url
}

function Click-GeneratedAction([string]$AccessibleName) {
  $nodes = Invoke-Rodney @('ax-find','--role','button','--name',$AccessibleName)
  if (-not $nodes.Trim()) { throw "Generated action has no accessible button named '$AccessibleName'." }
  $selector = Invoke-Rodney @('js',"Array.from(document.querySelectorAll('button[data-a2ui-component=Button]')).find(b => (b.getAttribute('aria-label') || b.innerText.trim()) === '$AccessibleName')?.getAttribute('aria-label')")
  if ($selector -and $selector -ne 'null') {
    Invoke-Rodney @('js',"document.querySelector('#active-workspace button[aria-label=`"$selector`"]')?.scrollIntoView({block:'center'})") | Out-Null
    Invoke-Rodney @('click',"#active-workspace button[aria-label=`"$selector`"]") | Out-Null
  } else {
    $count = [int](Invoke-Rodney @('count','#active-workspace button[data-a2ui-component="Button"]'))
    if ($count -ne 1) { throw "Cannot uniquely address generated action '$AccessibleName' by accessible name; found $count candidate buttons." }
    Invoke-Rodney @('js',"document.querySelector('#active-workspace button[data-a2ui-component=Button]')?.scrollIntoView({block:'center'})") | Out-Null
    Invoke-Rodney @('click','#active-workspace button[data-a2ui-component="Button"]') | Out-Null
  }
  Invoke-Rodney @('waitstable') | Out-Null
}

function Wait-ComposerReady {
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  do {
    try { Invoke-Rodney @('assert','document.querySelector("#composer-input").disabled === false') | Out-Null; return }
    catch { Start-Sleep -Milliseconds 250 }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Guest composer did not become enabled after the submitted turn.'
}

function Send-Guest([string]$Text) {
  if ($script:activeProfile -notin @('GuestA','GuestB')) {
    $currentUrl = ''; try { $currentUrl = Invoke-Rodney @('url') } catch {}
    $expectedGuest = if ($script:activeScenario -match 'Guest B') { 'GuestB' } elseif ($script:activeScenario -match 'Guest A') { 'GuestA' } else { 'a Guest' }
    throw "Expected $expectedGuest session but Rodney is attached to $($script:activeProfile) at $currentUrl before composer input."
  }
  Invoke-Rodney @('input','#composer-input',$Text) | Out-Null
  Invoke-Rodney @('click','#composer-submit') | Out-Null
  Invoke-Rodney @('waitstable') | Out-Null
  Wait-ComposerReady
}

function Get-BookingCounts {
  $code = "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('.scratch/pilot-local/shortlet.sqlite',{readOnly:true});const count=t=>Number(db.prepare('SELECT count(*) AS n FROM '+t).get().n);console.log(JSON.stringify({reservations:count('local_booking_reservations'),contracts:count('local_booking_contracts')}));db.close()"
  $json = Invoke-Captured 'node' @('-e',$code) ''
  return $json | ConvertFrom-Json
}

function Assert-AccessibleName([string]$Role, [string]$Name, [string]$Scenario) {
  $evidence = Invoke-Rodney @('ax-find','--role',$Role,'--name',$Name)
  if (-not $evidence.Trim()) { throw "Essential $Role control has no accessible node named '$Name' ($Scenario)." }
  $excerpt = (($evidence -split "`n" | Select-Object -First 2) -join ' ').Trim()
  $script:accessibilityEvidence.Add($excerpt)
  Add-Scenario "Accessibility: $Scenario" "Accessible $Role named '$Name' exists." $excerpt
}

function Get-GuestThread {
  return Invoke-Rodney @('js','sessionStorage.getItem("shortlet-concierge-thread") || ""')
}

function Get-TranscriptTurnCount {
  return [int](Invoke-Rodney @('js','document.querySelectorAll("#transcript article.turn").length'))
}

function Get-NewTranscriptText([int]$PreviousTurnCount, [ValidateSet('assistant','user')][string]$Role = 'assistant') {
  return Invoke-Rodney @('js',"Array.from(document.querySelectorAll('#transcript article.turn')).slice($PreviousTurnCount).filter(turn=>turn.classList.contains('$Role')).map(turn=>turn.innerText.trim()).join('\n')")
}

function Get-ThreadStateProbe([string]$ThreadId) {
  $encodedThreadId = [uri]::EscapeDataString($ThreadId)
  $result = Invoke-Rodney @('js',"fetch('/api/state?threadId=$encodedThreadId',{credentials:'include'}).then(async response=>JSON.stringify({status:response.status,body:await response.json()}))")
  return $result | ConvertFrom-Json
}

function Save-MobileShots([string]$Prefix, [int]$Width) {
  $height = if ($Width -eq 320) { 740 } else { 844 }
  $path = Join-Path $shots "$Prefix-$Width.png"
  Invoke-Rodney @('screenshot','-w',[string]$Width,'-h',[string]$height,$path) | Out-Null
  $metrics = Invoke-Rodney @('js','JSON.stringify({innerWidth:window.innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})') | ConvertFrom-Json
  if ($metrics.innerWidth -ne $Width -or $metrics.clientWidth -ne $Width) {
    $script:environmentLimitations.Add("Rodney screenshot sizing did not change the viewport to $Width CSS pixels; this image is capture-dimension evidence only.")
    Add-Scenario "$Prefix $Width px" 'Viewport behavioral test only when actual viewport changes.' "SKIPPED: Rodney left innerWidth=$($metrics.innerWidth), clientWidth=$($metrics.clientWidth); screenshot dimensions are not behavioral proof." 'SKIPPED' @(".scratch/pilot-acceptance-rodney/screenshots/$([IO.Path]::GetFileName($path))")
    return
  }
  $scroll = [int]$metrics.scrollWidth
  if ($scroll -gt $Width) { throw "Horizontal overflow at $Width CSS px ($scroll > $Width)." }
  Invoke-Rodney @('visible','#composer-input') | Out-Null
  Add-Scenario "$Prefix $Width px" "Actual browser viewport is $Width CSS pixels, content fits, and the composer remains visible." "innerWidth=$($metrics.innerWidth); clientWidth=$($metrics.clientWidth); scrollWidth=$scroll." 'PASS' @(".scratch/pilot-acceptance-rodney/screenshots/$([IO.Path]::GetFileName($path))")
}

function Stop-PreviousAcceptanceBrowsers {
  if (-not (Test-Path $sessions)) { return }
  foreach ($profile in Get-ChildItem $sessions -Directory -ErrorAction SilentlyContinue) {
    if (-not (Test-Path (Join-Path $profile.FullName 'state.json'))) { continue }
    $env:RODNEY_HOME = $profile.FullName
    try { Invoke-Captured 'rodney' @('stop') '' | Out-Null } catch {}
  }
  Remove-Item Env:RODNEY_HOME -ErrorAction SilentlyContinue
}

function Write-Reports([string]$Overall, [int]$ExitCode, [string]$ErrorText = '') {
  $result = [ordered]@{
    startedAt = $script:startTime.ToString('o'); completedAt = [DateTime]::UtcNow.ToString('o'); startingHead = $script:head
    rodneyVersion = $script:rodneyVersion; serverOwned = $script:serverOwned; restart = $script:restart
    rodneyExecutable = $script:rodneyPath; rodneySha256 = $script:rodneyHash; environmentLimitations = @($script:environmentLimitations)
    accessibilityEvidence = @($script:accessibilityEvidence)
    status = $Overall; exitCode = $ExitCode; error = $ErrorText; scenarios = @($script:scenarios)
    screenshotCount = @(Get-ChildItem $shots -Filter '*.png' -ErrorAction SilentlyContinue).Count
  }
  $json = $result | ConvertTo-Json -Depth 12
  Set-Content -Path $jsonPath -Value $json -Encoding utf8
  $md = [System.Collections.Generic.List[string]]::new()
  $md.Add('# Shortlet Pilot Rodney Acceptance')
  $md.Add("")
  $md.Add("- Status: **$Overall**")
  $md.Add("- Starting HEAD: ``$($script:head)``")
  $md.Add("- Rodney: ``$($script:rodneyVersion)``")
  $md.Add("- Rodney executable: ``$($script:rodneyPath)``")
  $md.Add("- Server owned: ``$($script:serverOwned)``; restart: ``$($script:restart)``")
  foreach ($limitation in $script:environmentLimitations) { $md.Add("- Environment limitation: $limitation") }
  if ($script:accessibilityEvidence.Count) { $md.Add('- Accessibility evidence: ' + ($script:accessibilityEvidence -join '; ')) }
  $md.Add("- Screenshots: $($result.screenshotCount)")
  if ($ErrorText) { $md.Add("- Harness error: $ErrorText") }
  foreach ($s in $script:scenarios) {
    $md.Add("")
    $md.Add("## $($s.status): $($s.scenario)")
    $md.Add("- Expected: $($s.expected)")
    $md.Add("- Observed: $($s.observed)")
    if ($s.screenshots.Count) { $md.Add("- Screenshots: $($s.screenshots -join ', ')") }
    if ($s.diagnostic) { $md.Add("- Safe diagnostics: ``$($s.diagnostic -replace '[\r\n]+',' ')``") }
  }
  Set-Content -Path $reportPath -Value ($md -join "`n") -Encoding utf8
}

$script:startTime = [DateTime]::UtcNow
$exitCode = 2
$overall = 'ENVIRONMENT_FAILURE'
$errorText = ''
New-Item -ItemType Directory -Force -Path $logs,$shots,$sessions | Out-Null
try {
  if ($Reset -and $UseExistingServer) { throw '-Reset cannot be combined with -UseExistingServer. Stop the manual server yourself, then run the reset-owned command.' }
  $script:head = (git rev-parse HEAD).Trim()
  $allowedHarnessChanges = @('.gitignore','docs/pilot-local-run.md','package.json')
  $changed = @(git status --porcelain --untracked-files=no | Where-Object {
    $path = $_.Substring(3).Trim()
    $allowedHarnessChanges -notcontains $path -and $path -ne 'scripts/pilot-acceptance-rodney.ps1'
  })
  if ($changed.Count -gt 0) { throw "Tracked modifications exist; refusing acceptance run: $($changed -join '; ')" }
  $rodneyCommands = @(Get-Command rodney -All | Where-Object { $_.CommandType -eq 'Application' })
  if ($rodneyCommands.Count -ne 1) { throw "Expected exactly one Rodney executable on PATH; found $($rodneyCommands.Count)." }
  $script:rodneyPath = $rodneyCommands[0].Source
  $script:rodneyHash = (Get-FileHash $script:rodneyPath -Algorithm SHA256).Hash
  $rodneyFile = Get-Item $script:rodneyPath
  $script:rodneyMetadata = "Path: $script:rodneyPath`nFileVersion: $($rodneyFile.VersionInfo.FileVersion)`nProductVersion: $($rodneyFile.VersionInfo.ProductVersion)`nSHA256: $script:rodneyHash"
  $versionOut = Invoke-Captured 'rodney' @('--version') 'rodney-version.log'
  $script:rodneyVersion = ($versionOut -split "`n" | Select-Object -First 1).Trim()
  if ($script:rodneyVersion -notmatch '^0\.4\.') { throw "Rodney version does not match the verified RODNEY_HOME behavior (expected 0.4.x): $script:rodneyVersion" }
  Invoke-Captured 'rodney' @('status') 'rodney-preflight-status.log' | Out-Null
  try { $script:rodneyStartHelp = Invoke-Captured 'rodney' @('start','--help') 'rodney-start-help.log' }
  catch { $script:rodneyStartHelp = $_.Exception.Message; $script:environmentLimitations.Add('`rodney start --help` is rejected by the resolved executable (usage output is recorded in logs).') }
  $probeHome = Join-Path $sessions 'rodney-show-probe'
  New-Item -ItemType Directory -Force -Path $probeHome | Out-Null
  $previousRodneyHome = $env:RODNEY_HOME
  $env:RODNEY_HOME = $probeHome
  try {
    $script:rodneyShowResult = Invoke-Captured 'rodney' @('start','--show') 'rodney-show-preflight.log'
    Invoke-Captured 'rodney' @('stop') '' | Out-Null
  } catch {
    $script:rodneyShowResult = $_.Exception.Message
    $script:environmentLimitations.Add('`rodney start --show` failed in isolated preflight; the required headless acceptance mode remains available.')
    try { Invoke-Captured 'rodney' @('stop') '' | Out-Null } catch {}
  } finally {
    if ($null -eq $previousRodneyHome) { Remove-Item Env:RODNEY_HOME -ErrorAction SilentlyContinue } else { $env:RODNEY_HOME = $previousRodneyHome }
  }

  $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener -and -not $UseExistingServer) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    throw "Port 3000 is occupied by PID $($listener.OwningProcess) ($($owner.Name): $($owner.CommandLine)). The harness will not kill it. Stop that exact pilot tree yourself or pass -UseExistingServer."
  }
  if ($Reset) {
    Stop-PreviousAcceptanceBrowsers
    if (Test-Path $root) { Get-ChildItem $root -Force | Remove-Item -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $logs,$shots,$sessions | Out-Null
    Set-Content (Join-Path $logs 'rodney-executable.txt') $script:rodneyMetadata
    Set-Content (Join-Path $logs 'rodney-version.log') $versionOut
    Set-Content (Join-Path $logs 'rodney-start-help.log') $script:rodneyStartHelp
    Set-Content (Join-Path $logs 'rodney-show-preflight.log') $script:rodneyShowResult
    Invoke-Captured 'npm.cmd' @('run','pilot:local:reset') 'reset.log' | Out-Null
    Invoke-Captured 'npm.cmd' @('run','pilot:local:bootstrap') 'bootstrap.log' | Out-Null
    Add-Scenario 'Explicit local state reset/bootstrap' 'Reset only the local pilot data, then bootstrap authoritative inventory before server start.' 'Reset and bootstrap commands completed; acceptance artifacts were cleaned in their dedicated directory.'
  }
  if ($UseExistingServer) { if (-not $listener) { throw '-UseExistingServer was supplied but port 3000 has no listener.' }; Wait-Healthy; Add-Scenario 'Server lifecycle' 'Use existing healthy local pilot; restart skipped.' 'Existing server healthy.' }
  else { Start-Pilot; Add-Scenario 'Server lifecycle' 'Harness starts pilot and waits for /healthz.' 'Owned npm run pilot:local server is healthy.' }

  $script:activeScenario = 'Guest A home'
  Start-Session 'guest-a'
  Assert-Rodney @('visible','#composer-input') 'Guest composer is visible.' 'Guest home composer'
  Assert-AccessibleName 'heading' 'Shortlet Concierge' 'Guest page heading'
  Assert-AccessibleName 'textbox' 'Message the concierge' 'Guest composer textbox'
  Assert-AccessibleName 'button' 'Send' 'Guest send button'
  $homeText = Invoke-Rodney @('text','body')
  if ($homeText -match 'AUTHENTICATION_REQUIRED') { throw 'Guest home displayed an authentication-required response.' }
  $script:guestAThread = Get-GuestThread
  if (-not $script:guestAThread) { throw 'Guest A session did not create a conversation thread in its isolated browser profile.' }
  $homeShot = Capture '01-guest-home.png'
  Add-Scenario 'Guest A initial session' 'Fresh isolated Guest page loads HTML, heading and composer without authentication error.' 'Guest home loaded in Guest A Rodney profile.' 'PASS' @($homeShot)

  $script:activeScenario = 'Lagos multi-turn discovery'
  Send-Guest 'Lagos'
  Send-Guest '2 nights and 2 guests'
  Send-Guest 'Lekki'
  [void](Assert-ProductSelector '.weaver-mount[data-renderer="weaver"]' 'Discovery results render through Weaver.' 'Lagos multi-turn discovery' '02-lekki-discovery.png')
  $body = Invoke-Rodney @('text','body')
  if ($body -notmatch 'Lekki' -or $body -notmatch '2 nights' -or $body -notmatch '2 guests') { throw 'Discovery did not visibly retain location and party context.' }
  $discovery = '.scratch/pilot-acceptance-rodney/screenshots/02-lekki-discovery.png'
  Assert-AccessibleName 'button' 'View Unit' 'Generated discovery action'
  Save-MobileShots '24-discovery' 390
  Save-MobileShots '27-discovery' 320
  Invoke-Rodney @('screenshot','-w','1280','-h','900',(Join-Path $shots 'viewport-reset.png')) | Out-Null

  $script:activeScenario = 'Authoritative Lekki result'
  $inventory = Get-Content '.scratch/pilot-local/inventory.json' -Raw | ConvertFrom-Json
  $lekki = $inventory | Where-Object { $_.id -eq 'unit-local-lagos-lekki' -or $_.unitId -eq 'unit-local-lagos-lekki' } | Select-Object -First 1
  if (-not $lekki) { throw 'Could not find Lekki unit in bootstrapped authoritative inventory.' }
  $expectedTitle = [string]$lekki.title
  if ($body -notmatch [regex]::Escape($expectedTitle)) { throw 'Rendered discovery result did not match authoritative Lekki Unit title.' }
  $expectedKobo = ([long]$lekki.price.nightlyKobo * 2) + [long]$lekki.price.mandatoryFeesKobo
  $expectedAmount = 'NGN ' + ([decimal]$expectedKobo / 100).ToString('N0',[Globalization.CultureInfo]::InvariantCulture)
  $expectedDigits = ([decimal]$expectedKobo / 100).ToString('N0',[Globalization.CultureInfo]::InvariantCulture)
  if ($body -notmatch [regex]::Escape($expectedDigits)) { throw "Rendered All-In Stay Total does not match the authoritative inventory calculation ($expectedAmount)." }
  $discoveryScreenshot = '.scratch/pilot-acceptance-rodney/screenshots/02-lekki-discovery.png'
  Add-Scenario 'Authoritative Lekki discovery result' 'Rendered Unit identity, location and All-In Stay Total match authoritative inventory.' "Title and authoritative All-In Stay Total $expectedAmount match." 'PASS' @($discoveryScreenshot)
  $script:activeScenario = 'Generated Unit-detail action'
  Click-GeneratedAction 'View Unit'
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
  $detailText = Invoke-Rodney @('text','#active-workspace')
  if ($detailText -notmatch [regex]::Escape($expectedTitle)) { throw 'Generated Unit action did not open the expected authoritative Unit detail.' }
  foreach ($fact in @($lekki.location.neighbourhood,'Bedrooms: 1','Bathrooms: 1','Capacity: 2 guests','wifi',$expectedDigits)) {
    if ($detailText -notmatch [regex]::Escape([string]$fact)) { throw "Unit detail did not show required authoritative fact: $fact" }
  }
  if ($detailText -notmatch [regex]::Escape([string]$lekki.description) -or [int](Invoke-Rodney @('count','.weaver-mount img')) -lt 1) { throw 'Unit detail did not render the authoritative description and a photo.' }
  $detailPhoto = Invoke-Rodney @('js','document.querySelector(".weaver-mount img")?.getAttribute("src") || ""')
  if ($detailPhoto -notmatch '/photos/') { throw 'Unit detail image does not use an authoritative inventory photo.' }
  Assert-AccessibleName 'button' 'Request to Book' 'Generated Unit-detail booking action'
  $detailScreenshot = Capture '03-unit-detail.png'
  Add-Scenario 'Unit detail' 'Generated result action opens the Unit-detail workspace through Weaver.' 'Unit detail rendered with authoritative Unit title.' 'PASS' @($detailScreenshot)
  Save-MobileShots '25-detail' 390
  Save-MobileShots '28-detail' 320
  Invoke-Rodney @('screenshot','-w','1280','-h','900',(Join-Path $shots 'viewport-reset.png')) | Out-Null

  $script:activeScenario = 'Two-bedroom refinement'
  $refinementTurnStart = Get-TranscriptTurnCount
  Send-Guest 'Only show me two bedrooms.'
  $refined = Capture '04-refined-discovery.png'
  $refinedText = Get-NewTranscriptText $refinementTurnStart
  $workspaceCount = [int](Invoke-Rodney @('count','.weaver-mount'))
  if ($refinedText -notmatch '2026-09-29 to 2026-10-01' -or $refinedText -notmatch '0 eligible places' -or $workspaceCount -ne 1) {
    Add-Scenario 'Refinement' 'Preserve Lagos stay context and render only matching two-bedroom results in one current workspace.' 'Refinement did not preserve expected context or produced unexpected workspace count.' 'FAIL' @($refined) $refinedText
    throw [InvalidOperationException]::new('Product acceptance failure at refinement; stopped without fixing product behavior.')
  }
  Add-Scenario 'Refinement' 'Preserve Lagos stay context and render only matching two-bedroom results in one current workspace.' 'Zero Lekki matches (the authoritative Lekki Unit has one bedroom); Lagos stay dates remain in the transcript and exactly one Weaver mount is present.' 'PASS' @($refined)
  $oldIkoyiTurnStart = Get-TranscriptTurnCount
  Send-Guest 'Old Ikoyi'
  $oldIkoyiAssistant = Get-NewTranscriptText $oldIkoyiTurnStart
  if ($oldIkoyiAssistant -match '(?i)how many nights|how many guests|how many people') {
    $missingStayTurnStart = Get-TranscriptTurnCount
    Send-Guest '2 nights and 2 guests'
    $oldIkoyiAssistant = Get-NewTranscriptText $missingStayTurnStart
  }
  if ($oldIkoyiAssistant -notmatch 'eligible places?' -or (Invoke-Rodney @('text','#active-workspace')) -notmatch 'eligible Unit') { throw 'The selected two-bedroom Old Ikoyi result did not appear after refinement.' }
  Click-GeneratedAction 'View Unit'
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null

  $script:activeScenario = 'Guest A Request Draft'
  $chosenDetail = Invoke-Rodney @('text','#active-workspace')
  $unitButton = Invoke-Rodney @('js','Array.from(document.querySelectorAll("button[data-a2ui-component=Button]")).map(b=>b.getAttribute("aria-label")||b.innerText.trim()).join("\n")')
  if ($unitButton -notmatch '(?m)^Request to Book$') { throw 'Unit-detail surface did not expose its generated Request to Book action.' }
  $chosenUnit = $inventory | Where-Object { $chosenDetail -match [regex]::Escape([string]$_.title) } | Select-Object -First 1
  if (-not $chosenUnit) { throw 'Could not identify the selected Guest A Unit from authoritative inventory.' }
  $chosenTitle = [string]$chosenUnit.title
  $stayMatch = [regex]::Match($chosenDetail,'Stay: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})')
  if (-not $stayMatch.Success) { throw 'Guest A Unit detail omitted the authoritative stay dates.' }
  $script:guestACheckIn = $stayMatch.Groups[1].Value
  $script:guestACheckOut = $stayMatch.Groups[2].Value
  if ($chosenDetail -notmatch [regex]::Escape($chosenTitle)) { throw 'Generated booking action title does not match visible Unit detail.' }
  $script:guestAUnitTitle = $chosenTitle
  $script:guestAUnitId = [string]$chosenUnit.id
  Click-GeneratedAction 'Request to Book'
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
  $draftText = Invoke-Rodney @('text','#active-workspace')
  if ($draftText -notmatch 'Request Draft' -or $draftText -notmatch 'Inventory is not reserved') { throw 'Request Draft surface missing or incorrectly represents inventory reservation.' }
  $draftShot = Capture '07-request-draft.png'
  Add-Scenario 'Guest A Request Draft' 'Generated Request to Book action creates a Weaver Request Draft without reserving inventory.' 'Request Draft is visible; no inventory reservation is stated.' 'PASS' @($draftShot)
  Assert-AccessibleName 'button' 'Review Request' 'Request Draft review action'

  Click-GeneratedAction 'Review Request'
  $reviewText = Invoke-Rodney @('text','#active-workspace')
  if ($reviewText -notmatch 'Review Booking Request' -or $reviewText -notmatch 'All-In Stay Total' -or $reviewText -notmatch [regex]::Escape("$($script:guestACheckIn) to $($script:guestACheckOut)")) { throw 'Booking review omitted the Unit price or authoritative stay dates.' }
  $reviewShot = Capture '09-booking-review.png'
  Add-Scenario 'Booking review' 'Review displays authoritative Unit, stay, All-In Stay Total and currency before submission.' 'Review surface includes the chosen Unit, stay 2026-09-29–2026-10-01 and All-In Stay Total.' 'PASS' @($reviewShot)
  Save-MobileShots 'booking-review' 390
  Save-MobileShots 'booking-review' 320
  Invoke-Rodney @('screenshot','-w','1280','-h','900',(Join-Path $shots 'viewport-reset.png')) | Out-Null
  Assert-AccessibleName 'button' 'Submit Booking Request' 'Booking review submission action'
  Click-GeneratedAction 'Submit Booking Request'
  $phoneText = Invoke-Rodney @('text','#active-workspace')
  if ($phoneText -notmatch 'Phone number') { throw 'Submitting the review did not show the required phone collection surface.' }
  $phoneShot = Capture '08-phone.png'
  $phoneEvidence = Invoke-Rodney @('ax-find','--role','textbox')
  if (-not $phoneEvidence.Trim()) { throw 'Phone collection input is not exposed as an accessible textbox.' }
  $script:accessibilityEvidence.Add(($phoneEvidence -split "`n" | Select-Object -First 2) -join ' ')
  Invoke-Rodney @('input','.weaver-mount input','+2348090001111') | Out-Null
  Assert-AccessibleName 'button' 'Save Phone number' 'Phone collection action'
  $guestASubmitTurnStart = Get-TranscriptTurnCount
  Click-GeneratedAction 'Save Phone number'
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
  $submittedText = Invoke-Rodney @('text','#active-workspace')
  $submittedAssistant = Get-NewTranscriptText $guestASubmitTurnStart
  if ($submittedText -notmatch 'Booking Request' -or $submittedAssistant -notmatch 'Booking Request submitted' -or $submittedAssistant -notmatch 'No Reservation exists yet') { throw 'Submitted request surface is missing or incorrectly implies confirmation.' }
  $submittedShot = Capture '10-request-submitted.png'
  Add-Scenario 'Phone collection' 'Collect valid synthetic Nigerian phone through generated UI and resume submission.' 'Phone saved through Weaver input; request submission resumed.' 'PASS' @($phoneShot)
  Add-Scenario 'Booking Request submitted' 'Real Guest submission is visible and not represented as confirmed/Reservation.' 'Booking Request status visible; UI states no Reservation exists yet.' 'PASS' @($submittedShot)


  # Prove Guest A's submitted request is visible only within its browser session.
  $script:guestAThread = Get-GuestThread
  $guestAState = Get-ThreadStateProbe $script:guestAThread
  if ($guestAState.status -ne 200 -or @($guestAState.body.timeline).Count -eq 0) { throw 'Guest A browser session could not read its own conversation through the Guest state endpoint.' }
  $guestARequestSurface = @($guestAState.body.surfaces | Where-Object { $_.surfaceId -match ':request:req-' } | Select-Object -Last 1)
  if ($guestARequestSurface.Count -ne 1) { throw 'Guest A authoritative state omitted its submitted Booking Request surface.' }
  $guestARequestMatch = [regex]::Match([string]$guestARequestSurface[0].surfaceId,':request:(req-[^:]+)$')
  if (-not $guestARequestMatch.Success) { throw 'Guest A request surface did not contain an opaque request identity.' }
  $script:guestARequestId = $guestARequestMatch.Groups[1].Value

  # Establish Guest B before Operator login so unauthenticated isolation is checked against both Guest threads.
  $script:activeScenario = 'Guest B fresh session and cross-Guest isolation'
  Start-Session 'guest-b'
  $script:guestBThread = Get-GuestThread
  if (-not $script:guestBThread -or $script:guestBThread -eq $script:guestAThread) { throw 'Guest B did not receive a distinct Guest thread in its isolated browser profile.' }
  Send-Guest 'Lagos'
  $guestBState = Get-ThreadStateProbe $script:guestBThread
  if ($guestBState.status -ne 200 -or @($guestBState.body.timeline).Count -eq 0) { throw 'Guest B browser session could not read its own fresh conversation through the Guest state endpoint.' }
  $guestBHomeText = Invoke-Rodney @('text','body')
  if ($guestBHomeText -match [regex]::Escape($script:guestAUnitTitle) -or $guestBHomeText -match [regex]::Escape($script:guestAUnitId) -or $guestBHomeText -match 'Booking Request submitted') { throw 'Guest B home exposed Guest A conversation or Booking Request state.' }
  $guestAFromB = Get-ThreadStateProbe $script:guestAThread
  if ($guestAFromB.status -ne 200 -or @($guestAFromB.body.timeline).Count -ne 0 -or @($guestAFromB.body.surfaces).Count -ne 0) { throw 'Guest B browser session received Guest A thread state from the authenticated Guest state endpoint.' }
  $guestBIsolationShot = Capture '11-guest-b-isolated-home.png'
  Add-Scenario 'Guest A / Guest B isolation' 'Guest B receives a distinct conversation and cannot read Guest A thread state through the normal Guest endpoint.' 'Guest B has its own thread and active Guest session; Guest A thread probe returned an empty projection.' 'PASS' @($guestBIsolationShot)

  $script:activeScenario = 'Operator token and login'
  $tokenOutput = Invoke-Captured 'npm.cmd' @('run','pilot:local:operator-token') '' -Sensitive
  $script:token = ($tokenOutput -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[A-Za-z0-9_-]{40,}$' } | Select-Object -First 1)
  if (-not $script:token) { throw 'Operator token command did not return the expected one-time token format; output was suppressed.' }
  Start-Session 'operator' "$origin/operator/login"
  Assert-AccessibleName 'textbox' 'One-time access token' 'Operator login token input'
  Assert-AccessibleName 'button' 'Sign in' 'Operator login submit button'
  if ((Invoke-Rodney @('js','sessionStorage.getItem("shortlet-concierge-thread") || ""')) -ne '') { throw 'Operator profile inherited Guest conversation session state.' }
  $operatorLoginText = Invoke-Rodney @('text','body')
  if ($operatorLoginText -match [regex]::Escape($script:guestAUnitTitle) -or $operatorLoginText -match 'Booking Request submitted|Lagos') { throw 'Unauthenticated Operator login exposed Guest A or Guest B application state.' }
  foreach ($guestThread in @($script:guestAThread,$script:guestBThread)) {
    $operatorProbe = Get-ThreadStateProbe $guestThread
    if ($operatorProbe.status -ne 401 -or $operatorProbe.body.code -ne 'AUTHENTICATION_REQUIRED') { throw 'Unauthenticated Operator profile accessed a Guest thread through the normal Guest state endpoint.' }
  }
  Add-Scenario 'Unauthenticated Operator isolation' 'Before login, Operator profile has no Guest conversation and Guest state requests require Guest authentication.' 'Login UI is unauthenticated; Guest A and Guest B thread probes returned AUTHENTICATION_REQUIRED.' 'PASS'
  Invoke-Rodney @('input','input[name=token]',$script:token) -Sensitive | Out-Null
  Invoke-Rodney @('submit','form[action="/operator/login"]') | Out-Null
  Invoke-Rodney @('wait','h1') | Out-Null
  $operatorText = Invoke-Rodney @('text','body')
  if ($operatorText -notmatch 'Operator workspace') { throw 'Operator login did not establish an authenticated session.' }
  Invoke-Rodney @('open',"$origin/operator/login") | Out-Null
  Invoke-Rodney @('input','input[name=token]',$script:token) -Sensitive | Out-Null
  Invoke-Rodney @('submit','form[action="/operator/login"]') -Sensitive | Out-Null
  Invoke-Rodney @('wait','[role=alert]') | Out-Null
  $reuseText = Invoke-Rodney @('text','[role=alert]')
  if ($reuseText -notmatch 'consum|invalid|expired|used') { throw 'Operator token reuse did not fail with an authentication error.' }
  $script:token = $null
  Invoke-Rodney @('open',"$origin/operator/requests") | Out-Null
  if ((Invoke-Rodney @('text','body')) -notmatch 'Booking Requests') { throw 'Failed token replay invalidated the established Operator session.' }
  $operatorInbox = Capture '11-operator-inbox.png'
  Add-Scenario 'Operator token and login' 'Fresh ADR-0086 one-time token authenticates only the isolated Operator profile through login UI.' 'Operator workspace displayed after successful UI login; token omitted from evidence.' 'PASS' @($operatorInbox)
  Add-Scenario 'Guest A / Operator profile isolation' 'Operator profile is separate from Guest A and authenticates only through the one-time Operator login flow.' 'Operator login established the Operator workspace; before login, the profile had no Guest thread and could not read either Guest thread.'

  $script:activeScenario = 'Operator request confirmation'
  Invoke-Rodney @('open',"$origin/operator/requests") | Out-Null
  Invoke-Rodney @('wait','h1') | Out-Null
  $inboxText = Invoke-Rodney @('text','body')
  if ($inboxText -notmatch [regex]::Escape($script:guestAUnitId)) { throw 'Operator inbox does not show Guest A Booking Request.' }
  $requestScript = "Array.from(document.querySelectorAll('a[href^=`"/operator/requests/`"]')).find(a=>a.parentElement?.innerText.includes('$($script:guestAUnitId)'))?.getAttribute('href') || ''"
  $requestHref = Invoke-Rodney @('js',$requestScript)
  if (-not $requestHref.StartsWith('/operator/requests/')) { throw 'Could not select Guest A request from the visible Operator inbox.' }
  Invoke-Rodney @('click',"a[href=`"$requestHref`"]") | Out-Null
  $requestText = Invoke-Rodney @('text','body')
  foreach ($requiredFact in @($script:guestAUnitId,$script:guestACheckIn,$script:guestACheckOut,'All-In Stay Total','Phone number')) { if ($requestText -notmatch [regex]::Escape($requiredFact)) { throw "Operator request detail omitted required fact: $requiredFact" } }
  $operatorRequestShot = Capture '12-operator-request.png'
  Add-Scenario 'Operator inbox and request detail' 'Operator inspects Guest A request facts through the real inbox and detail UI.' 'Unit, dates, party, contact, amount and status were visible.' 'PASS' @($operatorRequestShot)
  Assert-AccessibleName 'button' 'Confirm Booking Request' 'Operator confirmation action'
  Assert-AccessibleName 'button' 'Decline Booking Request' 'Operator decline action'
  Invoke-Rodney @('click','form[action$="/confirm"] button') | Out-Null
  Invoke-Rodney @('waitstable') | Out-Null
  $confirmedOperatorText = Invoke-Rodney @('text','body')
  if ($confirmedOperatorText -notmatch 'confirmed|Conditional Booking Offer') { throw 'Operator confirmation did not result in a confirmed request state.' }
  $operatorConfirmedShot = Capture '13-operator-confirmed.png'
  Add-Scenario 'Operator confirmation' 'Confirm Guest A request using Operator UI.' 'Request detail shows confirmed state.' 'PASS' @($operatorConfirmedShot)

  $script:activeScenario = 'Guest A Conditional Booking Offer'
  Use-RodneySession GuestA "$origin/" $script:guestAThread
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
  $offerText = Invoke-Rodney @('text','#active-workspace')
  if ($offerText -notmatch 'Conditional Booking Offer' -or $offerText -notmatch 'NGN|₦' -or $offerText -notmatch '2026') { throw 'Guest A refresh did not render the authoritative Conditional Booking Offer, amount and deadline.' }
  Assert-AccessibleName 'button' 'Accept' 'Guest offer acceptance action'
  $offerShot = Capture '14-conditional-offer.png'
  Add-Scenario 'Conditional Booking Offer' 'Guest refresh reflects Operator confirmation and renders Weaver offer with amount and deadline.' 'Offer, amount, status/deadline and generated acceptance action are visible.' 'PASS' @($offerShot)
  Click-GeneratedAction 'Accept'

  $paymentReadyText = Invoke-Rodney @('text','#active-workspace')
  if ($paymentReadyText -notmatch 'Secure card payment' -or $paymentReadyText -notmatch 'Payment status: ready' -or $paymentReadyText -notmatch 'NGN\s+[\d,]+\.\d{2}' -or $paymentReadyText -notmatch 'Total cash requirement') {
    throw 'Accept did not advance directly to the authoritative NGN payment-ready surface.'
  }
  if ($paymentReadyText -match 'payment succeeded|payment complete|Reservation confirmed|Booking Contract') {
    throw 'Payment-ready surface incorrectly claims payment success or booking confirmation.'
  }
  $acceptedState = Get-ThreadStateProbe (Get-GuestThread)
  if ($acceptedState.status -ne 200 -or -not $acceptedState.body.ok) { throw 'Guest state probe did not return the post-Accept authoritative projection.' }
  $paymentSurface = @($acceptedState.body.surfaces | Where-Object { $_.summary -eq 'Secure payment' } | Select-Object -Last 1)
  if ($paymentSurface.Count -ne 1 -or $paymentSurface[0].status -ne 'active' -or $paymentSurface[0].surfaceId -notmatch ':payment:ready:') {
    throw 'Post-Accept projection did not make the Secure payment-ready surface active.'
  }
  $paymentProjection = $paymentSurface[0].a2uiMessages | ConvertTo-Json -Depth 30 -Compress
  if ($paymentProjection -notmatch 'Payment status: ready' -or $paymentProjection -notmatch 'Total cash requirement: NGN') {
    throw 'Authoritative payment artifact omitted its ready status or NGN cash requirement.'
  }
  $remainingOfferAction = Invoke-Rodney @('js','Array.from(document.querySelectorAll("#active-workspace button[data-a2ui-component=Button]")).some(button=>button.innerText.trim()==="Accept")')
  if ($remainingOfferAction -ne 'false') { throw 'The superseded Conditional Booking Offer still exposes its Accept action in the active workspace.' }
  $countsAfterOfferAcceptance = Get-BookingCounts
  if ($countsAfterOfferAcceptance.reservations -ne 0 -or $countsAfterOfferAcceptance.contracts -ne 0) {
    throw 'Offer acceptance created a Reservation or Booking Contract before payment verification.'
  }
  Assert-AccessibleName 'button' 'Start secure checkout' 'Payment continuation action'
  $readyShot = Capture '15-payment-ready.png'
  Add-Scenario 'Offer acceptance and payment-ready state' 'Accept the Conditional Booking Offer once and inspect the authoritative payment projection.' 'The Offer is no longer actionable; Secure payment is active with the authoritative NGN amount, and no Reservation or Booking Contract exists.' 'PASS' @($readyShot)

  Assert-AccessibleName 'button' 'Start secure checkout' 'Payment continuation action'
  Click-GeneratedAction 'Start secure checkout'
  $emailText = Invoke-Rodney @('text','#active-workspace')
  if ($emailText -notmatch 'Email address for payment and booking receipt' -or $emailText -notmatch 'Required before payment continuation') { throw 'Payment continuation did not clearly request the required email through the Guest UI.' }
  $emailShot = Capture '16-payment-contact.png'
  Invoke-Rodney @('input','.weaver-mount input','pilot.guest@example.test') | Out-Null
  Assert-AccessibleName 'button' 'Save Email address for payment and booking receipt' 'Guest email collection action'
  Click-GeneratedAction 'Save Email address for payment and booking receipt'
  $paymentHandoffText = Invoke-Rodney @('text','#active-workspace')
  if ($paymentHandoffText -notmatch 'Payment handoff' -or $paymentHandoffText -notmatch 'Payment status: checkout_initiated' -or $paymentHandoffText -notmatch 'NGN\s+[\d,]+\.\d{2}' -or $paymentHandoffText -notmatch 'Payment deadline') {
    throw 'Saving the required email did not resume the authoritative checkout handoff with its NGN amount and deadline.'
  }
  if ($paymentHandoffText -match 'payment succeeded|payment complete|Reservation confirmed|Booking Contract') { throw 'Checkout handoff incorrectly claims payment success or booking confirmation.' }
  $countsBeforePayment = Get-BookingCounts
  if ($countsBeforePayment.reservations -ne 0 -or $countsBeforePayment.contracts -ne 0) { throw 'Reservation/Contract appeared before local payment completion.' }
  Assert-AccessibleName 'button' 'I have returned from secure checkout' 'Payment return verification action'
  $paymentHandoffShot = Capture '17-payment-handoff.png'
  Add-Scenario 'Payment email collection and checkout resume' 'Save synthetic payment/receipt email through Weaver and resume the authorized checkout action.' 'Email is required before payment continuation; after saving it, authoritative checkout handoff is active with NGN amount/deadline and no Reservation/Contract.' 'PASS' @($emailShot,$paymentHandoffShot)
  Invoke-Rodney @('click','a.fallback-link') | Out-Null
  Invoke-Rodney @('waitload') | Out-Null
  Invoke-Rodney @('click','a[href$="/continue"]') | Out-Null
  Invoke-Rodney @('waitload') | Out-Null
  if ((Invoke-Rodney @('text','body')) -notmatch 'Local demo payment') { throw 'Normal payment handoff did not reach the local deterministic provider UI.' }
  Invoke-Rodney @('click','form[action="/payments/local/complete"] button') | Out-Null
  Invoke-Rodney @('waitload') | Out-Null
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
  $paymentComplete = Capture '18-payment-complete.png'
  $confirmedGuestText = Invoke-Rodney @('text','#active-workspace')
  if ($confirmedGuestText -notmatch 'Reservation confirmed|Booking Contract|Contract') { throw 'Verified local payment did not produce a confirmed Guest booking surface.' }
  $countsAfterPayment = Get-BookingCounts
  if ($countsAfterPayment.reservations -ne 1 -or $countsAfterPayment.contracts -ne 1) { throw "Expected exactly one Reservation and one Booking Contract; observed $($countsAfterPayment.reservations)/$($countsAfterPayment.contracts)." }
  Assert-AccessibleName 'heading' 'Shortlet Concierge' 'Confirmed booking Guest shell'
  Save-MobileShots '27-confirmed' 390
  Save-MobileShots '30-confirmed' 320
  Invoke-Rodney @('screenshot','-w','1280','-h','900',(Join-Path $shots 'viewport-reset.png')) | Out-Null
  $confirmedShot = Capture '19-confirmed-booking.png'
  Add-Scenario 'Local deterministic payment and confirmed booking' 'Complete provider UI, then verify exactly one Reservation and Contract plus Weaver confirmed booking summary.' "Counts are unique (Reservation=$($countsAfterPayment.reservations), Contract=$($countsAfterPayment.contracts)); Guest confirmed summary visible." 'PASS' @($paymentComplete,$confirmedShot)

  $script:activeScenario = 'Restart persistence'
  if ($script:serverOwned) {
    Stop-OwnedServer
    Start-Pilot
    $script:restart = 'PASS'
    Use-RodneySession GuestA "$origin/" $script:guestAThread
    Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
    $afterRestartGuest = Invoke-Rodney @('text','#active-workspace')
    if ($afterRestartGuest -notmatch 'Reservation confirmed|Booking Contract|Contract') { throw 'Confirmed Guest booking was not visible after server restart.' }
    $guestRestartShot = Capture '20-after-restart-guest.png'
    $persistedCounts = Get-BookingCounts
    if ($persistedCounts.reservations -ne 1 -or $persistedCounts.contracts -ne 1) { throw 'Restart changed Reservation or Booking Contract uniqueness.' }
    Use-RodneySession Operator "$origin/operator/requests"
    Invoke-Rodney @('wait','h1') | Out-Null
    if ((Invoke-Rodney @('text','body')) -notmatch 'Booking Requests') { throw 'Operator state/session was unavailable after restart.' }
    $operatorRestartShot = Capture '21-after-restart-operator.png'
    Add-Scenario 'Restart persistence' 'Restart owned server without closing Rodney sessions; preserve Guest booking, Operator session and unique records.' 'Guest confirmed surface, Operator inbox and unique records remained available.' 'PASS' @($guestRestartShot,$operatorRestartShot)
  } else {
    $script:restart = 'SKIPPED'
    Add-Scenario 'Restart persistence' 'Restart only the harness-owned server; preserve Guest booking, Operator session and unique records.' 'SKIPPED: --UseExistingServer leaves the caller-owned server untouched.' 'SKIPPED'
  }

  $script:activeScenario = 'Guest B location conflict and decline'
  Use-RodneySession GuestB "$origin/" $script:guestBThread
  $guestBTranscriptBeforeConflict = Invoke-Rodney @('text','#transcript')
  if ($guestBTranscriptBeforeConflict -notmatch 'Lagos' -or $guestBTranscriptBeforeConflict -match [regex]::Escape($script:guestAUnitTitle)) {
    throw 'Guest B restart restoration did not show its own Lagos conversation independently of Guest A.'
  }
  $partyTurnStart = Get-TranscriptTurnCount
  Send-Guest '2 nights and 2 guests'
  $partyReply = Get-NewTranscriptText $partyTurnStart
  if ($partyReply -notmatch '2026-09-29 to 2026-10-01|2 nights') { throw 'Guest B party-size input did not produce a stay-scoped discovery response.' }
  $wuseTurnStart = Get-TranscriptTurnCount
  Send-Guest 'Wuse'
  $conflictReply = Get-NewTranscriptText $wuseTurnStart
  if ($conflictReply -notmatch '(?i)Wuse.*Abuja|conflict|different city') { throw 'Wuse did not produce a new location-conflict response.' }
  $conflictShot = Capture '05-location-conflict.png'
  $abujaTurnStart = Get-TranscriptTurnCount
  Send-Guest 'Abuja'
  $resolvedAssistant = Get-NewTranscriptText $abujaTurnStart
  if (-not $resolvedAssistant.Trim()) { throw 'Abuja resolution produced no new assistant turn.' }
  if ($resolvedAssistant -match '(?i)how many nights|how many guests|how many people') { throw 'Abuja resolution asked a new nights or guest-count question.' }
  if ($resolvedAssistant -notmatch '2026-09-29 to 2026-10-01' -or $resolvedAssistant -notmatch 'eligible place') { throw 'Abuja resolution did not preserve the two-night stay while executing discovery.' }
  if ((Invoke-Rodney @('text','#active-workspace')) -notmatch 'Sunlit Two-Bedroom Retreat in Wuse 2|Wuse 2, Abuja') { throw 'Abuja discovery did not render the eligible Wuse 2 result in the active workspace.' }
  $resolvedShot = Capture '06-location-conflict-resolved.png'
  Add-Scenario 'Location conflict and resolution' 'Recognize Lagos/Wuse conflict, preserve party/date facts, then resolve Abuja without asking those questions again.' 'The new Abuja assistant turn asked no nights/guest-count question, retained the 2026-09-29 to 2026-10-01 stay, and rendered the Wuse 2 Abuja result in the active Weaver workspace.' 'PASS' @($conflictShot,$resolvedShot)
  $conflictSurface = Invoke-Rodney @('exists','.weaver-mount[data-renderer="weaver"]')
  if ($conflictSurface -ne 'true') { throw 'Guest B conflict journey did not restore its Weaver discovery surface.' }
  Click-GeneratedAction 'View Unit'
  $bDetail = Invoke-Rodney @('text','#active-workspace')
  if ($bDetail -notmatch 'Sunlit Two-Bedroom Retreat in Wuse 2' -or $bDetail -notmatch '2026-09-29 to 2026-10-01') { throw 'Guest B opened a Unit other than the Wuse 2 result or lost the two-night stay dates.' }
  $bUnitDetailShot = Capture '22-guest-b-unit-detail.png'
  $bButtonNames = Invoke-Rodney @('js','Array.from(document.querySelectorAll("button[data-a2ui-component=Button]")).map(b=>b.getAttribute("aria-label")||b.innerText.trim()).join("\n")')
  if ($bButtonNames -notmatch '(?m)^Request to Book$') { throw 'Guest B Unit detail lacks Request to Book generated action.' }
  $bUnit = $inventory | Where-Object { $bDetail -match [regex]::Escape([string]$_.title) } | Select-Object -First 1
  if (-not $bUnit) { throw 'Could not identify Guest B Unit from its visible authoritative detail.' }
  $bTitle = [string]$bUnit.title
  Click-GeneratedAction 'Request to Book'
  $guestBDraftText = Invoke-Rodney @('text','#active-workspace')
  if ($guestBDraftText -notmatch 'Request Draft' -or $guestBDraftText -notmatch '2 nights' -or $guestBDraftText -notmatch 'Guests:' -or $guestBDraftText -notmatch 'not reserved') {
    throw 'Guest B Request Draft did not preserve the two-night, two-guest party or accurately state that inventory is not reserved.'
  }
  $guestBDraftShot = Capture '23-guest-b-request-draft.png'
  Click-GeneratedAction 'Review Request'
  $guestBReviewText = Invoke-Rodney @('text','#active-workspace')
  if ($guestBReviewText -notmatch 'Review Booking Request' -or $guestBReviewText -notmatch '2 nights' -or $guestBReviewText -notmatch 'Guests:' -or $guestBReviewText -notmatch 'NGN|₦') {
    throw 'Guest B booking review omitted preserved stay/party or authoritative price.'
  }
  $guestBReviewShot = Capture '24-guest-b-booking-review.png'
  Click-GeneratedAction 'Submit Booking Request'
  $guestBPhoneText = Invoke-Rodney @('text','#active-workspace')
  if ($guestBPhoneText -notmatch 'Phone number') { throw 'Guest B phone stage did not appear.' }
  $guestBPhoneShot = Capture '25-guest-b-phone.png'
  Invoke-Rodney @('input','.weaver-mount input','+2348090002222') | Out-Null
  Click-GeneratedAction 'Save Phone number'
  Invoke-Rodney @('wait','.weaver-mount[data-renderer="weaver"]') | Out-Null
  $guestBRequestText = Invoke-Rodney @('text','#active-workspace')
  if ($guestBRequestText -notmatch 'Booking Request') { throw 'Guest B request did not submit.' }
  $guestBStateAfterRequest = Get-ThreadStateProbe $script:guestBThread
  $bRequestSurface = @($guestBStateAfterRequest.body.surfaces | Where-Object { $_.surfaceId -match ':request:req-' } | Select-Object -Last 1)
  if ($guestBStateAfterRequest.status -ne 200 -or $bRequestSurface.Count -ne 1) { throw 'Guest B Booking Request is not present in its authenticated server projection.' }
  $bRequestMatch = [regex]::Match([string]$bRequestSurface[0].surfaceId,':request:(req-[^:]+)$')
  if (-not $bRequestMatch.Success) { throw 'Guest B request surface did not contain an opaque request identity.' }
  $script:guestBRequestId = $bRequestMatch.Groups[1].Value
  if ($script:guestBRequestId -eq $script:guestARequestId) { throw 'Guest B reused Guest A Booking Request identity.' }
  $guestBRequestProjection = $bRequestSurface[0].a2uiMessages | ConvertTo-Json -Depth 30 -Compress
  if ($guestBRequestProjection -notmatch 'Booking Request status: disclosed' -or $guestBRequestProjection -match 'Booking Request status: confirmed') { throw 'Guest B request was not left in the disclosed, unconfirmed state.' }
  $guestBRequestShot = Capture '26-guest-b-booking-request.png'
  $countsAfterGuestBRequest = Get-BookingCounts
  if ($countsAfterGuestBRequest.reservations -ne 1 -or $countsAfterGuestBRequest.contracts -ne 1) { throw 'Guest B submission changed the single existing Guest A Reservation/Contract counts.' }
  $guestAFromB = Get-ThreadStateProbe $script:guestAThread
  if ($guestAFromB.status -ne 200 -or @($guestAFromB.body.timeline).Count -ne 0 -or @($guestAFromB.body.surfaces).Count -ne 0) { throw 'Guest B browser received Guest A confirmed booking state.' }
  Add-Scenario 'Guest B Unit detail through Booking Request' 'Use the Wuse 2 Unit and generated surfaces through draft, review, phone and request submission.' 'Guest B preserved the two-night/two-guest facts; the request has a distinct disclosed identity and Guest A counts remain one Reservation/Contract.' 'PASS' @($bUnitDetailShot,$guestBDraftShot,$guestBReviewShot,$guestBPhoneShot,$guestBRequestShot)

  Use-RodneySession Operator "$origin/operator/requests"
  $operatorGuestBInbox = Invoke-Rodney @('text','body')
  if ($operatorGuestBInbox -notmatch [regex]::Escape($script:guestBRequestId) -or $operatorGuestBInbox -notmatch [regex]::Escape([string]$bUnit.id)) {
    throw 'Operator inbox does not expose Guest B request by its distinct request identity and Unit.'
  }
  $bInboxShot = Capture '27-operator-guest-b-inbox.png'
  $bRequestScript = "Array.from(document.querySelectorAll('a[href^=`"/operator/requests/`"]')).find(a=>a.getAttribute('href')?.endsWith('/$($script:guestBRequestId)'))?.getAttribute('href') || ''"
  $bHref = Invoke-Rodney @('js',$bRequestScript)
  if (-not $bHref.StartsWith('/operator/requests/')) { throw 'Operator inbox did not expose Guest B request.' }
  Invoke-Rodney @('click',"a[href=`"$bHref`"]") | Out-Null
  $operatorBDetail = Invoke-Rodney @('text','body')
  if ($operatorBDetail -notmatch [regex]::Escape($script:guestBRequestId) -or $operatorBDetail -notmatch [regex]::Escape([string]$bUnit.id)) { throw 'Operator request detail does not match Guest B request identity and authoritative Unit ID.' }
  $bDetailShot = Capture '28-operator-guest-b-request.png'
  Add-Scenario 'Operator inspects Guest B request' 'Locate Guest B Booking Request by its request identity in the Operator inbox and inspect its real UI detail.' 'Operator inbox and request detail show Guest B request identity and Unit.' 'PASS' @($bInboxShot,$bDetailShot)
  Assert-AccessibleName 'button' 'Decline Booking Request' 'Operator decline action'
  Invoke-Rodney @('click','form[action$="/decline"] button') | Out-Null
  $declineText = Invoke-Rodney @('text','body')
  if ($declineText -notmatch 'declined') { throw 'Operator UI did not show declined Guest B state.' }
  $declineShot = Capture '29-operator-guest-b-declined.png'
  Add-Scenario 'Operator declines Guest B' 'Decline Guest B request through authenticated Operator UI.' 'Declined terminal request state visible.' 'PASS' @($declineShot)
  Use-RodneySession GuestB "$origin/" $script:guestBThread
  $guestBDeclined = Invoke-Rodney @('text','#active-workspace')
  if ($guestBDeclined -notmatch 'declined|decline') { throw 'Guest B did not see its declined request after reload.' }
  $guestBFinalState = Get-ThreadStateProbe $script:guestBThread
  $guestAFromB = Get-ThreadStateProbe $script:guestAThread
  if ($guestBFinalState.status -ne 200 -or (@($guestBFinalState.body.timeline | ForEach-Object { $_.text }) -join ' ') -notmatch 'declined') { throw 'Guest B authoritative state does not show the declined request.' }
  $guestBDeclinedProjection = $guestBFinalState.body.surfaces | ConvertTo-Json -Depth 30 -Compress
  if ($guestBDeclinedProjection -notmatch 'Booking Request status: declined' -or $guestBDeclinedProjection -match ':booking:|:payment:') { throw 'Guest B current authoritative surface is not a declined request without payment or booking state.' }
  if ($guestAFromB.status -ne 200 -or @($guestAFromB.body.timeline).Count -ne 0 -or @($guestAFromB.body.surfaces).Count -ne 0) { throw 'Guest B profile can read Guest A confirmed thread state.' }
  if ($guestBDeclined -match [regex]::Escape($script:guestAUnitTitle) -or $guestBDeclined -match 'Reservation confirmed|Booking Contract') { throw 'Guest B declined workspace exposed Guest A confirmed booking details.' }
  $guestBDeclinedShot = Capture '30-guest-b-declined.png'
  Add-Scenario 'Guest B declined state and cross-Guest isolation' 'Guest B sees decline and cannot read Guest A thread, Reservation, or Booking Contract.' 'Guest B UI/API shows its decline; Guest A state probe remains empty in the Guest B browser session.' 'PASS' @($guestBDeclinedShot)
  Use-RodneySession GuestA "$origin/" $script:guestAThread
  $guestAConfirmedText = Invoke-Rodney @('text','#active-workspace')
  if ($guestAConfirmedText -notmatch 'Reservation confirmed|Booking Contract|Contract') { throw 'Guest A confirmed state was replaced or leaked after Guest B decline.' }
  $guestAFinalState = Get-ThreadStateProbe $script:guestAThread
  $guestAConfirmedSurface = @($guestAFinalState.body.surfaces | Where-Object { $_.summary -eq 'Reservation confirmed' -and $_.status -eq 'active' } | Select-Object -Last 1)
  if ($guestAFinalState.status -ne 200 -or $guestAConfirmedSurface.Count -ne 1 -or $guestAConfirmedSurface[0].surfaceId -notmatch ':booking:') { throw 'Guest A authoritative projection no longer exposes its active confirmed Booking Contract surface.' }
  $guestAContractProjection = $guestAConfirmedSurface[0].a2uiMessages | ConvertTo-Json -Depth 30 -Compress
  if ($guestAContractProjection -notmatch 'Booking confirmed' -or $guestAContractProjection -notmatch [regex]::Escape($script:guestAUnitId) -or $guestAContractProjection -notmatch 'Contract version: 1') { throw 'Guest A active booking surface no longer projects its confirmed Unit and Booking Contract.' }
  $finalCounts = Get-BookingCounts
  if ($finalCounts.reservations -ne 1 -or $finalCounts.contracts -ne 1) { throw 'Guest B decline changed Guest A Reservation/Contract counts.' }
  $guestAStillConfirmedShot = Capture '31-guest-a-still-confirmed.png'
  Add-Scenario 'Guest A remains confirmed' 'After Guest B decline, Guest A continues to see its own confirmed Reservation/Contract.' 'Guest A active UI and authenticated state still show its confirmed booking; counts remain exactly one Reservation and one Contract.' 'PASS' @($guestAStillConfirmedShot)
  Use-RodneySession GuestB "$origin/" $script:guestBThread
  if ((Invoke-Rodney @('text','#transcript')) -match [regex]::Escape($script:guestAUnitTitle)) { throw 'Guest B transcript contains Guest A Unit/booking state.' }

  # Capture genuine 390px/320px metrics on each major Guest state; Rodney 0.4 uses CDP device metrics.
  Use-RodneySession GuestA "$origin/" $script:guestAThread
  Save-MobileShots '27-confirmed' 390
  Save-MobileShots '30-confirmed' 320
  $script:activeScenario = 'Accessibility evidence'
  Invoke-Rodney @('ax-tree','--depth','4') 'guest-confirmed-ax.txt' | Out-Null
  Use-RodneySession Operator "$origin/operator/requests"
  Assert-AccessibleName 'heading' 'Booking Requests' 'Operator inbox heading'
  Invoke-Rodney @('ax-tree','--depth','4') 'operator-inbox-ax.txt' | Out-Null
  Add-Scenario 'Accessibility representative screens' 'Guest and Operator essential controls have accessible names and AX evidence is saved.' 'Guest heading/composer/Send/generated actions and Operator login/confirm/decline names were inspected.' 'PASS'
  $overall='PASS'; $exitCode=0; $errorText=''
} catch {
  $errorText = $_.Exception.Message
  if ($script:token) { $errorText = $errorText -replace [regex]::Escape([string]$script:token), '[REDACTED]' }
  if ($script:failureSeen) { $overall='FAIL'; $exitCode=1 } else { $overall='ENVIRONMENT_FAILURE'; $exitCode=2 }
  if (-not $script:failureSeen) {
    $diagnostic = $errorText
    $failureImages = @()
    if ($script:activeHome) {
      try { $failureImages += Capture 'failure.png' } catch {}
      try { $diagnostic += "`nURL: $(Invoke-Rodney @('url'))" } catch {}
      $visibleText = ''
      try { $visibleText = Invoke-Rodney @('text','body'); $diagnostic += "`nVisible text: $visibleText" } catch {}
      try { $diagnostic += "`nRodney: $(Invoke-Rodney @('status'))" } catch {}
    }
    if ($errorText -match 'Rodney reports support|rodney start --show failed|Chrome|browser session') {
      Add-Scenario 'Rodney browser startup' 'Installed Rodney starts the requested isolated Chrome mode.' 'Rodney/browser environment could not start.' 'FAIL' $failureImages $diagnostic
      $overall='ENVIRONMENT_FAILURE'; $exitCode=2
    } elseif ($script:activeScenario -ne 'Preflight' -and $script:activeScenario -ne 'Server lifecycle') {
      Add-Scenario $script:activeScenario 'Expected browser interaction or observable state transition succeeds.' 'Browser journey stopped at this step; inspect captured evidence.' 'FAIL' $failureImages $diagnostic
      $overall='FAIL'; $exitCode=1
    } else {
      Add-Scenario $script:activeScenario 'Harness preflight and lifecycle complete.' 'Execution stopped before browser acceptance began.' 'FAIL' $failureImages $diagnostic
    }
  }
} finally {
  $script:token = $null
  if (-not ($KeepBrowserOnFailure -and $script:failureSeen)) {
    foreach ($profileHome in $script:ownedRodneyHomes) {
      $env:RODNEY_HOME = $profileHome
      try { Invoke-Captured 'rodney' @('stop') '' | Out-Null } catch {}
    }
  }
  Stop-OwnedServer
  Remove-Item Env:RODNEY_HOME -ErrorAction SilentlyContinue
  try { Write-Reports $overall $exitCode $errorText } catch { Write-Error "Could not write acceptance reports: $_"; $exitCode=2 }
}
exit $exitCode
