import { conventionalSearchRoute } from "../../web/src/index.js";

function fallbackMessage(artifact) {
  const count = artifact.facts.results.length;
  return count === 0 ? "No eligible Units match those requirements." : `Found ${count} eligible Unit${count === 1 ? "" : "s"}.`;
}

export function conversationalSearch(query, filters) {
  const artifact = query.search(filters);
  return { channel: "web-agent", message: fallbackMessage(artifact), artifact };
}

export function createCopilotKitWebAgentAdapter({ runtime, query }) {
  return Object.freeze({
    async search(filters) {
      const artifact = query.search(filters);
      const fallback = { message: fallbackMessage(artifact), conventionalRoute: conventionalSearchRoute(filters) };
      try {
        const presentation = await runtime.present({ intent: "browse-eligible-unit", artifact });
        const correlatedMessage = presentation?.artifactId === artifact.id && typeof presentation.message === "string"
          ? presentation.message : fallback.message;
        return {
          channel: "web-agent", artifact,
          message: correlatedMessage,
          agentRun: "completed",
          fallback
        };
      } catch {
        return { channel: "web-agent", artifact, message: fallback.message, agentRun: "failed", fallback };
      }
    }
  });
}
