import { conventionalSearchRoute } from "../../web/src/index.js";
import {
  discoveryArtifactToA2UI,
  type DiscoveryArtifactProjection,
} from "./discovery-a2ui.js";

function fallbackMessage(artifact: any): string {
  const count = artifact.facts.results.length;
  return count === 0 ? "No eligible Units match those requirements." : `Found ${count} eligible Unit${count === 1 ? "" : "s"}.`;
}

export function conversationalSearch(query: any, filters: any) {
  const artifact = query.search(filters);
  return { channel: "web-agent" as const, message: fallbackMessage(artifact), artifact };
}

export interface WeaverDiscoveryQueryPort {
  search(filters: Readonly<Record<string, unknown>>): DiscoveryArtifactProjection;
}

export interface CreateWeaverWebAgentAdapterOptions {
  readonly query: WeaverDiscoveryQueryPort;
  readonly createSurfaceId: (artifactId: string) => string;
}

export function createWeaverWebAgentAdapter({ query, createSurfaceId }: CreateWeaverWebAgentAdapterOptions) {
  return Object.freeze({
    search(filters: Readonly<Record<string, unknown>>) {
      const artifact = query.search(filters);
      const surfaceId = createSurfaceId(artifact.id);
      const a2uiMessages = discoveryArtifactToA2UI({ artifact, surfaceId });
      const fallback = Object.freeze({
        message: fallbackMessage(artifact),
        conventionalRoute: conventionalSearchRoute(filters),
      });
      return Object.freeze({
        channel: "web-agent" as const,
        artifact,
        surfaceId,
        a2uiMessages,
        fallback,
      });
    },
  });
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
