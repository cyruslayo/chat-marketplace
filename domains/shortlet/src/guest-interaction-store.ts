import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

/**
 * Durable Guest booking interaction store (ADR-0070/0071/0074/0075/0079).
 *
 * The Guest composition previously kept its threads, browser session bindings,
 * drafts, booking requests, offers, checkout sessions and payment idempotency
 * records in process memory, so a process restart lost the active journey.
 *
 * This store keeps only the durable interaction projection and workflow
 * correlation needed to restore a journey server-side after restart:
 *
 *  - browser session bindings (opaque id, salted hash of the session secret,
 *    principal and tenant) so a restart can re-authenticate the same Guest
 *    without ever persisting the bearer session cookie,
 *  - thread state (identity, timeline projection, discovery correlation, the
 *    authoritative domain aggregate ids it references, and the current surface
 *    stage) so a restart can re-derive the current projection,
 *  - the authoritative domain records that must survive restart (Request
 *    Drafts, Booking Requests, Conditional Booking Offers, checkout sessions,
 *    Live Payment Attempts and processed PSP references).
 *
 * The store never persists bearer session cookies (only a salted hash), PSP
 * checkout URLs, payment credentials, card details, OTP values, raw identity
 * evidence, protected access data or raw risk material. The thread row only
 * references domain aggregates by opaque id; each aggregate has its own table
 * because no other durable repository owns it in this composition.
 */
export interface DurableGuestSessionBinding {
  readonly sessionId: string;
  readonly sessionSecretHash: string;
  readonly principalId: string;
  readonly tenantId: string;
}

export interface DurableGuestThreadRecord {
  readonly threadId: string;
  readonly principalId: string;
  readonly tenantId: string;
  /**
   * The full server-owned interaction projection that restoration needs:
   * timeline, workflow aggregate ids, active stage, discovery correlation and
   * the draft quote facts. A2UI messages and model history are never stored.
   */
  readonly threadJson: string;
}

export interface DurableBookingRequestDraft {
  readonly draftId: string;
  readonly unitId: string;
  readonly primaryGuestId: string;
  readonly primaryGuestName: string;
  readonly occupants: readonly string[];
  readonly selfBookingAttestationAccepted: boolean;
  readonly selfBookingAttestationVersion: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly createdAt: string;
}

export interface DurableBookingRequest {
  readonly requestId: string;
  readonly draftId: string;
  readonly unitId: string;
  readonly tenantId: string;
  readonly operatorId: string | null;
  readonly primaryGuestId: string;
  readonly primaryGuestName: string;
  readonly occupants: readonly string[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly quoteJson: string;
  readonly inventoryCommitmentId: string;
  readonly disclosedAt: string;
  readonly deliveryDeadlineAt: string;
  readonly operatorResponseDeadlineAt: string;
  readonly delivered: boolean;
  readonly deliveredAt: string | null;
  readonly status: string;
  readonly confirmedAt: string | null;
  readonly declinedAt: string | null;
  readonly declineReason: string | null;
  readonly phoneNumber: string | null;
}

export interface DurableConditionalOffer {
  readonly offerId: string;
  readonly requestId: string;
  readonly inventoryCommitmentId: string;
  readonly unitId: string;
  readonly tenantId: string;
  readonly offerJson: string;
  readonly status: string;
  readonly issuedAt: string;
  readonly acceptedAt: string | null;
  readonly tokenUsed: boolean;
  readonly offerVersion: number;
}

export interface DurableCardCheckoutSession {
  readonly checkoutId: string;
  readonly offerId: string;
  readonly pspReference: string;
  readonly totalAmountDueNowKobo: number;
  readonly amountKobo: number;
  readonly purpose: "stay" | "security_deposit";
  readonly currency: "NGN";
  readonly contactEmail: string;
  readonly providerEnvironment?: "test" | "live";
  readonly expiresAt: string;
  readonly status: "initiated" | "completed" | "expired" | "failed";
}

export interface DurableLivePaymentAttempt {
  readonly attemptId: string;
  readonly offerId: string;
  readonly method: string;
  readonly purpose: "stay" | "security_deposit";
  readonly status: "active" | "terminal";
  readonly startedAt: string;
  readonly expiresAt: string;
}

export interface DurableProcessedPspReference {
  readonly pspReference: string;
  readonly reservationId: string;
  readonly contractId: string;
  readonly offerId: string;
  readonly tenantId: string | null;
}

/**
 * Compact authoritative booking state snapshot for one confirmed booking.
 * The authoritative domain repository (BookingStateRepository) is rehydrated
 * from this at composition construction after a restart; no command is re-run.
 */
export interface DurableBookingSnapshot {
  readonly reservationId: string;
  readonly contractId: string;
  readonly offerId: string;
  readonly reservationJson: string;
  readonly contractJson: string;
  readonly confirmedAt: string;
}

/**
 * Compact payment-journey state for an offer that reached the stay-settled /
 * deposit-required / processing / confirmed boundary.
 */
export interface DurablePaymentJourneySnapshot {
  readonly offerId: string;
  readonly journeyJson: string;
  readonly journeyVersion: number;
  readonly stage: string;
  readonly updatedAt: string;
}

/** Deterministic projection of the recorded session secret into an opaque stored hash. */
export function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(`guest-session-v1:${secret}`).digest("hex");
}

