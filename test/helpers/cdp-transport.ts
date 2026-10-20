// Chrome DevTools Protocol transport for the real-browser helper (test/helpers/chrome-devtools.ts). Every call has a
// timeout, so a browser or page that never answers fails the test with the method and the page URL instead of hanging
// the run; pending calls are rejected when the socket closes, so nothing waits on a dead connection.

/**
 * Default budget for one CDP call. The slowest real-browser file runs for about 376 s in total, and a single call (a
 * navigation, one evaluate, one createTarget) takes well under a second. 60 s is headroom for a loaded machine, not a
 * wait for a stuck page.
 */
export const CDP_CALL_TIMEOUT_MS = 60_000;

/** The socket as the transport needs it: the WebSocket is adapted to these two operations by the caller. */
export interface CdpSocket {
  send(data: string): void;
  subscribe(handlers: { message(data: unknown): void; close(): void }): void;
}

export interface CdpCallOptions {
  /** Overrides the transport default for this call only. */
  readonly timeoutMs?: number;
}

export interface CdpEvent {
  readonly method: string;
  readonly params?: unknown;
  readonly sessionId?: string;
}

export interface CdpTransport {
  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string, options?: CdpCallOptions): Promise<T>;
  pendingCount(): number;
}

export interface CdpTransportOptions {
  readonly socket: CdpSocket;
  readonly defaultTimeoutMs?: number;
  /** The page a call is aimed at, for error messages (its URL when the session is known). */
  readonly describePage?: (sessionId: string | undefined) => string;
  readonly onEvent?: (event: CdpEvent) => void;
}

interface PendingCall {
  readonly method: string;
  readonly sessionId: string | undefined;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createCdpTransport(options: CdpTransportOptions): CdpTransport {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? CDP_CALL_TIMEOUT_MS;
  const describePage = options.describePage ?? (() => "<unknown page>");
  const pending = new Map<number, PendingCall>();
  let nextId = 1;
  let closed = false;

  // Removes a call from the pending table and stops its timer; returns it, or undefined when it already settled.
  function take(id: number): PendingCall | undefined {
    const call = pending.get(id);
    if (!call) return undefined;
    clearTimeout(call.timer);
    pending.delete(id);
    return call;
  }

  options.socket.subscribe({
    message(data) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof data === "string" ? data : String(data));
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      if (typeof parsed.id === "number") {
        const call = take(parsed.id);
        if (!call) return;
        if (parsed.error) call.reject(new Error(JSON.stringify(parsed.error)));
        else call.resolve(parsed.result);
        return;
      }
      if (typeof parsed.method === "string" && options.onEvent) {
        options.onEvent({
          method: parsed.method,
          params: parsed.params,
          sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
        });
      }
    },
    close() {
      closed = true;
      for (const id of [...pending.keys()]) {
        const call = take(id);
        call?.reject(new Error(`CDP socket closed before ${call.method} replied (page ${describePage(call.sessionId)})`));
      }
    },
  });

  return {
    send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string, callOptions?: CdpCallOptions): Promise<T> {
      const timeoutMs = callOptions?.timeoutMs ?? defaultTimeoutMs;
      return new Promise<T>((resolve, reject) => {
        if (closed) {
          reject(new Error(`CDP socket is closed; cannot send ${method} (page ${describePage(sessionId)})`));
          return;
        }
        const id = nextId++;
        const timer = setTimeout(() => {
          const call = take(id);
          call?.reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms (page ${describePage(sessionId)})`));
        }, timeoutMs);
        pending.set(id, { method, sessionId, timer, resolve: resolve as (value: unknown) => void, reject });
        try {
          options.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
        } catch (error) {
          take(id)?.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}
