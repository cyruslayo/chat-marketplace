# Settle the stay, message and favourites policy values

Status: resolved
Type: grilling
Blocked by: none (needs the user)
Requested: 2 Oct 2026

## Why

Nothing in the ADRs or `CONTEXT.md` fixes these values, and the coding standards forbid inventing them. ADR 0066 fixes only the review rules (one review, paid completed Verified Access stay, 14 days, one operator response).

Note on "completed": `VerifiedStayReviewManager` takes `BookingStateForReview.isCompleted` from the caller; nothing in the domain computes it. `CheckoutOverstayManager` (`domains/shortlet/src/checkout-overstay.ts`) knows the Contractual Checkout; `AccessStatus` (`domains/shortlet/src/checkin-support.ts:4`) knows Verified Access.

## Question for the user

1. **Completed Stay.** Is a stay completed at the Contractual Checkout time (11:00 WAT, or the amended time), or after a grace period? What if Verified Access was never recorded (no-show, support never confirmed)? Can it still be reviewed? ADR 0066 says no; confirm it shows as "past, not reviewable".
2. **Message window.** Does the Stay Message Thread open at booking confirmation or at check-in? How long after checkout does it stay open?
3. **Message limits.** Maximum length per message, and how many messages per hour per side.
4. **Retention.** How long are messages kept after the window closes?
5. **Contact details.** Should messages containing a phone number or email be refused, or sent with the detail masked? Should links be allowed?
6. **Favourites.** Maximum saved apartments per account. May a signed-out Guest save (kept on the device and moved into the account on sign-in), or does saving ask them to sign in?
7. **Cancelled bookings.** Do cancelled and declined bookings appear in "My stays" (e.g. under "Past" with their outcome), or only confirmed ones?

## Acceptance criteria (after the answer)

- AC1: Every answer is recorded under `## Answer` with the date.
- AC2: `PRD.md` "Open policy values" is replaced with the settled values.
- AC3: Issues 02, 03, 08, 11 and 12 are updated where an answer changes their scope.

## Answer

Approved by the user on 3 Oct 2026 (recommendations accepted as given).

1. **Completed Stay.** Completed at the Contractual Checkout (11:00 WAT, or the time set by an accepted checkout amendment), only when Verified Access was recorded. No extra grace period. A stay without Verified Access (including a no-show) shows under "Past" and is not reviewable (ADR 0066).
2. **Message window.** The Stay Message Thread opens when the booking is confirmed (paid) and closes 14 days after the Contractual Checkout, matching the review window. After that the thread is read-only, with a link to support.
3. **Message limits.** 2,000 characters per message; 20 messages per hour per side per thread.
4. **Retention.** Messages are kept 12 months after the window closes. A thread linked to an open deposit claim or appeal (ADR 0017–0019) is kept until that is final. **Provisional:** confirm with a lawyer together with `../guest-accounts/` issue 01 answer 6.
5. **Contact details.** Phone numbers and email addresses are masked (the message is delivered with the detail blanked and the sender sees a short note saying why). Links are not allowed: a message containing a link is refused with a reason.
6. **Favourites.** Up to 100 Saved Stays per account. Saving while signed out is allowed; saves are kept against the device's principal and move into the account on sign-in.
7. **My stays contents.** Confirmed bookings only, under "Upcoming" and "Past". Cancelled bookings appear under "Past", marked "Cancelled". Declined or expired Booking Requests stay in the conversation and are not listed.

## Comments

- 3 Oct 2026: answers applied to `PRD.md` ("Settled policy values"), issues 03, 04, 08 and 11, and the slice order in `map.md`.
