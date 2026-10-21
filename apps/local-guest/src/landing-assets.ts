// The only published landing binaries. Neither a URL nor a caller chooses a filesystem path.
export const LANDING_BINARY_ASSETS = {
  "/landing/fonts/hanken-grotesk-400-700.woff2": {
    name: "hanken-grotesk-400-700.woff2",
    file: "fonts/hanken-grotesk-400-700.woff2",
    contentType: "font/woff2",
  },
  "/landing/fonts/newsreader-500.woff2": {
    name: "newsreader-500.woff2",
    file: "fonts/newsreader-500.woff2",
    contentType: "font/woff2",
  },
  "/landing/fonts/newsreader-italic-400.woff2": {
    name: "newsreader-italic-400.woff2",
    file: "fonts/newsreader-italic-400.woff2",
    contentType: "font/woff2",
  },
  "/landing/photos/ikoyi-living.jpg": {
    name: "ikoyi-living.jpg",
    file: "landing/ikoyi-living.jpg",
    contentType: "image/jpeg",
  },
  "/landing/photos/ikoyi-bedroom.jpg": {
    name: "ikoyi-bedroom.jpg",
    file: "landing/ikoyi-bedroom.jpg",
    contentType: "image/jpeg",
  },
  "/landing/photos/lekki-living.jpg": {
    name: "lekki-living.jpg",
    file: "landing/lekki-living.jpg",
    contentType: "image/jpeg",
  },
  "/landing/photos/lekki-bedroom.jpg": {
    name: "lekki-bedroom.jpg",
    file: "landing/lekki-bedroom.jpg",
    contentType: "image/jpeg",
  },
} as const;

export type LandingBinaryAssetName =
  (typeof LANDING_BINARY_ASSETS)[keyof typeof LANDING_BINARY_ASSETS]["name"];

/** ADR 0095: hosts inject binary bytes; the route module never opens a file. */
export interface LandingBinaryAssetLoader {
  read(name: LandingBinaryAssetName): Uint8Array;
}
