import type { AssetLoader, AssetName } from "../../../packages/platform-core/src/asset-loader.js";
import { SHORTLET_FOUNDATIONS_CSS } from "./foundation-css.js";

/**
 * The Durable Object's asset loader (09a's decision, 09b's build).
 *
 * Cloudflare Static Assets serve `client.js`, `gallery.js`, `offer.js`, `payment.js` and
 * `shortlet-foundations.css` from `apps/cloudflare/public/` before a request reaches the Worker, so the handler's
 * script routes are never hit on Cloudflare. Only the inlined foundations CSS is needed inside the object; it comes
 * from the Vite `?raw` import, never a filesystem read (09a). Any other name fails this request rather than
 * pretending a missing asset exists (09a AC3).
 */
export const cloudflareAssetLoader: AssetLoader = {
  text(name: AssetName): string {
    if (name === "shortlet-foundations.css") return SHORTLET_FOUNDATIONS_CSS;
    throw new Error(`${name} is served as a static asset, not from the Durable Object`);
  },
};
