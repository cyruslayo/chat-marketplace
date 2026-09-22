import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import {
  JsonOperatorRepository,
  JsonUnitRepository,
  SqliteOperatorRepresentativeGrantStore,
  SqliteOperatorSessionAuthority,
  createProvisionedOperator,
  importInventoryCsv,
  operatorResolverFromRepository,
  publishUnit,
  type OperatorRecord,
} from "../../../domains/shortlet/src/index.js";

export const LOCAL_PILOT_DIRECTORY = resolve(".scratch/pilot-local");
export const LOCAL_PILOT_DATABASE = join(LOCAL_PILOT_DIRECTORY, "shortlet.sqlite");
export const LOCAL_PILOT_INVENTORY = join(LOCAL_PILOT_DIRECTORY, "inventory.json");
export const LOCAL_PILOT_OPERATORS = join(LOCAL_PILOT_DIRECTORY, "operators.json");
export const LOCAL_PILOT_TENANT_ID = "tenant-local-pilot";
export const LOCAL_PILOT_OPERATOR_ID = "operator-local-pilot";
export const LOCAL_PILOT_ACTOR_ID = "representative-local-pilot";
export const LOCAL_PILOT_OPERATOR_NAME = "Local Pilot Stays Ltd";
export const LOCAL_PILOT_PHOTO_HOST = "https://pilot-local.invalid";

export const LOCAL_PILOT_TIME_ISO = "2026-09-22T10:00:00.000Z";
const BOOTSTRAP_TIME = new Date(LOCAL_PILOT_TIME_ISO);
const GRANT_EXPIRY = "2027-09-22T23:59:59.000Z";

export interface LocalPilotPaths {
  readonly directory: string;
  readonly databasePath: string;
  readonly inventoryPath: string;
  readonly operatorsPath: string;
}

export function localPilotPaths(directory = LOCAL_PILOT_DIRECTORY): LocalPilotPaths {
  const absolute = resolve(directory);
  return {
    directory: absolute,
    databasePath: join(absolute, "shortlet.sqlite"),
    inventoryPath: join(absolute, "inventory.json"),
    operatorsPath: join(absolute, "operators.json"),
  };
}

function initializeLocalPilotClock(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("CREATE TABLE IF NOT EXISTS local_pilot_clock (clock_id INTEGER PRIMARY KEY CHECK (clock_id = 1), real_origin_ms INTEGER NOT NULL, virtual_origin_ms INTEGER NOT NULL)");
    database.prepare("INSERT OR IGNORE INTO local_pilot_clock (clock_id, real_origin_ms, virtual_origin_ms) VALUES (1, $real, $virtual)").run({ $real: Date.now(), $virtual: BOOTSTRAP_TIME.getTime() });
  } finally { database.close(); }
}

export function localPilotClock(paths = localPilotPaths()): () => Date {
  const database = new DatabaseSync(paths.databasePath);
  const row = database.prepare("SELECT real_origin_ms, virtual_origin_ms FROM local_pilot_clock WHERE clock_id = 1").get() as { real_origin_ms?: number; virtual_origin_ms?: number } | undefined;
  database.close();
  if (!row || typeof row.real_origin_ms !== "number" || !Number.isSafeInteger(row.real_origin_ms) || typeof row.virtual_origin_ms !== "number" || !Number.isSafeInteger(row.virtual_origin_ms)) throw new Error("Local pilot clock is not initialized; run npm run pilot:local:bootstrap");
  const realOrigin = row.real_origin_ms;
  const virtualOrigin = row.virtual_origin_ms;
  return () => new Date(virtualOrigin + (Date.now() - realOrigin));
}

