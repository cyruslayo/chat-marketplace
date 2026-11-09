import type { AssistantDomainPack } from "../../apps/local-guest/src/assistant/assistant-platform.js";

/** A minimal pack whose prompt section is "STUB SECTION", for prompt-composition and registry tests. */
export function createStubPack(overrides: Partial<AssistantDomainPack> = {}): AssistantDomainPack {
  return {
    id: "stub",
    label: "Stub",
    promptSection: "STUB SECTION",
    intentKeywords: [],
    toolNames: ["stub_tool"],
    toolsForState: () => [],
    validateToolCall: () => undefined,
    executeTool: () => { throw new Error("not executed"); },
    taskSummary: () => ({ label: "Stub", status: "Ready" }),
    discoverySurface: () => [],
    unitDetailSurface: () => [],
    pendingActionSurface: () => [],
    bookingRequestSurface: () => [],
    conditionalOfferSurface: () => [],
    cardPaymentSurface: () => [],
    bookingContractSurface: () => [],
    revalidateProposal: () => ({ ok: true }),
    ...overrides,
  };
}
