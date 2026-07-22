# Refund every late launch payment

If successful payment is not durably verified and committed before the 30-minute inventory deadline, the booking attempt closes permanently and inventory releases. The server deadline, final verification, and release use a race-safe transition in which either confirmation commits before release or release wins. Later PSP timestamps, callbacks, apparent availability, operator willingness, or human discretion cannot revive the attempt or reacquire dates.

Every subsequent success for that attempt becomes a refundable guest liability under controlled reconciliation. The platform initiates a full original-source refund of every collected booking component, absorbs payment and refund-processing costs, tracks asynchronous provider states accurately, and never describes initiation as receipt. The event affects PSP and platform reliability metrics rather than operator performance.

After the late payment is recorded and a valid refund instruction is successfully created, the guest may submit a completely fresh Request to Book without waiting for funds to arrive. It receives no prior inventory priority, reuses none of the old payment, and requires current availability, quote, operator confirmation, terms, and separate payment. The interface discloses the outstanding refund before inviting another payment.
