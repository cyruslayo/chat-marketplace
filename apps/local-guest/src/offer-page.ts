// ADR-0078/0080: progressively enhance the absolute server deadline; native forms still work without JS.
const offer = document.querySelector<HTMLElement>(
  '.offer-screen[data-offer-state="live"]',
);
const output = offer?.querySelector<HTMLElement>(".waiting-countdown");
const deadline = offer?.querySelector<HTMLTimeElement>("time[datetime]");
const serverNow = offer?.dataset.serverNow;
if (offer && output && deadline && serverNow) {
  const remainingAtReceipt =
    Date.parse(deadline.dateTime) - Date.parse(serverNow);
  const receivedAt = performance.now();
  if (Number.isFinite(remainingAtReceipt)) {
    const timer = window.setInterval(() => {
      const remaining = remainingAtReceipt - (performance.now() - receivedAt);
      const minutes = Math.max(0, Math.ceil(remaining / 60_000));
      output.textContent = `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
      if (remaining <= 0) {
        window.clearInterval(timer);
        // ADR-0074: only the server can expire an offer. Disable acceptance while refreshing its projection.
        for (const button of offer.querySelectorAll<HTMLButtonElement>(
          ".offer-actions button",
        ))
          button.disabled = true;
        window.location.reload();
      }
    }, 250);
  }
}
