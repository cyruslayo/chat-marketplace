import type { A2UIServerMessage, MessageProcessorResult, WeaverRuntimeSafetyConfig } from "@cylayo/weaver-core";
import type {
  BasicResourcePolicy,
  WebServerEventHandoff,
  WebSurfaceMountOptions,
  WebSurfaceMountResult,
} from "@cylayo/weaver-web";
import { createShortletWebRuntime } from "../../local-guest/src/shortlet-runtime.js";

export interface WeaverWebHostOptions {
  readonly onServerEvent?: (event: WebServerEventHandoff) => void;
  readonly resourcePolicy?: BasicResourcePolicy;
  readonly safety?: WeaverRuntimeSafetyConfig;
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
  const webRuntime = createShortletWebRuntime(options);
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
