/**
 * The conditional-offer event name, on its own so client-bundled modules (the catalogue manifests) can import it
 * without dragging the server action graph (platform-core, domains/shortlet) into the browser bundle. The action
 * module re-exports it, so existing importers keep working (issue 02 Follow-up C).
 */
export const CONDITIONAL_OFFER_ACCEPT_EVENT = "shortlet.conditional-offer.accept";
