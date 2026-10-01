"use strict";
(() => {
  // apps/local-guest/src/offer-page.ts
  var offer = document.querySelector(
    '.offer-screen[data-offer-state="live"]'
  );
  var output = offer?.querySelector(".waiting-countdown");
  var deadline = offer?.querySelector("time[datetime]");
  var serverNow = offer?.dataset.serverNow;
  if (offer && output && deadline && serverNow) {
    const remainingAtReceipt = Date.parse(deadline.dateTime) - Date.parse(serverNow);
    const receivedAt = performance.now();
    if (Number.isFinite(remainingAtReceipt)) {
      const timer = window.setInterval(() => {
        const remaining = remainingAtReceipt - (performance.now() - receivedAt);
        const minutes = Math.max(0, Math.ceil(remaining / 6e4));
        output.textContent = `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
        if (remaining <= 0) {
          window.clearInterval(timer);
          for (const button of offer.querySelectorAll(
            ".offer-actions button"
          ))
            button.disabled = true;
          window.location.reload();
        }
      }, 250);
    }
  }
})();
