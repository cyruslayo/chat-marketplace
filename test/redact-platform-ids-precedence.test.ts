import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSensitiveDataRedactor, redactSensitiveData } from "../packages/platform-core/src/redaction.js";

// ADR 0075 & Issue 50. Sensitive keys must win over the platform-id exemption. The production table has no sensitive
// id key, so this file drives the same redactor factory with a policy in which one key is both sensitive and tabled.

const requestId = `req-${randomUUID()}`;

test("A key present in both sensitiveKeys and the platform-id table is masked even when its value is a valid platform id", () => {
  const redact = createSensitiveDataRedactor({
    sensitiveKeys: new Set(["requestId"]),
    platformIdPrefixesByKey: { requestId: ["req"] }
  });
  assert.deepEqual(redact({ requestId }), { requestId: "[REDACTED]" });
});

test("A key present only in the platform-id table keeps the exemption for a valid platform id", () => {
  const redact = createSensitiveDataRedactor({
    sensitiveKeys: new Set(["token"]),
    platformIdPrefixesByKey: { requestId: ["req"] }
  });
  assert.deepEqual(redact({ requestId }), { requestId });
});

test("The production policy masks a sensitive key ahead of the exemption for the same key shape", () => {
  assert.deepEqual(redactSensitiveData({ confirmationToken: requestId }), { confirmationToken: "[REDACTED]" });
});
