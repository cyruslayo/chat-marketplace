import {
  createDiscoveryServerEventHandler,
  type AuthoritativeDiscoveryArtifact,
  type DiscoveryServerEventRejection,
} from "./discovery-actions.js";
import {
  executeDiscoveryNavigationEffect,
  type ApplicationNavigator,
} from "./navigation.js";

export interface CreateDiscoveryInteractionsOptions {
  readonly getArtifact: (artifactId: string) => AuthoritativeDiscoveryArtifact | undefined;
  readonly navigator: ApplicationNavigator;
  readonly onRejected?: (rejection: DiscoveryServerEventRejection) => void;
}

export function createDiscoveryInteractions({
  getArtifact,
  navigator,
  onRejected,
}: CreateDiscoveryInteractionsOptions) {
  const onServerEvent = createDiscoveryServerEventHandler({
    getArtifact,
    onEffect: (effect) => executeDiscoveryNavigationEffect({ effect, navigator }),
    ...(onRejected === undefined ? {} : { onRejected }),
  });

  return { onServerEvent };
}
