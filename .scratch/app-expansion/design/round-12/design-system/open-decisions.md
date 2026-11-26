# Decisions

## Settled by the owner, 20 Nov 2026

| # | Decision | What it changed |
| --- | --- | --- |
| 1 | The master brand is **Xenia** | System renamed. "Shortlet" stays only in code and domain names until a rename issue |
| 2 | **Services** is its own mode | Palm olive accent, key-tag mark (proposal), its own column on the Modes page |
| 3 | **One brand colour**, chosen through colour theory, visual principles and psychology | **Adire Indigo, confirmed** (Colour page); the green is retired |
| 4 | Rework Community and brass to fit the brand colour | Community is now lagoon teal; brass became sand, used only on indigo |
| 5 | The mark is a placeholder; the logo comes later | Wordmark in Newsreader until then; the logo must not reuse a mode silhouette |
| 6 | Align the persona copy | Brand: Xenia. Voice: the concierge. Label: "Concierge · Stays", or "Xenia Concierge · Stays" in full. Never a human name |
| 7 | Write new copy from the values, starting from foundations | Language page: names, voice, tone, mechanics, vocabulary layers, patterns, checklist |
| 8 | **Events** is the first second domain | It unblocks agent-modes slices 3 to 5, and needs its own ADR and CONTEXT.md |
| 9 | Placeholder images or illustrations until listings exist | Placeholder card and illustration rules; real photos replace them |
| 10 | Ranking: Honest, Exact, **Calm, Light**, Spoken | Values reordered; tie-break table updated; ADR 0078 kept as a floor |

## Still open

1. **Implement Adire Indigo in the code.** Replace the green baseline in the "Guest UI kit" block of `shortlet-foundations.css` and in the landing tokens, and add a `--mode-*` block for each mode. This is a code change with contrast tests and fresh screen captures, and it needs its own issue.
2. **Xenia name checks.** Before public launch, run a trademark search in Nigeria and the main diaspora markets, and check the domains and social handles. Xenia is used by other companies, including hotel brands abroad. This is not legal advice.
3. **Persona copy in code.** Three places to change: `STAYS_PRESENTATION.persona.name` ("Stays" becomes "Concierge · Stays"), the playground's "Stays concierge", and the pack prompt's identity line ("the Xenia concierge"). This needs a small issue and owner approval of the copy.
4. **Rename from Shortlet.** Decide the scope: guest-facing copy only, or package and app names too. Domain terms in `CONTEXT.md` keep their meaning.
5. **Services boundary.** Services added to a stay quote, versus Services booked on their own. The Services ADR decides this, and it must stay clear of commerce (ADR 0104).
6. **Services mark.** The key tag is a proposal.
7. **The promise across modes** (*proposal*): "Settled, in one conversation."
8. **The receipt as a brand moment** (*proposal*, under value 2).
9. **The logo brief.** It should come from the values, the indigo-and-sand palette, and the rule that it stands apart from every mode silhouette.
