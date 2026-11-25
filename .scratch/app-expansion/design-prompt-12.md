# Prompt for the design agent: round 12

Paste everything below the line. Share the prototype with the design workspace first.

---

We are moving the whole guest app onto the Xenia kit and adding sections. Use the prototype <https://claude.ai/artifact/19UKnffE8Wc45H3zCvgxcx> for structure and content, and the Xenia design system for everything visual. The prototype was built from your `bundle.css`; classes starting `xa-` are stand-ins for you to replace. Use existing tokens only. List any token you need with the reason.

**Part 1. Publish six components** in the design system, with anatomy, variants, every state, tokens, accessible name and role, keyboard behaviour and 44px targets, light and dark.
1. **Tab bar.** Three items, icon and label, current item in ink (indigo stays for the next action). Badge: count on `warning-surface`, with words for screen readers. At 320 its labels must not wrap.
2. **Ask bar.** The Composer as a link, above the tab bar, naming the page ("Ask about this stay").
3. **Task bar.** The App bar for a full-screen task: Close, title, Help. No wordmark, no tab bar.
4. **View switch.** Two options (Concierge, List). The shipped class is `.ui-segmented`.
5. **List row.** Title, optional line, optional value, chevron. The shipped class is `.ui-list`.
6. **Side navigation, guest.** Your existing component with Find, Your stays, Account and Help.

Then, for more than one domain only: **Concierge chooser** (strip and dialog), **Domain tag** and **Switch divider**. Use your Agent Marks; ours are stand-ins.

**Part 2. Boards, or a written "keep as is", for screens that have none:** apartment with a full gallery and photo viewer; compare two stays; payment choice; bank transfer; manual transfer with receipt upload; declined, expired and stale states; sign-in and code; account; stay page before, during and after; payments and receipts; report a problem and report sent; change or cancel; cancel with refund; message the Operator; help; saved; concierge unavailable; task rail.

**Part 3. Fix two kit defects:** the stay card's title link is 26px tall (44px needed); the human persona mark uses 10px text (12px is the floor).

**Part 4. The App bar at 320px** cannot hold Back, wordmark, mode label and Help. Show your solution. At 320×640 the app bar, Ask bar and tab bar leave about 71% for content; show 320×568 as well.

**Keep.** The six journey words. The deposit on its own line. Cancellation and house rules readable before accepting an offer. No guest names on Operator screens. No address, contact value or response time that is not settled: use "Set by the owner". The "Guest demo" frames stay as the landing showcase; they are not product screens.

**For every board:** 320, 390, 768, 1280; light and dark; every state; focus order; components by name; a copy list marked Code, Brand or New.

**Deliver:** the components, the boards, "Token needed", "Copy for review", and what you could not do and why.
