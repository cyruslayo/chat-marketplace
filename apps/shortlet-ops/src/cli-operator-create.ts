import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { formatOperatorSummary, runOperatorCreateCommand } from "./operator-cli.js";

const repository = new JsonOperatorRepository(process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json");
try {
  const result = runOperatorCreateCommand(repository, process.argv.slice(2));
  console.log(formatOperatorSummary(result.summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator creation failed");
  process.exitCode = 2;
}