interface ThreadRow {
  thread_id: string;
  principal_id: string;
  tenant_id: string;
  thread_json: string;
}

interface BookingRequestDraftRow {
  draft_id: string;
  unit_id: string;
  primary_guest_id: string;
  primary_guest_name: string;
  occupants_json: string;
  self_booking_attestation_accepted: number;
  self_booking_attestation_version: string;
  check_in: string;
  check_out: string;
  created_at: string;
}

interface BookingRequestRow {
  request_id: string;
  draft_id: string;
  unit_id: string;
  tenant_id: string;
  operator_id: string | null;
  primary_guest_id: string;
  primary_guest_name: string;
  occupants_json: string;
  check_in: string;
  check_out: string;
  nights: number;
  quote_json: string;
  inventory_commitment_id: string;
  disclosed_at: string;
  delivery_deadline_at: string;
  operator_response_deadline_at: string;
  delivered: number;
  delivered_at: string | null;
  status: string;
  confirmed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  phone_number: string | null;
}

interface ConditionalOfferRow {
  offer_id: string;
  request_id: string;
  inventory_commitment_id: string;
  unit_id: string;
  tenant_id: string;
  offer_json: string;
  status: string;
  issued_at: string;
  accepted_at: string | null;
  token_used: number;
  offer_version: number;
}

interface CardCheckoutSessionRow {
  checkout_id: string;
  offer_id: string;
  psp_reference: string;
  total_amount_due_now_kobo: number;
  amount_kobo: number;
  purpose: string;
  currency: string;
  contact_email: string | null;
  provider_environment: string | null;
  expires_at: string;
  status: string;
}

interface LivePaymentAttemptRow {
  attempt_id: string;
  offer_id: string;
  method: string;
  purpose: string;
  status: string;
  started_at: string;
  expires_at: string;
}

interface ProcessedPspReferenceRow {
  psp_reference: string;
  reservation_id: string;
  contract_id: string;
  offer_id: string;
  tenant_id: string | null;
}

interface BookingSnapshotRow {
  reservation_id: string;
  contract_id: string;
  offer_id: string;
  reservation_json: string;
  contract_json: string;
  confirmed_at: string;
}

interface PaymentJourneySnapshotRow {
  offer_id: string;
  journey_json: string;
  journey_version: number;
  stage: string;
  updated_at: string;
}

function parseNames(json: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? Object.freeze(parsed.filter((name): name is string => typeof name === "string")) : [];
  } catch {
    return [];
  }
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function parseBoolean(value: number): boolean {
  return value === 1;
}

function requiredPurpose(value: unknown): "stay" | "security_deposit" {
  return value === "security_deposit" ? "security_deposit" : "stay";
}

export class SqliteGuestInteractionStore {
  readonly databasePath: string;
  #database: DatabaseSync;
  #closed = false;
  readonly #ownsDatabase: boolean;

