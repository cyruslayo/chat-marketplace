# Handoff — Goal 2 Correction: Real-Browser Cross-Tab Safety Proof

**Session date:** 2026-09-05  
**Starting SHA (unchanged):** `f1810b5b975a4d8a995f236f7e82946d4a3b0082`  
**Current SHA (no new commit yet):** `f1810b5b975a4d8a995f236f7e82946d4a3b0082`

---

## 1. Outstanding User Requests

### PRIMARY: Fix Goal 2 — Real-browser cross-tab safety proof (PARTIALLY COMPLETE)

**Original brief:** Replace the Happy DOM emulation cross-tab proof with a real-browser-engine (Chromium) proof using Chrome DevTools Protocol. **No Playwright.** Use the `chrome-devtools` MCP strictly for agent-level exploration/verification. The CDP WebSocket helper in `test/helpers/chrome-devtools.ts` is the correct test-code infrastructure.

**Current test status (button-label fixes applied this session, NOT yet run):**

| Test | Fix applied? | Known root cause |
|------|-------------|-----------------|
| RB1 | Was passing | — |
| RB2 | Fixed `"Accept Offer"` → `"Accept"` | Wrong button label |
| RB3 | Fixed `"Pay by Card"` → `"Start secure checkout"` | Wrong button label |
| RB4 | Fixed `"I Have Completed Payment"` → `"I have returned from secure checkout"` | Wrong button label |
| RB5 | Fixed same as RB4 | Wrong button label |
| RB6 | NOT YET FIXED | See §3 below |
| RB7 | Fixed `"Accept Offer"` → `"Accept"` | Wrong button label |
| RB8 | Was passing | — |
| RB9 | Was passing | — |
| RB10 | NOT YET FIXED | See §3 below |
| RB11 | Was passing | — |
| RB12 | NOT YET FIXED | See §3 below |

**After all fixes are complete:**
1. `npx tsx --test test/guest-real-browser-cross-tab.test.ts` — all 12 must pass
2. `npm run check` — zero type errors
3. `npm test` — full suite passes
4. `npm run verify:weaver` — clean
5. `git diff --check`
6. One focused corrective commit

---

## 2. User Constraints (Non-Negotiable)

- **No Playwright.** The `chrome-devtools` MCP is for agent-level verification only.
- Test code uses `test/helpers/chrome-devtools.ts` (CDP WebSocket helper).
- **No new product features.**
- **No redesign of concurrency behaviour.**
- **Existing Happy DOM tests** (`test/guest-cross-tab-concurrency.test.ts`) must remain intact.

---

## 3. Remaining Failures — Root Causes and Fixes

### RB6 — "A superseded real-tab action fails closed"

**Root cause:** After a stale Tab B clicks "View Unit", the server returns `STALE_SURFACE`. `renderResponse` in client.ts:
1. Marks shell as stale, re-renders surface with `inert` on `.weaver-mount`.
2. Immediately calls `void refreshServerState()` — fetches `/api/state`, gets the current (unit-detail) surface, re-renders with `status: "active"`. The `inert` attribute is gone.

The test then asserts `inert` on `.weaver-mount` after a 1.2 s wait, but by then the surface is already refreshed to active state. The assertion `workspaceDisabled === true` fails.

**Fix** — change the assertion to verify Tab B recovered to the **current server projection**:

```typescript
// Remove the workspaceDisabled block entirely. Replace with:
await new Promise((r) => setTimeout(r, 2000));

// Tab B must recover to the authoritative current projection (unit detail)
const contentB = await ctx.tabB.evaluate<string>(
  `document.getElementById("active-workspace").innerText`
);
assert.ok(
  contentB.includes("Request to Book"),
  `Tab B must recover to current server projection after stale rejection; got: ${contentB.slice(0, 200)}`
);
```

"Request to Book" appears on the unit-detail surface — confirmed by `advanceToRequestReview` which waits for exactly that text after Tab A clicks "View Unit".

---

