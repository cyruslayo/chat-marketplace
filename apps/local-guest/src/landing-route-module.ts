import type { AssetLoader } from "../../../packages/platform-core/src/asset-loader.js";
import type {
  HttpRequestLike,
  HttpResponseLike,
} from "../../../packages/platform-core/src/http-like.js";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import {
  LANDING_BINARY_ASSETS,
  type LandingBinaryAssetLoader,
} from "./landing-assets.js";
import { renderLandingHtml, type LandingTheme } from "./landing-page-html.js";
import type { RouteModule } from "./guest-shell.js";

export interface LandingRouteOptions {
  readonly assets: AssetLoader;
  readonly binaryAssets: LandingBinaryAssetLoader;
  /** Owner-approved illustration mode; presentation only, never inventory or payment configuration. */
  readonly demo?: boolean;
  readonly secureCookie?: boolean;
  /** Reuse the host's existing origin and bounded form-reader rules, without changing stays behavior. */
  readonly originAccepted: (req: HttpRequestLike) => boolean;
  readonly readForm: (req: HttpRequestLike) => Promise<URLSearchParams>;
}

function themeFromCookie(req: HttpRequestLike): LandingTheme {
  const cookie = req.headers.cookie;
  if (typeof cookie !== "string") return "system";
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("shortlet_theme="))
    ?.slice("shortlet_theme=".length);
  return value === "light" || value === "dark" ? value : "system";
}

function notFound(res: HttpResponseLike): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

/** ADR 0099: public marketing routes run before the shortlet session/transaction dispatch. */
export function createLandingRouteModule(
  options: LandingRouteOptions,
): RouteModule {
  return {
    name: "landing",
    async tryHandle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/welcome") {
        res.writeHead(200, {
          ...GUEST_HTML_SECURITY_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          Vary: "Cookie",
        });
        res.end(
          renderLandingHtml(themeFromCookie(req), {
            demo: options.demo === true,
          }),
        );
        return true;
      }
      if (req.method === "POST" && url.pathname === "/welcome/theme") {
        if (!options.originAccepted(req)) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Origin rejected");
          return true;
        }
        let themes: string[];
        try {
          themes = (await options.readForm(req)).getAll("theme");
        } catch {
          themes = [];
        }
        const theme = themes.length === 1 ? themes[0] : undefined;
        if (theme !== "light" && theme !== "dark") {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Theme must be light or dark");
          return true;
        }
        res.writeHead(303, {
          Location: "/welcome",
          "Set-Cookie": `shortlet_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${options.secureCookie ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        });
        res.end();
        return true;
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/shortlet-landing.css" ||
          url.pathname === "/landing.js")
      ) {
        const stylesheet = url.pathname === "/shortlet-landing.css";
        try {
          const text = options.assets.text(
            stylesheet ? "shortlet-landing.css" : "landing.js",
          );
          res.writeHead(200, {
            "Content-Type": stylesheet
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
            ...(stylesheet ? { "Cache-Control": "public, max-age=3600" } : {}),
          });
          res.end(text);
        } catch {
          notFound(res);
        }
        return true;
      }
      if (
        url.pathname.startsWith("/landing/fonts/") ||
        url.pathname.startsWith("/landing/photos/")
      ) {
        // ADR 0075: validate the exact allow-list key before invoking any loader; no decoding or URL-to-path construction.
        if (
          req.method !== "GET" ||
          !Object.hasOwn(LANDING_BINARY_ASSETS, url.pathname)
        ) {
          notFound(res);
          return true;
        }
        const asset =
          LANDING_BINARY_ASSETS[
            url.pathname as keyof typeof LANDING_BINARY_ASSETS
          ];
        try {
          const bytes = options.binaryAssets.read(asset.name);
          res.writeHead(200, {
            "Content-Type": asset.contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(Buffer.from(bytes));
        } catch {
          notFound(res);
        }
        return true;
      }
      return false;
    },
  };
}
