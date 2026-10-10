import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { formatOperatorList, runOperatorListCommand } from "./operator-cli.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration } from "./ops-client.js";

try {
  const remote = remoteOpsConfiguration();
  if (remote !== null) {
    const body = assertOpsOk(await opsRequest(remote, "/_ops/operators", { method: "GET" }));
    console.log(formatOperatorList({ operators: body.operators as Parameters<typeof formatOperatorList>[0]["operators"] }));
  } else {
    const repository = new JsonOperatorRepository(process.env.SHORTLET_OPERATORS_PATH ?? ".scratch/shortlet/pilot-operators.json");
    console.log(formatOperatorList(runOperatorListCommand(repository)));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator listing failed");
  process.exitCode = 2;
}
