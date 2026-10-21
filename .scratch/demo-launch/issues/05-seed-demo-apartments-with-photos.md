# Seed demo apartments with photos

Status: ready-for-agent
Type: AFK
Blocked by: 04
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Visitors need apartments that look real so they can try the agent, but none of the existing units has a photo that loads.

- `Unit.photoUrls` (`domains/shortlet/src/browse.ts:43`) is the only media field. `domains/shortlet/src/photo-url.ts` accepts public HTTPS URLs only, with `MAX_UNIT_PHOTOS = 12`. Images are never fetched or proxied.
- The fixture units in `apps/local-guest/src/fixture.ts:731-883` have no photos.
- The pilot units in `apps/pilot/src/local-pilot.ts:111-113` point at `pilot-local.invalid`, which returns 404 on purpose (`local-pilot-server.ts:143-150`).
- Cloudflare inventory comes only from tenant SQLite, imported through `/_ops`, which needs `OPS_SHARED_SECRET` or Cloudflare Access. Until then the guest routes return 503 (`apps/cloudflare/src/cloudflare-config.ts` around lines 72–88).
- The CSV import format lives in `domains/shortlet/src/inventory-import.ts`. `photo_urls` is separated by `|` (`:281`), and the first URL is the cover. Operator steps are in `docs/shortlet-pilot-inventory-operations.md`.
- A unit is visible only if it passes `isEligibleUnit` (`browse.ts:237`): published, entire place, Lagos or Abuja, an approved operator with CAC and the other checks verified, an unexpired inspection that includes `listing-accuracy` and `current-media`, and authority, licensing and insurance at or above the minimums.
- Static files under `apps/cloudflare/public/` are served first by the `ASSETS` binding.

## What to build

- Create **8 demo units**:
  - 6 in Lagos: Ikoyi, Lekki Phase 1, Victoria Island, Yaba, Ikeja GRA, Banana Island.
  - 2 in Abuja: Wuse 2, Maitama.
  - Vary the bedrooms (studio to 3-bed), nightly and monthly prices, amenities and descriptions.
  - Make them suit monthly stays (Monthly Stay positioning: 1–6 month stays for assignment professionals and relocators).
  - Keep titles and descriptions plainly illustrative. Do not name a real building or a real operator.
- Create **one synthetic operator**, "Demo Operator Ltd", with synthetic verification, inspection, authority, licensing and insurance fields that pass `isEligibleUnit`. Make the synthetic values obviously fake (for example, CAC `RC-DEMO-0001`).
- **Photos:**
  - 4–5 interior or exterior photos per unit (about 36 total), from Unsplash or Pexels under their free licences.
  - Resize to 1600px wide, JPG, about 250KB or less each.
  - Store at `apps/cloudflare/public/demo/photos/<unit-slug>/<n>.jpg`.
  - Credit each photo in `apps/cloudflare/public/demo/photos/CREDITS.md`, following `apps/local-guest/assets/landing/CREDITS.md`.
  - Download only from the official Unsplash or Pexels hosts, into a fresh directory.
- **Data files** in `apps/cloudflare/demo/`:
  - `operators.csv` and `inventory.csv`, in the import format;
  - `photo_urls` are absolute `https://<demo-origin>/demo/photos/...` URLs;
  - the origin is substituted at provision time, not hardcoded.
- **`scripts/demo-provision.ts`** (with an npm script `demo:provision`):
  - takes `--origin` and reads `OPS_SHARED_SECRET` from the environment;
  - imports operators, then inventory, through the existing `/_ops` routes;
  - is idempotent (re-running updates rather than duplicates);
  - prints counts only, never the secret.
- **Local check.** Make the same CSVs importable in the local pilot, so the demo can be checked on `localhost` before deploying.

## Acceptance criteria

- [ ] AC1: All 8 demo units import cleanly and pass `isEligibleUnit`. A test loads the CSVs through `inventory-import.ts`.
- [ ] AC1 failure path: a row with a non-HTTPS or `localhost` photo URL is rejected by the import, and an existing test covers the rejection reason.
- [ ] AC2: Every unit has 4–5 photos, and every `photo_urls` path exists under `apps/cloudflare/public/demo/photos/`. A test checks the files exist.
- [ ] AC3: Every photo file is credited in `CREDITS.md`. A test asserts one credit line per file.
- [ ] AC4: `scripts/demo-provision.ts` is idempotent: a second run leaves the unit count at 8.
- [ ] AC4 failure path: without `OPS_SHARED_SECRET`, or with a wrong one, the script exits non-zero and imports nothing.
- [ ] AC5: The script never prints or writes the secret (ADR 0075).
- [ ] AC6: Discovery returns the demo units with photo cards, and the unit-detail gallery shows all photos. Verify in the local walkthrough and take screenshots.
- [ ] AC7: `npm run check` and `npm test` pass.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0008 / 0009 / 0010 / 0065 | Inspection and operator verification before publication | Deferred by 0105: synthetic claims, labelled "Demo listing" (AC1) |
| 0095 | Inventory comes only from tenant SQLite through `/_ops` | Kept: import through `/_ops`, no hardcoded seeding in the Durable Object (AC4) |
| 0075 | No bearer credentials in logs | AC5 |

## Comments
