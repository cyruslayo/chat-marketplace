# 37 · Reflow at 320px and 200% zoom: no mid-word breaks, money on one line

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 2 (follow-up from Phase 0; owner approved 12 Nov 2026)
Applicable ADRs: 0078 (reflow, 44px targets); guideline §7 typography, §10 money, §12, §14 required proof

## What to build

Matrix rows 73 and 24 (P2), and 23 and 25 (P3).

- **Mid-word breaks (rows 73, 23):** at 200% zoom the confirmed header breaks as "Book / ing / confi / rmed", date labels split as "Check- / in", and "2 bathrooms" breaks as "bathroom / s" at 320. Find the rule causing it (likely `overflow-wrap: anywhere` on headings or labels). Let words wrap whole, and only break unbroken strings such as references or URLs.
- **Money on one line (row 24):** "Refundable Security Deposit (separate): ₦20,00" wraps the last digit onto the next line. Keep each amount unbroken (for example `white-space: nowrap` on the money value).
- **Sticky bar (row 25):** "₦390,000Total to complete booking" runs together. Separate the amount from its label.
- Do not hide content to fit. There must still be no horizontal overflow and no control under 44px.

## Acceptance criteria

1. At 320px and at 390px with 200% zoom, no heading or label breaks inside a word on the confirmed, offer, unit detail and draft screens
2. No money amount wraps across lines at any of the four widths
3. The sticky bar shows the amount and its label as separate, readable items
4. There is no horizontal overflow and no control under 44px (capture sweep findings)

## Rules

- Follow the AGENTS.md implementation protocol. Write one named test per acceptance criterion, covering its failure paths (a real-Chrome test can measure word breaks with a Range per text node).
- Foundation CSS: commit `shortlet-foundations.css` before running `test/landing-page.test.ts`. Keep literal six-digit hex tokens and the committed formatting.
- `client.ts` changes, if any, run one at a time: not in parallel with 35 or 36.
- After the change, re-run `capture-11-all.sh` (one group per process) and save captures under `screenshots/37/`, including 200% zoom at 390.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here.
- Commit by explicit path only. Never stage generated screenshots outside `screenshots/37/`. No stash, reset or clean.

## Comments
