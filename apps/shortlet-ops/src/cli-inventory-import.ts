import { readFileSync } from "node:fs";
import { JsonUnitRepository, importInventoryCsv, operatorResolverFromUnitRepository } from "../../../domains/shortlet/src/index.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((argument) => argument !== "--dry-run");
const inputPath = positional[0];
if (!inputPath || positional.length > 1) {
  console.error("Usage: npm run pilot:inventory:import -- [--dry-run] path/to/listings.csv");
  process.exitCode = 2;
} else {
  const inventoryPath = process.env.SHORTLET_INVENTORY_PATH ?? ".scratch/shortlet/pilot-inventory.json";
  const repository = new JsonUnitRepository(inventoryPath);
  const result = importInventoryCsv(readFileSync(inputPath, "utf8"), {
    repository,
    operatorResolver: operatorResolverFromUnitRepository(repository),
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
