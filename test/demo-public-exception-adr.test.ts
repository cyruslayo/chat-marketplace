import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const adr = readFileSync('docs/adr/0105-public-demo-exception.md', 'utf8');
const issue = readFileSync('.scratch/demo-launch/issues/01-record-public-demo-exception-adr.md', 'utf8');

test('AC1: ADR 0105 exists and lists every deferred ADR with its reason, and every kept ADR', () => {
  for (const id of ['0008', '0009', '0010', '0065', '0092', '0095', '0104']) {
    assert.match(adr, new RegExp(`\\| ${id} \\| [^\\n]+ \\| [^\\n]+ \\|`));
  }
  for (const id of ['0068', '0069', '0072', '0075', '0079', '0080', '0087']) {
    assert.match(adr, new RegExp(`\\| ${id} \\| [^\\n]+ \\|`));
  }
});

test('AC2: The ADR states that demo mode is refused in production', () => {
  assert.match(adr, /production configuration must refuse demo mode at startup/);
});

test('AC3: The ADR states the reversal criteria', () => {
  assert.match(adr, /Remove `SHORTLET_DEMO`/);
  assert.match(adr, /Delete the synthetic inventory and demo photos/);
  assert.match(adr, /Mark this ADR superseded before any real launch/);
});

test('AC4: The owner has recorded their sign-off in Comments with a date', () => {
  assert.match(issue, /## Comments\s+- 21 Oct 2026: The owner accepted ADR 0105 in chat/);
});

test('AC5: The 180-night maximum is staging-demo-only and keeps ADR 0092 payment periods', () => {
  assert.match(adr, /owner authorizes the synthetic staging demo to accept Extended Stays of 30 to 180 consecutive nights/);
  assert.match(adr, /does not change ADR 0092 for production or other non-demo deployments/);
  assert.match(adr, /A demo stay of 180 nights contains six 30-night Billing Periods/);
  assert.match(adr, /separate later Period Payments/);
  assert.match(adr, /Any production maximum above 90 nights requires counsel's review and a new owner decision/);
});

test('AC6: Demo cancellation and Notice to End retain counsel limits and lawful handling', () => {
  assert.match(adr, /may demonstrate ADR 0092's existing T-30\/T-14 cancellation values and 14-day Notice to End/);
  assert.match(adr, /Mark them as demo terms; this does not satisfy counsel's approval/);
  assert.match(adr, /The lawful process remains \[counsel\]/);
  assert.match(adr, /must not lock out guests, change access, or run a termination process/);
});
