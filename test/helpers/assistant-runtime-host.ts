import { AssistantRuntime, type AssistantRuntimeOptions } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { createShortletAssistantPack } from "../../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import type { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";

/**
 * A test host: the composition root that a Shortlet concierge runs under (ADR 0099 section 6). The runtime constructs no pack
 * itself, so a test that runs the Shortlet concierge supplies the Shortlet pack here, as shortlet-app.ts and guest-server.ts do.
 * Caller-supplied `packs` follow the Shortlet pack, and `additionalPacks` register after them, as before.
 */
export class ShortletAssistantRuntime extends AssistantRuntime {
  constructor(environment: LocalGuestEnvironment, modelClient: AssistantModelClient, options: AssistantRuntimeOptions = {}) {
    super(environment, modelClient, { ...options, packs: [createShortletAssistantPack(environment), ...(options.packs ?? [])] });
  }
}
