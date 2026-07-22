# Domain Docs

This repository uses a multi-context domain-documentation layout.

## Before exploring

1. Read `CONTEXT-MAP.md` to identify the relevant bounded contexts.
2. Read each applicable `CONTEXT.md` under `packages/` or `domains/`.
3. Read the system-wide decisions under `docs/adr/` that affect the work.

Proceed silently if an expected document does not yet exist. Domain documentation is created when language or decisions are actually resolved.

## Vocabulary

Use the exact project terms defined in the relevant glossary. Do not drift to synonyms that a glossary explicitly rejects. A missing necessary term is a domain-modelling gap and should be surfaced rather than invented casually.

## No invented domain logic

Do not implement any policy, rule, threshold, time window, business constant, or prose string that is not explicitly stated in:
- the issue's acceptance criteria or "What to build" section,
- an ADR under `docs/adr/`, or
- a `CONTEXT.md` under the relevant bounded context.

If required content is absent from all three sources, that is a specification gap. Surface it to the user rather than hallucinating an implementation. This rule is the primary reason agents introduce scope creep and hardcoded strings that do not match system decisions.

## ADR conflicts

Explicitly identify any proposal that contradicts an existing ADR, including the ADR number and the reason it may warrant reopening. Never silently override an accepted decision.
