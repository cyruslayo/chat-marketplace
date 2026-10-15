import type { AssetLoader, AssetName } from "../../../packages/platform-core/src/asset-loader.js";
import type { HttpRequestLike, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";

/**
 * The guest HTTP shell (ADR 0099: hosts are composition roots). It owns the transport concerns a
 * host repeats for every domain — request URL parsing, static bundle serving and route dispatch —
 * and knows nothing about any domain. Feature routes are registered as `RouteModule`s.
 */

export interface RouteModule {
  readonly name: string;
  /** Handles the request when it owns the route; returning false lets the shell try the next module. */
  tryHandle(req: HttpRequestLike, res: HttpResponseLike, url: URL): Promise<boolean>;
}

export interface StaticAsset {
  readonly path: string;
  readonly assetName: AssetName;
  readonly contentType: string;
  readonly cacheControl?: string;
  readonly missingStatus: number;
  readonly missingMessage: string;
}

export interface GuestShellOptions {
  readonly assets: AssetLoader;
  readonly staticAssets: readonly StaticAsset[];
  readonly routeModules: readonly RouteModule[];
  readonly notFound: (req: HttpRequestLike, res: HttpResponseLike) => Promise<void>;
}

export interface GuestShell {
  handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>;
}

export function createGuestShell(options: GuestShellOptions): GuestShell {
  return {
    async handle(req, res) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET") {
        for (const asset of options.staticAssets) {
          if (url.pathname !== asset.path) continue;
          try {
            res.writeHead(200, {
              "Content-Type": asset.contentType,
              ...(asset.cacheControl ? { "Cache-Control": asset.cacheControl } : {}),
            });
            res.end(options.assets.text(asset.assetName));
          } catch {
            res.writeHead(asset.missingStatus, { "Content-Type": "text/plain" });
            res.end(asset.missingMessage);
          }
          return;
        }
      }
      for (const routeModule of options.routeModules) {
        if (await routeModule.tryHandle(req, res, url)) return;
      }
      await options.notFound(req, res);
    },
  };
}
