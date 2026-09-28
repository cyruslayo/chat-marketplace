/**
 * Outbound email for pilot notifications (launch-readiness issue 23). Resend is the pilot provider; the sender is an
 * interface so tests and a later provider swap never touch the notifier (ADR 0068).
 */
export interface EmailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  /** Stable per notification, so a retry after an ambiguous failure cannot send twice. */
  readonly idempotencyKey: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Carries only the HTTP status, never provider prose or message content (ADR 0075). */
export class EmailProviderError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? "Email provider could not be reached" : `Email provider returned HTTP ${status}`);
    this.status = status;
  }
}

export const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 10_000;

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export class ResendEmailSender implements EmailSender {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: FetchFunction;

  constructor(config: { readonly apiKey: string; readonly from: string; readonly fetch?: FetchFunction }) {
    if (!config.apiKey.trim()) throw new Error("RESEND_API_KEY is required for ResendEmailSender");
    if (!config.from.trim()) throw new Error("SHORTLET_NOTIFICATION_FROM is required for ResendEmailSender");
    this.#apiKey = config.apiKey.trim();
    this.#from = config.from.trim();
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async send(message: EmailMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({ from: this.#from, to: message.to, subject: message.subject, text: message.text }),
        signal: controller.signal,
      });
    } catch {
      throw new EmailProviderError(null);
    } finally {
      clearTimeout(timer);
    }
    // Drain the body; its content (the provider's id or error text) is not needed.
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) throw new EmailProviderError(response.status);
  }
}
