export interface WeaverSurfaceFallbackOptions {
  readonly mount: HTMLElement;
  readonly text: string;
  readonly conventionalRoute?: string;
  readonly conventionalRouteLabel?: string;
  readonly onConventionalRouteFallback?: () => void;
}

export function renderWeaverSurfaceFallback({
  mount,
  text,
  conventionalRoute,
  conventionalRouteLabel,
  onConventionalRouteFallback,
}: WeaverSurfaceFallbackOptions): void {
  const document = mount.ownerDocument;
  mount.replaceChildren();
  mount.dataset.renderer = "fallback";
  const box = document.createElement("div");
  box.className = "surface-fallback";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  box.appendChild(paragraph);
  if (conventionalRoute) {
    const link = document.createElement("a");
    link.href = conventionalRoute;
    link.className = "fallback-link";
    link.textContent = conventionalRouteLabel ?? "Open full details";
    box.appendChild(link);
    onConventionalRouteFallback?.();
  }
  mount.appendChild(box);
}
