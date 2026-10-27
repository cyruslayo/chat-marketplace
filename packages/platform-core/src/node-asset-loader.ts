import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetLoader, AssetName } from "./asset-loader.js";

/**
 * Node-only file so the Workers composition never touches `node:fs` (slice 09a). Module scope must not read
 * `import.meta.url`: Workers see it as undefined, so the path is resolved here, only when a loader is created.
 */
function repoRootDirectory(): string {
  const packageDirectory = dirname(fileURLToPath(import.meta.url));
  return join(packageDirectory, "..", "..", "..");
}

/**
 * `nodeAssetLoader()` resolves today's paths — the client bundle at `apps/local-guest/dist/` (or the
 * `clientScriptPath` override), the sibling bundles beside it, and the shared foundations CSS — and caches each
 * file after its first read. Behavior is unchanged for the Node wrappers and the pilot (slice 09a).
 */
export function nodeAssetLoader(
  options: { readonly clientScriptPath?: string } = {},
): AssetLoader {
  const REPO_ROOT = repoRootDirectory();
  const clientScriptPath =
    options.clientScriptPath ??
    join(REPO_ROOT, "apps", "local-guest", "dist", "client.js");
  const scriptDirectory = dirname(clientScriptPath);
  const paths: Record<AssetName, () => string> = {
    "shortlet-foundations.css": () =>
      join(REPO_ROOT, "apps", "web", "src", "shortlet-foundations.css"),
    "shortlet-landing.css": () =>
      join(REPO_ROOT, "apps", "web", "src", "shortlet-landing.css"),
    "landing.js": () => join(scriptDirectory, "landing.js"),
    "client.js": () => clientScriptPath,
    "gallery.js": () => join(scriptDirectory, "gallery.js"),
    "offer.js": () => join(scriptDirectory, "offer.js"),
    "payment.js": () => join(scriptDirectory, "payment.js"),
  };
  const cache = new Map<AssetName, string>();
  return {
    text(name: AssetName): string {
      const cached = cache.get(name);
      if (cached !== undefined) return cached;
      const text = readFileSync(paths[name](), "utf8");
      cache.set(name, text);
      return text;
    },
  };
}
