/**
 * Demo-launch issue 05 (ADR 0105 staging demo; ADR 0095: inventory only through the authenticated /_ops routes;
 * ADR 0075: the shared secret is never printed, logged or written).
 *
 * Imports the synthetic demo operator and then each demo unit through /_ops. Idempotent: the operator is upserted by
 * id and each unit is upserted by unit_id, so a second run updates the same eight units. The origin is substituted
 * into the photo URLs at provision time. Only https origins are accepted, plus loopback http for local tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateOperatorRecord, type OperatorRecord } from "../domains/shortlet/src/index.js";

export const DEMO_PLACEHOLDER_ORIGIN = "https://demo-origin.invalid";
export const DEMO_TENANT_ID = "tenant-staging";
const OPS_SECRET_HEADER = "x-shortlet-ops-secret";
const DEMO_CAC_PATTERN = /^RC-DEMO-\d{4}$/;

export interface DemoOperatorRow {
  readonly id: string;
  readonly operator: OperatorRecord;
}

export interface DemoProvisionOptions {
  readonly origin: string;
  readonly secret: string;
  readonly accessClientId?: string;
  readonly accessClientSecret?: string;
  readonly demoDirectory: string;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

export interface DemoProvisionResult {
  readonly ok: boolean;
  readonly operators: number;
  readonly units: number;
  readonly error?: string;
}

/** Splits a demo CSV into its non-empty lines. The demo files carry no quoted fields or embedded line breaks. */
export function demoInventoryLines(csv: string): string[] {
  return csv.split(/\r?\n/).filter((line) => line.trim() !== "");
}

function csvRows(csv: string): Array<Record<string, string>> {
  const [headerLine, ...lines] = demoInventoryLines(csv);
  if (headerLine === undefined) throw new Error("demo CSV is empty");
  const headers = headerLine.split(",");
  return lines.map((line, index) => {
    const values = line.split(",");
    if (values.length !== headers.length) throw new Error(`demo CSV row ${index + 1} has ${values.length} fields; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]!.trim()]));
  });
}

/** Replaces the placeholder origin in every photo URL with the provisioning origin. */
export function substituteDemoOrigin(value: string, origin: string): string {
  return value.replaceAll(DEMO_PLACEHOLDER_ORIGIN, origin.replace(/\/$/, ""));
}

/** Builds the validated Operator records from operators.csv. The CAC marker is checked, and it is not stored. */
export function demoOperatorRecords(csv: string): DemoOperatorRow[] {
  return csvRows(csv).map((row) => {
    const cac = row.cac_reference ?? "";
    if (!DEMO_CAC_PATTERN.test(cac)) throw new Error("demo operator CAC reference must be a synthetic RC-DEMO number");
    const record = validateOperatorRecord({
      id: row.operator_id,
      tenantId: row.tenant_id,
      name: row.name,
      status: row.status,
      createdAt: row.approved_at,
      updatedAt: row.approved_at,
      legalForm: row.legal_form,
      cacVerified: row.cac_verified === "true",
      responsiblePersonsVerified: row.responsible_persons_verified === "true",
      responsiblePersons: [{ actorId: row.responsible_person_actor_id }],
      beneficialOwnersVerified: row.beneficial_owners_verified === "true",
      paymentProviderApproved: row.payment_provider_approved === "true",
      settlementAccountVerified: row.settlement_account_verified === "true",
      approvedAt: row.approved_at,
      approvalExpiresAt: row.approval_expires_at,
    });
    return { id: record.id, operator: record };
  });
}

/** Only https origins, and loopback http for local tests; a bare origin with no path. */
export function assertDemoOriginAllowed(origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("--origin must be an absolute URL");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) throw new Error("--origin must use HTTPS");
  if ((parsed.pathname !== "" && parsed.pathname !== "/") || parsed.search !== "" || parsed.hash !== "") throw new Error("--origin must be an origin with no path");
  return parsed;
}

function opsHeaders(options: DemoProvisionOptions, contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    [OPS_SECRET_HEADER]: options.secret,
    ...(options.accessClientId ? { "cf-access-client-id": options.accessClientId } : {}),
    ...(options.accessClientSecret ? { "cf-access-client-secret": options.accessClientSecret } : {}),
  };
}

/**
 * Imports the operator, then each demo unit through the demo route, which publishes it. Stops at the first refusal, so
 * a refused request never leaves a partial import behind for the following steps. Error text never echoes a response body.
 */
export async function provisionDemo(options: DemoProvisionOptions): Promise<DemoProvisionResult> {
  const log = options.log ?? (() => {});
  const fetchFn = options.fetch ?? fetch;
  if (options.secret === "") return { ok: false, operators: 0, units: 0, error: "OPS_SHARED_SECRET is not set; nothing was imported" };
  let origin: string;
  try {
    origin = assertDemoOriginAllowed(options.origin).origin;
  } catch (error) {
    return { ok: false, operators: 0, units: 0, error: error instanceof Error ? error.message : "invalid origin" };
  }

  const operatorsCsv = readFileSync(join(options.demoDirectory, "operators.csv"), "utf8");
  const inventoryCsv = substituteDemoOrigin(readFileSync(join(options.demoDirectory, "inventory.csv"), "utf8"), origin);
  const operators = demoOperatorRecords(operatorsCsv);

  const operatorBody = JSON.stringify({ table: "operators", rows: operators.map((row) => ({ id: row.id, operator_json: JSON.stringify(row.operator) })) });
  const operatorResponse = await fetchFn(`${origin}/_ops/import`, { method: "POST", headers: opsHeaders(options, "application/json"), body: operatorBody });
  if (!operatorResponse.ok) return { ok: false, operators: 0, units: 0, error: `operator import was refused with HTTP ${operatorResponse.status}; nothing else was imported` };
  log(`Operators imported: ${operators.length}`);

  const [header, ...rows] = demoInventoryLines(inventoryCsv);
  let units = 0;
  for (const row of rows) {
    const response = await fetchFn(`${origin}/_ops/demo/inventory/import`, { method: "POST", headers: opsHeaders(options, "text/csv"), body: `${header}\n${row}\n` });
    const body = (await response.json().catch(() => ({}))) as { ok?: unknown; published?: unknown; unitId?: unknown };
    if (!response.ok || body.ok !== true || body.published !== true) {
      return { ok: false, operators: operators.length, units, error: `unit import was refused with HTTP ${response.status}; ${units} of ${rows.length} units were imported` };
    }
    units += 1;
  }
  log(`Units published: ${units}`);
  return { ok: true, operators: operators.length, units };
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const origin = argValue(args, "--origin");
  if (!origin) {
    console.error("Usage: npm run demo:provision -- --origin https://<staging-origin>");
    process.exitCode = 2;
    return;
  }
  const result = await provisionDemo({
    origin,
    secret: process.env.OPS_SHARED_SECRET?.trim() ?? "",
    accessClientId: process.env.CF_ACCESS_CLIENT_ID?.trim() || undefined,
    accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET?.trim() || undefined,
    demoDirectory: join(process.cwd(), "apps/cloudflare/demo"),
    log: (line) => console.log(line),
  });
  if (!result.ok) {
    console.error(result.error ?? "Demo provisioning failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
