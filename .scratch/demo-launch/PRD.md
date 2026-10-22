# Public Live Demo Launch PRD

Status: ready-for-agent
Requested: 21 Oct 2026

## Goal

Ship a public, clickable demo of the stays concierge so people can try the agent itself. Visitors chat with an LLM-driven agent, which runs on **GPT-6 Luna via OpenRouter**. They browse seeded demo apartments with real-looking photos, request a stay, and complete a **Paystack test-mode** checkout. No real money moves, and no real listing is offered.

The agent is the product being sold. The demo exists to show it working, not to take bookings.

## Owner decisions (21 Oct 2026)

| Decision | Choice |
| --- | --- |
| Hosting | Cloudflare staging Worker (`shortlet-pilot-staging`), on a workers.dev URL or `staging.shortlet.ng` |
| Model | GPT-6 Luna through OpenRouter, using the existing OpenAI-compatible client |
| Booking flow | Full flow through to Paystack **test** checkout (test keys and test cards only) |
| Access | Anyone with the URL: no beta invite gate in demo mode, with costs bounded by the daily model-call cap |
| Photos | Free-licence stock interiors (Unsplash or Pexels), credited, with each unit labelled "Demo listing" |
| Legal and launch gates | Knowingly deferred for the demo only, and recorded in an ADR rather than silently bypassed |

## Demo monthly booking scope (22 Oct 2026)

The owner authorized a staging-only Extended Stay demo through 180 consecutive nights. Production keeps ADR 0092's 30–90-night maximum. Short Stays keep their existing 1–14-night rule, and 15–29 nights remain unsupported. A 180-night demo uses six 30-night Billing Periods. Guests pay each period through a separate payment session, under ADR 0092's due and reminder rules. The demo must use the real quote, Request to Book, confirmation and payment paths with synthetic inventory. It must not imply a six-calendar-month term or a production policy change. Cancellation and Notice to End may demonstrate ADR 0092 values with clear demo labels. An unpaid period may trigger human contact, but the demo must never simulate lockout or a legal termination process.

Monthly booking support is new work because no Extended Stay pricing or payment-period runtime exists today. Issues 08–13 define the dependency chain before issue 05 seeds and provisions monthly demo units. ADR 0105 records the staging-only maximum exception. The monthly-stays tracker remains independent; this work does not resolve its open tickets or the pending legal review.

## Current state (findings, 21 Oct 2026, `main` b48bca6)

- **Nothing is deployed.**
  - Cloudflare issue 15 (the staging rehearsal) is `ready-for-human`, and its evidence log is blank.
  - The entry point is `apps/cloudflare/src/worker.ts`, which routes guest traffic to the `ShortletPilot` Durable Object (`apps/cloudflare/src/shortlet-pilot-do.ts`).
- **No LLM runs on Cloudflare.**
  - `apps/cloudflare/cloudflare.config.ts:86` hardcodes `CONCIERGE_MODE: bindings.text("deterministic")` and declares no `LLM_*` bindings.
  - The Durable Object already calls `createConciergeModelClient(configuration.concierge)` (`shortlet-pilot-do.ts:286`).
- **OpenRouter fits the existing client.**
  - `apps/local-guest/src/assistant/openai-compatible-client.ts` POSTs to `${LLM_BASE_URL}/chat/completions` using raw fetch, as ADR 0068 requires.
  - It reads `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` and `LLM_PROVIDER_LABEL` (`concierge-configuration.ts`).
- **Delegation to the LLM is already structured.**
  - `AssistantRuntime.handleTurn` (`apps/local-guest/src/assistant/assistant-runtime.ts:285-626`) lets the model pick tools from `toolsForState` and runs them through `pack.executeTool`.
  - Confirm and cancel stay deterministic (`pending-actions.ts:87-95`).
  - The runtime falls back to the deterministic concierge when the budget is exhausted (ADR 0080).
- **No benchmark records latency or cost.**
  - `scripts/pilot-agent-smoke.ts` grades tool choice, entity and price accuracy, and fabrication across a 4-turn journey.
  - It records no timings, token counts or cost.
- **Staging blocks a public visitor.**
  - Every guest route returns 503 `NOT_PROVISIONED` until inventory is imported through `/_ops` (`apps/cloudflare/src/cloudflare-config.ts` around lines 72–88).
  - Staging requires `SHORTLET_BETA_INVITE_CODE` (`apps/pilot/src/pilot-config-core.ts:161`, `cloudflare.config.ts:76-78`).
- **The demo label exists but is never turned on.**
  - `landingDemo` (`apps/local-guest/src/guest-server.ts:2164`) shows the owner-approved text "Demo — illustrative photos, not live listings." (landing issue 13).
  - No host sets it.
- **No photos load today.**
  - `Unit.photoUrls` (`domains/shortlet/src/browse.ts:43`) accepts HTTPS URLs only, with a maximum of 12 (`domains/shortlet/src/photo-url.ts`).
  - The fixture units have none.
  - The pilot units point at `pilot-local.invalid`, which returns 404 on purpose.
  - The CSV import (`domains/shortlet/src/inventory-import.ts:281`) takes `photo_urls` separated by `|`.
  - Units must pass `isEligibleUnit` (`browse.ts:237`), which requires full operator and inspection claims.
- **The build tooling is broken on Windows.**
  - `cf build` fails with `spawn …\bin\cf-vite ENOENT`.
  - The workaround is `node apps/cloudflare/node_modules/@cloudflare/vite-plugin/bin/cf-vite build`, after running `node scripts/ensure-worker-deps.mjs`.
  - See `docs/runbooks/cloudflare-staging-rehearsal.md`, gap 1.

## ADR treatment

| ADR | Constraint | Demo treatment |
| --- | --- | --- |
| 0065 / 0095 | No real-person data until DPIA, counsel review and processor contracts; processors are Cloudflare and Gemini only | **Deferred** by ADR 0105: OpenRouter becomes a demo processor, and the UI tells visitors not to enter personal data |
| 0008 / 0009 / 0010 | Only inspected units from verified, CAC-registered operators are published | **Deferred**: demo units carry synthetic claims and are labelled "Demo listing" |
| 0104 | The development demo is not exposed publicly | **Superseded for the demo** by 0105; commerce stays off |
| 0072 / 0080 | Consequential actions go through the command gate with explicit confirmation; the agent cannot make financial transitions alone | **Kept unchanged** |
| 0075 | No keys, prompts or replies in logs | **Kept**; the benchmark records numbers only |
| 0079 | A model change needs smoke and eval evidence | **Kept**, satisfied by issue 03 |
| 0068 / 0069 | No vendor SDK in the port; keys stay server-side | **Kept**, through the raw-fetch client |
| 0087 | Staging uses test keys only; the callback origin equals the public origin | **Kept** |

## Out of scope

- Real payments, live Paystack keys, payouts
- Real or inspected listings
- Production deploy (Cloudflare issue 16)
- Commerce
- Guest email sign-in. It is optional: without `RESEND_API_KEY` it stays off, which is fine for the demo.

## Reversal at real launch

At real launch, remove `SHORTLET_DEMO`, delete the demo inventory and photos, and retire ADR 0105. The production path is never changed by this effort, and the config loader refuses demo mode in production.

## Issues

See [map.md](map.md).
