# 29: Cancellation AC1 failed under load because a pooled keep-alive socket was reset

Status: resolved
Type: task
Blocked by: none

## Defect

`test/cancellation-always-finishes.test.ts` AC1 failed once in a 10-file concurrent batch and passed alone. Reproduced with the issue-05 ten-file batch (`Copies=4`, round 2, copy 3):

```
FETCH_FAILED {"url":"http://localhost:58881/operator","name":"TypeError","message":"fetch failed",
  "cause":{"name":"Error","message":"read ECONNRESET","code":"ECONNRESET","errno":-4077,"syscall":"read"}}
not ok 8 - AC1: For every combination of one failure in ledger, dates, stay refund and deposit refund, …
```

`back-office-uphold-complaint.test.ts` AC1 failed the same way (`fetch failed` in `reservationPage`) in the same batch, so the defect is in the request path, not in AC1's logic.

## Cause

`node:http` servers close an idle keep-alive socket after `server.keepAliveTimeout`, default 5 s. Node's `fetch` (undici) pools that socket. When a test blocks its event loop for longer than 5 s between two requests to the same operator server — AC1 does `guest.pay()`, `cancelApp.cancel()` and `listGuestRefundsOwed()` on a loaded machine — the FIN has not been read yet, so the next `fetch` writes onto the half-closed socket and the peer answers with RST: `read ECONNRESET`. Alone, AC1's heavy steps finish in well under 5 s, so the test passed. In the batch, AC1's own duration is 10–47 s, so the window opens.

Deterministic reproduction without any test file (`scratch-keepalive-probe.ts`, since removed): sign in, `GET /operator`, busy-block the event loop for 6 s, `GET /operator` again → `ECONNRESET` **6/6**. A second probe with plain `setTimeout` waits of 5.5 s and 6 s never failed, which confirms it is the blocked event loop racing the server's 5 s close, not the gap itself.

## Fix (test helper only)

`test/helpers/operator-session.ts` `startOperatorServer` sets `server.server.keepAliveTimeout = 0` on the returned `node:http` server (Node: "a value of 0 will disable the keep-alive timeout behaviour on incoming connections"). Idle connections are never closed, so there is no half-closed socket to reuse.

- No application code changed; `startLocalOwnerServer` already returns its `node:http` server, so the helper sets it locally.
- No timeout raised and no assertion weakened: AC1 still checks every one-failure combination resumes to a finished state, and that recorded refunds stay on Operator home until the Paystack reference is recorded.
- The same probe after the fix: **0/6** failures.
- `server.close()` still ends the test: every run below completed and closed its server.

## Verification

- Reproduction: `.scratch/app-expansion/batch05parallel.ps1 -Copies 4 -Rounds 2` (ten-file issue-05 batch, four copies at once) → `1` failure, the `ECONNRESET` above.
- After the fix, 20 consecutive passes with three copies of the ten-file batch restarted after every pass (`.scratch/app-expansion/stable-ac1.ps1 -Passes 20 -LoadCopies 3`): `AC1 under load: passed=20 failed=0`. Pass durations include 41 s, 47 s and 22 s, i.e. far past the 5 s window that used to break it.
- All 24 files that import `test/helpers/operator-session.ts`, run as one `npx tsx --test …` command minus the two real-Chrome files listed next (23 files): `177 pass, 0 fail`.
- Real-Chrome files that use the helper, one at a time: `test/round12-2b-07.test.ts` → `3 pass, 0 fail`; `test/self-hosted-type.test.ts` → `5 pass, 0 fail`.
- `npm run check` → clean.

## Follow-up (not done here)

The same 5 s close applies to `startPilotServer` and `startGuestServer`. Tests that block for >5 s between fetches to those origins can hit the same reset; the known load flakes listed in AGENTS.md (`back-office-manual-transfers`, `back-office-owner-overpayment`, `guest-cross-tab-concurrency`, `model-quota-host-recovery`, `pilot-local` AC4) are candidates. Out of this item's scope; record as its own issue if one reproduces.
