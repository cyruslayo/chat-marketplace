import { readFileSync } from "node:fs";
import { JsonOperatorRepository, JsonUnitRepository, importInventoryCsv, operatorResolverFromRepository } from "../../../domains/shortlet/src/index.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tenantIndex = args.indexOf("--tenant-id");
const tenantId = tenantIndex >= 0 ? args[tenantIndex + 1] : process.env.SHORTLET_TENANT_ID;
const positional = args.filter((argument, index) => argument !== "--dry-run" && argument !== "--tenant-id" && index !== tenantIndex + 1);
const inputPath = positional[0];
if (!inputPath || positional.length > 1 || !tenantId || tenantId.startsWith("--")) {
  console.error("Usage: npm run pilot:inventory:import -- [--dry-run] --tenant-id tenant_123 path/to/listings.csv");
  process.exitCode = 2;
} else {
  const inventoryPath = process.env.SHORTLET_INVENTORY_PATH ?? ".scratch/shortlet/pilot-inventory.json";
  const operatorPath = process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json";
  const repository = new JsonUnitRepository(inventoryPath);
  const operators = new JsonOperatorRepository(operatorPath);
  const result = importInventoryCsv(readFileSync(inputPath, "utf8"), {
    repository,
    operatorResolver: operatorResolverFromRepository(operators),
    tenantId,
    dryRun,
  });

  console.log(`Rows: ${result.rowsRead}`);
  console.log(`Valid: ${result.valid}`);
  console.log(`Invalid: ${result.invalid}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Imported: ${result.imported}`);
  console.log(`Publication-ready: ${result.publicationReady}`);
  console.log(`Unpublished/ineligible: ${result.unpublishedIneligible}`);
  for (const error of result.errors) console.error(`Row ${error.row}: ${error.message}`);
  if (result.invalid > 0) process.exitCode = 1;
}
