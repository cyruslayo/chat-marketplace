import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { formatOperatorSummary, runOperatorCreateCommand } from "./operator-cli.js";
import { assertOpsOk, flagValue, opsRequest, remoteOpsConfiguration } from "./ops-client.js";

const args = process.argv.slice(2);
try {
  const remote = remoteOpsConfiguration();
  if (remote !== null) {
    const body = assertOpsOk(await opsRequest(remote, "/_ops/operators", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        operatorId: flagValue(args, "--operator-id"),
        tenantId: flagValue(args, "--tenant-id"),
        name: flagValue(args, "--name"),
      }),
    }));
    console.log(formatOperatorSummary(body.operator as Parameters<typeof formatOperatorSummary>[0]));
  } else {
    const repository = new JsonOperatorRepository(process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json");
    console.log(formatOperatorSummary(runOperatorCreateCommand(repository, args).summary));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator creation failed");
  process.exitCode = 2;
}