  constructor(databasePath: string, database?: DatabaseSync) {
    this.databasePath = databasePath;
    this.#database = database ?? new DatabaseSync(databasePath);
    this.#ownsDatabase = database === undefined;
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS guest_session_bindings (
        session_id TEXT PRIMARY KEY,
        session_secret_hash TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_sessions_principal
        ON guest_session_bindings (principal_id, tenant_id);

      CREATE TABLE IF NOT EXISTS guest_threads (
        thread_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        thread_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_threads_principal
        ON guest_threads (principal_id, tenant_id);

      CREATE TABLE IF NOT EXISTS guest_request_drafts (
        draft_id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        primary_guest_id TEXT NOT NULL,
        primary_guest_name TEXT NOT NULL,
        occupants_json TEXT NOT NULL,
        self_booking_attestation_accepted INTEGER NOT NULL,
        self_booking_attestation_version TEXT NOT NULL,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guest_booking_requests (
        request_id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        operator_id TEXT,
        primary_guest_id TEXT NOT NULL,
        primary_guest_name TEXT NOT NULL,
        occupants_json TEXT NOT NULL,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        nights INTEGER NOT NULL,
        quote_json TEXT NOT NULL,
        inventory_commitment_id TEXT NOT NULL,
        disclosed_at TEXT NOT NULL,
        delivery_deadline_at TEXT NOT NULL,
        operator_response_deadline_at TEXT NOT NULL,
        delivered INTEGER NOT NULL,
        delivered_at TEXT,
        status TEXT NOT NULL,
        confirmed_at TEXT,
        declined_at TEXT,
        decline_reason TEXT,
        phone_number TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_guest_requests_principal
        ON guest_booking_requests (primary_guest_id, tenant_id);

      CREATE TABLE IF NOT EXISTS guest_conditional_offers (
        offer_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        inventory_commitment_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        offer_json TEXT NOT NULL,
        status TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        accepted_at TEXT,
        token_used INTEGER NOT NULL,
        offer_version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_offers_request
        ON guest_conditional_offers (request_id);

      CREATE TABLE IF NOT EXISTS guest_checkout_sessions (
        checkout_id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL,
        psp_reference TEXT NOT NULL,
        total_amount_due_now_kobo INTEGER NOT NULL,
        amount_kobo INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        currency TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        provider_environment TEXT,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_sessions_offer
        ON guest_checkout_sessions (offer_id);
      CREATE INDEX IF NOT EXISTS idx_guest_sessions_reference
        ON guest_checkout_sessions (psp_reference);

      CREATE TABLE IF NOT EXISTS guest_live_payment_attempts (
        attempt_id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL,
        method TEXT NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_attempts_offer
        ON guest_live_payment_attempts (offer_id);

      CREATE TABLE IF NOT EXISTS guest_processed_psp_references (
        psp_reference TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        tenant_id TEXT
      );

      CREATE TABLE IF NOT EXISTS guest_booking_snapshots (
        reservation_id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        reservation_json TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        confirmed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_booking_snapshots_offer
        ON guest_booking_snapshots (offer_id);

      CREATE TABLE IF NOT EXISTS guest_payment_journey_snapshots (
        offer_id TEXT PRIMARY KEY,
        journey_json TEXT NOT NULL,
        journey_version INTEGER NOT NULL,
        stage TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const requestColumns = this.#database.prepare("PRAGMA table_info(guest_booking_requests)").all() as unknown as { name: string }[];
    if (!requestColumns.some((column) => column.name === "phone_number")) this.#database.exec("ALTER TABLE guest_booking_requests ADD COLUMN phone_number TEXT");
    const checkoutColumns = this.#database.prepare("PRAGMA table_info(guest_checkout_sessions)").all() as unknown as { name: string }[];
    if (!checkoutColumns.some((column) => column.name === "contact_email")) this.#database.exec("ALTER TABLE guest_checkout_sessions ADD COLUMN contact_email TEXT");
    if (!checkoutColumns.some((column) => column.name === "provider_environment")) this.#database.exec("ALTER TABLE guest_checkout_sessions ADD COLUMN provider_environment TEXT");
  }

  #transaction<T>(operation: () => T): T {
    if (this.#database.isTransaction) return operation();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        /* preserve the original failure */
      }
      throw error;
    }
  }

  // --- Browser session bindings ---

  saveSessionBinding(binding: DurableGuestSessionBinding): void {
    this.#database.prepare(`
      INSERT INTO guest_session_bindings (session_id, session_secret_hash, principal_id, tenant_id)
      VALUES ($sessionId, $hash, $principalId, $tenantId)
      ON CONFLICT(session_id) DO UPDATE SET
        session_secret_hash = excluded.session_secret_hash,
        principal_id = excluded.principal_id,
        tenant_id = excluded.tenant_id
    `).run({ $sessionId: binding.sessionId, $hash: binding.sessionSecretHash, $principalId: binding.principalId, $tenantId: binding.tenantId });
  }

  findSessionBinding(sessionId: string): DurableGuestSessionBinding | null {
    const row = this.#database.prepare("SELECT * FROM guest_session_bindings WHERE session_id = $sessionId").get({ $sessionId: sessionId }) as
      | { session_id: string; session_secret_hash: string; principal_id: string; tenant_id: string }
      | undefined;
    if (!row) return null;
    return Object.freeze({ sessionId: row.session_id, sessionSecretHash: row.session_secret_hash, principalId: row.principal_id, tenantId: row.tenant_id });
  }

  listSessionBindingIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT session_id FROM guest_session_bindings").all() as unknown as { session_id: string }[];
    return Object.freeze(rows.map((row) => row.session_id));
  }

  // --- Threads ---

  saveThread(thread: DurableGuestThreadRecord): void {
    this.#database.prepare(`
      INSERT INTO guest_threads (thread_id, principal_id, tenant_id, thread_json)
      VALUES ($threadId, $principalId, $tenantId, $threadJson)
      ON CONFLICT(thread_id) DO UPDATE SET
        principal_id = excluded.principal_id,
        tenant_id = excluded.tenant_id,
        thread_json = excluded.thread_json
    `).run({
      $threadId: thread.threadId,
      $principalId: thread.principalId,
      $tenantId: thread.tenantId,
      $threadJson: thread.threadJson,
    });
  }

  findThread(threadId: string): DurableGuestThreadRecord | null {
    const row = this.#database.prepare("SELECT * FROM guest_threads WHERE thread_id = $threadId").get({ $threadId: threadId }) as ThreadRow | undefined;
    if (!row) return null;
    return Object.freeze({
      threadId: row.thread_id,
      principalId: row.principal_id,
      tenantId: row.tenant_id,
      threadJson: row.thread_json,
    });
  }

  findThreadsForPrincipal(principalId: string, tenantId: string): DurableGuestThreadRecord[] {
    const rows = this.#database.prepare("SELECT * FROM guest_threads WHERE principal_id = $principalId AND tenant_id = $tenantId").all({ $principalId: principalId, $tenantId: tenantId }) as unknown as ThreadRow[];
    return rows.map((row) => Object.freeze({
      threadId: row.thread_id,
      principalId: row.principal_id,
      tenantId: row.tenant_id,
      threadJson: row.thread_json,
    }));
  }

  // --- Request Drafts ---

  listDraftIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT draft_id FROM guest_request_drafts").all() as unknown as { draft_id: string }[];
    return Object.freeze(rows.map((row) => row.draft_id));
  }

  saveDraft(draft: DurableBookingRequestDraft): void {
    this.#database.prepare(`
      INSERT INTO guest_request_drafts (
        draft_id, unit_id, primary_guest_id, primary_guest_name, occupants_json,
        self_booking_attestation_accepted, self_booking_attestation_version,
        check_in, check_out, created_at)
      VALUES ($draftId, $unitId, $primaryGuestId, $primaryGuestName, $occupantsJson,
        $selfBookingAttestationAccepted, $selfBookingAttestationVersion,
        $checkIn, $checkOut, $createdAt)
      ON CONFLICT(draft_id) DO UPDATE SET
        unit_id = excluded.unit_id,
        primary_guest_id = excluded.primary_guest_id,
        primary_guest_name = excluded.primary_guest_name,
        occupants_json = excluded.occupants_json,
        self_booking_attestation_accepted = excluded.self_booking_attestation_accepted,
        self_booking_attestation_version = excluded.self_booking_attestation_version,
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        created_at = excluded.created_at
    `).run({
      $draftId: draft.draftId,
      $unitId: draft.unitId,
      $primaryGuestId: draft.primaryGuestId,
      $primaryGuestName: draft.primaryGuestName,
      $occupantsJson: JSON.stringify(draft.occupants),
      $selfBookingAttestationAccepted: boolToInt(draft.selfBookingAttestationAccepted),
      $selfBookingAttestationVersion: draft.selfBookingAttestationVersion,
      $checkIn: draft.checkIn,
      $checkOut: draft.checkOut,
      $createdAt: draft.createdAt,
    });
  }

  findDraft(draftId: string): DurableBookingRequestDraft | null {
    const row = this.#database.prepare("SELECT * FROM guest_request_drafts WHERE draft_id = $draftId").get({ $draftId: draftId }) as BookingRequestDraftRow | undefined;
    if (!row) return null;
    return Object.freeze({
      draftId: row.draft_id,
      unitId: row.unit_id,
      primaryGuestId: row.primary_guest_id,
      primaryGuestName: row.primary_guest_name,
      occupants: parseNames(row.occupants_json),
      selfBookingAttestationAccepted: parseBoolean(row.self_booking_attestation_accepted),
      selfBookingAttestationVersion: row.self_booking_attestation_version,
      checkIn: row.check_in,
      checkOut: row.check_out,
      createdAt: row.created_at,
    });
  }

  // --- Booking Requests ---

  listBookingRequestIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT request_id FROM guest_booking_requests").all() as unknown as { request_id: string }[];
    return Object.freeze(rows.map((row) => row.request_id));
  }

  saveBookingRequest(request: DurableBookingRequest): void {
    this.#database.prepare(`
      INSERT INTO guest_booking_requests (
        request_id, draft_id, unit_id, tenant_id, operator_id, primary_guest_id,
        primary_guest_name, occupants_json, check_in, check_out, nights, quote_json,
        inventory_commitment_id, disclosed_at, delivery_deadline_at,
        operator_response_deadline_at, delivered, delivered_at, status, confirmed_at,
        declined_at, decline_reason, phone_number)
      VALUES ($requestId, $draftId, $unitId, $tenantId, $operatorId, $primaryGuestId,
        $primaryGuestName, $occupantsJson, $checkIn, $checkOut, $nights, $quoteJson,
        $inventoryCommitmentId, $disclosedAt, $deliveryDeadlineAt,
        $operatorResponseDeadlineAt, $delivered, $deliveredAt, $status, $confirmedAt,
        $declinedAt, $declineReason, $phoneNumber)
      ON CONFLICT(request_id) DO UPDATE SET
        draft_id = excluded.draft_id,
        unit_id = excluded.unit_id,
        tenant_id = excluded.tenant_id,
        operator_id = excluded.operator_id,
        primary_guest_id = excluded.primary_guest_id,
        primary_guest_name = excluded.primary_guest_name,
        occupants_json = excluded.occupants_json,
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        nights = excluded.nights,
        quote_json = excluded.quote_json,
        inventory_commitment_id = excluded.inventory_commitment_id,
        disclosed_at = excluded.disclosed_at,
        delivery_deadline_at = excluded.delivery_deadline_at,
        operator_response_deadline_at = excluded.operator_response_deadline_at,
        delivered = excluded.delivered,
        delivered_at = excluded.delivered_at,
        status = excluded.status,
        confirmed_at = excluded.confirmed_at,
        declined_at = excluded.declined_at,
        decline_reason = excluded.decline_reason,
        phone_number = excluded.phone_number
    `).run({
      $requestId: request.requestId,
      $draftId: request.draftId,
      $unitId: request.unitId,
      $tenantId: request.tenantId,
      $operatorId: request.operatorId ?? null,
      $primaryGuestId: request.primaryGuestId,
      $primaryGuestName: request.primaryGuestName,
      $occupantsJson: JSON.stringify(request.occupants),
      $checkIn: request.checkIn,
      $checkOut: request.checkOut,
      $nights: request.nights,
      $quoteJson: request.quoteJson,
      $inventoryCommitmentId: request.inventoryCommitmentId,
      $disclosedAt: request.disclosedAt,
      $deliveryDeadlineAt: request.deliveryDeadlineAt,
      $operatorResponseDeadlineAt: request.operatorResponseDeadlineAt,
      $delivered: boolToInt(request.delivered),
      $deliveredAt: request.deliveredAt ?? null,
      $status: request.status,
      $confirmedAt: request.confirmedAt ?? null,
      $declinedAt: request.declinedAt ?? null,
      $declineReason: request.declineReason ?? null,
      $phoneNumber: request.phoneNumber,
    });
  }

  findBookingRequest(requestId: string): DurableBookingRequest | null {
    const row = this.#database.prepare("SELECT * FROM guest_booking_requests WHERE request_id = $requestId").get({ $requestId: requestId }) as BookingRequestRow | undefined;
    if (!row) return null;
    return Object.freeze({
      requestId: row.request_id,
      draftId: row.draft_id,
      unitId: row.unit_id,
      tenantId: row.tenant_id,
      operatorId: row.operator_id,
      primaryGuestId: row.primary_guest_id,
      primaryGuestName: row.primary_guest_name,
      occupants: parseNames(row.occupants_json),
      checkIn: row.check_in,
      checkOut: row.check_out,
      nights: row.nights,
      quoteJson: row.quote_json,
      inventoryCommitmentId: row.inventory_commitment_id,
      disclosedAt: row.disclosed_at,
      deliveryDeadlineAt: row.delivery_deadline_at,
      operatorResponseDeadlineAt: row.operator_response_deadline_at,
      delivered: parseBoolean(row.delivered),
      deliveredAt: row.delivered_at,
      status: row.status,
      confirmedAt: row.confirmed_at,
      declinedAt: row.declined_at,
      declineReason: row.decline_reason,
      phoneNumber: row.phone_number,
    });
  }

  // --- Conditional Booking Offers ---

  listConditionalOfferIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT offer_id FROM guest_conditional_offers").all() as unknown as { offer_id: string }[];
    return Object.freeze(rows.map((row) => row.offer_id));
  }

  findConditionalOfferByRequestId(requestId: string): DurableConditionalOffer | null {
    const row = this.#database.prepare("SELECT * FROM guest_conditional_offers WHERE request_id = $requestId LIMIT 1").get({ $requestId: requestId }) as ConditionalOfferRow | undefined;
    if (!row) return null;
    return this.findConditionalOffer(row.offer_id);
  }

  saveConditionalOffer(offer: DurableConditionalOffer): void {
    this.#database.prepare(`
      INSERT INTO guest_conditional_offers (
        offer_id, request_id, inventory_commitment_id, unit_id, tenant_id, offer_json,
        status, issued_at, accepted_at, token_used, offer_version)
      VALUES ($offerId, $requestId, $inventoryCommitmentId, $unitId, $tenantId, $offerJson,
        $status, $issuedAt, $acceptedAt, $tokenUsed, $offerVersion)
      ON CONFLICT(offer_id) DO UPDATE SET
        request_id = excluded.request_id,
        inventory_commitment_id = excluded.inventory_commitment_id,
        unit_id = excluded.unit_id,
        tenant_id = excluded.tenant_id,
        offer_json = excluded.offer_json,
        status = excluded.status,
        issued_at = excluded.issued_at,
        accepted_at = excluded.accepted_at,
        token_used = excluded.token_used,
        offer_version = excluded.offer_version
    `).run({
      $offerId: offer.offerId,
      $requestId: offer.requestId,
      $inventoryCommitmentId: offer.inventoryCommitmentId,
      $unitId: offer.unitId,
      $tenantId: offer.tenantId,
      $offerJson: offer.offerJson,
      $status: offer.status,
      $issuedAt: offer.issuedAt,
      $acceptedAt: offer.acceptedAt ?? null,
      $tokenUsed: boolToInt(offer.tokenUsed),
      $offerVersion: offer.offerVersion,
    });
  }

  findConditionalOffer(offerId: string): DurableConditionalOffer | null {
    const row = this.#database.prepare("SELECT * FROM guest_conditional_offers WHERE offer_id = $offerId").get({ $offerId: offerId }) as ConditionalOfferRow | undefined;
    if (!row) return null;
    return Object.freeze({
      offerId: row.offer_id,
      requestId: row.request_id,
      inventoryCommitmentId: row.inventory_commitment_id,
      unitId: row.unit_id,
      tenantId: row.tenant_id,
      offerJson: row.offer_json,
      status: row.status,
      issuedAt: row.issued_at,
      acceptedAt: row.accepted_at,
      tokenUsed: parseBoolean(row.token_used),
      offerVersion: row.offer_version,
    });
  }

  // --- Checkout sessions ---

  listCheckoutSessionIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT checkout_id FROM guest_checkout_sessions").all() as unknown as { checkout_id: string }[];
    return Object.freeze(rows.map((row) => row.checkout_id));
  }

  saveCheckoutSession(session: DurableCardCheckoutSession): void {
    this.#database.prepare(`
      INSERT INTO guest_checkout_sessions (
        checkout_id, offer_id, psp_reference, total_amount_due_now_kobo,
        amount_kobo, purpose, currency, contact_email, provider_environment, expires_at, status)
      VALUES ($checkoutId, $offerId, $pspReference, $totalAmountDueNowKobo,
        $amountKobo, $purpose, $currency, $contactEmail, $providerEnvironment, $expiresAt, $status)
      ON CONFLICT(checkout_id) DO UPDATE SET
        offer_id = excluded.offer_id,
        psp_reference = excluded.psp_reference,
        total_amount_due_now_kobo = excluded.total_amount_due_now_kobo,
        amount_kobo = excluded.amount_kobo,
        purpose = excluded.purpose,
        currency = excluded.currency,
        contact_email = excluded.contact_email,
        provider_environment = excluded.provider_environment,
        expires_at = excluded.expires_at,
        status = excluded.status
    `).run({
      $checkoutId: session.checkoutId,
      $offerId: session.offerId,
      $pspReference: session.pspReference,
      $totalAmountDueNowKobo: session.totalAmountDueNowKobo,
      $amountKobo: session.amountKobo,
      $purpose: session.purpose,
      $currency: session.currency,
      $contactEmail: session.contactEmail,
      $providerEnvironment: session.providerEnvironment ?? null,
      $expiresAt: session.expiresAt,
      $status: session.status,
    });
  }

  findCheckoutSession(checkoutId: string): DurableCardCheckoutSession | null {
    const row = this.#database.prepare("SELECT * FROM guest_checkout_sessions WHERE checkout_id = $checkoutId").get({ $checkoutId: checkoutId }) as CardCheckoutSessionRow | undefined;
    if (!row) return null;
    return Object.freeze({
      checkoutId: row.checkout_id,
      offerId: row.offer_id,
      pspReference: row.psp_reference,
      totalAmountDueNowKobo: row.total_amount_due_now_kobo,
      amountKobo: row.amount_kobo,
      purpose: requiredPurpose(row.purpose),
      currency: "NGN",
      contactEmail: row.contact_email ?? "",
      ...(row.provider_environment === "test" || row.provider_environment === "live" ? { providerEnvironment: row.provider_environment } : {}),
      expiresAt: row.expires_at,
      status: row.status === "completed" ? "completed" : row.status === "expired" ? "expired" : row.status === "failed" ? "failed" : "initiated",
    });
  }

  findCheckoutSessionByOfferId(offerId: string): DurableCardCheckoutSession | null {
    const row = this.#database.prepare("SELECT * FROM guest_checkout_sessions WHERE offer_id = $offerId").get({ $offerId: offerId }) as CardCheckoutSessionRow | undefined;
    return row ? this.findCheckoutSession(row.checkout_id) : null;
  }

  findCheckoutSessionByReference(pspReference: string): DurableCardCheckoutSession | null {
    const row = this.#database.prepare("SELECT * FROM guest_checkout_sessions WHERE psp_reference = $pspReference").get({ $pspReference: pspReference }) as CardCheckoutSessionRow | undefined;
    return row ? this.findCheckoutSession(row.checkout_id) : null;
  }

  // --- Live Payment Attempts ---

  saveLivePaymentAttempt(attempt: DurableLivePaymentAttempt): void {
    this.#database.prepare(`
      INSERT INTO guest_live_payment_attempts (
        attempt_id, offer_id, method, purpose, status, started_at, expires_at)
      VALUES ($attemptId, $offerId, $method, $purpose, $status, $startedAt, $expiresAt)
      ON CONFLICT(attempt_id) DO UPDATE SET
        offer_id = excluded.offer_id,
        method = excluded.method,
        purpose = excluded.purpose,
        status = excluded.status,
        started_at = excluded.started_at,
        expires_at = excluded.expires_at
    `).run({
      $attemptId: attempt.attemptId,
      $offerId: attempt.offerId,
      $method: attempt.method,
      $purpose: attempt.purpose,
      $status: attempt.status,
      $startedAt: attempt.startedAt,
      $expiresAt: attempt.expiresAt,
    });
  }

  findLivePaymentAttempt(attemptId: string): DurableLivePaymentAttempt | null {
    const row = this.#database.prepare("SELECT * FROM guest_live_payment_attempts WHERE attempt_id = $attemptId").get({ $attemptId: attemptId }) as LivePaymentAttemptRow | undefined;
    if (!row) return null;
    return Object.freeze({
      attemptId: row.attempt_id,
      offerId: row.offer_id,
      method: row.method,
      purpose: requiredPurpose(row.purpose),
      status: row.status === "terminal" ? "terminal" : "active",
      startedAt: row.started_at,
      expiresAt: row.expires_at,
    });
  }

  findLivePaymentAttemptByOfferId(offerId: string): DurableLivePaymentAttempt | null {
    const row = this.#database.prepare("SELECT * FROM guest_live_payment_attempts WHERE offer_id = $offerId").get({ $offerId: offerId }) as LivePaymentAttemptRow | undefined;
    return row ? this.findLivePaymentAttempt(row.attempt_id) : null;
  }

  listLivePaymentAttemptOfferIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT DISTINCT offer_id FROM guest_live_payment_attempts").all() as unknown as { offer_id: string }[];
    return Object.freeze(rows.map((row) => row.offer_id));
  }

  // --- Processed PSP references ---

  saveProcessedPspReference(reference: DurableProcessedPspReference): void {
    this.#database.prepare(`
      INSERT INTO guest_processed_psp_references (
        psp_reference, reservation_id, contract_id, offer_id, tenant_id)
      VALUES ($pspReference, $reservationId, $contractId, $offerId, $tenantId)
      ON CONFLICT(psp_reference) DO UPDATE SET
        reservation_id = excluded.reservation_id,
        contract_id = excluded.contract_id,
        offer_id = excluded.offer_id,
        tenant_id = excluded.tenant_id
    `).run({
      $pspReference: reference.pspReference,
      $reservationId: reference.reservationId,
      $contractId: reference.contractId,
      $offerId: reference.offerId,
      $tenantId: reference.tenantId ?? null,
    });
  }

  findProcessedPspReference(pspReference: string): DurableProcessedPspReference | null {
    const row = this.#database.prepare("SELECT * FROM guest_processed_psp_references WHERE psp_reference = $pspReference").get({ $pspReference: pspReference }) as ProcessedPspReferenceRow | undefined;
    if (!row) return null;
    return Object.freeze({
      pspReference: row.psp_reference,
      reservationId: row.reservation_id,
      contractId: row.contract_id,
      offerId: row.offer_id,
      tenantId: row.tenant_id,
    });
  }

  listProcessedPspReferenceIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT psp_reference FROM guest_processed_psp_references").all() as unknown as { psp_reference: string }[];
    return Object.freeze(rows.map((row) => row.psp_reference));
  }

  listBookingSnapshotOfferIds(): readonly string[] {
    const rows = this.#database.prepare("SELECT offer_id FROM guest_booking_snapshots").all() as unknown as { offer_id: string }[];
    return Object.freeze(rows.map((row) => row.offer_id));
  }

  close(): void {
    if (!this.#closed) {
      if (this.#ownsDatabase) this.#database.close();
      this.#closed = true;
    }
  }

  // --- Booking snapshots ---

  saveBookingSnapshot(snapshot: DurableBookingSnapshot): void {
    this.#database.prepare(`
      INSERT INTO guest_booking_snapshots (
        reservation_id, contract_id, offer_id, reservation_json, contract_json, confirmed_at)
      VALUES ($reservationId, $contractId, $offerId, $reservationJson, $contractJson, $confirmedAt)
      ON CONFLICT(reservation_id) DO UPDATE SET
        contract_id = excluded.contract_id,
        offer_id = excluded.offer_id,
        reservation_json = excluded.reservation_json,
        contract_json = excluded.contract_json,
        confirmed_at = excluded.confirmed_at
    `).run({
      $reservationId: snapshot.reservationId,
      $contractId: snapshot.contractId,
      $offerId: snapshot.offerId,
      $reservationJson: snapshot.reservationJson,
      $contractJson: snapshot.contractJson,
      $confirmedAt: snapshot.confirmedAt,
    });
  }

  findBookingSnapshotByOfferId(offerId: string): DurableBookingSnapshot | null {
    const row = this.#database.prepare("SELECT * FROM guest_booking_snapshots WHERE offer_id = $offerId").get({ $offerId: offerId }) as BookingSnapshotRow | undefined;
    if (!row) return null;
    return Object.freeze({
      reservationId: row.reservation_id,
      contractId: row.contract_id,
      offerId: row.offer_id,
      reservationJson: row.reservation_json,
      contractJson: row.contract_json,
      confirmedAt: row.confirmed_at,
    });
  }

  findBookingSnapshotByReservationId(reservationId: string): DurableBookingSnapshot | null {
    const row = this.#database.prepare("SELECT * FROM guest_booking_snapshots WHERE reservation_id = $reservationId").get({ $reservationId: reservationId }) as BookingSnapshotRow | undefined;
    if (!row) return null;
    return Object.freeze({
      reservationId: row.reservation_id,
      contractId: row.contract_id,
      offerId: row.offer_id,
      reservationJson: row.reservation_json,
      contractJson: row.contract_json,
      confirmedAt: row.confirmed_at,
    });
  }

  // --- Payment journey snapshots ---

  savePaymentJourneySnapshot(snapshot: DurablePaymentJourneySnapshot): void {
    this.#database.prepare(`
      INSERT INTO guest_payment_journey_snapshots (
        offer_id, journey_json, journey_version, stage, updated_at)
      VALUES ($offerId, $journeyJson, $journeyVersion, $stage, $updatedAt)
      ON CONFLICT(offer_id) DO UPDATE SET
        journey_json = excluded.journey_json,
        journey_version = excluded.journey_version,
        stage = excluded.stage,
        updated_at = excluded.updated_at
    `).run({
      $offerId: snapshot.offerId,
      $journeyJson: snapshot.journeyJson,
      $journeyVersion: snapshot.journeyVersion,
      $stage: snapshot.stage,
      $updatedAt: snapshot.updatedAt,
    });
  }

  findPaymentJourneySnapshot(offerId: string): DurablePaymentJourneySnapshot | null {
    const row = this.#database.prepare("SELECT * FROM guest_payment_journey_snapshots WHERE offer_id = $offerId").get({ $offerId: offerId }) as PaymentJourneySnapshotRow | undefined;
    if (!row) return null;
    return Object.freeze({
      offerId: row.offer_id,
      journeyJson: row.journey_json,
      journeyVersion: row.journey_version,
      stage: row.stage,
      updatedAt: row.updated_at,
    });
  }
}
