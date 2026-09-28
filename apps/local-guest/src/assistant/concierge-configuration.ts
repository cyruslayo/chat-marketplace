import type { AssistantModelClient } from "./assistant-model.js";
import { FallbackModelClient } from "./fallback-model-client.js";
import { DEFAULT_GEMINI_MODEL, GeminiInteractionsClient, type AssistantThinkingLevel } from "./gemini-interactions-client.js";
import { OpenAiCompatibleClient } from "./openai-compatible-client.js";

export type ConciergeMode = "deterministic" | "gemini" | "openai-compatible";

export interface ConciergeEnvironmentSource {
  readonly CONCIERGE_MODE?: string;
  readonly CONCIERGE_FALLBACK?: string;
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
  readonly GEMINI_THINKING_LEVEL?: string;
  readonly LLM_API_KEY?: string;
  readonly LLM_BASE_URL?: string;
  readonly LLM_MODEL?: string;
  /** Short name printed in the startup banner, e.g. "deepseek" or "openai". */
  readonly LLM_PROVIDER_LABEL?: string;
}

export interface GeminiProviderSettings {
  readonly provider: "gemini";
  readonly apiKey: string;
  readonly model: string;
  readonly thinkingLevel?: AssistantThinkingLevel;
}

export interface OpenAiCompatibleProviderSettings {
  readonly provider: "openai-compatible";
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly label: string;
}

export interface ConciergeConfiguration {
  readonly mode: ConciergeMode;
  readonly primary: GeminiProviderSettings | OpenAiCompatibleProviderSettings | null;
  readonly fallback: OpenAiCompatibleProviderSettings | null;
}

const THINKING_LEVELS: readonly AssistantThinkingLevel[] = ["minimal", "low", "medium", "high"];

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function geminiSettings(source: ConciergeEnvironmentSource): GeminiProviderSettings {
  const apiKey = trimmed(source.GEMINI_API_KEY);
  if (!apiKey) throw new Error("CONCIERGE_MODE=gemini requires GEMINI_API_KEY");
  const thinking = trimmed(source.GEMINI_THINKING_LEVEL).toLowerCase();
  if (thinking && !THINKING_LEVELS.includes(thinking as AssistantThinkingLevel)) {
    throw new Error("GEMINI_THINKING_LEVEL must be minimal, low, medium or high");
  }
  return Object.freeze({
    provider: "gemini",
    apiKey,
    model: trimmed(source.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL,
    ...(thinking ? { thinkingLevel: thinking as AssistantThinkingLevel } : {}),
  });
}

function openAiCompatibleSettings(source: ConciergeEnvironmentSource, role: string): OpenAiCompatibleProviderSettings {
  const apiKey = trimmed(source.LLM_API_KEY);
  const baseUrl = trimmed(source.LLM_BASE_URL);
  const model = trimmed(source.LLM_MODEL);
  if (!apiKey || !baseUrl || !model) throw new Error(`${role} requires LLM_API_KEY, LLM_BASE_URL and LLM_MODEL`);
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error("LLM_BASE_URL must be an absolute HTTPS URL"); }
  if (parsed.protocol !== "https:") throw new Error("LLM_BASE_URL must be an absolute HTTPS URL");
  const label = trimmed(source.LLM_PROVIDER_LABEL) || "openai-compatible";
  // The label is printed in the startup banner; keep it to a safe token.
  if (!/^[a-z0-9-]{1,32}$/.test(label)) throw new Error("LLM_PROVIDER_LABEL must be lowercase letters, digits or hyphens");
  return Object.freeze({ provider: "openai-compatible", apiKey, baseUrl, model, label });
}

/**
 * Validates concierge settings at startup. Unset CONCIERGE_MODE means the deterministic concierge;
 * any value that is not recognised fails startup, so a typo can never silently switch the AI off.
 */
export function loadConciergeConfiguration(source: ConciergeEnvironmentSource): ConciergeConfiguration {
  const mode = trimmed(source.CONCIERGE_MODE) || "deterministic";
  const fallbackMode = trimmed(source.CONCIERGE_FALLBACK);
  if (mode !== "deterministic" && mode !== "gemini" && mode !== "openai-compatible") {
    throw new Error("CONCIERGE_MODE must be deterministic, gemini or openai-compatible");
  }
  if (fallbackMode !== "" && fallbackMode !== "openai-compatible") {
    throw new Error("CONCIERGE_FALLBACK must be openai-compatible or unset");
  }
  if (fallbackMode !== "" && mode !== "gemini") {
    throw new Error("CONCIERGE_FALLBACK is only supported with CONCIERGE_MODE=gemini");
  }

  const primary = mode === "gemini"
    ? geminiSettings(source)
    : mode === "openai-compatible"
      ? openAiCompatibleSettings(source, "CONCIERGE_MODE=openai-compatible")
      : null;
  const fallback = fallbackMode ? openAiCompatibleSettings(source, "CONCIERGE_FALLBACK=openai-compatible") : null;
  return Object.freeze({ mode, primary, fallback });
}

function clientFor(settings: GeminiProviderSettings | OpenAiCompatibleProviderSettings): AssistantModelClient {
  return settings.provider === "gemini"
    ? new GeminiInteractionsClient({ apiKey: settings.apiKey, model: settings.model, ...(settings.thinkingLevel ? { thinkingLevel: settings.thinkingLevel } : {}) })
    : new OpenAiCompatibleClient({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model });
}

/** Returns undefined for the deterministic concierge, which needs no model. */
export function createConciergeModelClient(configuration: ConciergeConfiguration): AssistantModelClient | undefined {
  if (!configuration.primary) return undefined;
  const primary = clientFor(configuration.primary);
  return configuration.fallback ? new FallbackModelClient(primary, clientFor(configuration.fallback)) : primary;
}

function describe(settings: GeminiProviderSettings | OpenAiCompatibleProviderSettings): string {
  return settings.provider === "gemini" ? `gemini:${settings.model}` : `${settings.label}:${settings.model}`;
}

/** Banner fields for the concierge. Keys and base URLs never appear here (ADR 0075). */
export function conciergeStartupFields(configuration: ConciergeConfiguration): readonly string[] {
  return [
    `concierge=${configuration.mode}`,
    ...(configuration.primary ? [`model=${describe(configuration.primary)}`] : []),
    ...(configuration.fallback ? [`fallback=${describe(configuration.fallback)}`] : []),
  ];
}
