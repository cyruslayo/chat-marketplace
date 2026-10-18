// The shortlet agent pack now lives in `shortlet-assistant-pack.ts` and the platform (prompt
// preamble, pack registry, tool-loop bound) in `assistant-platform.ts`. This module keeps the
// historical shortlet symbols for existing callers.
export { MAX_ASSISTANT_TOOL_ROUNDS } from "./assistant-platform.js";
export type {
  AssistantDomainPack,
  AssistantToolContext,
  AssistantToolExecutionResult,
  AssistantToolPreconditionFailure,
} from "./assistant-platform.js";
export {
  ASSISTANT_SYSTEM_INSTRUCTION,
  SHORTLET_PROMPT_SECTION,
  ASSISTANT_TOOL_DEFINITIONS,
  assistantToolsForState,
  validateAssistantToolCall,
  executeAssistantTool,
  normalizeNeighbourhood,
  normalizeLaunchCity,
  resolveCheckInDate,
  type SearchStaysToolArgs,
} from "./shortlet-assistant-pack.js";
export { createCommerceAssistantPack } from "./commerce-assistant-pack.js";
