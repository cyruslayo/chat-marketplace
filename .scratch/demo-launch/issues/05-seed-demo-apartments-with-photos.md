# Seed demo apartments with photos

Status: resolved
Type: AFK
Blocked by: 04, 08, 09, 10, 11, 12, 13
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
  - include the versioned Monthly Agreed Amounts and utilities/servicing fields required by issues 09 and 10;
  - `photo_urls` are absolute `https://<demo-origin>/demo/photos/...` URLs;
  - the origin is substituted at provision time, not hardcoded.
- **`scripts/demo-provision.ts`** (with an npm script `demo:provision`):
  - takes `--origin` and reads `OPS_SHARED_SECRET` from the environment;
  - imports operators, then inventory, through the existing `/_ops` routes;
  - is idempotent (re-running updates rather than duplicates);
  - prints counts only, never the secret.
- **Local check.** Make the same CSVs importable in the local pilot, so the demo can be checked on `localhost` before deploying.

## Acceptance criteria

- [x] AC1: All 8 demo units import cleanly, pass `isEligibleUnit`, and support valid demo quotes through 180 nights. A test loads the CSVs through `inventory-import.ts` and the monthly quote path.
- [x] AC1 failure path: a row with a non-HTTPS or `localhost` photo URL is rejected by the import, and an existing test covers the rejection reason.
- [x] AC2: Every unit has 4–5 photos, and every `photo_urls` path exists under `apps/cloudflare/public/demo/photos/`. A test checks the files exist.
- [x] AC3: Every photo file is credited in `CREDITS.md`. A test asserts one credit line per file.
- [x] AC4: `scripts/demo-provision.ts` is idempotent: a second run leaves the unit count at 8.
- [x] AC4 failure path: without `OPS_SHARED_SECRET`, or with a wrong one, the script exits non-zero and imports nothing.
- [x] AC5: The script never prints or writes the secret (ADR 0075).
- [x] AC6: Discovery returns the demo units with monthly photo cards, and each unit-detail gallery shows all photos. Verify in the local walkthrough and take screenshots.
- [x] AC7: `npm run check` passes and the issue's own and affected tests pass (commands and counts recorded in Comments); the full `npm test` and `npm run test:workers` run at the batch's pre-merge gate.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0008 / 0009 / 0010 / 0065 | Inspection and operator verification before publication | Deferred by 0105: synthetic claims, labelled "Demo listing" (AC1) |
| 0095 | Inventory comes only from tenant SQLite through `/_ops` | Kept: import through `/_ops`, no hardcoded seeding in the Durable Object (AC4) |
| 0075 | No bearer credentials in logs | AC5 |

## Comments

**Implementation: commit `910a0af`** (tracker commit follows separately).

**Red first.** Before any implementation, `test/demo-apartments.test.ts` (the earlier untracked draft, finished and corrected) and the new `test/demo-provision.test.ts` were run with `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/demo-apartments.test.ts test/demo-provision.test.ts`. Result: both files fail at load (`ERR_MODULE_NOT_FOUND` for `scripts/demo-provision.js`), 0 of 2 files pass. The draft's own AC1 failure-path expectation (zero rows stored after a rejected row) was wrong, since valid rows are stored; it was corrected before the red run.

**Green.** Same command: `# tests 17 / # pass 17 / # fail 0`. Per criterion: AC1 import and eligibility, AC1 180-night quotes (30, 45, 61, 90, 120, 150, 179, 180 nights for all 8 units; shorter final period priced per night, ADR 0092), AC1 failure path (`must use HTTPS`, `must use a public HTTPS host`), AC1 local pilot JSON import, AC2 paths and 1600px JPEG check, AC3 one credit line per file, AC6 discovery (8 results, 4–5 photos, monthly total), AC5 scope check, AC4 idempotent run and failure paths (no secret, wrong secret, non-HTTPS origin), AC5 no-secret output, CLI loopback refusals.

**Typecheck.** `npm run check` (`tsc --noEmit` root, `apps/cloudflare`, `tsconfig.test.json`, `tsconfig.tooling.json`, Worker bundle guard): exit 0 after two test-file type fixes.

