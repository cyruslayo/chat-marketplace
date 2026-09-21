import { readFileSync } from "node:fs";
import { getUnitOnboardingStatus } from "./onboarding.js";
import type { Unit } from "./browse.js";
import { normalizePhotoUrls } from "./photo-url.js";

const SUPPORTED_CITIES = new Set(["Lagos", "Abuja"]);
const REQUIRED_HEADERS = [
  "external_listing_id", "unit_id", "property_id", "operator_id", "title", "city", "neighbourhood",
  "capacity", "bedrooms", "nightly_price_ngn", "mandatory_fees_ngn", "refundable_security_deposit_ngn",
  "currency", "amenities", "blocked_dates",
] as const;

export const PILOT_INVENTORY_HEADERS = Object.freeze([
  ...REQUIRED_HEADERS,
  "inspection_status", "inspection_date", "inspection_expiry", "inspection_scope", "inspection_material_change_pending",
  "management_authority_status", "management_authority_date", "management_authority_expiry", "management_authority_permissions",
  "licensing_status", "licensing_date", "licensing_expiry",
  "insurance_status", "insurance_date", "insurance_expiry", "insurance_public_liability_ngn", "insurance_annual_aggregate_ngn", "insurance_property_cover_verified",
  "cancellation_policy",
  "photo_urls",
] as const);

type InventoryHeader = typeof PILOT_INVENTORY_HEADERS[number];

export interface OperatorReference {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface OperatorReferenceResolver {
  findById(id: string): OperatorReference | null;
}

export interface InventoryRepository {
  findAll(): Unit[];
  findById(id: string): Unit | null;
  save(unit: Unit): void;
}

export interface InventoryAuditSink {
  record(entry: Record<string, unknown>): void;
}

export interface InventoryImportError {
  readonly row: number;
  readonly message: string;
}

export interface InventoryImportSummary {
  readonly rowsRead: number;
  readonly valid: number;
  readonly invalid: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly imported: number;
  readonly publicationReady: number;
  readonly unpublishedIneligible: number;
  readonly zeroPhotoListings: number;
  readonly errors: readonly InventoryImportError[];
}

export interface InventoryImportOptions {
  readonly repository: InventoryRepository;
  readonly operatorResolver: OperatorReferenceResolver;
  readonly tenantId?: string;
  readonly dryRun?: boolean;
  readonly clock?: () => Date;
  readonly audit?: InventoryAuditSink;
}

interface CsvRow {
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
}

interface PreparedUnit {
  readonly rowNumber: number;
  readonly unit: Unit;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cell(row: CsvRow, header: string): string {
  return row.values[header]?.trim() ?? "";
}

function parseCsv(contents: string): { readonly headers: readonly string[]; readonly rows: readonly CsvRow[] } {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const pushField = () => {
    fields.push(field);
    field = "";
    closedQuote = false;
  };
  const pushRow = () => {
    if (fields.length > 1 || fields[0] !== "") rows.push(fields);
    fields = [];
  };

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (closedQuote) {
      if (character === ",") {
        pushField();
        continue;
      }
      if (character === "\n" || character === "\r") {
        pushField();
        pushRow();
        if (character === "\r" && contents[index + 1] === "\n") index += 1;
        continue;
      }
      throw new Error("CSV has characters after a closing quote");
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n" || character === "\r") {
      pushField();
      pushRow();
      if (character === "\r" && contents[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  if (field.length > 0 || fields.length > 0) {
    pushField();
    pushRow();
  }
  if (rows.length === 0) throw new Error("CSV is empty");

  const headers = rows[0]!.map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length > 0 || headers.some((header) => header.length === 0)) throw new Error("CSV header contains a blank or duplicate column");
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);

  const parsedRows = rows.slice(1).map((values, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, headerIndex) => { record[header] = values[headerIndex] ?? ""; });
    if (values.length !== headers.length) record.__row_error = `CSV row has ${values.length} columns; expected ${headers.length}`;
    return { rowNumber: index + 2, values: record };
  });
  return { headers, rows: parsedRows };
}

function parseDate(value: string, field: string): string | undefined {
  if (value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} must be a valid date`);
  return value;
}

function parseMoneyKobo(value: string, field: string, required = false): number {
  if (value === "") {
    if (required) throw new Error(`${field} is required`);
    return 0;
  }
  const normalized = value.replace(/^₦\s*/, "").replaceAll(" ", "");
  if (!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`${field} must be a non-negative NGN amount with at most 2 decimal places`);
  const [whole, fraction = ""] = normalized.split(".");
  const wholeDigits = whole!.replaceAll(",", "");
  const kobo = Number(`${wholeDigits}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(kobo)) throw new Error(`${field} is too large`);
  return kobo;
}

