# Controlled evaluation tooling evidence

The parent added `scripts/concierge-controls-eval.ts` for synthetic local HTTP evaluation.
The script requires the exact approved model, `openai/gpt-6-luna`.
It checks the existing USD 2 key cap before inference.
It rejects an absent, unlimited, resettable, or exhausted cap.
It requires an explicit attempt limit between 1 and 64.
The cap check does not authorize changing provider settings.

Each model call captures its turn usage object before any asynchronous work.
Each provider attempt reserves evaluation capacity outside the transport catch.
The report separates reserved capacity from actual transport starts.
It also separates reported cost, estimated cost, and account usage changes.
It retains each failed run in a separate timestamped directory.

The scenarios check greeting, Pidgin search, location correction, details, price, and draft preparation.
They also check role override, other-guest data, payment override, unrelated generation, mixed requests, and injected listing narrative.
The grader uses current surfaces, criteria, and authoritative database effects.
It checks draft counts, contracts, reservations, and inventory commitments.
It reuses the strict existing price-role and false-confirmation grader.
It does not read history offsets.

## Offline checks

```powershell
npx tsx --test test/concierge-controls-eval.test.ts
npx tsc --noEmit --pretty false
```

The parser safety test passed one test, with no failures, cancellations, or skips; exit 0.
The final root type check passed with no errors; exit 0.
Logs: `validation/2026-10-24/parent-evaluation-tooling-final.log` and `parent-evaluation-typecheck-final.log`.

No paid inference ran during these tooling checks.
Live semantic results and final independent review remain pending.
