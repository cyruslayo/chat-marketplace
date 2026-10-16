import { createServer, type ServerResponse } from "node:http";
import { MerchantEnvironment } from "./merchant-environment.js";

/** A minimal JSON surface for the merchant back office. Sessions/views are the ADR 0086 follow-up. */
export function startMerchantServer(environment: MerchantEnvironment, port = 0) {
  const server = createServer((request, response) => {
    const principal = environment.merchantPrincipal();
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/catalogue") {
      const catalogue = environment.pack.backOffice.merchantCatalogue(principal, environment.config.storeId);
      return json(response, 200, { storeId: environment.config.storeId, offers: catalogue });
    }
    if (request.method === "GET" && url.pathname === "/orders") {
      const orders = environment.pack.backOffice.merchantOrders(principal, environment.config.storeId);
      return json(response, 200, { storeId: environment.config.storeId, orders });
    }
    return json(response, 404, { error: "not_found" });
  });

  return {
    server,
    listen: () => new Promise<number>((resolve) => server.listen(port, () => resolve((server.address() as { port: number }).port))),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