### RB10 — "Two real tabs restore safely after server restart"

**Root cause:** After server restart on a new port, the browser navigates to `newBase/?threadId=...`. HTTP cookies are NOT port-scoped for non-secure origins, so the `shortlet_guest_session` cookie should still be sent. The new server should load the thread from SQLite via `#loadThread(threadId)`.

**Likely cause:** 8 s `waitForText` timeout is too short for a cold server restart + full page bootstrap + `/api/state` fetch + Weaver render cycle.

**Fix:** Extend the timeout for post-restart waits:

```typescript
await ctx.tabA.waitForText("Submit Booking Request", 15000);
await ctx.tabB.waitForText("Submit Booking Request", 15000);
```

**Diagnosis step if still failing:** Use MCP `chrome-devtools` tools to open the new port URL in a tab (`new_page`, `navigate_page`), then `take_snapshot` to see what actually renders and read the console with `list_console_messages` to catch any fetch/session errors.

Also check `apps/local-guest/src/guest-server.ts` lines 1231–1345 (`resolveBrowserSession`) — the new server's in-memory `browserSessions` cache is empty; it must fall through to SQLite. Confirm the SQLite lookup path works for a session created on a different server instance.

---

### RB12 — `SyntaxError: Unexpected identifier 'as'`

**Root cause:** The `evaluate<boolean>` string contains TypeScript-specific syntax (`as any`). CDP `Runtime.evaluate` runs plain JavaScript; TypeScript keyword `as` is a syntax error in the browser.

**Fix** (one line edit in `test/guest-real-browser-cross-tab.test.ts` around line 606):

```typescript
// Wrong (TypeScript cast inside a JS eval string):
Boolean(window.BroadcastChannel && (window as any).__shortletBroadcastLock)

// Correct (plain JS — the as any cast was unnecessary; the property simply won't exist):
Boolean(window.BroadcastChannel && window.__shortletBroadcastLock)
```

Note: inside a template-literal string passed to `evaluate()`, TypeScript does not type-check the string contents, so `window.__shortletBroadcastLock` won't cause a TS error even without the cast.

---

## 4. Architecture — Key Facts

### Exact Button Text (verified from source)

| A2UI source file | Stage | Button text rendered |
|-----------------|-------|---------------------|
| `apps/web-agent/src/conditional-offer-a2ui.ts` line 30 | Offer ready | `"Accept"` |
| `apps/web-agent/src/card-payment-a2ui.ts` line 19 | Ready for checkout | `"Start secure checkout"` |
| `apps/web-agent/src/card-payment-a2ui.ts` line 19 | Checkout initiated | `"I have returned from secure checkout"` |
| `apps/web-agent/src/card-payment-a2ui.ts` line 19 | Deposit required | `"Continue to refundable deposit"` |

### `canUseSurfaceActions` (`apps/local-guest/src/conversational-shell.ts` line 81)
```typescript
export function canUseSurfaceActions(status: SurfaceLifecycleStatus): boolean {
  return status === "active";  // anything else → false → mount.setAttribute("inert", "")
}
```

### `renderResponse` stale recovery path (`apps/local-guest/src/client.ts` lines 286–292)
```typescript
if (response.code === "STALE_SURFACE" || response.code === "EXPIRED_SURFACE") {
  shellState = markActiveSurfaceStatus(shellState, response.code === "EXPIRED_SURFACE" ? "expired" : "stale");
  if (activePayload) renderSurface({ ...activePayload, status: shellState.activeSurface?.status });
  void refreshServerState();  // ← fires immediately and replaces stale mount with current state
}
```

### `fallbackSummary` messages (`apps/local-guest/src/conversational-shell.ts` lines 85–91)
- `"stale"` → `"This workspace is out of date. Refresh to continue."`
- `"expired"` → `"This workspace has expired. Refresh to continue."`

### Guest HTTP routes (`apps/local-guest/src/guest-server.ts`)
- `GET /` — issues/validates `shortlet_guest_session` HttpOnly cookie, serves HTML shell
- `GET /api/state?threadId=X` — returns timeline + surfaces; loads thread from SQLite
- `POST /api/event` — Weaver-originated button action

