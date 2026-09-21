import { JsonOperatorRepository, JsonUnitRepository, bootstrapOperatorsFromUnitRepository } from "../../../domains/shortlet/src/index.js";

const args = process.argv.slice(2);
const tenantIndex = args.indexOf("--tenant-id");
const tenantId = tenantIndex >= 0 ? args[tenantIndex + 1] : undefined;
const inventoryPath = process.env.SHORTLET_INVENTORY_PATH ?? ".scratch/shortlet/pilot-inventory.json";
const operatorsPath = process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json";
if (!tenantId || tenantId.startsWith("--") || args.some((argument, index) => argument.startsWith("--") && argument !== "--tenant-id" && index !== tenantIndex + 1)) {
  console.error("Usage: npm run pilot:operator:bootstrap -- --tenant-id tenant_123");
  process.exitCode = 2;
} else {
  try {
    const migrated = bootstrapOperatorsFromUnitRepository({ units: new JsonUnitRepository(inventoryPath), operators: new JsonOperatorRepository(operatorsPath), tenantId });
    console.log(`Migrated: ${migrated.length}`);
    for (const operator of migrated) console.log(`${operator.id}\t${operator.tenantId}\t${operator.name}\t${operator.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Operator bootstrap failed");
    process.exitCode = 2;
  }
}
