# Domain Docs

This repository uses a multi-context domain-documentation layout.

## Before exploring

1. Read `CONTEXT-MAP.md` to identify the relevant bounded contexts.
2. Read each applicable `CONTEXT.md` under `packages/` or `domains/`.
3. Read the system-wide decisions under `docs/adr/` that affect the work.

Proceed silently if an expected document does not yet exist. Domain documentation is created when language or decisions are actually resolved.

## Vocabulary

Use the exact project terms defined in the relevant glossary. Do not drift to synonyms that a glossary explicitly rejects. A missing necessary term is a domain-modelling gap and should be surfaced rather than invented casually.

## ADR conflicts

Explicitly identify any proposal that contradicts an existing ADR, including the ADR number and the reason it may warrant reopening. Never silently override an accepted decision.
