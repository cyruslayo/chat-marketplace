#!/bin/sh
# Runs capture-11.ts once per screen group, since each group boots its own fixture.
for group in chat-compare chat-home chat-results chat-unit search-page unit-page request-draft request-review request-sent request-declined request-expired offer-live offer-expired payment-choice bank-transfer manual-transfer manual-waiting no-reservation confirmed error-page no-js; do
  echo "== $group"
  npx tsx .scratch/guest-ui-consistency/capture-11.ts "$group" 2>&1 | grep -v "Warning\|trace-warnings"
done
echo FINISHED
