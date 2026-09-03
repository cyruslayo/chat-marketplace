/// <reference lib="dom" />
/**
 * Local guest demo browser client.
 *
 * The browser owns only the persistent conversational shell. Every apartment
 * card, price, offer, payment and booking surface is A2UI generated on the
 * server and rendered here by the real Weaver Basic Catalog runtime
 * (ADR-0081). No domain logic and no hand-coded product cards live here.
 */
import { createBasicWebRuntime } from "@weaver/web";

interface GuestSurfacePayload {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
}

interface GuestResponse {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly messages?: readonly string[];
  readonly surfaces?: readonly GuestSurfacePayload[];
}

const threadId = `g-${crypto.randomUUID()}`;
const transcript = document.getElementById("transcript") as HTMLElement;
const composerForm = document.getElementById("composer") as HTMLFormElement;
const composerInput = document.getElementById("composer-input") as HTMLInputElement;

function addAssistantText(text: string): void {
  addTurn("assistant", text);
}

const created = createBasicWebRuntime({
  rendering: {
    onServerEvent: (event) => {
      void sendEvent(event.message.action);
    },
  },
});
if (!created.ok) {
  addAssistantText("The interface runtime could not start. Please reload the page.");
  throw new Error("Unable to create the Weaver web runtime");
}
const weaver = created.value;

function addTurn(role: "assistant" | "user", text: string): void {
  const turn = document.createElement("div");
  turn.className = `turn ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  turn.appendChild(bubble);
  transcript.appendChild(turn);
  transcript.scrollTop = transcript.scrollHeight;
}

function mountSurface(a2uiMessages: readonly unknown[], surfaceId: string): void {
  const card = document.createElement("div");
  card.className = "surface-card";
  const mount = document.createElement("div");
  mount.className = "weaver-mount";
  card.appendChild(mount);
  transcript.appendChild(card);
  transcript.scrollTop = transcript.scrollHeight;

  for (const message of a2uiMessages) {
    const processed = weaver.runtime.process(message);
    if (!processed.ok) {
      // ADR-0074: unsupported or invalid generated UI fails closed with a
      // safe textual fallback and never guesses missing meaning.
      mount.textContent = "This card could not be displayed safely. Ask me to continue and I will retry.";
      return;
    }
  }

  const mounted = weaver.mount({ surfaceId, target: mount });
  if (!mounted.ok) {
    mount.textContent = "This card could not be displayed safely. Ask me to continue and I will retry.";
    return;
  }
  transcript.scrollTop = transcript.scrollHeight;
}

function renderResponse(response: GuestResponse): void {
  if (!response.ok) {
    addAssistantText(response.message ?? "That action could not be completed.");
    return;
  }
  for (const message of response.messages ?? []) {
    addAssistantText(message);
  }
  for (const surface of response.surfaces ?? []) {
    mountSurface(surface.a2uiMessages, surface.surfaceId);
  }
}

async function postJson(path: string, body: unknown): Promise<GuestResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as GuestResponse;
}

async function sendTurn(text: string): Promise<void> {
  addTurn("user", text);
  renderResponse(await postJson("/api/turn", { threadId, text }));
}

async function sendEvent(action: { name: string; surfaceId: string; sourceComponentId: string; timestamp: string; context: unknown }): Promise<void> {
  renderResponse(await postJson("/api/event", { threadId, ...action }));
}

composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = composerInput.value.trim();
  if (text === "") return;
  composerInput.value = "";
  void sendTurn(text);
});

addAssistantText(
  "Hi! I'm the Shortlet concierge. Tell me where you'd like to stay, for how long, and how many guests — for example: “I need an apartment in Ikoyi for 3 nights for 2 people”.",
);