function approvedSyntheticOperator(): OperatorRecord {
  return {
    ...createProvisionedOperator({ id: LOCAL_PILOT_OPERATOR_ID, tenantId: LOCAL_PILOT_TENANT_ID, name: LOCAL_PILOT_OPERATOR_NAME, now: BOOTSTRAP_TIME }),
    status: "approved",
    legalForm: "private-company-limited-by-shares",
    cacVerified: true,
    responsiblePersonsVerified: true,
    responsiblePersons: [{ actorId: LOCAL_PILOT_ACTOR_ID, name: "Local Pilot Representative" }],
    beneficialOwnersVerified: true,
    paymentProviderApproved: true,
    settlementAccountVerified: true,
    approvedAt: "2026-09-01T00:00:00.000Z",
    approvalExpiresAt: "2027-09-30T23:59:59.000Z",
  };
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function inventoryCsv(): string {
  const headers = [
    "external_listing_id", "unit_id", "property_id", "operator_id", "title", "city", "neighbourhood", "capacity", "bedrooms",
    "nightly_price_ngn", "mandatory_fees_ngn", "refundable_security_deposit_ngn", "currency", "amenities", "blocked_dates",
    "inspection_status", "inspection_date", "inspection_expiry", "inspection_scope", "inspection_material_change_pending",
    "management_authority_status", "management_authority_date", "management_authority_expiry", "management_authority_permissions",
    "licensing_status", "licensing_date", "licensing_expiry", "insurance_status", "insurance_date", "insurance_expiry",
    "insurance_public_liability_ngn", "insurance_annual_aggregate_ngn", "insurance_property_cover_verified", "cancellation_policy",
    "description", "bathrooms", "photo_urls",
  ];
  const common = {
    operator_id: LOCAL_PILOT_OPERATOR_ID, currency: "NGN", blocked_dates: "", inspection_status: "passed", inspection_date: "2026-09-01",
    inspection_expiry: "2027-09-30", inspection_scope: "entire-place-possession|structure-and-sanitation|fire-and-emergency-readiness|electrical-and-utilities|locks-and-privacy|access-controls|cameras|listing-accuracy|current-media",
    inspection_material_change_pending: "false", management_authority_status: "verified", management_authority_date: "2026-09-01",
    management_authority_expiry: "2027-09-30", management_authority_permissions: "advertise|accept-bookings|contract-guests|provide-access|collect-revenue|manage-cancellations|issue-refunds|manage-incidents",
    licensing_status: "verified", licensing_date: "2026-09-01", licensing_expiry: "2027-09-30", insurance_status: "verified",
    insurance_date: "2026-09-01", insurance_expiry: "2027-09-30", insurance_public_liability_ngn: "10000000",
    insurance_annual_aggregate_ngn: "20000000", insurance_property_cover_verified: "true", cancellation_policy: "standard",
  };
  const rows: Array<Record<string, string | number>> = [
    { ...common, external_listing_id: "local-abuja-wuse-2", unit_id: "unit-local-abuja-wuse2", property_id: "property-local-abuja-wuse2", title: "Sunlit Two-Bedroom Retreat in Wuse 2", city: "Abuja", neighbourhood: "Wuse 2", capacity: 4, bedrooms: 2, nightly_price_ngn: 95000, mandatory_fees_ngn: 12000, refundable_security_deposit_ngn: 0, amenities: "wifi|24_7_power_generator|parking|air_conditioning|security_guard|workspace", description: "A calm, contemporary Entire Place near Wuse 2 dining, with reliable power, a generous lounge, and a dedicated workspace.", bathrooms: 2, photo_urls: `${LOCAL_PILOT_PHOTO_HOST}/photos/wuse-2-living.svg|${LOCAL_PILOT_PHOTO_HOST}/photos/wuse-2-bedroom.svg` },
    { ...common, external_listing_id: "local-lagos-ikoyi", unit_id: "unit-local-lagos-ikoyi", property_id: "property-local-lagos-ikoyi", title: "Garden Two-Bedroom Stay in Old Ikoyi", city: "Lagos", neighbourhood: "Old Ikoyi", capacity: 4, bedrooms: 2, nightly_price_ngn: 125000, mandatory_fees_ngn: 15000, refundable_security_deposit_ngn: 0, amenities: "wifi|24_7_power_generator|parking|air_conditioning|security_guard|swimming_pool", description: "A leafy Old Ikoyi Entire Place with a bright living room, dependable utilities, secure parking, and easy access to central Lagos.", bathrooms: 2, photo_urls: `${LOCAL_PILOT_PHOTO_HOST}/photos/ikoyi-living.svg|${LOCAL_PILOT_PHOTO_HOST}/photos/ikoyi-bedroom.svg` },
  ];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(","))].join("\n");
}

