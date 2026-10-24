# Concierge capture evidence

This capture uses synthetic local data and a scripted offline model.
It does not demonstrate live model generation.
The fixture uses the application scope classifier and constrained reply path.
The quota state uses `SqliteModelRequestQuota` with local SQLite storage.

## Commands

The shell used these environment values:

```powershell
$env:NODE_ENV='test'
$env:COMMERCE_REFERENCE_TEST_KEY='allow'
$env:CONTROLS_CAPTURE_RUN='2026-10-24-controls-final'
```

Each command ran in a separate process, sequentially:

```powershell
npx tsx .scratch/concierge-agent-controls/capture.ts details
npx tsx .scratch/concierge-agent-controls/capture.ts results
npx tsx .scratch/concierge-agent-controls/capture.ts draft
npx tsx .scratch/concierge-agent-controls/capture.ts redirect
npx tsx .scratch/concierge-agent-controls/capture.ts unavailable
npx tsx .scratch/concierge-agent-controls/capture.ts quota
```

## Results

Each state passed eight checks and exited 0.
Each check used one width and one theme.
The widths were 320, 390, 768, and 1280 CSS pixels.
The themes were light and dark.
All 48 checks reported no horizontal overflow and no visible controls below 44 pixels.
The quota state exhausted the real local reservation store before browser submissions.
Every refused submission asserted that transport starts did not increase.
Its three recorded transport starts came from the initial search.

Logs: `validation/2026-10-24/capture-*.log`.
Images and findings: `../guest-ui-consistency/screenshots/concierge-controls-05/2026-10-24-controls-final/`.

## Visual inspection

The parent inspected these images:

- Details: light at 320 pixels and dark at 1280 pixels.
- Draft: light at 390 pixels.
- Redirect: light at 320 pixels.
- Quota: dark at 390 pixels.

Details showed the authoritative all-in amount and separate deposit wording.
The draft showed that the request was not sent and dates were not reserved.
Redirect and quota states retained the existing discovery and conventional controls.
The fixture has no property photos.

Final runtime changes can require new captures.
The batch remains claimed until the integrated gates and independent review pass.
