import assert from "node:assert/strict";
import test from "node:test";

import { COPILOTKIT_RUNTIME_CONFIG } from "../client/src/copilotkit-config.js";

test("The web client selects the default agent and the multi-route CopilotKit runtime", () => {
  assert.equal(COPILOTKIT_RUNTIME_CONFIG.agent, "default");
  assert.equal(COPILOTKIT_RUNTIME_CONFIG.useSingleEndpoint, false);
});
