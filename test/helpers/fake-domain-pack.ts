import type { AssistantDomainPack } from "../../apps/local-guest/src/assistant/assistant-platform.js";

/** A minimal second-domain pack for router and task-switching tests. */
export function createFakeShopPack(): AssistantDomainPack {
  return {
    id: "shop",
    promptSection: "You help guests shop for products.",
    intentKeywords: ["shop", "store", "product", "products", "cart", "buy"],
    toolNames: ["shop_search"],
    toolsForState: () => [{
      name: "shop_search",
      description: "Search products.",
      category: "read",
      parametersSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    }],
    validateToolCall: (name) => (name === "shop_search" ? undefined : { code: "invalid_tool_for_state", message: "That operation is not available for the current Guest workflow." }),
    executeTool: () => { throw new Error("The fake shop pack does not execute tools in these tests."); },
    discoverySurface: () => [],
    unitDetailSurface: () => [],
    pendingActionSurface: () => [],
    bookingRequestSurface: () => [],
    conditionalOfferSurface: () => [],
    cardPaymentSurface: () => [],
    bookingContractSurface: () => [],
    revalidateProposal: () => ({ ok: true }),
  };
}
