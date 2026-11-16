# Update the browser theme colour from the mode tokens on a switch

Status: resolved
Type: task
Blocked by: 03c (resolved: the client applies the server's mode and sets `data-mode`). Owner release before any build (ADR 0107 "Settled", 8 Nov 2026).
Requested: 16 Nov 2026

## Open owner decisions

1. **Which token.** The colour comes from `--mode-tint` (analysis 5.4) or from the page surface. Recommendation: `--mode-tint`, so the mobile address bar takes the mode's tint.
2. **How the colour reaches the meta tag.** The meta `content` is a plain value, and a CSS custom property cannot be read from the stylesheet. Choose: (a) read the resolved token at runtime with `getComputedStyle` and write it to the meta (no hex outside the token block; preferred); or (b) keep a fixed pair of values per mode in the shell markup. Owner also confirms that the value a browser accepts for `theme-color` is what the token resolves to in each theme.
3. **Initial colour.** The shell head has no `theme-color` meta today (`apps/local-guest/src/guest-server.ts:335` to `:341`). Owner to set the colour for light and for dark before the first response.
4. **No-JS page.** Does `/conversation` carry the stays colour statically? Recommendation: yes, for parity (ADR 0080).

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 5.4 (theming: scoped semantic tokens, browser chrome); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 4 (colours through `--mode-*` tokens only, with contrast tested) and decisions 2 and 6 (the mode is applied only from the validated response). Map slice `4-theme`.

## Why

Facts from the survey:

- No `<meta name="theme-color">` exists anywhere in `apps/local-guest/src`, `apps/cloudflare/src` or `apps/web-agent/src`. The shell head (`apps/local-guest/src/guest-server.ts:335` to `:341`) has charset, viewport and title only.
- The client writes `data-mode` only: `applyResponseMode` (`apps/local-guest/src/client.ts:1550` to `:1554`) calls `applyResponseModeTo`, which is in `apps/local-guest/src/response-mode.ts:19` to `:27`. Neither touches browser chrome.
- The root `data-theme` (`system`, `light` or `dark`, `guest-server.ts:337`) can override the system preference. A meta tag that follows only `prefers-color-scheme` would show the wrong colour under a forced theme.
- ADR 0107 decision 4 requires each mode's tokens to pass contrast, and components read tokens, not hex. A runtime read keeps that rule.

## What to build

1. **Shell head.** Add two `<meta name="theme-color">` tags to the shell head: one without a media condition and one with `media="(prefers-color-scheme: dark)"`, both with the initial colour from owner decision 3.
2. **Resolved theme.** The colour written follows the resolved theme, from `data-theme` first and the system preference only when `data-theme="system"`. A forced theme therefore wins over the system preference.
3. **Pure helper.** A pure function in `apps/local-guest/src/response-mode.ts` (no DOM access, so node can import it) maps a mode id and a resolved theme to the colour to write.
4. **Client write.** `applyResponseMode` writes the meta content only when the mode id changes, and only from a validated response.
5. **Fail closed.** An empty or unparseable token value keeps the previous meta content and throws nothing.
6. **No user path.** A chip, a strip radio or a sheet choice never writes the meta. Only the validated response does (ADR 0107 decision 2).
7. **No-JS page.** Carries the static stays colour, if owner decision 4 says so.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 4 | Colours through `--mode-*` tokens only; no hex in components; each pair tested for contrast. | Steps 2 and 3; AC 8. |
| 0107 decision 2 and 6 | The client changes the mode only from the server response; the response mode is validated first. | Steps 4 and 6; AC 6. |
| 0080 | No-JS parity for critical workflows. Chrome colour is cosmetic, so parity means the static colour only. | Step 7; AC 7. |
| 0078 | Contrast and reflow. The meta colour has no ADR of its own; owner decision 1 sets it. | Owner decisions 1 and 3. |

## Acceptance criteria

Each is its own `test()` in `test/agent-mode-theme-color.test.ts` (new).

1. The shell head has one `theme-color` meta without media and one with `(prefers-color-scheme: dark)`, both present in the first response.
2. A mode switch sets the meta content to the new mode's token value for the resolved light theme.
3. A mode switch sets the meta content to the new mode's token value for the resolved forced-dark theme.
4. A forced `data-theme="light"` on a dark system sets the light colour (the forced theme wins).
5. A response with no mode, or a malformed mode, leaves the meta unchanged and throws nothing.
6. A user action (a chip, a strip radio or a sheet choice) never writes the meta; only the validated response does.
7. An empty or unparseable token value keeps the previous meta content and writes nothing (fail closed).
8. Every registered mode id resolves to a non-empty token value for light and dark (extends the 03c token-coverage test; does not duplicate it).

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/agent-mode-theme-color.test.ts test/agent-mode-shell.test.ts test/local-guest-shell.test.ts`.
- Real Chrome, solo: only if owner decision 2 chooses the runtime read. Then `test/agent-mode-theme-color-chromium.test.ts` (new), reading the meta after a switch in light and dark.
- No screenshot is taken for this issue: the page looks the same. The mobile address-bar colour is a manual check on the reference low-end Android Chrome, recorded under `## Comments`.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- The View Transition (03j) and the announcement (03l).
- Any change to the page's own colours or to the token values of the stays mode.
- Browsers that ignore `theme-color` (no fallback is needed; the page is unchanged).

## Comments

### Agent, implementation (Agent modes issue 03k)

Status at this entry: resolved. The pre-merge batch gate (`npm test`, `npm run test:workers`, once per batch after every issue is resolved) has not run here; per Test scope it is not run per issue.

**Owner decisions (17 Nov 2026), applied as settled.**

1. Token: `--mode-tint` (`var(--color-accent-subtle)`: `#F7E6D8` light, `#3A2518` dark).
2. Mechanism: runtime read. The client reads the resolved `--mode-tint` with `getComputedStyle` after it applies `data-mode`, and writes it to both theme-color metas. No new hex in the client or in components.
3. Initial colour: the stays values, in one exported constant `MODE_THEME_COLOUR_INITIAL` (`apps/local-guest/src/response-mode.ts`). The shell's two tags follow the resolved `data-theme` (`system`: light on the plain tag, dark on the media tag).
4. No-JS: `/conversation` carries the same two static tags (ADR 0080 parity).

**ADR table (steps 1 and 2).** Read in full: 0107. Read the consequences and decisions 2, 4, 6 in full; 0080 (parity for critical workflows) and 0078 (contrast and reflow) read before code.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 2 | The client changes the mode only from the validated response; chips, the strip and the sheet never write the meta. | `applyResponseMode` (`client.ts`) is the only call site of `applyResponseModeAndThemeColour`; AC6. |
| 0107 decision 4 | Colours through `--mode-*` tokens only; no hex in components; pairs tested. | The colour is read from `--mode-tint`; the only literals are the stays values in `MODE_THEME_COLOUR_INITIAL`, checked against `shortlet-foundations.css` (design test). Token values unchanged. |
| 0107 decision 6 | The response mode is validated before it is applied. | `applyResponseModeTo` returns false before the tint is read for an absent or malformed mode; AC5. |
| 0080 | No-JS parity for critical workflows. | `renderNoScriptConversationHtml` passes the static tags through the new `head` option of `pageShell`; design (ADR 0080 parity) test. |
| 0078 | No layout, type or target change; contrast. | No CSS change; no new colour pair; the shell DOM only gains two `<meta>` tags. |

**Implementation notes and deviations.**

- `test/fixtures/guest-shell-pre-agent-modes.html` gained the two theme-color tags (the first paint now carries them, which is the point of AC1). The byte-identity tests (`agent-mode-shell` AC4, `agent-mode-follows-task` AC4) compare against it and pass.
- `applyResponseModeTo` now returns `true` only when the id changed (its callers ignore the result, so they are unaffected).
- `pageShell` (`apps/web/src/ui-kit.ts`) gained an optional `head` string, empty by default, so every other page renders byte-identically.
- Accepted computed colour formats: `#RGB`, `#RRGGBB`, `#RRGGBBAA`, and `rgb()`, `rgba()`, `hsl()`, `hsla()`. Anything else (empty, whitespace, `var()`, `url()`, a non-string) fails closed and the previous content stays. This is a validation rule, not domain policy.
- The write also runs on `prefers-color-scheme` change, only while `data-theme` is `system`.
- `npm run build` was run to regenerate `apps/local-guest/dist/client.js`. It also rewrote line endings in `apps/cloudflare/public/_headers` and `dist/{gallery,landing,offer,payment}.js`; those five differed only by CRLF (checked with `--ignore-cr-at-eol`) and were restored. Only `client.js` is committed from dist.
- The issue's "`/conversation` the no-JS page" parity test is an added test beyond AC1 to AC8.

**Commands and counts** (worktree `C:\AI2026\chat-marketplace-03k`, every command prefixed `env -u LLM_API_KEY`):

1. `env -u LLM_API_KEY npm run check`: exit 0 (root `tsc`, cloudflare, test and tooling tsconfigs, worker bundle guard).
2. `env -u LLM_API_KEY npx tsx --test test/agent-mode-theme-color.test.ts`: 12 tests, 12 pass, 0 fail.
3. `env -u LLM_API_KEY npx tsx --test test/agent-mode-theme-color.test.ts test/agent-mode-shell.test.ts test/local-guest-shell.test.ts test/agent-mode-follows-task.test.ts test/agent-mark-shell.test.ts test/guest-journey-rail.test.ts test/guest-new-conversation.test.ts`: 59 tests, 59 pass, 0 fail, exit 0 (the three required files plus the suites that render the shell, the no-JS page or `pageShell`).
4. Solo, after the rebuild: `env -u LLM_API_KEY npx tsx --test test/agent-mode-theme-color-chromium.test.ts` (real Chrome, runtime read after a switch to shop, forced light and forced dark): 2 tests, 2 pass, 0 fail.
5. Solo, because the client bundle changed: `env -u LLM_API_KEY npx tsx --test test/agent-mode-sheet-chromium.test.ts`: 5 tests, 5 pass, 0 fail.

Not run here: the full `npm test` and `npm run test:workers` (batch gate, Test scope).

**Definition of Done.** (1) Each AC has its own named test in `test/agent-mode-theme-color.test.ts`; AC2 and AC3 are also proven in real Chrome. (2) Failure paths: absent, null, string, unknown key, unknown icon (AC5); empty, whitespace, unparseable, `var()`, `url()`, invalid hex length (AC7); a repeat of the same mode reads nothing (AC6); forced light on a dark system (AC4). (3) ADRs listed above and cited in the commit message. (4) No injected dependency added. (5) No policy string invented: the colours trace to owner decision 1 and `--color-accent-subtle`. (6) No credential or identity material in any log or record. (7) `npm run check` passes; `npm test` is deferred to the batch gate, as Test scope requires.

**Manual owner check (not done here).** The mobile address-bar colour on the reference low-end Android Chrome (a real device) is an owner check. The automated checks above prove the meta content, not the device's chrome.
