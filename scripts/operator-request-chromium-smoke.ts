import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment, startLocalOwnerServer } from "../apps/local-owner/src/index.js";
import { launchRealBrowser } from "../test/helpers/chrome-devtools.js";

const dir = await mkdtemp(join(tmpdir(), "operator-request-chromium-"));
const path = join(dir, "pilot.sqlite");
const clock = () => new Date("2026-09-03T10:00:00Z");
const guest = new LocalGuestEnvironment({ databasePath: path, clock });
const operator = new LocalApartmentOwnerEnvironment({ databasePath: path, clock });
const draft = guest.bookingRequestApp.createDraft({ unitId: "unit-lagos-ikoyi-001", primaryGuest: { id: guest.config.guestId, name: guest.config.guestName }, occupants: guest.demoOccupants(2), selfBookingAttestation: guest.selfBookingAttestation(), checkIn: "2026-09-10", checkOut: "2026-09-13" }, guest.guestPrincipal());
const request = guest.bookingRequestApp.disclose(draft.draftId, guest.guestPrincipal());
const server = startLocalOwnerServer({ port: 0, environment: operator });
const port = await server.listen();
const browser = await launchRealBrowser();
try {
  const login = await browser.createTab(`http://localhost:${port}/operator/login`);
  await login.waitForSelector("#token");
  const token = JSON.stringify(operator.provisionOperatorAccessToken());
  await login.evaluate(`document.querySelector('#token').value = ${token}`);
  await login.clickButton("Sign in");
  await login.waitForText("Operator workspace");
  await login.navigate(`http://localhost:${port}/operator/requests`);
  for (const [width, height] of [[320, 700], [390, 844], [1280, 800]] as const) {
    await login.setViewport(width, height);
    const fits = await login.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth");
    if (!fits) throw new Error(`Operator surface overflows at ${width}px`);
  }
  await login.waitForText(request.requestId);
  await login.navigate(`http://localhost:${port}/operator/requests/${request.requestId}`);
  await login.waitForText("Confirm Booking Request");
  await login.clickButton("Confirm Booking Request");
  await login.waitForText("Status");
  if (guest.interactionStore.findConditionalOfferByRequestId(request.requestId) === null) throw new Error("Guest offer was not persisted");
  console.log("operator Chromium confirmation journey: passed");
  const secondDraft = guest.bookingRequestApp.createDraft({ unitId: "unit-lagos-ikoyi-001", primaryGuest: { id: guest.config.guestId, name: guest.config.guestName }, occupants: guest.demoOccupants(2), selfBookingAttestation: guest.selfBookingAttestation(), checkIn: "2026-09-15", checkOut: "2026-09-18" }, guest.guestPrincipal());
  const secondRequest = guest.bookingRequestApp.disclose(secondDraft.draftId, guest.guestPrincipal());
  await login.navigate(`http://localhost:${port}/operator/requests/${secondRequest.requestId}`);
  await login.waitForText("Decline Booking Request");
  await login.clickButton("Decline Booking Request");
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (guest.bookingRequestApp.manager.getRequest(secondRequest.requestId).status !== "declined") throw new Error("Guest decline was not persisted");
  console.log("operator Chromium decline journey: passed");
  await login.close();
} finally {
  await browser.close();
  await server.close();
  guest.close();
  await rm(dir, { recursive: true, force: true });
}
