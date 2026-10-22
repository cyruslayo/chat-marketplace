import { restartFixture, guestActionOrUndefined } from "../../test/helpers/guest-restart.js";

// Demo-launch issue 13 (AC6): drives a synthetic staging Extended Stay through the guest flow to the confirmed contract,
// for the captures in screenshots/13/. Stubbed provider only; local test data only.
export async function driveExtendedStayToConfirmed(log: (line: string) => void): Promise<{ fixture: Awaited<ReturnType<typeof restartFixture>>; contractPath: string }> {
  const fixture = await restartFixture({ demo: true, deployment: "staging" });
  const unit = fixture.environment.unitRepository.findAll()[0]!;
  fixture.environment.unitRepository.save({
    ...unit,
    extendedStay: {
      optedIn: true,
      monthlyAgreedAmounts: { accommodationKobo: 15_000_000, mandatoryChargesKobo: 500_000, version: "capture-month-v1" },
      utilitiesAndServicing: { powerAndGeneratorFuelIncluded: true, waterIncluded: true, internetIncluded: true, cleaningIncluded: true, cleaningFrequency: "weekly" },
    },
  });
  let r: any = await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi for 30 nights for two people." });
  r = await fixture.send("/api/turn", { text: "10 Sep" });
  r = await fixture.send("/api/turn", { text: "2 guests" });
  let accepted = false;
  let contractPath = "";
  for (let step = 0; step < 30; step++) {
    const surface = r.surfaces?.[0];
    if (!surface) { log(`step ${step}: no surface`); break; }
    const route = String(surface.conventionalRoute ?? "");
    log(`step ${step}: ${route.split("?")[0]}`);
    if (route.startsWith("/booking-contracts/")) { contractPath = route; log("confirmed contract reached"); break; }
    const action = guestActionOrUndefined(surface);
    if (!action) {
      if (accepted) { log("no action after acceptance; stopping"); break; }
      const requestId = String(surface.surfaceId).split(":").at(-1)!;
      fixture.environment.simulateOperatorAcceptance(requestId);
      accepted = true;
      const state: any = await fixture.state();
      r = { ok: true, messages: [], surfaces: state.surfaces ?? [] };
      continue;
    }
    r = await fixture.send("/api/event", action);
    if (!r.ok) { log(`event failed: ${r.code ?? "unknown"}`); break; }
  }
  return { fixture, contractPath };
}

if (process.argv[1]?.endsWith("drive-13.ts")) {
  const { fixture } = await driveExtendedStayToConfirmed((line) => console.log(line));
  await fixture.close();
}
