import type {
  AssistantConversationStep,
  AssistantModelClient,
  AssistantModelRequest,
  AssistantModelResponse,
  AssistantToolCall,
} from "./assistant-model.js";

/**
 * Deterministic offline scripted model implementation (Item 25).
 * Implements AssistantModelClient without making any real LLM calls.
 * Simulates tool orchestration protocol:
 *   user utterance -> tool_calls -> tool_results -> natural text response
 */
export class ScriptedAssistantModel implements AssistantModelClient {
  readonly #scenarioOverrides: ((request: AssistantModelRequest) => AssistantModelResponse | null)[] = [];

  constructor(overrides: ((request: AssistantModelRequest) => AssistantModelResponse | null)[] = []) {
    this.#scenarioOverrides = [...overrides];
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    for (const override of this.#scenarioOverrides) {
      const match = override(request);
      if (match) return match;
    }

    const lastStep = request.history[request.history.length - 1];

    // If the last step is tool_results, generate an assistant explanation based on the tool that just completed
    if (lastStep?.role === "tool_results") {
      return this.#handleToolResults(lastStep.results);
    }

    // Otherwise, parse the latest user message and decide whether to call a tool or ask for clarification
    const userText = this.#getLatestUserText(request.history);
    return this.#interpretUserUtterance(userText, request.history);
  }

