/** Platform-owned web adapter contract. No CopilotKit types cross this boundary. */
export function conversationalSearch(query, filters) {
  const results = query.search(filters);
  return {
    channel: "web-agent",
    message: results.length === 0 ? "No eligible Units match those requirements." : `Found ${results.length} eligible Unit${results.length === 1 ? "" : "s"}.`,
    results
  };
}

/**
 * CopilotKit is passed as an infrastructure runtime, never imported by the
 * Domain Pack. Its only required capability is running a framework-neutral
 * search intent and returning the canonical result.
 */
export function createCopilotKitWebAgentAdapter({ runtime, query }) {
  return Object.freeze({
    async search(filters) {
      const result = await runtime.run({ intent: "browse-eligible-unit", filters });
      return conversationalSearch(query, result.filters ?? filters);
    }
  });
}
