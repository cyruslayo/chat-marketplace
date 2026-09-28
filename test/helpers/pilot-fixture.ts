import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { loadPilotConfiguration } from "../../apps/pilot/src/pilot-config.js";
import type { PaystackClient, Unit } from "../../domains/shortlet/src/index.js";

export const PUBLIC_ORIGIN = "https://pilot.example.com";

export interface ProductionFixture {
  readonly directory: string;
  readonly configuration: ReturnType<typeof loadPilotConfiguration>;
  readonly paystack: PaystackClient;
}

/** Persistent pilot files for one fixture Unit and its Operator, plus a provider-shaped Paystack fake. */
export async function productionFixture(options: { readonly noDeposit?: boolean; readonly environment?: Readonly<Record<string, string>> } = {}): Promise<ProductionFixture> {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-pilot-composition-"));
  const source = new LocalGuestEnvironment({ databasePath: join(directory, "source.sqlite") });
  const units = source.unitRepository.findAll() as Unit[];
  source.close();
  const unit = options.noDeposit
    ? { ...units[0]!, price: { ...units[0]!.price, refundableSecurityDepositKobo: 0 } }
    : units[0]!;
  const operator = {
    id: unit.operator.id,
    tenantId: "tenant-pilot",
    name: unit.operator.name,
    status: unit.operator.status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const inventoryPath = join(directory, "inventory.json");
  const operatorsPath = join(directory, "operators.json");
  await writeFile(inventoryPath, JSON.stringify([unit]), "utf8");
  await writeFile(operatorsPath, JSON.stringify([operator]), "utf8");
  const configuration = loadPilotConfiguration({
    SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    SHORTLET_DB_PATH: join(directory, "pilot.sqlite"),
    SHORTLET_INVENTORY_PATH: inventoryPath,
    SHORTLET_OPERATORS_PATH: operatorsPath,
    PAYSTACK_SECRET_KEY: "sk_live_test-only",
    PAYSTACK_ENVIRONMENT: "live",
    ...options.environment,
  });
  const paystack: PaystackClient = {
    configuration: { environment: configuration.paystack.environment, callbackBaseUrl: PUBLIC_ORIGIN },
    initializeTransaction: async () => { throw new Error("Paystack network is not part of this test"); },
    verifyTransaction: async () => { throw new Error("Paystack network is not part of this test"); },
    verifyWebhookSignature: () => false,
  };
  return { directory, configuration, paystack };
}

/** The `name=value` part of a response's Set-Cookie header. */
export function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Expected a Set-Cookie header");
  return value.split(";", 1)[0]!;
}

/** An arrival date the deterministic concierge understands, one week out. */
export function arrivalNextWeek(): string {
  return new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}
