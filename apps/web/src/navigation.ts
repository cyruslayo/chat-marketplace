import type { DiscoveryRouteEffect } from "./discovery-actions.js";

export interface ApplicationNavigator {
  openInternalRoute(route: string): void;
}

export interface ExecuteDiscoveryNavigationEffectOptions {
  readonly effect: DiscoveryRouteEffect;
  readonly navigator: ApplicationNavigator;
}

export function executeDiscoveryNavigationEffect({
  effect,
  navigator,
}: ExecuteDiscoveryNavigationEffectOptions): void {
  navigator.openInternalRoute(effect.route);
}
