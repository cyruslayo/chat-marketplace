import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";

test("AC1: npm run test:workers runs the harness spec in workerd and passes", async () => {
  const stub = env.TEST_HARNESS.get(env.TEST_HARNESS.idFromName("sql-proof"));
  const result = await runInDurableObject(stub, (_instance, ctx) =>
    ctx.storage.sql.exec<{ value: number }>("SELECT 1 AS value").one(),
  );
  expect(result).toEqual({ value: 1 });
});
