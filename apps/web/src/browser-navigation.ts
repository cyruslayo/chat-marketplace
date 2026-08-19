import type { ApplicationNavigator } from "./navigation.js";

export interface BrowserLocation {
  assign(url: string): void;
}

export interface CreateBrowserNavigatorOptions {
  readonly location: BrowserLocation;
}

export function createBrowserNavigator({
  location,
}: CreateBrowserNavigatorOptions): ApplicationNavigator {
  return {
    openInternalRoute(route) {
      location.assign(route);
    },
  };
}
