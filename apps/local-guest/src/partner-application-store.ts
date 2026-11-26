import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import {
  PARTNER_CONSENT_TEXT,
  type PartnerApplication,
} from "./partner-application.js";

/**
 * Founding partner applications (landing issue 17). Personal data about people who are not guests or Operators yet: it is in
 * the daily export like the other personal-data tables, it is never logged (ADR 0075), and it is collected only while a
 * privacy notice is configured (ADR 0095). Applied by the schema migrations and by this store's constructor.
 */
export const PARTNER_APPLICATION_SCHEMA = `CREATE TABLE IF NOT EXISTS partner_applications (
      application_id TEXT PRIMARY KEY,
      submission_key TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      area TEXT NOT NULL,
      unit_range TEXT NOT NULL,
      stay_lengths TEXT NOT NULL,
      booking_today TEXT,
      consent_text TEXT NOT NULL,
      privacy_notice_url TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    )`;

export interface PartnerApplicationSubmission {
  readonly application: PartnerApplication;
  /** Identifies one sending of one form, so a double press or a reload stores one row. */
  readonly submissionKey: string;
  /** Null when no privacy notice was configured; stored as an empty string. */
  readonly privacyNoticeUrl: string | null;
}

export interface PartnerApplicationStore {
  /** True when a row was added, false when this submission is already stored. Throws when it cannot be saved. */
  save(submission: PartnerApplicationSubmission): boolean;
}

export class SqlitePartnerApplicationStore implements PartnerApplicationStore {
  readonly #database: SqlDatabase;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(
    database: SqlDatabase,
    options: {
      readonly clock: () => Date;
      readonly newId: () => string;
    },
  ) {
    this.#database = database;
    this.#clock = options.clock;
    this.#newId = options.newId;
    database.exec(PARTNER_APPLICATION_SCHEMA);
  }

  save(submission: PartnerApplicationSubmission): boolean {
    const { application } = submission;
    const result = this.#database
      .prepare(
        `INSERT INTO partner_applications (application_id, submission_key, full_name, business_name, phone, email, area,
          unit_range, stay_lengths, booking_today, consent_text, privacy_notice_url, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (submission_key) DO NOTHING`,
      )
      .run([
        this.#newId(),
        submission.submissionKey,
        application.fullName,
        application.business,
        application.phone,
        application.email,
        application.area,
        application.units,
        application.stays.join(","),
        application.how === "" ? null : application.how,
        PARTNER_CONSENT_TEXT,
        submission.privacyNoticeUrl ?? "",
        this.#clock().toISOString(),
      ]);
    return result.changes > 0;
  }
}
