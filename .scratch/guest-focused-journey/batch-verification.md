# Batch verification

Base: `22fe11b`.

The parent reported 174/193 passing Worker tests, with 19 timeouts across seven files.
Isolated reruns passed except daily-export D3: eight of nine passed, with D3 taking 6,566ms against its 5,000ms limit.
AGENTS.md directs agents to raise this known test timeout.

Only the multipart-export D3 test now uses a 15,000ms timeout.
Its assertions and production code remain unchanged.

Command: `npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts`.
Result: one file passed; nine tests passed, zero failed. The Worker bundle guard also passed.
Vitest reported 134.49 seconds total, including 65.50 seconds for tests.
Source-map warnings did not fail the run.

This isolated pass resolves the documented daily-export timeout.
It does not replace the remaining full batch verification.
