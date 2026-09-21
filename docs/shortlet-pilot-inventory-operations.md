# Pilot inventory operations

The pilot inventory import is a controlled CSV workflow. It changes inventory records only; it does not approve Operators or publish Units.

1. Copy [`pilot-inventory-template.csv`](./pilot-inventory-template.csv) into Google Sheets or Excel and keep one row per entire-place Unit.
2. Keep `operator_id` pointed at an already onboarded, authoritative Operator. The importer never creates or approves an Operator from a listing row.
3. Run a dry run:

   ```text
   npm run pilot:inventory:import -- --dry-run path/to/listings.csv
   ```

4. Fix every reported row error and repeat the dry run.
5. Back up the configured inventory file before a real import. By default this is `.scratch/shortlet/pilot-inventory.json`; set `SHORTLET_INVENTORY_PATH` for the pilot deployment and back up that file together with the application SQLite file.
6. Import the corrected file:

   ```text
   npm run pilot:inventory:import -- path/to/listings.csv
   ```

7. Review the inserted/updated and publication-readiness summary. Imported Units remain unpublished unless they were already published and remain eligible after the update.
8. Publish eligible Units through the existing onboarding publication path. Do not set a publication flag in the CSV.
9. Verify the published Lagos and Abuja Units through normal Guest discovery.

The CSV uses NGN amounts such as `120000`, `"120,000"`, or `120000.50`. Quote amounts containing commas in the CSV. The importer converts them at the application boundary to integer kobo, rejects negative or malformed amounts, and accepts no currency other than `NGN`. Amenities and claim scopes use `|`; blocked dates use `YYYY-MM-DD/YYYY-MM-DD` pairs separated by `;`.

The durable inventory repository is the existing `JsonUnitRepository`; no second Unit persistence system or fixture seed is used when `SHORTLET_INVENTORY_PATH` is configured. Current application state such as Guest interactions remains in SQLite.

## Current pilot gap

The current Unit model does not carry bathrooms, listing descriptions, or listing media/photos. The importer intentionally does not invent or silently discard those fields. A media/listing-content capability is still required for a fully usable apartment marketplace.
