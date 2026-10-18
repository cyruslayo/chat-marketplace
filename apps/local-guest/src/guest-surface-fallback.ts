import { fallbackSummary, type SurfacePresentation } from "./conversational-shell.js";

export interface SurfaceMountResult {
  readonly ok: boolean;
}

export interface MountGuestSurfaceOptions<Result extends SurfaceMountResult> {
  readonly attemptMount: () => Result;
  readonly mount: HTMLElement;
  readonly surface: SurfacePresentation;
  readonly onConventionalRouteFallback?: () => void;
}

/** Mount a rich surface or replace it with the guest's safe text and route fallback. */
export function mountGuestSurfaceOrFallback<Result extends SurfaceMountResult>(
  options: MountGuestSurfaceOptions<Result>,
): Result {
  const result = options.attemptMount();
  if (result.ok) return result;

  options.mount.replaceChildren();
  options.mount.dataset.renderer = "fallback";

  const document = options.mount.ownerDocument;
  const box = document.createElement("div");
  box.className = "surface-fallback";
  const text = document.createElement("p");
  text.textContent = options.surface.textFallback ?? fallbackSummary(options.surface);
  box.appendChild(text);

  if (options.surface.conventionalRoute) {
    const link = document.createElement("a");
    link.href = options.surface.conventionalRoute;
    link.className = "fallback-link";
    link.textContent = options.surface.conventionalRouteLabel ?? "Open full details";
    box.appendChild(link);
    options.onConventionalRouteFallback?.();
  }

  options.mount.appendChild(box);
  return result;
}
