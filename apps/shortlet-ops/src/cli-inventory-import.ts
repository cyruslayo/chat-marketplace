import { readFileSync } from "node:fs";
import { JsonOperatorRepository, JsonUnitRepository, importInventoryCsv, operatorResolverFromRepository } from "../../../domains/shortlet/src/index.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration } from "./ops-client.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tenantIndex = args.indexOf("--tenant-id");
const tenantId = tenantIndex >= 0 ? args[tenantIndex + 1] : process.env.SHORTLET_TENANT_ID;
const positional = args.filter((argument, index) => argument !== "--dry-run" && argument !== "--tenant-id" && index !== tenantIndex + 1);
const inputPath = positional[0];

function printSummary(result: {
  readonly rowsRead: number; readonly valid: number; readonly invalid: number; readonly inserted: number;
  readonly updated: number; readonly unchanged: number; readonly imported: number; readonly publicationReady: number;
  readonly unpublishedIneligible: number; readonly zeroPhotoListings: number;
  readonly errors: readonly { readonly row: number; readonly message: string }[];
}): void {
  console.log(`Rows: ${result.rowsRead}`);
  console.log(`Valid: ${result.valid}`);
  console.log(`Invalid: ${result.invalid}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Imported: ${result.imported}`);
  console.log(`Publication-ready: ${result.publicationReady}`);
  console.log(`Unpublished/ineligible: ${result.unpublishedIneligible}`);
  console.log(`Zero-photo listings: ${result.zeroPhotoListings}`);
  for (const error of result.errors) console.error(`Row ${error.row}: ${error.message}`);
  if (result.invalid > 0) process.exitCode = 1;
}

if (!inputPath || positional.length > 1 || !tenantId || tenantId.startsWith("--")) {
  console.error("Usage: npm run pilot:inventory:import -- [--dry-run] --tenant-id tenant_123 path/to/listings.csv");
  process.exitCode = 2;
} else {
  try {
    const csv = readFileSync(inputPath, "utf8");
    const remote = remoteOpsConfiguration();
    if (remote !== null) {
      const query = `?tenantId=${encodeURIComponent(tenantId)}${dryRun ? "&dryRun=true" : ""}`;
      const body = assertOpsOk(await opsRequest(remote, `/_ops/inventory/import${query}`, { method: "POST", contentType: "text/csv", body: csv }));
      printSummary(body as Parameters<typeof printSummary>[0]);
    } else {
      const inventoryPath = process.env.SHORTLET_INVENTORY_PATH ?? ".scratch/shortlet/pilot-inventory.json";
      const operatorPath = process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json";
      printSummary(importInventoryCsv(csv, {
        repository: new JsonUnitRepository(inventoryPath),
        operatorResolver: operatorResolverFromRepository(new JsonOperatorRepository(operatorPath)),
        tenantId,
        dryRun,
      }));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Inventory import failed");
    process.exitCode = 2;
  }
}
