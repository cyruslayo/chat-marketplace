/** The assets the handlers serve; the closed union keeps every new bundle accounted for. */
export type AssetName =
  | "shortlet-foundations.css"
  | "client.js"
  | "gallery.js"
  | "offer.js"
  | "payment.js";

/**
 * Slice 09a: the source of the bundle/CSS text the handlers serve. A Durable Object has no filesystem, so
 * `nodeAssetLoader()` is the Node implementation and the Cloudflare composition (09b/10b) supplies its own.
 */
export interface AssetLoader {
  /** The exact configured text of the asset (ADR 0081: identical bytes); throws when the asset is missing. */
  text(name: AssetName): string;
}
