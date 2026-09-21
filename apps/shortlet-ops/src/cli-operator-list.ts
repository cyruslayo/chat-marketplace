import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { formatOperatorList, runOperatorListCommand } from "./operator-cli.js";

try {
  const repository = new JsonOperatorRepository(process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json");
  console.log(formatOperatorList(runOperatorListCommand(repository)));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator listing failed");
  process.exitCode = 2;
}
