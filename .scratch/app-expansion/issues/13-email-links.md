# Emails open their own item, and sign-in returns to it

Status: ready-for-agent
Type: task
Blocked by: guest-accounts 13 (D21 accepted 25 Nov 2026). Sending email in staging (D11) is not needed here

## Why

All six guest booking emails in `pilot-notifier.ts` link to the home page. On another device the guest lands in an empty chat. The "offer not found" page offers sign-in with no way back to the offer. Checked on `main`: the conventional request, offer and contract pages authorise the browser principal only, so a signed-in second device gets 404 (guest-accounts 13). Without that fix a correct link still leads to a refusal.

## What to build

- Each guest email links to its item's standard route: request submitted, declined, expired and not delivered to `/booking-requests/:id`; offer made to `/conditional-offers/:id`; payment confirmed to `/booking-contracts/:id`.
- Links carry an id only. They grant nothing (ADR 0075, 0093).
- The refusal page's sign-in link carries a `return` that `safeReturnPath` accepts. It already accepts any safe same-origin path, so no change to it is expected.
- The refusal stays identical for a missing and a foreign item.

## Acceptance criteria

- AC1: Each email's link is the route of its own item. Failure path: an item with no route links to the home page.
- AC2: Opening the link in the same browser session shows the item.
- AC3: In a browser with no session it shows the same refusal as an unknown id, and signing in as the owner returns to the item.
- AC4: Signing in as someone else returns to the refusal.
- AC5: An external, protocol-relative, encoded or unknown `return` is refused and falls back as today.
- AC6: No email body or log line gains a credential, address or contact detail.

## ADR compliance

0070, 0075, 0080, 0093.

## Tests

The notifier tests, the guest-account sign-in tests, the new file, and `npm run check`.

## Comments
