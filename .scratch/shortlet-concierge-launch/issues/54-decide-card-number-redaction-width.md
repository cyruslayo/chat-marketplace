# Decide the card-number redaction width (13-15 and 17-19 digits)

Status: ready-for-human
Type: HITL
Requested: 11 Oct 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

The card-number rule matches only 16-digit groups, so other lengths of card number are never masked, in free text or in ids. This is pre-existing on `origin/main` (before PR #105) and is pinned by tests rather than fixed.

- The rule is `CARD_NUMBER_SHAPE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g` at `packages/platform-core/src/redaction.ts:13`, applied by `.replace(CARD_NUMBER_SHAPE, "[REDACTED]")` at `:155`.
- A 15-digit Amex-length number (4-6-5 grouping) is not matched. A Luhn-valid 17- to 19-digit number is not matched either.
- The pinned tests are in `test/redact-platform-ids.test.ts`, named `PINNED LIMIT` (`:222` for 17-, 18- and 19-digit numbers in a v4 id; `:232` for the 19-digit id `req-21022665-8675-4290-889a-aaaaaaaaaaaa`), plus the free-text Amex and 19-digit pins in the same file. Issue 50 Needs user, item 2, records this as an accepted limit pending a human decision.
- Issue 50 tried a whole-run 17- to 19-digit rule and dropped it: it added about 1 in 5,650 more loss in ids (177 of 1,000,000) to cover a case the card rule never matched anywhere.

## Question for the human

1. Widen the card rule to cover 13- to 19-digit runs, or keep 16 digits? Widening has a cost in platform ids (issue 50 measured about 1 in 5,650 extra masked ids for 17- to 19-digit runs) and a cost in false positives on other digit runs (phone numbers, references, amounts).
2. If widened: which lengths, which grouping rules (Amex 4-6-5, Diners 4-6-4, Maestro 12 to 19), and should the Luhn gate (`containsLuhnValidCardShape`, `redaction.ts:114`) decide, so that only Luhn-valid runs are masked?
3. Or accept the limit: record it as an accepted risk in `docs/agents/coding-standards.md` or an ADR, and keep the PINNED LIMIT tests as the record.

The status stays `ready-for-human` until question 1 is answered. This issue must not be implemented as a guess.

## Once decided (for the implementing agent)

- Change the rule in `redaction.ts` only (ADR 0075: one redactor). Do not add a second rule for ids.
- Flip the PINNED LIMIT tests in `test/redact-platform-ids.test.ts` to assert the decided behaviour, one test per length class.
- Re-run the 20,000-id oracle tests and the flake loops in issue 50 for the new rule, and record the new residual in Comments.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0075 | Minimise personal and financial data in audit, telemetry and projections | `redaction.ts:13`, `:155` |
| 0096 | Payment references in plaintext are exempt only in the private export | Not applicable to the card rule |

## Comments

- 11 Oct 2026, filed from issue 50 Needs user (item 2) and the Luhn gate section. Lines re-checked on `origin/main` 8b23923: rule at `redaction.ts:13`, applied at `:155`, Luhn gate at `:114`; the PINNED LIMIT tests at `test/redact-platform-ids.test.ts:203, 216, 222, 232`.
