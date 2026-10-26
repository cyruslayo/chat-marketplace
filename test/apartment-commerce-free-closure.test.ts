import assert from "node:assert/strict";
import test from "node:test";
import { importClosure, importsOf } from "./helpers/import-closure.js";

/**
 * The apartment boundary (ADR 0099, ADR 0100 decision 1, ADR 0104 decision 6). A host that ships apartment code must not
 * have any domains/commerce file in its runtime-and-type import closure: the commerce domain is composed only by a
 * composition root that injects it (guest-server takes the commerce module as an option, default none).
 *
 * Exempt: apps/cloudflare/src/worker.ts re-exports CommerceMarket (worker.ts line 6), the Durable Object class that ADR 0101
 * and ADR 0104 decision 5 keep. Its closure still contains domains/commerce; the sanity test below pins that, so removing the
 * exception is noticed. The dev demo (ADR 0104 decision 4) is a composition root that may keep commerce on; it may reach
 * domains/commerce only through the one composition file.
 */

const COMMERCE_DOMAIN = "domains/commerce/";
const DEV_COMMERCE_COMPOSITION = "apps/local-guest/src/commerce-module-local.ts";
const commerceFilesIn = (entry: string) => importClosure(entry).filter((file) => file.startsWith(COMMERCE_DOMAIN));

test("the Shortlet Durable Object's runtime-and-type closure contains no domains/commerce file", () => {
  assert.deepEqual(commerceFilesIn("apps/cloudflare/src/shortlet-pilot-do.ts"), []);
});

test("the guest server's runtime-and-type closure contains no domains/commerce file", () => {
  assert.deepEqual(commerceFilesIn("apps/local-guest/src/guest-server.ts"), []);
});

test("the Node pilot host (apps/pilot/src/cli-start.ts) runtime-and-type closure contains no domains/commerce file", () => {
  assert.deepEqual(commerceFilesIn("apps/pilot/src/cli-start.ts"), []);
});

test("the local pilot host (apps/pilot/src/cli-local-start.ts) runtime-and-type closure contains no domains/commerce file", () => {
  assert.deepEqual(commerceFilesIn("apps/pilot/src/cli-local-start.ts"), []);
});

test("the dev demo (apps/local-guest/src/cli-start.ts) reaches domains/commerce only through the commerce composition files", () => {
  const closure = importClosure("apps/local-guest/src/cli-start.ts");
  // Files inside domains/commerce import each other; only the files outside the domain that reach into it count.
  const directImporters = closure.filter((file) => !file.startsWith(COMMERCE_DOMAIN) && importsOf(file).some((target) => target.startsWith(COMMERCE_DOMAIN)));
  assert.ok(directImporters.includes(DEV_COMMERCE_COMPOSITION), "the composition root injects the module from commerce-module-local.ts");
  assert.deepEqual(directImporters.filter((file) => !file.startsWith("apps/local-guest/src/commerce-")), []);
});

test("sanity: the commerce object's closure still contains domains/commerce, so the scanner sees commerce", () => {
  assert.ok(commerceFilesIn("apps/cloudflare/src/commerce-market-do.ts").length > 0);
});

test("the documented Worker exception: the Worker's closure still contains domains/commerce through the CommerceMarket re-export", () => {
  assert.ok(importsOf("apps/cloudflare/src/worker.ts").includes("apps/cloudflare/src/commerce-market-do.ts"));
  assert.ok(commerceFilesIn("apps/cloudflare/src/worker.ts").length > 0);
});
