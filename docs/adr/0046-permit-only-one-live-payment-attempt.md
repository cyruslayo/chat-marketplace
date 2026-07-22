# Permit only one live payment attempt

A booking payment session has at most one Live Payment Attempt. Before the original 20-minute deadline, a guest may retry or switch channels only after the PSP confirms the designated attempt is terminally failed, abandoned, expired before processing, or otherwise technically unable to complete. Closing a page, modal, or guest-side cancellation request is not terminal while the provider reports customer action, pending, processing, or unknown.

Every replacement uses a unique reference and a locked, idempotent session transition that supersedes the prior attempt without resetting the Payment Window. Only the designated attempt can confirm the booking or receive Payment-Processing Grace. Transfer instructions that remain payable keep the slot and cannot be casually switched away from. No replacement begins after the initiation deadline.

All references remain monitored. Success from any superseded, expired, or non-designated attempt is recorded and fully refunded to its original source; it never confirms the booking. If both designated and old attempts succeed, the booking confirms once from the designated payment and every duplicate is refunded. Client actions and callbacks never replace backend verification or race-safe state transitions.
