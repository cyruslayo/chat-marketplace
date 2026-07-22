# Allow risk-based card authentication

Launch card checkout accepts PSP- and issuer-approved challenged or frictionless authentication. A visible OTP, 3-D Secure page, or banking-app prompt is not universally required and its absence does not prove missing authentication. Booking confirmation independently requires a valid designated reference, exact NGN amount and merchant relationship, unused and timely server-verified success, valid inventory, payer controls, and passing platform risk policy.

Versioned risk policy may require PSP-supported step-up, manual review, or rejection based on booking value, account and device history, velocity, payment attempts, payer mismatch, prior disputes, provider signals, and other permitted factors. When required step-up is unavailable, failed, or unverifiable, the platform rejects rather than downgrades. An authentication-pending attempt remains the one Live Payment Attempt.

Post-payment risk review cannot extend inventory beyond the existing deadline. Unresolved review at expiry releases dates and fully refunds any successful payment; predictable lengthy review should occur before checkout. The platform stores only permitted, necessary authentication metadata and never infers results from UI behavior or retains OTP, PIN, CVV, answers, secrets, or sensitive challenge payloads.
