# Require request disclosure three hours before check-in

A new Booking Request must be successfully disclosed no later than the Latest Disclosure Cutoff, calculated as three hours before the unit-specific Contractual Check-In Window begins in Africa/Lagos time. Successful disclosure means eligibility, risk, inventory and quote checks pass, the block commits, a supported operator channel accepts delivery, and state reaches Pending Operator. Draft, review, reconfirmation, or Delivery Pending at cutoff closes without operator, calendar, risk, or payment consequence.

The cutoff and Active Hours constraint both apply. No five-minute delivery attempt or human override may extend past it, and no payment begins for a missed draft. Guests receive accurate explanation and may choose later dates or another unit whose cutoff remains open; the platform never silently changes unit, dates, or arrival.

A request validly disclosed before cutoff keeps its complete operator and payment windows even when they later cross the cutoff, because the three-hour buffer already accounts for the maximum 65-minute transactional path and access preparation. A future rapid-booking capability requires separate design and evidence.
