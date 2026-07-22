# Limit request delivery attempts to five minutes

A validated Booking Request may block inventory in Delivery Pending for at most five minutes while supported channels attempt operator-notification acceptance. Acceptance means a configured provider or persisted application endpoint accepts delivery, or authorized platform staff directly reaches and records delivery; it does not require a read receipt or response. Acceptance starts a fresh full 30-minute operator window.

If no channel accepts by the deadline, request failure and overlapping inventory release occur atomically as Delivery Failed, remaining attempts stop, and the guest is told delivery failed and nothing remains reserved. Idempotent retries may use primary, secondary, and backup routes during the window. A late callback records channel telemetry and sends withdrawal where possible but can never revive the request, recreate priority, or accept a stale operator action.

Failures distinguish platform/provider faults from invalid, stale, disabled, or improperly maintained operator contacts. Only attributable configuration failures affect operator performance. After such a failure, new disclosures pause until a primary and backup route pass testing; existing booking and check-in duties continue. Retrying later creates a new version after channel, availability, and price revalidation.
