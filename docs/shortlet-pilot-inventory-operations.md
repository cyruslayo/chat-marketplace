# Pilot inventory operations

The pilot inventory import is a controlled CSV workflow. It changes inventory records only; it does not approve Operators or publish Units.

1. Copy [`pilot-inventory-template.csv`](./pilot-inventory-template.csv) into Google Sheets or Excel and keep one row per entire-place Unit.
2. Provision the authoritative Operator before preparing the CSV. This creates only the supply-side Operator identity; it does not create a representative grant, an authenticated session, Management Authority, inspection approval, publication authority, or payment authority:

   ```text
   npm run pilot:operator:create -- --operator-id operator_123 --tenant-id tenant_123 --name "Example Shortlets"
   npm run pilot:operator:list
   ```

   Use `pilot:operator:update` only for a basic display-name correction. Keep `operator_id` pointed at one of the listed Operator IDs. The importer never creates or approves an Operator from a listing row. Set `SHORTLET_OPERATORS_PATH` for the pilot deployment; the default is `.scratch/shortlet/pilot-operators.json`.
3. Run a dry run, scoped to the inventory tenant:

   ```text
   npm run pilot:inventory:import -- --dry-run --tenant-id tenant_123 path/to/listings.csv
   ```

4. Fix every reported row error and repeat the dry run.
5. Back up the configured inventory and Operator registry files before a real import. By default these are `.scratch/shortlet/pilot-inventory.json` and `.scratch/shortlet/pilot-operators.json`; set `SHORTLET_INVENTORY_PATH` and `SHORTLET_OPERATORS_PATH` for the pilot deployment and back up both files together with the application SQLite file.
6. Import the corrected file:

   ```text
   npm run pilot:inventory:import -- --tenant-id tenant_123 path/to/listings.csv
   ```

7. Review the inserted/updated and publication-readiness summary. Imported Units remain unpublished unless they were already published and remain eligible after the update.
8. Publish eligible Units through the existing onboarding publication path. Do not set a publication flag in the CSV.
9. Verify the published Lagos and Abuja Units through normal Guest discovery.

The CSV uses NGN amounts such as `120000`, `"120,000"`, or `120000.50`. Quote amounts containing commas in the CSV. The importer converts them at the application boundary to integer kobo, rejects negative or malformed amounts, and accepts no currency other than `NGN`. Amenities and claim scopes use `|`; blocked dates use `YYYY-MM-DD/YYYY-MM-DD` pairs separated by `;`.

For listing photos, host each image at a public HTTPS location, then put its URL(s) in `photo_urls`, separated by `|` (for example, `https://images.example/cover.jpg|https://images.example/living-room.jpg`). The first URL is the listing cover/primary photo. A Unit may have zero photos, but the importer reports zero-photo listings for operations; no more than 12 URLs are accepted. Run the dry run first, import the corrected file, and verify the photos on Guest discovery and the Unit detail page. The importer validates URL shape and obvious internal hosts but never fetches images.

Each pilot row must also include a useful plain-text `description` and an integer `bathrooms` count of at least `1`. Descriptions may contain normal paragraph breaks but not HTML, control characters, or embedded links, and are limited to 2,000 characters. Dry-run reports missing or invalid descriptions and bathroom counts before any Unit is written.

The durable inventory repository is the existing `JsonUnitRepository`; no second Unit persistence system or fixture seed is used when `SHORTLET_INVENTORY_PATH` is configured. Current application state such as Guest interactions remains in SQLite.

The durable Operator registry is the JSON `JsonOperatorRepository`. Existing inventory that already embeds Operators can be migrated explicitly, without creating Units or inferring authority, with:

```text
npm run pilot:operator:bootstrap -- --tenant-id tenant_123
```

The pilot sequence is: create a tenant if current tooling requires it, provision the Operator, create a representative grant if needed, prepare the inventory CSV, run a dry run, import Units, and publish only eligible Units through the existing path.
