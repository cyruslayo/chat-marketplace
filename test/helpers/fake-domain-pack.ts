import type { AssistantDomainPack } from "../../apps/local-guest/src/assistant/assistant-platform.js";
import type { AssistantTaskState } from "../../apps/local-guest/src/assistant/assistant-state.js";
import type { ModePresentation } from "../../apps/web-agent/src/guest-content.js";

/** A valid presentation for the fake shop pack (ADR 0107 decision 3: it passes validateModePresentation). */
const SHOP_PRESENTATION: ModePresentation = {
  id: "shop",
  label: "Shop",
  persona: { name: "Shop", icon: "arrow-right" },
  tagline: "Browse products from verified merchants.",
  emptyState: {
    heading: "Shop for products",
    body: "Ask about products from verified merchants.",
    starters: [{ label: "Browse products", prompt: "Show me products" }],
  },
  composer: {
    label: "Message the shop assistant",
    ariaLabel: "Message the shop assistant",
    placeholder: "Ask about a product",
    hint: "Products and prices come from the shop.",
  },
  workspace: {
    regionLabel: "Shop workspace",
    reopenLabel: "Open shop workspace",
    returnedAnnouncement: "Returned to shop workspace",
    readyAnnouncement: "Shop workspace ready",
    workingStatus: "Working on your shop request",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A minimal second-domain pack for router, task-switching and contract tests. It implements the neutral hooks of issue 03a
 * (presentation, state, scope facts, at-risk) and no booking method, so it proves the contract without stubbing booking.
 */
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
    revalidateProposal: () => ({ ok: true }),
    presentation: SHOP_PRESENTATION,
    surfaces: {},
    initialState: () => ({ items: [] }),
    parseState: (value: unknown) => (isRecord(value) && Array.isArray(value.items) ? value : undefined),
    stateSummary: (state: unknown) => (isRecord(state) && Array.isArray(state.items) ? { label: "Shopping", status: "Browse" } : undefined),
    scopeFacts: (state: AssistantTaskState) => ({ hasCart: Boolean(state.currentDraftId) }),
    atRisk: (state: AssistantTaskState) => Boolean(state.pendingAction),
  };
}
