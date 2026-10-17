import { createBasicCatalogV091Registration, createWeaverRuntime, type A2UIServerMessage } from "@cylayo/weaver-core";
import { SHORTLET_BOOKING_CATALOG, SHORTLET_DISCOVERY_CATALOG } from "./shortlet-catalogs.js";

/** Validate a complete server message sequence using the same catalogue set as the guest runtime. */
export function validateShortletMessages(messages: readonly A2UIServerMessage[]) {
  const created = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration(), SHORTLET_DISCOVERY_CATALOG, SHORTLET_BOOKING_CATALOG] });
  if (!created.ok) return { ok: false as const, failedMessageIndex: 0, error: created.error };
  for (let index = 0; index < messages.length; index += 1) {
    const result = created.value.process(messages[index]);
    if (!result.ok) return { ok: false as const, failedMessageIndex: index, error: result.error };
  }
  return { ok: true as const };
}
