import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import { StayDateRange } from "../../../domains/shortlet/src/index.js";

export const MAX_GEMINI_TOOL_ROUNDS = 2;
export const GEMINI_SYSTEM_INSTRUCTION = `You are the conversational concierge for Shortlet.
Help guests describe accommodation they want.
You do not control marketplace state.
Never invent availability, prices, fees, deposits, inspection status, management authority, booking status, host/Operator decisions, payment status, or booking confirmation.
When enough information is available to search, call search_stays.
If essential information is missing, ask one concise clarification question.
Do not claim that a booking, payment, Operator action, or other consequential action succeeded unless the Shortlet platform has returned that authoritative result.
Do not generate HTML, A2UI, or application commands.`;

export const searchStaysDeclaration: FunctionDeclaration = {
  name: "search_stays",
  description: "Search the Shortlet marketplace for eligible accommodation once the guest has supplied sufficient stay requirements.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "Requested city, for example Lagos" },
      neighbourhood: { type: ["string", "null"], description: "Requested neighbourhood, or null when none was requested" },
      checkIn: { type: ["string", "null"], description: "Explicit check-in date in YYYY-MM-DD form, or null" },
      nights: { type: "integer", minimum: 1, description: "Requested stay duration in nights" },
      guests: { type: "integer", minimum: 1, description: "Number of guests" },
    },
    required: ["city", "neighbourhood", "checkIn", "nights", "guests"],
    additionalProperties: false,
  },
};

export interface GeminiFunctionCall { readonly name?: string; readonly id?: string; readonly args?: unknown; }
export interface GeminiModelResponse { readonly text?: string; readonly functionCalls?: readonly GeminiFunctionCall[]; readonly content?: Content; }
export interface GeminiConciergeClient { generate(contents: Content[]): Promise<GeminiModelResponse>; }
export interface NormalizedStaySearch { readonly location: string; readonly neighbourhood?: string; readonly checkIn: string; readonly checkOut: string; readonly partySize: number; }
export interface GeminiSearchMetadata { readonly resultCount: number; readonly location: string; readonly neighbourhood?: string; readonly checkIn: string; readonly checkOut: string; }

export function validateGeminiStaySearchArguments(args: unknown, options: { readonly demoCheckIn: string; readonly now: Date }): NormalizedStaySearch {
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new TypeError("search_stays arguments must be an object");
  const value = args as Record<string, unknown>;
  const city = value.city;
  if (typeof city !== "string" || !["Lagos", "Abuja"].includes(city.trim())) throw new TypeError("city is unsupported");
  const neighbourhoodValue = value.neighbourhood;
  if (neighbourhoodValue !== null && neighbourhoodValue !== undefined && typeof neighbourhoodValue !== "string") throw new TypeError("neighbourhood is invalid");
  const neighbourhoodMap: Readonly<Record<string, string>> = { "old ikoyi": "Old Ikoyi", ikoyi: "Old Ikoyi", lekki: "Lekki Phase 1", "lekki phase 1": "Lekki Phase 1", "victoria island": "Victoria Island" };
  const rawNeighbourhood = typeof neighbourhoodValue === "string" ? neighbourhoodValue.trim() : "";
  const neighbourhood = rawNeighbourhood === "" ? undefined : neighbourhoodMap[rawNeighbourhood.toLowerCase()];
  if (rawNeighbourhood !== "" && !neighbourhood) throw new TypeError("neighbourhood is unsupported");
  const nights = value.nights;
  const guests = value.guests;
  if (typeof nights !== "number" || !Number.isSafeInteger(nights) || nights < 1) throw new RangeError("nights must be a positive integer");
  if (typeof guests !== "number" || !Number.isSafeInteger(guests) || guests < 1) throw new RangeError("guests must be a positive integer");
  const checkIn = value.checkIn === null ? options.demoCheckIn : value.checkIn;
  if (typeof checkIn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) throw new TypeError("checkIn must be an ISO calendar date or null");
  const start = new Date(`${checkIn}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== checkIn) throw new TypeError("checkIn is invalid");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + nights);
  const checkOut = end.toISOString().slice(0, 10);
  const range = new StayDateRange(checkIn, checkOut, options.now);
  return { location: city.trim(), ...(neighbourhood ? { neighbourhood } : {}), checkIn: range.checkIn, checkOut: range.checkOut, partySize: guests };
}

function modelContent(response: GeminiModelResponse): Content {
  return response.content ?? { role: "model", parts: response.functionCalls?.map((call) => ({ functionCall: { name: call.name, id: call.id, ...(call.args !== null && typeof call.args === "object" && !Array.isArray(call.args) ? { args: call.args as Record<string, unknown> } : {}) } })) ?? [{ text: response.text ?? "" }] };
}

export async function handleGeminiTurn(input: {
  readonly client: GeminiConciergeClient;
  readonly history: Content[];
  readonly text: string;
  readonly demoCheckIn: string;
  readonly now: Date;
  readonly search: (filters: NormalizedStaySearch) => GeminiSearchMetadata;
}): Promise<{ readonly kind: "clarify"; readonly reply: string } | { readonly kind: "search"; readonly filters: NormalizedStaySearch; readonly metadata: GeminiSearchMetadata; readonly reply: string }> {
  input.history.push({ role: "user", parts: [{ text: input.text }] });
  let response = await input.client.generate(input.history);
  for (let round = 0; round < MAX_GEMINI_TOOL_ROUNDS; round += 1) {
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      const reply = response.text?.trim();
      if (!reply) throw new Error("Gemini returned an empty response");
      input.history.push(modelContent(response));
      return { kind: "clarify", reply };
    }
    if (calls.length !== 1 || calls[0]?.name !== "search_stays") throw new Error("Unsupported Gemini function call");
    const call = calls[0];
    const filters = validateGeminiStaySearchArguments(call.args, { demoCheckIn: input.demoCheckIn, now: input.now });
    const metadata = input.search(filters);
    input.history.push(modelContent(response));
    input.history.push({ role: "user", parts: [{ functionResponse: { id: call.id, name: "search_stays", response: { resultCount: metadata.resultCount, location: metadata.location, ...(metadata.neighbourhood ? { neighbourhood: metadata.neighbourhood } : {}), checkIn: metadata.checkIn, checkOut: metadata.checkOut } } }] });
    response = await input.client.generate(input.history);
    const reply = response.text?.trim();
    if (response.functionCalls && response.functionCalls.length > 0) continue;
    if (!reply) throw new Error("Gemini returned an empty response");
    input.history.push(modelContent(response));
    return { kind: "search", filters, metadata, reply };
  }
  throw new Error("Gemini tool loop exceeded limit");
}

export function createGeminiConciergeClient(apiKey: string, model: string, timeoutMs = 20_000): GeminiConciergeClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(contents) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await ai.models.generateContent({ model, contents, config: { systemInstruction: GEMINI_SYSTEM_INSTRUCTION, tools: [{ functionDeclarations: [searchStaysDeclaration] }], abortSignal: controller.signal } });
        return { text: response.text, functionCalls: response.functionCalls, content: response.candidates?.[0]?.content };
      } finally { clearTimeout(timer); }
    },
  };
}
