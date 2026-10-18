# Slice 23 commerce surface rendering after root fix

- Candidate under test: `9b98837d3bd9aec807e2ffc9a43bf35f3e5c9fce` plus the uncommitted fix in `apps/web-agent/src/commerce-presentation.ts`.
- Root cause: Weaver's Basic Web runtime resolves a surface tree only when its root component is identified by the canonical component ID `root`. Commerce used `commerce-root` and `checkout-root`; `runtime.process()` accepted the messages, but `resolveSurface()` returned `tree.ready: false`, and `mount()` succeeded with an empty `<div data-weaver-mount=""></div>`.
- Fix: discovery, cart, order, and checkout A2UI component trees now use the canonical `root` ID. The underlying approved commerce catalogue IDs, renderer registrations, resource policy, action handling and lifecycle remain in the existing shared runtime path.
- The earlier blank captures and findings remain unchanged in `screenshots/23/` as before-fix evidence.
- Successful capture command: `npx tsx .scratch/guest-ui-consistency/capture-23.ts`; output: 3 commerce surfaces × 320, 390, 768 and 1280 CSS px in `screenshots/23-root-fix/`.
- Captures wait for each expected visible commerce fact before measuring and taking a screenshot. `findings.txt` reports all facts visible, no horizontal overflow, and no visible controls below 44px.
- Real-Chromium regression: `test/commerce-surfaces-chromium.test.ts` checks approved catalogue IDs and canonical root IDs, then waits for and asserts rendered product name, current price and stock; cart product and quantity/price; and order public code and current status. It also requires rendered Weaver nodes, no fallback, and no horizontal overflow.
- Validation logs: `C:\Users\Cyrus\AppData\Local\Temp\opencode\mdp23-commerce-visible-chromium.log` and `C:\Users\Cyrus\AppData\Local\Temp\opencode\mdp23-commerce-captures-fixed.log`.
- `npm run build`, `npm run check`, and the 19 focused commerce/catalogue tests passed.