  #getLatestUserText(history: readonly AssistantConversationStep[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
      const step = history[i];
      if (step && step.role === "user") return step.text;
    }
    return "";
  }

  #handleToolResults(results: readonly { name: string; result: Record<string, unknown> }[]): AssistantModelResponse {
    const firstResult = results[0];
    if (!firstResult) return { text: "I processed that request." };

    switch (firstResult.name) {
      case "search_stays": {
        const count = Number(firstResult.result.resultCount ?? 0);
        const location = String(firstResult.result.neighbourhood ?? firstResult.result.location ?? "Lagos");
        if (count === 0) {
          return {
            text: `I couldn't find any eligible stays matching those requirements in ${location}.`,
          };
        }
        return {
          text: `I found ${count} matching stay${count === 1 ? "" : "s"} in ${location}. Here ${count === 1 ? "it is" : "they are"}.`,
        };
      }

      case "get_unit_details": {
        const title = String(firstResult.result.title ?? "this stay");
        const amenities = Array.isArray(firstResult.result.amenities)
          ? firstResult.result.amenities.join(", ")
          : "";
        return {
          text: `${title} offers ${amenities}, entire place possession, and passed physical inspection.`,
        };
      }

      case "compare_stays": {
        const compared = Array.isArray(firstResult.result.compared)
          ? firstResult.result.compared
          : [];
        if (compared.length >= 2) {
          const first = compared[0];
          const second = compared[1];
          const firstTitle = first.title;
          const secondTitle = second.title;
          const firstPrice = (Number(first.nightlyKobo ?? 0) / 100).toLocaleString("en-NG");
          const secondPrice = (Number(second.nightlyKobo ?? 0) / 100).toLocaleString("en-NG");
          return {
            text: `Comparing both options: ${firstTitle} is ₦${firstPrice}/night, while ${secondTitle} is ₦${secondPrice}/night. ${firstTitle} has higher capacity.`,
          };
        }
        return { text: "Here is the comparison between your shortlisted stays." };
      }

      case "explain_stay_price": {
        const title = String(firstResult.result.title ?? "this stay");
        const deposit = (Number(firstResult.result.refundableSecurityDepositKobo ?? 0) / 100).toLocaleString("en-NG");
        const fees = (Number(firstResult.result.mandatoryFeesKobo ?? 0) / 100).toLocaleString("en-NG");
        return {
          text: `For ${title}, the price includes mandatory fees of ₦${fees}. A refundable security deposit of ₦${deposit} is collected separately and returned after checkout.`,
        };
      }

      case "get_booking_status": {
        const status = String(firstResult.result.status ?? "");
        if (status === "confirmed") {
          return {
            text: `Your booking is confirmed under contract reference ${String(firstResult.result.contractId)}.`,
          };
        }
        if (status === "offer_issued") {
          return {
            text: `The host has issued a Conditional Booking Offer under offer reference ${String(firstResult.result.offerId)}.`,
          };
        }
        if (status === "request_disclosed") {
          return {
            text: `Your Booking Request ${String(firstResult.result.requestId)} has been disclosed and is awaiting host response.`,
          };
        }
        return { text: "You currently have no active booking or pending request." };
      }

      case "get_offer_status": {
        if (firstResult.result.hasOffer === false) {
          return { text: "You don't currently have an active offer." };
        }
        const due = (Number(firstResult.result.amountDueNowKobo ?? 0) / 100).toLocaleString("en-NG");
        const deposit = (Number(firstResult.result.refundableDepositKobo ?? 0) / 100).toLocaleString("en-NG");
        return {
          text: `The host offered this stay. The amount due is ₦${due} (including refundable deposit of ₦${deposit}).`,
        };
      }

      case "propose_request_to_book":
      case "propose_accept_offer":
      case "propose_start_payment": {
        return {
          text: String(firstResult.result.message ?? "Please review and confirm this action."),
        };
      }

      default:
        return { text: "I completed the requested action." };
    }
  }

  #interpretUserUtterance(text: string, history: readonly AssistantConversationStep[]): AssistantModelResponse {
    const norm = text.toLowerCase().trim();

    // 1. Status questions
    if (/\b(am i booked|booking status|what happened to my request|is my payment complete|booking reference|dates)\b/.test(norm)) {
      return {
        toolCalls: [{ id: `call-${crypto.randomUUID()}`, name: "get_booking_status", args: {} }],
      };
    }

    // 2. Offer questions
    if (/\b(what did the host offer|how much is the offer|how much is due|what's the deposit|when does this expire)\b/.test(norm)) {
      return {
        toolCalls: [{ id: `call-${crypto.randomUUID()}`, name: "get_offer_status", args: {} }],
      };
    }

    // 3. Consequential Proposal: Request to Book
    if (/\b(request the first one|request it|book this one|request this one|go with the cheaper one|book the first one)\b/.test(norm)) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "propose_request_to_book",
            args: { stayRef: "stay-1" },
          },
        ],
      };
    }

    // 4. Consequential Proposal: Accept Offer
    if (/\b(accept the offer|accept it|accept offer)\b/.test(norm)) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "propose_accept_offer",
            args: {},
          },
        ],
      };
    }

    // 5. Consequential Proposal: Start Payment
    if (/\b(start payment|start secure checkout|pay now|checkout)\b/.test(norm)) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "propose_start_payment",
            args: {},
          },
        ],
      };
    }

    // 6. Compare stays
    if (/\b(compare|which is cheaper|compare the two|compare these)\b/.test(norm)) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "compare_stays",
            args: { stayRefs: ["stay-1", "stay-2"] },
          },
        ],
      };
    }

    // 7. Unit Details / Selection
    if (/\b(tell me (more )?about (this one|the first one|stay-1)|why is it a good fit)\b/.test(norm)) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "get_unit_details",
            args: { stayRef: "stay-1" },
          },
        ],
      };
    }

    // 8. Price explanation
    if (/\b(what's included in the price|why is there a separate deposit|why is the first one more expensive|how much do i pay now|explain.*price)\b/.test(norm)) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "explain_stay_price",
            args: { stayRef: "stay-1" },
          },
        ],
      };
    }

    // 9. Relative dates -> prompt for exact date
    if (/\b(next friday|next week|tomorrow|next month)\b/.test(norm)) {
      return {
        text: "Please give me the check-in date as YYYY-MM-DD.",
      };
    }

    // 10. Search intent extraction
    const hasIkoyi = /\b(ikoyi|old ikoyi)\b/.test(norm);
    const hasLekki = /\b(lekki|lekki phase 1)\b/.test(norm);
    const hasLagos = /\b(lagos)\b/.test(norm);
    const hasAbuja = /\b(abuja)\b/.test(norm);

    // Nights extraction
    const nightsMatch = norm.match(/\b(\d+)\s*(?:nights?|nts?)\b/);
    const nights = nightsMatch ? parseInt(nightsMatch[1] ?? "3", 10) : undefined;

    // Guests extraction
    const guestsMatch = norm.match(/\b(\d+)\s*(?:guests?|people|persons?)\b/);
    const hasPartner = /\b(with my partner|couple|two of us)\b/.test(norm);
    const guests = guestsMatch ? parseInt(guestsMatch[1] ?? "2", 10) : (hasPartner ? 2 : undefined);

    // Refinement checks
    if (norm === "actually lekki" || norm === "actually lekki.") {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: "Lekki Phase 1",
              checkIn: null,
              nights: 4,
              guests: 2,
            },
          },
        ],
      };
    }

    if (norm === "actually make it five nights" || norm === "make it five nights" || norm === "make it 5 nights") {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: "Old Ikoyi",
              checkIn: null,
              nights: 5,
              guests: 2,
            },
          },
        ],
      };
    }

    if (norm === "show me the lagos options instead" || norm === "show me lagos generally" || norm === "show me lagos generally.") {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: null,
              checkIn: null,
              nights: 4,
              guests: 2,
            },
          },
        ],
      };
    }

    // Check if user is answering a clarification (e.g. "Four nights." or "Four nights for two people.")
    const isOnlyNightsOrGuests = /^(four nights|4 nights|four nights for two|4 nights for 2|four nights for two people|three nights for two people|3 nights for 2 people)[.!]?$/.test(norm);
    if (isOnlyNightsOrGuests) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: "Old Ikoyi",
              checkIn: null,
              nights: 4,
              guests: 2,
            },
          },
        ],
      };
    }

    // If user says "I want somewhere in Ikoyi" or "I'm coming to Lagos with my partner. Somewhere quiet in Ikoyi with reliable power."
    if (hasIkoyi && !nights) {
      return {
        text: "How many nights will you be staying?",
      };
    }

    if (hasIkoyi && nights && guests) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: "Old Ikoyi",
              checkIn: null,
              nights,
              guests,
            },
          },
        ],
      };
    }

    if (hasLekki && nights && guests) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: "Lekki Phase 1",
              checkIn: null,
              nights,
              guests,
            },
          },
        ],
      };
    }

    if (hasLagos && nights && guests) {
      return {
        toolCalls: [
          {
            id: `call-${crypto.randomUUID()}`,
            name: "search_stays",
            args: {
              city: "Lagos",
              neighbourhood: null,
              checkIn: null,
              nights,
              guests,
            },
          },
        ],
      };
    }

    // Fallback: Clarify
    return {
      text: "I can help you find accommodation in Lagos or Abuja. Where would you like to stay, for how many nights, and for how many guests?",
    };
  }
}

