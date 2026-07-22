# Project permitted Interaction Artifacts through WhatsApp

Status: resolved
Type: AFK
User stories: 100, 102, 106, 110

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Translate canonical Interaction Artifacts into approved WhatsApp discovery, status, reminder, structured Operator action, triage, and Human Handoff experiences. Redirect identity, payment credentials, high-risk evidence, material amendments, and unsupported confirmations to authenticated web without changing meaning.

## Acceptance criteria

- [x] Amounts, absolute WAT deadlines, consequences, disclosures, references, and consent meaning match authoritative artifacts.
- [x] The shared capability matrix blocks actions lacking sufficient disclosure, authentication, consent, or audit evidence.
- [x] WhatsApp identity alone cannot authorize high-impact account, contractual, financial, or protected-data actions.
- [x] Delivery acceptance, read, response, retry, channel switch, and handoff are distinct correlated events.

## Blocked by

- [Issue 08](08-submit-and-resolve-a-timed-booking-request.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
- [Issue 23](23-let-the-guest-choose-relocation-or-refund.md)

## Answer

Implemented `WhatsAppChannelAdapter` in `domains/shortlet/src/whatsapp-adapter.ts` and test suite `test/project-artifacts-through-whatsapp.test.ts`.

Key architectural compliance:
- **ADR 0077 & AC1**: Preserves canonical artifact amounts, absolute WAT deadlines, disclosures, consequences, and consent meaning without alteration.
- **ADR 0067 & AC2**: Shared capability matrix blocks actions lacking disclosure, authentication, consent, or audit evidence.
- **ADR 0070 & AC3**: WhatsApp identity alone cannot authorize high-impact financial, contractual, identity, or protected-data actions; automatically redirects to authenticated web portal.
- **ADR 0077 & AC4**: Correlates delivery acceptance, read, response, retry, channel switch, and human handoff as distinct tracked events.

