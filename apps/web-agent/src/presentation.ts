import { conventionalSearchRoute } from "../../web/src/index.js";

function fallbackMessage(artifact: any): string {
  const count = artifact.facts.results.length;
  return count === 0 ? "No eligible Units match those requirements." : `Found ${count} eligible Unit${count === 1 ? "" : "s"}.`;
}

export function conversationalSearch(query: any, filters: any) {
  const artifact = query.search(filters);
  return { channel: "web-agent" as const, message: fallbackMessage(artifact), artifact };
}

export function createCopilotKitWebAgentAdapter({ runtime, query }: { runtime: any; query: any }) {
  return Object.freeze({
    async search(filters: any) {
      const artifact = query.search(filters);
      const fallback = { message: fallbackMessage(artifact), conventionalRoute: conventionalSearchRoute(filters) };
      try {
        const presentation = await runtime.present({ intent: "browse-eligible-unit", artifact });
        const correlatedMessage = presentation?.artifactId === artifact.id && typeof presentation.message === "string"
          ? presentation.message : fallback.message;
        return {
          channel: "web-agent" as const, artifact,
          message: correlatedMessage,
          agentRun: "completed" as const,
          fallback
        };
      } catch {
        return { channel: "web-agent" as const, artifact, message: fallback.message, agentRun: "failed" as const, fallback };
      }
    }
  });
}
