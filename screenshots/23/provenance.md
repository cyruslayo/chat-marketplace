# Slice 23 browser evidence

- Candidate under test: `ee017928ae71832b881655a1195ca1398c0cbf96`.
- Merged main: `823909b2d61bd4d612cd4930655914511ada5728`, via merge `eb436396a2133aa74d8d9724fd737c94283621fc`.
- Capture command: `npx tsx .scratch/guest-ui-consistency/capture-23.ts`.
- The harness uses the actual commerce `AssistantRuntime`, commerce pack, commerce catalogue projections, built Guest client, and real Chromium. It supplies the runtime's resulting A2UI surface payload to the Guest `/api/state` response so each of discovery, cart, and order can be independently captured.
- Each surface was captured in light mode at 320, 390, 768 and 1280 CSS pixels. `findings.txt` records viewport overflow, visible controls under 44px and missing expected commerce text. Hidden native radio inputs are excluded; no shared stylesheet or normalization was changed.

## Result requiring follow-up

All 12 screenshots show an empty commerce workspace. The Guest client accepts each surface and reports the mount as `data-renderer="weaver"`, but the mount remains `<div data-weaver-mount=""></div>` with zero `[data-a2ui-component]` nodes. The exact discovery payload uses the approved `urn:chat-marketplace:commerce/discovery/v1` ID and a Basic `Column` with `Text` children (including “Northstar Cotton Tote”). Cart and order have the same empty-render result. The viewport audit found no horizontal overflow or undersized visible controls, but a blank workspace is a failed visual gate.

The capture script and screenshots are retained as reproduction evidence. The full Node suite and worker suite passed on the candidate; the remaining blocker is browser rendering of the commerce catalogues and needs source-level diagnosis/review before final approval.

## Validation log

Full validation output, including the 28 focused commerce tests, 100 worker tests, full `NODE_ENV=test npm test`, and capture diagnostics: `C:\Users\Cyrus\AppData\Local\Temp\opencode\mdp23-final-validation.log`.

- `npm run check`: passed.
- `npm run build`: passed; the generated commerce catalogue registrations are committed in `apps/local-guest/dist/client.js`.
- Focused commerce/catalogue tests: 28 passed.
- Workers (`npm run test:workers -- --maxWorkers=1`): 20 files, 100 passed.
- Full `NODE_ENV=test npm test`: phase 1, 1,828 passed; real-browser phase, 177 passed and 2 skipped; zero failures.
