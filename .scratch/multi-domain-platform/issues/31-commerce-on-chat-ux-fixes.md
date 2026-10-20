# Fix the chat UX defects found when commerce is turned on

Status: needs-triage
Type: task
Blocked by: 30, and the owner reopening commerce (deferred until after the stays launch)
Requested: 20 Oct 2026
Lane: E: Concierge UX
PRD: `../PRD.md`

## Why

On 20 Oct 2026 a read-only walk ran the guest app locally with commerce on: the default `local` composition, the commerce assistant pack registered as `additionalPacks`, seeded data, and a scripted model for the commerce turns. It found the defects below. Screenshots are 390px wide, in `../screenshots/31/`. The walk script is `../screenshots/31/walk.mts`, which needs `npm ci` and a free port.

Not tested: a real LLM, a full dark-theme sweep, a real no-JS browser run, and the Cloudflare deployment.

**Triage note:** split this into slices before work starts. Items 1–4 probably belong with slice 26 (task rail, starters and router); item 5 belongs with slice 22.

## Defects

### Blockers for turning commerce on in public
1. **The Shop door is invisible on a first visit.** A new guest sees only "Find a place to stay" and the city chips, the same as with commerce off (`01-home-first-visit-w390.png`). Starters render only once a second task exists: `apps/local-guest/src/client.ts:2633` (`response.tasks.length > 1`). The no-JS HTML for a fresh session has no starter markup either.
2. **A cross-domain request is a dead end.** In a Stays task, "I want to buy a kettle" gets "Start a Commerce search? Your shortlet search is saved.", with nothing to act on; replying "yes" repeats the same message (`09-cross-domain-typed-w390.png`, `09b-reply-yes-w390.png`). `#route` returns text with `surfaces: []` and runs before the model (`apps/local-guest/src/assistant/assistant-runtime.ts:231-245`). It also shows internal ids ("Commerce", "shortlet") instead of the `GUEST_VERTICALS` labels. The keyword list also catches stays wording such as "order", "store" and "delivery".
3. **The task rail and starters disappear after the router reply.** The reply carries no `tasks`, and the client re-renders the rail from every response (`client.ts:2467-2468`, `2487-2488`, `2043`). The guest loses the only way to switch back until a reload (`10a-reload-after-router-w390.png`).
4. **A stale checkout keeps a working action after a task switch** (ADR-0074). After switching from Shop to Stays, the "Checkout · Harbour Goods" card stays on screen with a live "Confirm checkout" button (`05b-stays-with-open-checkout-w390.png`). Pressing it shows the developer string "Unknown assistant action." (`05c-confirm-from-stays-w390.png`; `assistant-runtime.ts:793`). `renderSurfaces([])` does not clear the previous task's surfaces (`client.ts:1988-1999`). The server does refuse the action.
5. **"Confirm checkout" is offered when payment cannot complete.** The proposed card shows the button with no warning (`05-checkout-proposal-w390.png`; `apps/web-agent/src/commerce-presentation.ts:145-148`). After the press: "Checkout confirmation was authorized, but payment is unavailable; …" (`06-after-confirm-w390.png`). The word "authorized" suggests a payment step happened. This goes away once slice 22 lands, but until then the button must not be offered.

### Should fix
6. **Stays vocabulary inside Shop:** "Booking details updated" after every commerce turn, the "Booking details" workspace heading, and the screen-reader text "Booking details is ready." (`apps/local-guest/src/conversational-shell.ts:96-117`). The app bar says "Shortlet" on chat, cart, tracking and unverified-store pages. ADR-0100 and `domains/commerce/CONTEXT.md` use Shop, Store and Merchant.
7. **The Shop rail status is fixed at "Browse"** whatever the cart or checkout state (`apps/local-guest/src/assistant/commerce-assistant-pack.ts:166`).
8. **`/cart` is a static empty page** whatever the cart holds (`15-cart-page-w390.png`; `apps/local-guest/src/commerce-route-module.ts:144`).
9. **Turning on the `local` composition does not add Shop to chat.** It mounts only the store, cart and tracking routes. `createCommerceAssistantPack` is passed by tests and scripts only, never by `cli-start.ts`, the Node pilot hosts or `shortlet-pilot-do.ts`. Turning commerce on needs the routes, the pack and a public Worker route to CommerceMarket to be enabled together.
10. **The no-JS starters and rail are inert `<li>` elements** (`apps/local-guest/src/guest-kit.ts:685-715`). A no-JS guest can see a Shop task but cannot start or switch to it.

### Minor
11. **The order status reads "Pending Verification"** for a just-created order, and the public order code is 36 characters long, which is hard to read or type on a phone (`17-track-found-w390.png`).
12. **Inconsistent app bar brand:** the store and offer pages show the store name, while the cart, tracking and unverified-store pages show "Shortlet" (`12-store-page-w390.png` vs `15-cart-page-w390.png`).

### Already works (keep it)
- Unverified stores are hidden (ADR-0100) (`13-unverified-store-page-w390.png`).
- The store and offer pages work.
- Checkout totals are recalculated on the server.
- Per-task workspaces are saved and restored.
- The failure text after confirm is honest.
- At 320, 390 and 1280: no overflow, no controls under 44px, no text under 12px.

## Acceptance criteria

To be written per slice at triage. Each blocker (1–5) becomes at least one criterion, named for the guest-visible behaviour (for example "A first-time guest sees both verticals' starters on the first screen").

## Comments
