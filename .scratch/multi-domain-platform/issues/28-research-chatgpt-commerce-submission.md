# Research: ChatGPT app submission for commerce (link-out checkout, Nigeria, review checklist)

Status: resolved
Type: research
Blocked by: 03
Requested: 14 Oct 2026
Unlocks: 29
Lane: F: ChatGPT
PRD: `../PRD.md`

## Why

Submission rules change; confirm current requirements before building.

## What to build

Read the current OpenAI plugin/app guidelines and submission docs. Answer: is link-out checkout to our hosted Paystack checkout allowed; any regional limits for Nigeria; required privacy policy, test credentials, review checklist; how widgets are served; whether Instant Checkout applies. Record sources with URLs.

## Out of scope

- Building anything.

## Acceptance criteria

- AC1: Each question has a sourced answer in `## Answer`.
- AC2: A submission checklist is listed for slice 29.

## Tests

None.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0067-bound-launch-channels-and-support.md` | New channel. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Data shared with a third-party host. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Research/design slice. DoD items 3 and 5 apply. No production code changes; the evidence and conclusions go in `## Answer`.

## Answer

### AC1 — sourced answers

1. **Is link-out checkout to a hosted Paystack checkout allowed?** Yes. OpenAI calls this **external checkout** and it is the "recommended and generally available" approach: direct users from ChatGPT to a merchant-hosted checkout flow on your own domain, where you handle pricing, payments, shipping and fulfillment for eligible physical goods. Payment, billing, taxes, refunds and compliance are handled entirely on our domain. — https://developers.openai.com/plugins/build/monetization

2. **Regional limits for Nigeria?** None found specific to Nigeria in the commerce, monetization, submission, or review pages. Availability is publisher-declared via `publication.countries` (an allowlist of uppercase ISO country codes, e.g. `["NG"]`). OpenAI's commerce policies are global category/prohibited-product lists, not country-specific. Note that ChatGPT product availability is tracked separately in "Supported countries". — https://developers.openai.com/plugins/deploy/submission, https://openai.com/policies/commerce-policies/

3. **Required privacy policy / legal pages.** For a remote-MCP app under public review, four HTTPS URLs are required: `websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`. The privacy policy must disclose every category of personal data the tools collect, process, or return (undisclosed user-data types are a rejection reason). — https://developers.openai.com/plugins/deploy/submission, https://developers.openai.com/plugins/deploy/app-review

4. **Test credentials.** Reviewer credentials are entered separately in the dashboard's "Review details" (never in the ZIP — `test_credentials` and `reviewer_instructions` are rejected from the package). They must be a dedicated test account using sample data, with no MFA, SMS/email/magic-link approval, or private-network access, and must work immediately. — https://developers.openai.com/plugins/deploy/submission

5. **How widgets are served.** Optional UI/widgets are served from the MCP server's own registrable domain (iframes/embedded pages from that domain), and a content security policy must allow the exact domains the component fetches from. Tools return a `_meta.ui.resourceUri` for a widget. — https://developers.openai.com/plugins/deploy/app-review, https://developers.openai.com/plugins/plugin-guidelines

6. **Does Instant Checkout apply?** No, for our link-out flow. Instant Checkout / the ChatGPT payment sheet (Agentic Commerce Protocol) is a separate private-beta path for select marketplaces/partners, and its supported PSPs are Adyen, Checkout.com, Fiserv, PayPal, Stripe and Worldpay — Paystack is not listed. Our path is external checkout (link-out to our hosted Paystack checkout). — https://developers.openai.com/plugins/build/monetization

### AC2 — submission checklist for slice 29

- Complete individual or business identity verification in the OpenAI platform.
- Hold `api.apps.write` (owner or a granted role).
- Host the commerce MCP server on a public HTTPS, registrable domain; complete the domain-verification challenge at `/.well-known/openai-apps-challenge` (exact plain-text token).
- Use no-auth, OAuth, or mixed auth on the MCP connection (the portal has no API-key/bearer submission flow; don't embed tokens in server headers).
- Package a ZIP with `plugin.json` (or `.codex-plugin/plugin.json`) + `mcp.json`, a square logo/icon ≥48px, name ≤64 chars, and listing metadata (`displayName` ≤30, `shortDescription` ≤30, `longDescription` ≤4000, category, capabilities).
- Provide four HTTPS URLs: website, support, privacy policy, terms of service.
- Set `review.commerce: true` with a `commerce_description` (physical goods, external checkout link-out).
- Declare `publication.countries` (e.g. `["NG"]`).
- Include five positive + three negative review test cases, a reviewer-accessible demo recording URL, and release notes.
- Enter reviewer credentials in the dashboard only (dedicated no-MFA test account, sample data).
- Define a CSP if any widget/UI is served.
- Keep secrets, tokens, credentials and `test_credentials` out of the ZIP and out of server `headers`.

### Sources

- [Checkout API reference — Plugins | OpenAI Developers](https://developers.openai.com/plugins/build/monetization)
- [Upload and submit your plugin — Plugins | OpenAI Developers](https://developers.openai.com/plugins/deploy/submission)
- [Remote MCP server review requirements — Plugins | OpenAI Developers](https://developers.openai.com/plugins/deploy/app-review)
- [Commerce policies — OpenAI](https://openai.com/policies/commerce-policies/)

## Comments

Research slice only (no production code). Key commercial takeaway for slice 29: build the commerce MCP server around **external checkout** — read tools plus a link-out to our Paystack checkout — not the ChatGPT payment sheet, since Paystack is not a supported embedded-checkout PSP today and that path is private beta.
