/**
 * The card-payment event names, on their own so client-bundled modules (the catalogue manifests) can import them
 * without dragging the server action graph (platform-core, domains/shortlet) into the browser bundle. The action
 * module re-exports them, so existing importers keep working (issue 02 Follow-up C).
 */
export const CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT = "shortlet.card-payment.initialize-checkout";
export const CARD_PAYMENT_VERIFY_RETURN_EVENT = "shortlet.card-payment.verify-return";