function parseInteger(value: string, field: string, minimum: number): number | undefined {
  if (value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${field} must be at least ${minimum}`);
  return parsed;
}

function parseBoolean(value: string, field: string): boolean | undefined {
  if (value === "") return undefined;
  if (value !== "true" && value !== "false") throw new Error(`${field} must be true or false`);
  return value === "true";
}

function splitList(value: string): string[] {
  return value.split("|").map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseBlockedDates(value: string): Array<{ start: string; end: string }> {
  if (value === "") return [];
  return value.split(";").map((range) => {
    const [startValue, endValue, ...extra] = range.split("/").map((item) => item.trim());
    if (!startValue || !endValue || extra.length > 0) throw new Error("blocked_dates must use start/end pairs separated by semicolons");
    const start = parseDate(startValue, "blocked_dates.start");
    const end = parseDate(endValue, "blocked_dates.end");
    if (!start || !end || start >= end) throw new Error("blocked_dates ranges must end after they start");
    return { start, end };
  });
}

function hasAny(row: CsvRow, fields: readonly string[]): boolean {
  return fields.some((field) => cell(row, field) !== "");
}

function claim(row: CsvRow, fields: { readonly status: string; readonly verifiedAt: string; readonly expiresAt: string; readonly id: string }, id: string): Record<string, unknown> | null {
  if (!hasAny(row, [fields.status, fields.verifiedAt, fields.expiresAt])) return null;
  const status = cell(row, fields.status);
  const verifiedAt = parseDate(cell(row, fields.verifiedAt), fields.verifiedAt);
  const expiresAt = parseDate(cell(row, fields.expiresAt), fields.expiresAt);
  return {
    id: `${fields.id}-${id}`,
    status: status || undefined,
    verifiedAt,
    expiresAt,
  };
}

function buildUnit(row: CsvRow, operator: OperatorReference): Unit {
  const unitId = cell(row, "unit_id");
  const inspection = hasAny(row, ["inspection_status", "inspection_date", "inspection_expiry", "inspection_scope", "inspection_material_change_pending"])
    ? {
      id: `inspection-import-${unitId}`,
      status: cell(row, "inspection_status") || undefined,
      inspectedAt: parseDate(cell(row, "inspection_date"), "inspection_date"),
      expiresAt: parseDate(cell(row, "inspection_expiry"), "inspection_expiry"),
      materialChangePending: parseBoolean(cell(row, "inspection_material_change_pending"), "inspection_material_change_pending"),
      scope: splitList(cell(row, "inspection_scope")),
    }
    : null;
  const authority = claim(row, { status: "management_authority_status", verifiedAt: "management_authority_date", expiresAt: "management_authority_expiry", id: "authority-import" }, unitId);
  if (authority) authority.propertyId = cell(row, "property_id");
  if (authority) authority.permissions = splitList(cell(row, "management_authority_permissions"));
  const licensing = claim(row, { status: "licensing_status", verifiedAt: "licensing_date", expiresAt: "licensing_expiry", id: "licensing-import" }, unitId);
  const insurance = claim(row, { status: "insurance_status", verifiedAt: "insurance_date", expiresAt: "insurance_expiry", id: "insurance-import" }, unitId);
  if (insurance) {
    insurance.publicLiabilityPerOccurrenceKobo = parseMoneyKobo(cell(row, "insurance_public_liability_ngn"), "insurance_public_liability_ngn");
    insurance.annualAggregateKobo = parseMoneyKobo(cell(row, "insurance_annual_aggregate_ngn"), "insurance_annual_aggregate_ngn");
    insurance.propertyCoverVerified = parseBoolean(cell(row, "insurance_property_cover_verified"), "insurance_property_cover_verified");
  }

  const cancellationPolicy = cell(row, "cancellation_policy");
  if (cancellationPolicy !== "" && !["flexible", "standard", "firm"].includes(cancellationPolicy)) {
    throw new Error("cancellation_policy must be flexible, standard, or firm");
  }
  const bedrooms = parseInteger(cell(row, "bedrooms"), "bedrooms", 0);
  const photoUrls = normalizePhotoUrls(splitList(cell(row, "photo_urls")));
  const priceVersion = `inventory-import-${unitId}`;
  return {
    id: unitId,
    externalListingId: cell(row, "external_listing_id"),
    propertyId: cell(row, "property_id"),
    title: cell(row, "title"),
    location: { city: cell(row, "city"), neighbourhood: cell(row, "neighbourhood") },
    occupancyModel: "entire-place",
    capacity: parseInteger(cell(row, "capacity"), "capacity", 1) ?? (() => { throw new Error("capacity is required"); })(),
    ...(bedrooms === undefined ? {} : { bedrooms }),
    amenities: splitList(cell(row, "amenities")),
    photoUrls,
    published: false,
    price: {
      nightlyKobo: parseMoneyKobo(cell(row, "nightly_price_ngn"), "nightly_price_ngn", true),
      mandatoryFeesKobo: parseMoneyKobo(cell(row, "mandatory_fees_ngn"), "mandatory_fees_ngn"),
      refundableSecurityDepositKobo: parseMoneyKobo(cell(row, "refundable_security_deposit_ngn"), "refundable_security_deposit_ngn", true),
      version: priceVersion,
    },
    operator,
    inspection,
    managementAuthority: authority,
    regulatory: (licensing || insurance) ? { licensing, insurance } : null,
    blockedDates: parseBlockedDates(cell(row, "blocked_dates")),
    ...(cancellationPolicy === "" ? {} : { cancellationPolicy: { type: cancellationPolicy, version: "cancellation-v1" } }),
  };
}

function validateRow(row: CsvRow, options: InventoryImportOptions): PreparedUnit {
  if (row.values.__row_error) throw new Error(row.values.__row_error);
  const unitId = cell(row, "unit_id");
  if (unitId === "") throw new Error("unit_id is required");
  if (cell(row, "external_listing_id") === "") throw new Error("external_listing_id is required");
  if (cell(row, "property_id") === "") throw new Error("property_id is required");
  if (cell(row, "operator_id") === "") throw new Error("operator_id is required");
  if (cell(row, "title") === "") throw new Error("title is required");
  if (cell(row, "city") === "") throw new Error("city is required");
  if (!SUPPORTED_CITIES.has(cell(row, "city"))) throw new Error("city must be Lagos or Abuja");
  if (cell(row, "neighbourhood") === "") throw new Error("neighbourhood is required");
  if (cell(row, "currency") !== "NGN") throw new Error("currency must be NGN");

  const operatorId = cell(row, "operator_id");
  const resolved = options.operatorResolver.findById(operatorId);
  if (!resolved || resolved.id !== operatorId) throw new Error(`Operator ${operatorId} was not found in the authoritative Operator records`);
  // ADR-0010/0065: an inventory row cannot cross the authoritative Operator tenant boundary.
  if (options.tenantId !== undefined && resolved.tenantId !== options.tenantId) {
    throw new Error(`Operator ${operatorId} does not belong to tenant ${options.tenantId}`);
  }

  const existingById = options.repository.findById(unitId);
  const existingByExternalId = options.repository.findAll().find((unit) => unit.externalListingId === cell(row, "external_listing_id"));
  if (existingByExternalId && existingByExternalId.id !== unitId) throw new Error(`external_listing_id already belongs to Unit ${existingByExternalId.id}`);
  const unit = buildUnit(row, resolved);
  const current = existingById ?? existingByExternalId;
  if (current?.operator?.id && current.operator.id !== resolved.id) throw new Error("operator_id cannot change for an existing Unit");
  return { rowNumber: row.rowNumber, unit: { ...unit, published: current?.published === true } };
}

export function operatorResolverFromUnitRepository(repository: { findAll(): Unit[] }): OperatorReferenceResolver {
  return {
    findById(id: string): OperatorReference | null {
      const found = repository.findAll().find((unit) => {
        const operator = asObject(unit.operator);
        return operator?.id === id;
      });
      const operator = asObject(found?.operator);
      return operator && typeof operator.id === "string" ? operator as OperatorReference : null;
    },
  };
}

export function operatorResolverFromRepository(repository: { findById(id: string): { readonly id: string } | null }): OperatorReferenceResolver {
  return {
    findById(id: string): OperatorReference | null {
      const operator = repository.findById(id);
      return operator ? { ...operator } as OperatorReference : null;
    },
  };
}

export function importInventoryCsv(contents: string, options: InventoryImportOptions): InventoryImportSummary {
  const parsed = parseCsv(contents);
  const errors: InventoryImportError[] = [];
  const prepared: PreparedUnit[] = [];
  let publicationReady = 0;
  let unpublishedIneligible = 0;
  let zeroPhotoListings = 0;
  const clock = options.clock ?? (() => new Date());

  for (const row of parsed.rows) {
    try {
      const candidate = validateRow(row, options);
      const readiness = getUnitOnboardingStatus(candidate.unit, clock());
      if (readiness.eligibleForPublication) publicationReady += 1;
      else unpublishedIneligible += 1;
      if (candidate.unit.photoUrls.length === 0) zeroPhotoListings += 1;
      prepared.push(candidate);
    } catch (error) {
      errors.push({ row: row.rowNumber, message: error instanceof Error ? error.message : "row validation failed" });
    }
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  if (!options.dryRun) {
    for (const preparedUnit of prepared) {
      const existing = options.repository.findById(preparedUnit.unit.id);
      const readiness = getUnitOnboardingStatus(preparedUnit.unit, clock());
      const toSave = { ...preparedUnit.unit, published: existing?.published === true && readiness.eligibleForPublication };
      if (!existing) {
        options.repository.save(toSave);
        inserted += 1;
        options.audit?.record({ type: "unit.imported", unitId: toSave.id, row: preparedUnit.rowNumber });
      } else if (JSON.stringify(existing) === JSON.stringify(toSave)) {
        unchanged += 1;
      } else {
        options.repository.save(toSave);
        updated += 1;
        options.audit?.record({ type: "unit.updated", unitId: toSave.id, row: preparedUnit.rowNumber });
      }
    }
  }

  return Object.freeze({
    rowsRead: parsed.rows.length,
    valid: prepared.length,
    invalid: errors.length,
    inserted,
    updated,
    unchanged,
    imported: inserted + updated,
    publicationReady,
    unpublishedIneligible,
    zeroPhotoListings,
    errors: Object.freeze(errors),
  });
}

export function importInventoryFile(filePath: string, options: InventoryImportOptions): InventoryImportSummary {
  return importInventoryCsv(readFileSync(filePath, "utf8"), options);
}

export type { InventoryHeader };
