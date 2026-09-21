import { createServer, type Server } from "node:http";

const IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export interface ImageFixtureResponse {
  readonly status: number;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly body: Uint8Array;
}

export interface ImageFixtureServer {
  readonly port: number;
  readonly origin: string;
  readonly brokenUrl: string;
  listen(): Promise<void>;
  respond(url: string): Promise<ImageFixtureResponse | undefined>;
  close(): Promise<void>;
}

function response(status: number, contentType: string, body: Uint8Array): ImageFixtureResponse {
  return {
    status,
    headers: [
      { name: "Content-Type", value: contentType },
      { name: "Cache-Control", value: "no-store" },
    ],
    body,
  };
}

export function startImageFixtureServer(): ImageFixtureServer {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    if (path === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("ok");
      return;
    }
    if (path === "/synthetic-cover.png" || path === "/synthetic-living-room.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(IMAGE_BYTES);
      return;
    }
    if (path === "/broken.png") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("not found");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("not found");
  });

  let port = 0;
  let listening = false;
  let closed = false;
  let listenPromise: Promise<void> | undefined;

  async function listen(): Promise<void> {
    if (listening) return;
    if (listenPromise) return listenPromise;
    listenPromise = new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        const address = server.address();
        if (typeof address !== "object" || address === null) {
          reject(new Error("Image fixture server did not expose a bound address"));
          return;
        }
        port = address.port;
        listening = true;
        void fetch(`http://127.0.0.1:${port}/healthz`).then(async (health) => {
          if (!health.ok || (await health.text()) !== "ok") throw new Error("Image fixture server health check failed");
          resolve();
        }, reject);
      });
    });
    return listenPromise;
  }

  async function respond(url: string): Promise<ImageFixtureResponse | undefined> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "images.example") return undefined;
    await listen();
    const result = await fetch(`http://127.0.0.1:${port}${parsed.pathname}`);
    return response(
      result.status,
      result.headers.get("content-type") ?? "application/octet-stream",
      new Uint8Array(await result.arrayBuffer()),
    );
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    if (!listening) return;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    listening = false;
  }

  return {
    get port() { return port; },
    get origin() { return `http://127.0.0.1:${port}`; },
    get brokenUrl() { return "https://images.example/broken.png"; },
    listen,
    respond,
    close,
  };
}
