import type { HttpRequestLike } from "../../../packages/platform-core/src/http-like.js";

/** The saved light/dark choice of the public pages; "system" follows the device. */
export type LandingTheme = "light" | "dark" | "system";

export function landingThemeFromCookie(req: HttpRequestLike): LandingTheme {
  const cookie = req.headers.cookie;
  if (typeof cookie !== "string") return "system";
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("shortlet_theme="))
    ?.slice("shortlet_theme=".length);
  return value === "light" || value === "dark" ? value : "system";
}
