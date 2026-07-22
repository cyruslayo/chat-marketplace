import { CopilotKitCore } from "@copilotkit/core";
import { AssistantMessageSchema, UserMessageSchema } from "@ag-ui/core";

export const AG_UI_PROFILE = Object.freeze({
  id: "ag-ui/0.0.57-shortlet-launch-v1",
  protocolVersion: "0.0.57",
  transport: "https-post-sse",
  artifactSchema: "shortlet.discovery/v1",
  allowedInboundMessageRoles: Object.freeze(["assistant"])
});

function assertProtocolConformance(profile: any, artifact: any) {
  if (profile.id !== AG_UI_PROFILE.id || profile.transport !== "https-post-sse") {
    throw new Error("Unsupported AG-UI protocol profile");
  }
  if (artifact.schemaVersion !== profile.artifactSchema || !Object.isFrozen(artifact)) {
    throw new Error("Unsupported or mutable interaction artifact");
  }
}

function waitForAgent(core: any, agentId: string, timeoutMs: number): Promise<any> {
  const existing = core.getAgent ? core.getAgent(agentId) : null;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    let subscription: any;
    const timeout = setTimeout(() => {
      subscription?.unsubscribe();
      reject(new Error(`CopilotKit agent ${agentId} unavailable`));
    }, timeoutMs);
    subscription = core.subscribe({
      onAgentsChanged: ({ agents }: any) => {
        if (!agents[agentId]) return;
        clearTimeout(timeout);
        subscription.unsubscribe();
        resolve(agents[agentId]);
      }
    });
  });
}

export interface CreateCopilotKitRuntimeOptions {
  runtimeUrl?: string;
  agentId?: string;
  timeoutMs?: number;
  coreFactory?: (config: any) => any;
}

export function createCopilotKitRuntime({
  runtimeUrl = "/api/copilotkit", agentId = "default", timeoutMs = 5000,
  coreFactory = (config) => new CopilotKitCore(config)
}: CreateCopilotKitRuntimeOptions = {}) {
  const core = coreFactory({ runtimeUrl, credentials: "include", deferInitialConnection: true });
  core.connect();
  return Object.freeze({
    async present({ intent, artifact }: { intent: string; artifact: any }) {
      assertProtocolConformance(AG_UI_PROFILE, artifact);
      const agent = await waitForAgent(core, agentId, timeoutMs);
      const messageBoundary = agent.messages.length;
      const message = UserMessageSchema.parse({
        id: crypto.randomUUID(), role: "user",
        content: JSON.stringify({ profile: AG_UI_PROFILE.id, intent, interactionArtifact: artifact })
      });
      agent.addMessage(message);
      await core.runAgent({ agent, forwardedProps: { agUiProfile: AG_UI_PROFILE, interactionArtifact: artifact } });
      const response = agent.messages.slice(messageBoundary + 1).reverse()
        .find((candidate: any) => candidate.role === "assistant" && typeof candidate.content === "string");
      if (response) AssistantMessageSchema.parse(response);
      return { artifactId: artifact.id, message: response?.content };
    },
    async renderRecordedStream(events: any[]) {
      let normalized: any = null;
      for (const event of events) {
        if (event.type === "surface.created") {
          normalized = {
            surfaceId: event.surfaceId,
            catalogue: event.catalogue,
            revision: event.revision,
            status: "active",
            facts: { ...event.facts }
          };
        } else if (event.type === "surface.updated" && normalized?.surfaceId === event.surfaceId) {
          if (event.revision < normalized.revision) {
            normalized.status = "stale";
          } else {
            normalized.revision = event.revision;
            normalized.facts = { ...event.facts };
          }
        } else if (event.type === "surface.expired" && normalized?.surfaceId === event.surfaceId) {
          normalized.status = "expired";
        }
      }
      return normalized;
    }
  });
}
