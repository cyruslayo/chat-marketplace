export class InstagramChannelAdapter {
  #repository;
  #baseUrl;

  constructor({ repository, baseUrl = "https://shortlet.platform" } = {}) {
    this.#repository = repository;
    this.#baseUrl = baseUrl;
  }

  projectToInstagram(unit) {
    if (!unit) throw new Error("Unit is required for Instagram projection");

    return Object.freeze({
      channel: "instagram",
      unitId: unit.id,
      title: unit.title,
      neighbourhood: unit.location.neighbourhood,
      city: unit.location.city,
      capacity: unit.capacity,
      pricingSummary: Object.freeze({
        nightlyKobo: unit.price.nightlyKobo,
        currency: "NGN"
      }),
      actions: Object.freeze([
        Object.freeze({
          type: "get_web_referral_link",
          label: "Continue booking on secure web",
          targetUrl: `${this.#baseUrl}/stays/${unit.id}`
        })
      ])
    });
  }

  generateSecureReferralLink({ unitId, searchContext = {} }) {
    const token = `ref-${crypto.randomUUID()}`;
    const referralUrl = `${this.#baseUrl}/stays/${unitId}?ref=${token}`;

    return Object.freeze({
      referralUrl,
      token,
      requiresNewAuthSession: true,
      context: Object.freeze({
        unitId,
        ...searchContext
      })
    });
  }

  handleInstagramMessage(messagePayload = {}) {
    return Object.freeze({
      channel: "instagram",
      createsBookingState: false,
      authoritativeAction: null,
      replyText: "Instagram does not support direct bookings or financial transactions. Please use our secure web link to complete your request."
    });
  }

  executeAction({ intent, payload }) {
    const prohibitedIntents = new Set([
      "create_booking_request",
      "pay_reservation",
      "verify_identity",
      "cancel_booking",
      "request_remedy",
      "request_exact_address",
      "operator_payout"
    ]);

    if (prohibitedIntents.has(intent)) {
      throw new Error(`Prohibited completion path: Instagram does not support transactional or restricted actions (${intent})`);
    }

    if (intent === "get_web_referral_link") {
      return this.generateSecureReferralLink(payload ?? {});
    }

    throw new Error(`Unsupported Instagram intent: ${intent}`);
  }
}