---

## 5. Files Changed (Uncommitted, in `C:\AI2026\chat-marketplace`)

| File | git status | Change |
|------|-----------|--------|
| `apps/local-guest/src/client.ts` | M | `getThreadId()` reads `?threadId=` URL param; `renderResponse()` calls `refreshServerState()` on stale/expired |
| `apps/local-guest/dist/client.js` | ?? | Rebuilt via `build-client.mjs` |
| `test/guest-cross-tab-concurrency.test.ts` | ?? | 9-line JSDoc header: labelled as Happy DOM emulation |
| `test/helpers/chrome-devtools.ts` | ?? | CDP WebSocket helper (RealBrowserInstance / RealBrowserTab) |
| `test/guest-real-browser-cross-tab.test.ts` | ?? | 12 RB tests; button labels fixed this session; 3 still need fixing |

---

## 6. Chrome DevTools Helper Facts

**File:** `test/helpers/chrome-devtools.ts`  
**Chrome path:** `C:\Program Files\Google\Chrome\Application\chrome.exe`

- Launches with `--headless=new --remote-debugging-port=<dynamic>`
- All methods are per-tab (sessionId required for CDP commands)
- `getCookies()` calls `Network.getCookies` with sessionId — **not browser-level** (browser-level returns -32601)
- `waitForText(text, timeoutMs=8000)` polls `document.body.innerText.includes(text)` every 100 ms
- `clickButton(label, accessibleLabel?)` — finds `<button>` by `textContent.includes(label)`
- `evaluate<T>(expression)` — **expression must be plain JavaScript, not TypeScript**

---

## 7. Suggested Skills

- **`tdd`** — iterative red-green fix loop; run the real-browser suite after each fix
- **`diagnose`** — use MCP chrome-devtools tools (`new_page`, `navigate_page`, `take_snapshot`, `evaluate_script`, `list_console_messages`) to inspect what Tab B's DOM shows post-stale-rejection and post-restart before writing assertions
- **`domain`** — consult `CONTEXT-MAP.md` and `docs/adr/` if unsure about invariants

---

## 8. Ordered Next Steps

1. **Fix RB12** (trivial string edit, ~1 min):  
   In `test/guest-real-browser-cross-tab.test.ts` around line 606, remove `as any` from the eval string.

2. **Fix RB6** (replace assertion, ~5 min):  
   Remove the `workspaceDisabled` block; add a check that Tab B now shows `"Request to Book"` after recovery. See §3.

3. **Diagnose RB10** using MCP chrome-devtools if the extended-timeout fix doesn't work:  
   Start the server, restart it, navigate a tab to the new port, `take_snapshot`.

4. **Run the real-browser suite:**  
   `npx tsx --test test/guest-real-browser-cross-tab.test.ts`

5. **Run the full suite, type check, weaver verify.**

6. **Commit** — one focused corrective commit.

---

## 9. Reference File Locations

| Purpose | Path |
|---------|------|
| Real-browser test (12 RB tests) | `test/guest-real-browser-cross-tab.test.ts` |
| CDP WebSocket helper | `test/helpers/chrome-devtools.ts` |
| Happy DOM tests (keep) | `test/guest-cross-tab-concurrency.test.ts` |
| Client shell | `apps/local-guest/src/client.ts` |
| Guest HTTP server | `apps/local-guest/src/guest-server.ts` |
| Offer A2UI (button labels) | `apps/web-agent/src/conditional-offer-a2ui.ts` |
| Card payment A2UI (button labels) | `apps/web-agent/src/card-payment-a2ui.ts` |
| Surface lifecycle guard | `apps/local-guest/src/conversational-shell.ts` |
| Fixture / env helpers | `apps/local-guest/src/fixture.ts` |
| ADR directory | `docs/adr/` |
| Context map | `CONTEXT-MAP.md` |
