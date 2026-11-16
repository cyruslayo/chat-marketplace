# Update the browser theme colour from the mode tokens on a switch

Status: needs-triage
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
