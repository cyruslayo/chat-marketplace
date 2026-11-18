import { defineCatalogueManifest } from "../../../packages/surface-kit/src/index.js";
import { PROBE_CARD } from "./probe-card.js";

/**
 * Test-only manifest (surface-catalogue-library issue 02). The id is in the `test` namespace and is never registered in
 * production. `ProbeStayCard` narrows the `badge` slot away; `ProbeOtherCard` keeps every slot optional.
 */
export const PROBE_CATALOGUE_ID = "urn:chat-marketplace:test/probe/v1";
export const PROBE_ACTION_NAME = "probe_open";

export const PROBE_MANIFEST = defineCatalogueManifest({
  id: PROBE_CATALOGUE_ID,
  owner: "test",
  base: "basic/v0.9.1",
  components: {
    ProbeStayCard: { component: PROBE_CARD, major: 1, slots: { badge: "absent" } },
    ProbeOtherCard: { component: PROBE_CARD, major: 1 },
  },
  actions: [PROBE_ACTION_NAME],
});
