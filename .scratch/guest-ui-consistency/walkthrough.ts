// Warm editorial walkthrough: one local guest server per booking stage, each behind a front proxy on a fixed port that
// sends that fixture's guest session cookie, so the browser pane sees exactly what that guest sees. Local test data only.
import { createServer, request } from "node:http";
import { restartFixture, type RestartStage } from "../../test/helpers/guest-restart.js";
import { TEST_MANUAL_ACCOUNT } from "../../test/helpers/guest-payment-page.js";

type Stop = { readonly port: number; readonly stage: RestartStage; readonly label: string; readonly start?: "manual-transfer" | "transfer" };

const stops: readonly Stop[] = [
  { port: 3021, stage: "review", label: "Request review" },
  { port: 3022, stage: "pending", label: "Request sent" },
  { port: 3023, stage: "offer", label: "Conditional Booking Offer" },
  { port: 3024, stage: "payment-ready", label: "Payment choice" },
  { port: 3025, stage: "payment-ready", label: "Manual bank transfer", start: "manual-transfer" },
  { port: 3026, stage: "payment-ready", label: "Provider bank transfer", start: "transfer" },
  { port: 3027, stage: "confirmed", label: "Reservation confirmed" },
  { port: 3028, stage: "inspection", label: "Unit detail" },
];

const BOOKING_ROUTE = /^\/(booking-requests|conditional-offers|booking-contracts|stays)\//;

for (const stop of stops) {
  const fixture = await restartFixture({ manualTransferAccount: TEST_MANUAL_ACCOUNT }, { localPayment: true });
  const routes = new Map<string, string>();
  await fixture.advance(stop.stage, (_stage, result) => {
    for (const surface of result.surfaces) if (surface.conventionalRoute && BOOKING_ROUTE.test(surface.conventionalRoute)) routes.set(surface.conventionalRoute.split("/")[1]!, surface.conventionalRoute);
  });
  const offerId = /^\/conditional-offers\/([^/?]+)/.exec(routes.get("conditional-offers") ?? "")?.[1];
  const payment = offerId ? `/payments/offers/${offerId}` : undefined;
  if (stop.start && payment) {
    const response = await fetch(`${fixture.base}${payment}/${stop.start}`, { method: "POST", headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    if (response.status !== 303) throw new Error(`${stop.label}: starting ${stop.start} returned ${response.status}`);
  }
  const upstream = new URL(fixture.base);
  createServer((req, res) => {
    const proxied = request({ host: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host, cookie: fixture.cookie } }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    proxied.on("error", () => { res.writeHead(502); res.end("Guest server unavailable"); });
    req.pipe(proxied);
  }).listen(stop.port);
  const page = stop.start ? `${payment}/${stop.start}` : stop.stage === "payment-ready" ? payment : [...routes.values()].at(-1);
  console.log(`${stop.label}: http://localhost:${stop.port}${page}  (chat: http://localhost:${stop.port}/?threadId=${fixture.threadId})`);
}
console.log("Walkthrough ready");