**Walkthrough (AC6).** `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx .scratch/demo-launch/capture-05-demo-apartments.ts` (source: `.scratch/demo-launch/capture-05-demo-apartments.ts`). The script imports the CSVs into a JSON inventory, starts the local guest on it, asks for Lagos for 30 nights, and checks 6 Lagos cards with loaded photos. It opens Old Ikoyi and checks 5 gallery photos, all loaded. Captures at 320/390/768/1280, light and dark: 16 PNGs in `.scratch/demo-launch/screenshots/05/`. Findings: `No horizontal overflow or controls below 44px.` The photos are served through request interception from `apps/cloudflare/public/demo/photos/`, so no external host is contacted. The detail shows ₦3,280,000 for 30 nights, which matches (₦2,600,000 + ₦24,000) × 1.25.

**Photos and credits.** The 32 earlier downloads had no recoverable attribution and repeated images across units (16 unique files). They were moved, not deleted, to `C:\Users\Cyrus\AppData\Local\Temp\claude\C--AI2026-chat-marketplace\04108396-c526-4888-b3b3-cc66a87d5a20\scratchpad\old-photos-unattributed`. The transcript search matched none of them (perceptual hash distance 66–115 of 256 against the transcript's candidate IDs). All 35 photos were then fetched from `images.unsplash.com` into `scratchpad\fresh`. The photographer and page URL come from Unsplash search-page extraction (WebFetch). Each file was checked visually on a contact sheet. The sources are recorded per file in `apps/cloudflare/public/demo/photos/CREDITS.md`. Recovered from transcripts: 0 files. Re-downloaded: 35 files. One photo (`ikeja-gra/4.jpg`) is centre-cropped to 4:3 to meet the 250KB limit.

**ADR table (read and applied).** ADR 0105 (synthetic operator and units; every description starts "Demo listing."; photos identified as illustrative; deferred ADR 0008/0009/0010/0065 claims; 180-night amendment); ADR 0092 and 0089 (30-night Billing Periods, monthly amounts, shorter final period at the nightly guest price, owner terms via `unitPriceFromOwnerTerms`); ADR 0095 (inventory only through `/_ops`, no hardcoded seeding in the Durable Object); ADR 0075 (the provisioner prints counts only and sends the secret as a header; a test checks the output); ADR 0031 (check-in window 14:00–22:00 WAT); ADR 0078 (captures and 44px audit).

**Verify (after implementation).** Every constraint above is in the code: the CSV rows, the provisioner's request shape, and the tests named in each criterion.

**Definition of Done.** (1) Each AC has a dedicated test named after it. (2) The failure paths are asserted: a rejected URL, no secret, a wrong secret, a non-HTTPS origin, a missing unit row. (3) ADRs are cited above. (4) All injected options are used (`fetch`, `log`, `accessClientId`, `accessClientSecret`, `demoDirectory`). (5) The invented constants are the synthetic CAC marker (the issue's own example), the demo claim expiry `2027-12-31` (see risks), and the 30-night policy (ADR 0105). (6) Only counts are logged. (7) `npm run check` and the two test files pass; the full `npm test` and `npm run test:workers` are left to the batch gate.

**Risks and deviations (for the orchestrator).**
1. Operators go through `POST /_ops/import` (table `operators`), the only `/_ops` route that stores verification fields. It upserts, but it is refused with 409 `CUTOVER_COMPLETE` once cutover is recorded. Confirm staging cutover state before running `demo:provision`. A refusal fails closed.
2. Units go through `POST /_ops/demo/inventory/import` (one row per request, demo flag only), which publishes them. The provisioner makes one request per unit.
3. The provisioner was not run against any remote origin. Its tests use an in-process fake of the `/_ops` routes (real domain functions for import), plus a loopback server for the CLI refusals. A Worker-level spec for the demo route was not added.
4. Photo attribution is from Unsplash search pages through WebFetch. Individual photo pages were not each re-opened. The owner should spot-check the photographer names in `CREDITS.md`.
5. The claim expiry `2027-12-31` is a synthetic choice (inspection, authority, licence, insurance, operator approval). It is not in any ADR.
6. Local check: `npm run pilot:inventory:import` can read the same CSVs, but the photo host is the synthetic `demo.example.test`. Photos show only in the walkthrough, which serves them by interception. The local pilot server's deliberate 404 for `pilot-local.invalid` is unchanged.
7. `.git/index.lock` (0 bytes, written 22 Oct 9:52 PM) was removed before committing. No git.exe process was running. Other sessions' idle bash wrappers were present but ran no git command. Creator unknown (stale).

**Staged and committed (`910a0af`, 60 files):** the CSVs, `scripts/demo-provision.ts`, the two test files, the `demo:provision` npm script, the walkthrough script, `screenshots/05/`, `CREDITS.md`, and the 35 photos (force-added by explicit path; the directory is Git-ignored).
