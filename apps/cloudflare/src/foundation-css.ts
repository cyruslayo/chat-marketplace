// Slice 09a's serving decision (recorded in issues/09a), importable from apps/cloudflare/src (slice 09b):
// the foundations CSS enters the Durable Object as build-time text, never through a Wrangler Text-module rule.
// The static asset copy in apps/cloudflare/public/ serves the CSS route before the DO is reached (09b).
import foundationsCss from "../../../apps/web/src/shortlet-foundations.css?raw";

/** The exact foundations stylesheet text; ADR 0081 keeps it byte-identical to the Node-served asset. */
export const SHORTLET_FOUNDATIONS_CSS: string = foundationsCss;
