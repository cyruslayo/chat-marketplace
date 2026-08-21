import type { A2UIServerMessage, MessageProcessorResult } from "@weaver/core";
import {
  createBasicWebRuntime,
  type BasicResourcePolicy,
  type WebServerEventHandoff,
  type WebSurfaceMountOptions,
  type WebSurfaceMountResult,
} from "@weaver/web";

export interface WeaverWebHostOptions {
  readonly onServerEvent?: (event: WebServerEventHandoff) => void;
  readonly resourcePolicy?: BasicResourcePolicy;
}

export type WeaverWebHostProcessResult = {
  readonly ok: true;
  readonly processedMessageCount: number;
} | {
  readonly ok: false;
  readonly failedMessageIndex: number;
  readonly error: Extract<MessageProcessorResult, { readonly ok: false }>["error"];
};

export interface WeaverWebHost {
  readonly catalogId: string;
  process(messages: readonly A2UIServerMessage[]): WeaverWebHostProcessResult;
  mount(options: WebSurfaceMountOptions): WebSurfaceMountResult;
}

export function createWeaverWebHost(options: WeaverWebHostOptions = {}): WeaverWebHost {
  const created = createBasicWebRuntime({
    ...(options.resourcePolicy === undefined ? {} : { basic: { resourcePolicy: options.resourcePolicy } }),
    ...(options.onServerEvent === undefined ? {} : { rendering: { onServerEvent: options.onServerEvent } }),
  });
  if (!created.ok) {
    throw new Error("Unable to create the Weaver web runtime", { cause: created.error });
  }

  const webRuntime = created.value;
  return {
    catalogId: webRuntime.catalogId,
    process(messages) {
      for (let index = 0; index < messages.length; index += 1) {
        const result = webRuntime.runtime.process(messages[index]);
        if (!result.ok) {
          return { ok: false, failedMessageIndex: index, error: result.error };
        }
      }
      return { ok: true, processedMessageCount: messages.length };
    },
    mount: (mountOptions) => webRuntime.mount(mountOptions),
  };
}
