# Pilot launch readiness (map)

Source: simulated expert panel review, 27 Sept 2026. The software is ahead of the business: the money path and booking rules are built, but there are no real units, no real legal advice and no real guests yet.

Goal: a closed, founder-operated paid pilot with 10–20 real, inspected units in one or two neighbourhoods per city (Lagos, Abuja). First paid guest targeted for early November 2026, ahead of December diaspora demand.

**Product direction (decided 27 Sept 2026, issue 11):** the web app is all-in-one. Guests explore cities, find apartments, book, pay and manage their stay there; the agent drives discovery and Weaver renders the UI. WhatsApp is, at most, a human-run support channel that sends guests back into the app. The product is not WhatsApp first.

**Stays-only launch (20 Oct 2026):** [issue 27 — disable commerce on both Node pilot hosts](issues/27-disable-commerce-on-node-pilot-hosts.md) is the code half of the owner's [commerce deferral decision (multi-domain 30)](../multi-domain-platform/issues/30-defer-commerce-until-stays-launch.md). Commerce remains off in public deployments; the local guest demo is a development tool.

## Issues

| # | Issue | Type | Status | Blocked by |
|---|---|---|---|---|
| 01 | [Merge ADRs 0088–0090 and mark superseded ADRs](issues/01-merge-business-model-adrs.md) | task | ready-for-agent | none |
| 02 | [Reopen issues 42–44 as real human work](issues/02-reopen-simulated-hitl-gates.md) | task | ready-for-agent | none |
| 03 | [Engage Nigerian counsel for the launch legal pack](issues/03-legal-launch-pack.md) | task | ready-for-human | 01 |
| 04 | [Paystack live account, certification and transfer access](issues/04-paystack-go-live.md) | task | ready-for-human | 03 |
| 05 | [Sign and inspect the first 10–20 units](issues/05-sign-and-inspect-first-units.md) | task | ready-for-human | 03 |
| 06 | [Unit operations pack](issues/06-unit-operations-pack.md) | task | ready-for-human | 05 |
| 07 | [Fund and state the guest protection promise](issues/07-guest-protection-promise.md) | grilling | ready-for-human | 01 |
| 08 | [Write the identity-at-check-in procedure](issues/08-identity-at-check-in-procedure.md) | grilling | ready-for-human | none |
| 09 | [Support rota and incident playbook](issues/09-support-rota-and-playbook.md) | task | ready-for-human | none |
| 10 | [Fix must-fix guest and back-office UX](issues/10-must-fix-ux.md) | task | resolved | none |
| 11 | [Decide WhatsApp's role at launch](issues/11-decide-whatsapp-role.md) | grilling | resolved | none |
| 12 | [Choose target guests and the December launch plan](issues/12-target-guests-and-launch-plan.md) | grilling | ready-for-human | none |
| 13 | [Define and capture pilot metrics](issues/13-pilot-metrics.md) | task | ready-for-agent | 01 |
| 14 | [Record paused scope](issues/14-record-paused-scope.md) | grilling | ready-for-human | 01 |
| 15 | [Staffed dry run with one real paid booking](issues/15-staffed-dry-run.md) | task | ready-for-human | 03, 04, 05, 06, 07, 08, 09, 10 |
| 16 | [Production build and runtime](issues/16-production-build-and-runtime.md) | task | resolved | none |
| 17 | [OpenAI-compatible model adapter (DeepSeek and OpenAI)](issues/17-openai-compatible-model-adapter.md) | task | resolved | none |
| 18 | [Validated concierge configuration and provider fallback](issues/18-validated-concierge-configuration.md) | task | resolved | 17 |
| 19 | [Guardrails: rate limits, body limits, session lifecycle and errors](issues/19-guardrails-rate-limits-and-sessions.md) | task | resolved | 18 |
| 20 | [Remove production stubs in the back office](issues/20-remove-back-office-stubs.md) | task | ready-for-agent | none |
| 21 | [Persist money and audit records](issues/21-persist-money-and-audit-records.md) | task | ready-for-agent | none |
| 22 | [Staging deployment mode for the closed beta](issues/22-staging-deployment-mode.md) | task | resolved | none |
| 23 | [Operator and guest notifications](issues/23-operator-and-guest-notifications.md) | task | resolved | none |
| 24 | [Structured logging and assistant diagnostics](issues/24-structured-logging.md) | task | ready-for-agent | 18 |
| 25 | [Backups, WAL and schema versioning](issues/25-backups-wal-and-schema-versioning.md) | task | ready-for-agent | 21 |
| 26 | [Tester feedback link](issues/26-tester-feedback-link.md) | task | ready-for-agent | none |
| 27 | [Disable commerce on the Node pilot hosts](issues/27-disable-commerce-on-node-pilot-hosts.md) | task | resolved | none |

Issues 16–26 come from the production audit of 28 Sept 2026. The closed beta (test payments, invited testers) needs 16–19, 22, 23 and 10. The paid pilot additionally needs 20, 21, 24 and 25.

## Rules

- Human (`ready-for-human`) issues are resolved only with real-world evidence: signed documents, named people, dates, receipts. Code that records findings is not evidence (see issue 02).
- Agent issues follow the Definition of Done in `docs/agents/issue-tracker.md`.

## Context pointers (append as issues resolve)

- 11: web app is all-in-one (agent discovery rendered by Weaver). WhatsApp is support only and not connected; `whatsapp-adapter.ts` stays paused.
- 17, 18: concierge providers are `gemini` and `openai-compatible` (DeepSeek or OpenAI), with an optional `CONCIERGE_FALLBACK`; settings are validated at startup (`apps/local-guest/src/assistant/concierge-configuration.ts`). Branch `launch/llm-providers`.
- 16: production install is `npm ci --omit=dev` → `npm run build` → `npm run pilot:start`; tsx and esbuild are runtime dependencies. Branch `launch/staging-and-build`.
- 22: `SHORTLET_DEPLOYMENT=staging` is the closed beta: Paystack test keys only, beta banner on every page, `SHORTLET_BETA_INVITE_CODE` gate (`/?invite=<code>`). Branch `launch/staging-and-build`.
- 19: hourly rate limits at the pilot front server, a daily model-call cap that falls back to the deterministic concierge, body limits, idle session-runtime eviction (`docs/pilot-deployment.md` "Guardrails"). Default values confirmed by the user. Branch `launch/guardrails-and-notifications`.
- 23: Resend email notifications via a sweeping `PilotNotifier` (`apps/pilot/src/notifications/`); Operator alerts go to `SHORTLET_OPERATOR_ALERT_EMAILS`. Branch `launch/guardrails-and-notifications`.
- 10: most criteria were already met on main; "show me the apartment" now opens a result or asks which one (`viewResultIntent`). All six criteria are covered by `test/guest-must-fix-ux.test.ts`. Branch `ux/issue-10-must-fix`.
- 27: [answer and gate evidence](issues/27-disable-commerce-on-node-pilot-hosts.md#answer) — `ebfa4c1`, branch `stays-launch/27-commerce-off-pilot-hosts`; Node production/staging and local pilots disable commerce, fixed configuration fails closed, demo/Cloudflare/stays unchanged. Build/check passed; targeted 35/35, existing local-pilot browser 44/44, Workers 159/159. Full-suite single contention failure passed 23/23 alone; owner explicitly accepted that exception and restoration of the 31 verification side effects. Resolved on the branch, not merged/pushed/deployed.
