# Art direction

This page applies the five ranked values (1 Honest, 2 Exact, 3 Calm, 4 Light, 5 Spoken) to each discipline. The number in brackets after each rule is the value that sets it.

## Photography

- Use real interiors of published Units only, approved by the owner. The Unsplash files in `apps/local-guest/assets/landing/` are placeholders and must not ship. [1]
- Shoot in daylight at eye height. Show the whole room: where you sleep, where you work, where you cook. These guests live in the apartment for weeks, so the desk and the kitchen matter as much as the bed. [4] *Proposal.*
- Never style a room with things the guest won't find when they arrive. No staged fruit bowls or champagne. [1]
- Never put text on the image unless a solid scrim paints first. Check contrast at the lightest point of the photo. [3]
- Budget: the hero image is AVIF with a WebP fallback, about 120 KB or less at 1440px wide and 50 KB or less at 390px. Every other image lazy-loads with fixed dimensions. [3]
- When a specific listing has no photo, show a labelled fallback that keeps every fact visible. Never put a stock image or an illustration in its place. [1]

- **Other modes.** The same rules apply. Events uses real venue or past-event photos the organiser has the rights to. Community uses real group activity shot with consent, showing faces only when people have agreed. Never use stock crowds. Details are on the Modes page. [1]

## Illustration and placeholders (until real photography exists)

- Real photos come with real listings. Until then, the landing page, mode empty states and campaigns use the placeholder illustrations on the **Placeholder** card. [1]
- The style is cut-paper architecture. Flat shapes are cut from the radius scale and coloured `indigo` for structure, the mode accent for the subject and `sand` for light, on the mode tint. There are no gradients and no photoreal detail. [3, 4]
- No faces or figures. People are suggested by objects (chairs, keys, a stage), which avoids caricature and consent problems. [1, 3]
- Any illustration next to listing facts carries a visible "Illustration" tag. No AI-generated photoreal images, because they show places that do not exist. [1]
- Sample stock photos are allowed only in internal demo builds, labelled "Sample photo". [1]

## Type

- **Newsreader** (display) for headlines, stay names and every ₦ amount. Headlines are set in weight 500. [4, 2]
- **Hanken Grotesk** (body and UI) in weights 400, 600 and 700. It has no ₦ glyph, so never set money in it. [2]
- Each headline may set one word in 400 italic in the accent colour. That is the only decorative device. [4]
- Nothing smaller than 12px. Money, deadlines, errors and trust facts are never set at metadata size. [2, 3]
- No full-uppercase labels for hierarchy, except landing eyebrows (12–13px with 0.14em tracking). [4]

## Colour and density

- Ground: warm paper (`canvas`). Adire Indigo covers only a minority of the screen. [3]
- Indigo means "the next action", and nothing else in the app layer, in every mode. Sand appears only on `indigo-deep` and photo scrims. [3, 2]
- Mode accents (`--mode-accent`, `--mode-subtle`) are for the mark, the persona label, the empty state, the criteria chips' selected state, and the one italic headline word. They are never used for actions, money or status. [3, 5]
- Status colours are never the only signal: each one comes with a word and an icon, so status doesn't rely on colour alone. [1]
- Use flat tonal surfaces and thin borders. The only shadow belongs to the active workspace and the sticky action layer, because those are the things that float. [4]
- Density is low at entry, medium on cards and detail, and high only for comparisons and the final booking review. [4, 2]

## Shape

- Radii come from the scale: 4, 8, 12, 16 and 24. Criteria chips and the guest's primary call to action can be pills. Cards are never pills. [4]
- The Xenia logo will be designed later. The speech bubble with a roof peak is retired as a placeholder. Until the logo exists, set "Xenia" in Newsreader 500 as the wordmark. The future logo must not reuse any mode silhouette. [5]
- Agent Marks are one family: the same rig with different silhouettes (see Modes). They are not mascots. [5]
- No icons used as decoration and no emoji in the product. [5]

## Motion

- Motion is limited to surface crossfades and height changes, and is removed when reduced motion is requested. [3, 4]
- No ambient animation, parallax or auto-rotating carousel. [3]
- The one exception is Agent Mark states. They are driven by real signals, use `transform` and `opacity` only, settle within 5 seconds, are still under reduced motion and pause while the page is hidden (ADR 0107 decision 9). [3, 5]
- A mode switch may crossfade through a view transition. An instant switch is always correct. [3]

## Anti-references

| Looks like | Why we reject it | Value |
| --- | --- | --- |
| Holiday-rental marketplace grid with star ratings | It sells social proof we don't have. Its guests compare, ours settle in. | 1, 4 |
| Luxury hotel campaign (dark, gold, models) | It promises glamour, but the promise is a reliable host. Sand on indigo stays quiet and flat, never metallic. | 1, 3 |
| SaaS dashboard (dense cards, KPIs) | It reads as software, not hospitality. | 4 |
| Chatbot (bubbles, avatar, sparkles, purple gradient) | It makes the technology the hero. | 5 |
| A super-app home screen with a tile per service | It turns one host into a menu and splits trust. | 5 |
| A ticketing site with a countdown and "only 3 left!" | It sells through pressure we don't use. | 1, 4 |
| Glassy, animated landing page | It breaks on cheap phones and makes contrast unpredictable. | 3 |
