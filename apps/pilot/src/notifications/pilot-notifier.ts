import { DatabaseSync } from "node:sqlite";
import {
  OPERATOR_RESPONSE_REMINDER_MINUTES,
  SqliteGuestContactRepository,
  SqliteGuestInteractionStore,
  operatorResponseReminderDue,
  projectBookingRequestStatus,
  type DurableBookingRequest,
} from "../../../../domains/shortlet/src/index.js";
import { formatMoney } from "../../../web/src/ui-kit.js";
import { formatStayDates } from "../../../web-agent/src/booking-presentation.js";
import { formatWat } from "../../../local-owner/src/back-office-view.js";
import type { EmailMessage, EmailSender } from "./email-sender.js";

/**
 * Operator and Guest email notifications (launch-readiness issue 23).
 *
 * A sweep reads authoritative state from the pilot database and sends each notification at most once, recorded in
 * `pilot_notifications`. It never writes domain state: request expiry is projected lazily
 * (`projectBookingRequestStatus`), and a send failure only records an attempt, so a notification can never change a
 * booking. Sweeping (rather than hooking each transition) means nothing is lost across restarts and every channel
 * reads the same durable truth (ADR 0077).
 *
 * Delivery for the 30-minute window is already accepted when the request is persisted to the back office
 * (`autoDeliverRequests`, ADR 0043); email is an additional alert, not the delivery channel.
 *
 * Content is minimised (ADR 0075): apartment, dates, party size, amount and deadlines. Never guest names, phone
 * numbers, identity or payment details.
 */

export type NotificationKind =
  | "operator.request_received"
  | "operator.response_reminder"
  | "guest.request_submitted"
  | "guest.offer_made"
  | "guest.payment_confirmed"
  | "guest.request_declined"
  | "guest.request_expired"
  | "guest.request_not_delivered";

export interface PilotNotifierOptions {
  readonly databasePath: string;
  readonly publicOrigin: string;
  readonly sender: EmailSender;
  /** Where Operator alerts go: the people covering the response window (ADR 0042). */
  readonly operatorAlertEmails: readonly string[];
  readonly unitTitle: (unitId: string) => string;
  readonly clock?: () => Date;
  /** Events older than this when first seen are not announced, so a first deploy does not email history. */
  readonly lookbackMs?: number;
  /** Sends that fail this many times are abandoned and stay recorded as failed. */
  readonly maxAttempts?: number;
  readonly log?: (line: string) => void;
}