export function bootstrapLocalPilot(paths = localPilotPaths()): { readonly created: boolean; readonly unitIds: readonly string[] } {
  mkdirSync(paths.directory, { recursive: true });
  initializeLocalPilotClock(paths.databasePath);
  const operators = new JsonOperatorRepository(paths.operatorsPath, { clock: () => BOOTSTRAP_TIME });
  if (!operators.findById(LOCAL_PILOT_OPERATOR_ID)) operators.create(approvedSyntheticOperator());
  const units = new JsonUnitRepository(paths.inventoryPath);
  const imported = importInventoryCsv(inventoryCsv(), {
    repository: units,
    operatorResolver: operatorResolverFromRepository(operators),
    tenantId: LOCAL_PILOT_TENANT_ID,
    clock: () => BOOTSTRAP_TIME,
  });
  if (imported.invalid > 0) throw new Error(`Local inventory bootstrap failed: ${imported.errors.map((error) => error.message).join("; ")}`);
  for (const unit of units.findAll()) if (!unit.published) publishUnit(units, unit.id, { clock: () => BOOTSTRAP_TIME });

  const grants = new SqliteOperatorRepresentativeGrantStore(paths.databasePath, { clock: () => BOOTSTRAP_TIME });
  try {
    if (!grants.canActForOperator({ actorId: LOCAL_PILOT_ACTOR_ID, operatorId: LOCAL_PILOT_OPERATOR_ID, tenantId: LOCAL_PILOT_TENANT_ID })) {
      grants.createGrant(createPlatformCommandEnvelope({
        commandName: "operator_representative.grant",
        principal: { id: "admin-local-pilot", role: "admin", tenantId: LOCAL_PILOT_TENANT_ID },
        payload: { actorId: LOCAL_PILOT_ACTOR_ID, operatorId: LOCAL_PILOT_OPERATOR_ID, expiresAtIso: GRANT_EXPIRY, responsiblePersonVerifiedAtIso: BOOTSTRAP_TIME.toISOString(), verificationReference: "local-pilot-synthetic-representative" },
        idempotencyKey: "local-pilot-representative-grant",
      }));
    }
  } finally { grants.close(); }
  return { created: imported.inserted > 0, unitIds: units.findAll().map((unit) => unit.id) };
}

export function issueLocalOperatorToken(paths = localPilotPaths()): string {
  if (!existsSync(paths.databasePath) || !existsSync(paths.operatorsPath)) throw new Error("Local pilot is not bootstrapped; run npm run pilot:local:bootstrap");
  const clock = localPilotClock(paths);
  const grants = new SqliteOperatorRepresentativeGrantStore(paths.databasePath, { clock });
  const authorized = grants.canActForOperator({ actorId: LOCAL_PILOT_ACTOR_ID, operatorId: LOCAL_PILOT_OPERATOR_ID, tenantId: LOCAL_PILOT_TENANT_ID });
  grants.close();
  if (!authorized) throw new Error("Local pilot representative grant is missing or expired");
  const sessions = new SqliteOperatorSessionAuthority(paths.databasePath, { clock });
  try { return sessions.provisionAccessToken({ actorId: LOCAL_PILOT_ACTOR_ID, tenantId: LOCAL_PILOT_TENANT_ID, representativeAuthorized: true }).token; }
  finally { sessions.close(); }
}

export function resetLocalPilot(paths = localPilotPaths()): void {
  const allowed = resolve(LOCAL_PILOT_DIRECTORY);
  if (resolve(paths.directory) !== allowed) throw new Error(`Local pilot reset is restricted to ${allowed}`);
  rmSync(allowed, { recursive: true, force: true });
}

export function assertLocalPilotReady(paths = localPilotPaths()): void {
  for (const path of [paths.databasePath, paths.inventoryPath, paths.operatorsPath]) {
    if (!existsSync(path)) throw new Error("Local pilot is not bootstrapped; run npm run pilot:local:bootstrap");
  }
  JSON.parse(readFileSync(paths.inventoryPath, "utf8"));
}
