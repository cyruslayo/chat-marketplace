# Note for the Weaver team: card actions that outlive their artifact

Date: 9 Nov 2026
From: Shortlet guest app (staging defect, [issue 56](../../shortlet-concierge-launch/issues/56-discovery-artifact-id-drift-after-criteria-chip.md))
Weaver version: `@cylayo/weaver-core` / `@cylayo/weaver-web` 0.2.1

## Summary

A guest tapped "View apartment" on a discovery card and got "The action does not match the authoritative artifact." twice. **Weaver did not cause it.** It rendered the card and sent the action exactly as the server built it. The app's server changed the artifact behind the card without sending a new surface (fixed in the app). Three things in the Weaver contract let the defect reach the guest as a dead, repeating card. They are worth a look because every app on Weaver can hit them.

## What happened, from Weaver's side

1. The server sent a surface `thread-…:discovery:results` whose Button action context is `{ artifactId: A, unitId }`.
2. The server later replaced artifact A with B on the thread. It sent no `updateComponents` / `deleteSurface` for the surface.
3. The guest tapped the Button. Weaver emitted the action with `surfaceId` (still current) and `artifactId: A` (no longer current).
4. The host refused it with `ARTIFACT_MISMATCH`. The surface stayed interactive, so the next tap was refused the same way.

## Findings for Weaver

### 1. A surface's identity is not tied to the artifact it renders

The surface id and the artifact id in an action's context are two independent keys. Here the surface id stayed valid while the artifact behind it changed, so the host's surface check passed and only the artifact check caught it. Weaver has no way to say "this surface renders artifact A, version N".

**Suggestion:** let a producer declare the authoritative artifact a surface renders (for example `artifactRef: { id, projectionVersion }` on `createSurface`), and have Weaver include it on every action from that surface. Hosts could then check one pair instead of hand-matching ids in each action context, and a mismatch would always be detectable at the surface level.

### 2. No standard rejection outcome for an action

`weaver-web` hands an action to the host and has no shared shape for "the server refused this". Each host keeps its own list of codes that should mark a surface stale. Ours handles `STALE_SURFACE`, `STALE_ACTION` and `EXPIRED_SURFACE` but not `ARTIFACT_MISMATCH` or `INVALID_ARTIFACT`, so the card stayed live after a refusal that should have retired it.

**Suggestion:** a closed rejection class on the action result (`stale` | `forbidden` | `invalid` | `unavailable` | `busy`), with a default `weaver-web` behaviour per class: `stale` retires the surface and asks the host to refresh (the guest sees fixed copy once), `forbidden` and `invalid` disable only the tapped control until the next server update for the surface, `unavailable` allows a retry, and `busy` keeps the control enabled and shows the copy once. Hosts map their codes to a class once, instead of re-deriving the UI rule per screen.

### 3. Nothing stops a refused control from being tapped again

After a refusal the same Button stays enabled, so a guest taps it again and gets the same error. A `stale` or `forbidden` result from finding 2 should disable that control (or the whole surface for `stale`) until the next server update for the surface.

## What the app changed (no Weaver change needed for the fix)

- The server no longer re-mints a discovery artifact id when it re-queries for a changed context. The card's id stays valid (ADR 0106).
- Implemented on the app side ([issue 60](../../shortlet-concierge-launch/issues/60-guest-safe-refusals.md)): every refused action now carries a closed class as `refusal` beside its `code` — `stale | forbidden | invalid | unavailable | busy`. The server maps each code to guest copy once (no ids, provider text or internal messages reach the guest), and the client applies one behaviour per class:
  - `stale`: retire the view, re-render its status, and refresh from the server; the guest sees the fixed copy once.
  - `forbidden` / `invalid`: set `aria-disabled` on the tapped control (announced, target unchanged) until the next server render of that surface; other controls keep working and a second tap sends nothing.
  - `unavailable`: show the fixed copy; a retry is allowed.
  - `busy`: keep the control enabled and show the copy once.
  - An identical consecutive refusal collapses into one turn instead of repeating.
  We offer this class and its per-class behaviour as the starting shape for the Weaver rejection contract in finding 2.
- The class mapping now treats `ARTIFACT_MISMATCH` and `INVALID_ARTIFACT` as stale, so those cards retire and refresh instead of staying live. Findings 2 and 3 would make this the default in Weaver rather than per app.

## Questions back to Weaver

- Is an artifact reference on `createSurface` in scope for the catalogue runtime (weaver-catalogues issue 03)?
- Would a rejection class fit on the A2UI v0.9.1 action round trip, or does it belong in a Weaver extension?
