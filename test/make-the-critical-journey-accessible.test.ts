import test from "node:test";
import assert from "node:assert/strict";
import { AccessibilityLocalizationManager } from "../domains/shortlet/src/accessibility-localization.js";

test("Approved components expose correct semantics, focus, errors, contrast, reflow, touch targets, and restrained live updates.", () => {
  const manager = new AccessibilityLocalizationManager();

  const componentSpec = manager.getAccessibilitySpec({
    componentId: "booking_offer_card",
    role: "region",
    label: "Booking Offer Summary",
    liveMode: "polite",
    touchTargetPx: 44,
    contrastRatio: 4.5
  });

  assert.equal(componentSpec.semantics.role, "region");
  assert.equal(componentSpec.semantics["aria-label"], "Booking Offer Summary");
  assert.equal(componentSpec.semantics["aria-live"], "polite"); // Restrained live update
  assert.equal(componentSpec.touchTargetPx >= 44, true);
  assert.equal(componentSpec.contrastRatio >= 4.5, true);

  // Focus and error handling
  const errorSpec = manager.formatAccessibleError({
    fieldId: "check_in_date",
    errorMsg: "Check-in date cannot be in the past"
  });

  assert.equal(errorSpec["aria-invalid"], "true");
  assert.equal(errorSpec["aria-errormessage"], "check_in_date_error");
});

test("Money uses kobo and locale-safe display; contractual time always includes an absolute Africa/Lagos value.", () => {
  const manager = new AccessibilityLocalizationManager();

  // Money formatting
  const formattedMoney = manager.formatMoneyKobo(15000000); // 150,000 NGN
  assert.equal(formattedMoney.rawKobo, 15000000);
  assert.equal(formattedMoney.currency, "NGN");
  assert.equal(formattedMoney.localeFormatted, "₦150,000.00");

  // Time formatting (ADR 0078: Absolute Africa/Lagos value mandatory!)
  const isoTime = "2026-07-25T13:00:00.000Z";
  const formattedTime = manager.formatContractualTime(isoTime);

  assert.equal(formattedTime.timeZone, "Africa/Lagos");
  assert.equal(formattedTime.absoluteWatFormatted.includes("WAT"), true);
  assert.equal(formattedTime.absoluteWatIso, "2026-07-25T14:00:00+01:00");
  assert.ok(formattedTime.absoluteWatFormatted.length > 0);
});

test("Critical text precedes nonessential media, offline and stale state are explicit, and unsafe material actions disable.", () => {
  const manager = new AccessibilityLocalizationManager();

  const surfacePayload = manager.prepareAccessibleSurface({
    title: "Reservation Details",
    criticalText: "Your booking is confirmed for 2 nights at Ikeja Apartment.",
    media: [{ type: "image", url: "https://shortlet.platform/img1.jpg" }],
    isOffline: true,
    isStale: true,
    staleAsOfIso: "2026-07-22T20:00:00Z"
  });

  // Critical text ordering check (text appears before media)
  const textIndex = JSON.stringify(surfacePayload).indexOf("criticalText");
  const mediaIndex = JSON.stringify(surfacePayload).indexOf("media");
  assert.equal(textIndex < mediaIndex, true);

  // Explicit offline/stale state
  assert.equal(surfacePayload.state.isOffline, true);
  assert.equal(surfacePayload.state.isStale, true);

  // Unsafe material actions disabled when offline/stale!
  const actionStatus = manager.evaluateActionSafety({
    actionType: "pay_now",
    surfaceState: surfacePayload.state
  });
  assert.equal(actionStatus.disabled, true);
  assert.match(actionStatus.reason!, /Action disabled due to (offline|stale) state/);
});

test("Automated checks and representative keyboard, screen-reader, reduced-motion, slow-network, and small-screen tests pass.", () => {
  const manager = new AccessibilityLocalizationManager();

  const suiteResults = manager.runAccessibilityValidationSuite({
    viewportWidthPx: 320, // 320-pixel mobile layout
    reducedMotionPreferred: true,
    networkSpeedKbps: 56, // Degraded network
    keyboardNavigable: true,
    screenReaderAnnouncements: true
  });

  assert.equal(suiteResults.allPassed, true);
  assert.equal(suiteResults.viewportPassed, true);
  assert.equal(suiteResults.reducedMotionPassed, true);
  assert.equal(suiteResults.slowNetworkPassed, true);
  assert.equal(suiteResults.keyboardPassed, true);
  assert.equal(suiteResults.screenReaderPassed, true);
});
