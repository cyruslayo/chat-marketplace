import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { formatOperatorSummary, runOperatorUpdateCommand } from "./operator-cli.js";

try {
  const repository = new JsonOperatorRepository(process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json");
  const result = runOperatorUpdateCommand(repository, process.argv.slice(2));
  console.log(formatOperatorSummary(result.summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator update failed");
  process.exitCode = 2;
}
