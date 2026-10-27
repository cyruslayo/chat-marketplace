import type { AssistantDomainPack } from "../../apps/local-guest/src/assistant/assistant-platform.js";

/** A minimal second-domain pack for router and task-switching tests. */
export function createFakeShopPack(options: { readonly omitIntentMap?: boolean } = {}): AssistantDomainPack {
  return {
    id: "shop",
    label: "Shop",
    starterDescription: "Browse products from verified merchants.",
    promptSection: "You help guests shop for products.",
    intentKeywords: ["shop", "store", "product", "products", "cart", "buy"],
    toolNames: ["shop_search"],
    ...(options.omitIntentMap ? {} : { toolIntentMap: { search: ["shop_search"] } }),
    toolsForState: () => [{
      name: "shop_search",
      description: "Search products.",
      category: "read",
      parametersSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    }],
    toolDefinition: (name) => name === "shop_search" ? {
      name: "shop_search", description: "Search products.", category: "read",
      parametersSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    } : undefined,
    validateToolCall: (name) => (name === "shop_search" ? undefined : { code: "invalid_tool_for_state", message: "That operation is not available for the current Guest workflow." }),
    executeTool: () => { throw new Error("The fake shop pack does not execute tools in these tests."); },
    taskSummary: () => ({ label: "Shopping", status: "Browse" }),
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
