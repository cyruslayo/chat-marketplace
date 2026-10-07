import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { formatOperatorSummary, runOperatorUpdateCommand } from "./operator-cli.js";
import { assertOpsOk, flagValue, opsRequest, remoteOpsConfiguration } from "./ops-client.js";

const args = process.argv.slice(2);
try {
  const remote = remoteOpsConfiguration();
  if (remote !== null) {
    const operatorId = flagValue(args, "--operator-id");
    const body = assertOpsOk(await opsRequest(remote, `/_ops/operators/${encodeURIComponent(operatorId)}`, {
      method: "PATCH",
      contentType: "application/json",
      body: JSON.stringify({ name: flagValue(args, "--name") }),
    }));
    console.log(formatOperatorSummary(body.operator as Parameters<typeof formatOperatorSummary>[0]));
  } else {
    const repository = new JsonOperatorRepository(process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json");
    console.log(formatOperatorSummary(runOperatorUpdateCommand(repository, args).summary));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator update failed");
  process.exitCode = 2;
}