export interface SweepReport {
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

interface NotificationRecord {
  readonly status: "sent" | "failed" | "skipped";
  readonly attempts: number;
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

class NotificationLog {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
    database.exec(`CREATE TABLE IF NOT EXISTS pilot_notifications (
      notification_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }

  find(key: string): NotificationRecord | null {
    const row = this.#database.prepare("SELECT status, attempts FROM pilot_notifications WHERE notification_key = $key").get({ $key: key }) as { status: string; attempts: number } | undefined;
    if (!row) return null;
    const status = row.status === "sent" || row.status === "skipped" ? row.status : "failed";
    return { status, attempts: row.attempts };
  }

  record(key: string, kind: NotificationKind, status: NotificationRecord["status"], attempts: number, at: Date): void {
    this.#database.prepare(`INSERT INTO pilot_notifications (notification_key, kind, status, attempts, updated_at)
      VALUES ($key, $kind, $status, $attempts, $at)
      ON CONFLICT(notification_key) DO UPDATE SET status = $status, attempts = $attempts, updated_at = $at`)
      .run({ $key: key, $kind: kind, $status: status, $attempts: attempts, $at: at.toISOString() });
  }
}

function allInStayTotalKobo(quoteJson: string): number | null {
  try {
    const quote: unknown = JSON.parse(quoteJson);
    const total = quote !== null && typeof quote === "object" ? (quote as { allInStayTotalKobo?: unknown }).allInStayTotalKobo : undefined;
    return typeof total === "number" && Number.isSafeInteger(total) ? total : null;
  } catch {
    return null;
  }
}

export class PilotNotifier {
  readonly #database: DatabaseSync;
  readonly #store: SqliteGuestInteractionStore;
  readonly #contacts: SqliteGuestContactRepository;
  readonly #log: NotificationLog;
  readonly #options: PilotNotifierOptions;
  readonly #clock: () => Date;
  readonly #lookbackMs: number;
  readonly #maxAttempts: number;
  readonly #writeLog: (line: string) => void;
  #sweeping = false;

  constructor(options: PilotNotifierOptions) {
    this.#options = options;
    this.#database = new DatabaseSync(options.databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#store = new SqliteGuestInteractionStore(options.databasePath, this.#database);
    this.#contacts = new SqliteGuestContactRepository(this.#database);
    this.#log = new NotificationLog(this.#database);
    this.#clock = options.clock ?? (() => new Date());
    this.#lookbackMs = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#writeLog = options.log ?? ((line) => console.error(line));
  }

  close(): void {
    this.#database.close();
  }

  /** One pass over current state. Never throws; overlapping calls return an empty report. */
  async sweep(): Promise<SweepReport> {
    if (this.#sweeping) return { sent: 0, failed: 0, skipped: 0 };
    this.#sweeping = true;
    const report = { sent: 0, failed: 0, skipped: 0 };
    try {
      const now = this.#clock();
      for (const requestId of this.#store.listBookingRequestIds()) {
        const request = this.#store.findBookingRequest(requestId);
        if (request) await this.#requestNotifications(request, now, report);
      }
      for (const offerId of this.#store.listConditionalOfferIds()) {
        const offer = this.#store.findConditionalOffer(offerId);
        const request = offer ? this.#store.findBookingRequest(offer.requestId) : null;
        if (!offer || !request || !this.#recent(offer.issuedAt, now)) continue;
        await this.#notifyGuest(request, "guest.offer_made", `guest.offer_made:${offer.offerId}`, now, report, (title, stay) => ({
          subject: `Your Booking Request was accepted: ${title}`,
          text: [`The owner accepted your Booking Request for ${title} (${stay}).`, "", "Open Shortlet to review the offer and pay. Your dates are not reserved until payment is confirmed.", "", `${this.#origin()}/`].join("\n"),
        }));
      }
      for (const offerId of this.#store.listBookingSnapshotOfferIds()) {
        const snapshot = this.#store.findBookingSnapshotByOfferId(offerId);
        const offer = snapshot ? this.#store.findConditionalOffer(snapshot.offerId) : null;
        const request = offer ? this.#store.findBookingRequest(offer.requestId) : null;
        if (!snapshot || !request || !this.#recent(snapshot.confirmedAt, now)) continue;
        await this.#notifyGuest(request, "guest.payment_confirmed", `guest.payment_confirmed:${snapshot.reservationId}`, now, report, (title, stay) => ({
          subject: `Booking confirmed: ${title}`,
          text: [`Your payment is confirmed and your Reservation for ${title} (${stay}) exists.`, "", "Open Shortlet to see your booking.", "", `${this.#origin()}/`].join("\n"),
        }));
      }
    } catch (error) {
      this.#writeLog(JSON.stringify({ event: "notification_sweep_failed", errorClass: error instanceof Error ? error.constructor.name : typeof error }));
    } finally {
      this.#sweeping = false;
    }
    return report;
  }

  async #requestNotifications(request: DurableBookingRequest, now: Date, report: { sent: number; failed: number; skipped: number }): Promise<void> {
    const status = projectBookingRequestStatus(request, now);
    const title = this.#options.unitTitle(request.unitId);
    const stay = `${formatStayDates(request.checkIn, request.checkOut)}, ${request.nights} ${request.nights === 1 ? "night" : "nights"}`;

    if (status === "disclosed" && request.delivered && this.#recent(request.disclosedAt, now)) {
      const total = allInStayTotalKobo(request.quoteJson);
      const guests = request.occupants.length;
      await this.#notifyOperator("operator.request_received", `operator.request_received:${request.requestId}`, now, report, {
        subject: `New Booking Request: ${title}, respond by ${formatWat(request.operatorResponseDeadlineAt)}`,
        text: [
          `A Guest sent a Booking Request for ${title}.`,
          "",
          `Stay: ${stay}`,
          `Guests: ${guests}`,
          ...(total === null ? [] : [`All-In Stay Total: ${formatMoney(total)}`]),
          `Respond by: ${formatWat(request.operatorResponseDeadlineAt)}`,
          "",
          `${this.#origin()}/operator/requests/${encodeURIComponent(request.requestId)}`,
        ].join("\n"),
      });
      await this.#notifyGuest(request, "guest.request_submitted", `guest.request_submitted:${request.requestId}`, now, report, () => ({
        subject: `Booking Request sent: ${title}`,
        text: [`Your Booking Request for ${title} (${stay}) was sent. No Reservation exists yet; the Operator must respond by ${formatWat(request.operatorResponseDeadlineAt)}.`, "", `${this.#origin()}/`].join("\n"),
      }));
    }

    // ADR 0041: the same reminder offsets the back office shows, measured from the projected deadline.
    const reminder = operatorResponseReminderDue({ status, delivered: request.delivered, operatorResponseDeadlineAt: request.operatorResponseDeadlineAt }, now);
    if (reminder !== null) {
      const last = OPERATOR_RESPONSE_REMINDER_MINUTES[OPERATOR_RESPONSE_REMINDER_MINUTES.length - 1];
      const minutesLeft = Math.max(0, Math.ceil((Date.parse(request.operatorResponseDeadlineAt) - now.getTime()) / 60_000));
      await this.#notifyOperator("operator.response_reminder", `operator.response_reminder:${request.requestId}:${reminder}`, now, report, {
        subject: `${reminder === last ? "Final reminder" : "Reminder"}: ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"} left to answer ${title}`,
        text: [`The Booking Request for ${title} (${stay}) is still waiting for your response.`, "", `Respond by: ${formatWat(request.operatorResponseDeadlineAt)}`, "", `${this.#origin()}/operator/requests/${encodeURIComponent(request.requestId)}`].join("\n"),
      });
    }

    const nothingReserved = "Nothing was reserved and you have not been charged. You can search again on Shortlet.";
    if (status === "declined" && request.declinedAt && this.#recent(request.declinedAt, now)) {
      await this.#notifyGuest(request, "guest.request_declined", `guest.request_declined:${request.requestId}`, now, report, () => ({
        subject: `Booking Request declined: ${title}`,
        text: [`The owner declined your Booking Request for ${title} (${stay}).`, nothingReserved, "", `${this.#origin()}/`].join("\n"),
      }));
    }
    if (status === "expired" && this.#recent(request.operatorResponseDeadlineAt, now)) {
      await this.#notifyGuest(request, "guest.request_expired", `guest.request_expired:${request.requestId}`, now, report, () => ({
        subject: `Booking Request expired: ${title}`,
        text: [`The owner did not respond to your Booking Request for ${title} (${stay}) in time, so it expired.`, nothingReserved, "", `${this.#origin()}/`].join("\n"),
      }));
    }
    // ADR 0043: when no channel accepted delivery, the Guest is told delivery failed and nothing remains reserved.
    if (status === "delivery_failed" && this.#recent(request.deliveryDeadlineAt, now)) {
      await this.#notifyGuest(request, "guest.request_not_delivered", `guest.request_not_delivered:${request.requestId}`, now, report, () => ({
        subject: `Booking Request not delivered: ${title}`,
        text: [`Your Booking Request for ${title} (${stay}) could not be delivered to the owner.`, nothingReserved, "", `${this.#origin()}/`].join("\n"),
      }));
    }
  }

  async #notifyOperator(kind: NotificationKind, key: string, now: Date, report: { sent: number; failed: number; skipped: number }, content: { readonly subject: string; readonly text: string }): Promise<void> {
    if (this.#options.operatorAlertEmails.length === 0) return;
    await this.#deliver(kind, key, now, report, () => ({ to: this.#options.operatorAlertEmails, ...content }));
  }

  async #notifyGuest(
    request: DurableBookingRequest,
    kind: NotificationKind,
    key: string,
    now: Date,
    report: { sent: number; failed: number; skipped: number },
    content: (title: string, stay: string) => { readonly subject: string; readonly text: string },
  ): Promise<void> {
    const title = this.#options.unitTitle(request.unitId);
    const stay = `${formatStayDates(request.checkIn, request.checkOut)}, ${request.nights} ${request.nights === 1 ? "night" : "nights"}`;
    await this.#deliver(kind, key, now, report, () => {
      const email = this.#contacts.find(request.primaryGuestId, request.tenantId)?.contactEmail ?? null;
      return email ? { to: [email], ...content(title, stay) } : null;
    });
  }

  async #deliver(
    kind: NotificationKind,
    key: string,
    now: Date,
    report: { sent: number; failed: number; skipped: number },
    compose: () => Omit<EmailMessage, "idempotencyKey"> | null,
  ): Promise<void> {
    const existing = this.#log.find(key);
    if (existing && (existing.status !== "failed" || existing.attempts >= this.#maxAttempts)) return;
    const message = compose();
    if (!message) {
      // No address to send to (the Guest gave no email); recorded so it is not re-evaluated every sweep.
      this.#log.record(key, kind, "skipped", existing?.attempts ?? 0, now);
      report.skipped++;
      return;
    }
    const attempts = (existing?.attempts ?? 0) + 1;
    try {
      await this.#options.sender.send({ ...message, idempotencyKey: key });
      this.#log.record(key, kind, "sent", attempts, now);
      report.sent++;
    } catch (error) {
      this.#log.record(key, kind, "failed", attempts, now);
      report.failed++;
      const status = (error as { readonly status?: unknown }).status;
      this.#writeLog(JSON.stringify({ event: "notification_failed", kind, attempts, ...(typeof status === "number" ? { providerStatus: status } : {}) }));
    }
  }

  #recent(at: string, now: Date): boolean {
    const time = Date.parse(at);
    return Number.isFinite(time) && now.getTime() - time <= this.#lookbackMs;
  }

  #origin(): string {
    return this.#options.publicOrigin;
  }
}
