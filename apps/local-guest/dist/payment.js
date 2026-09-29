"use strict";
(() => {
  // apps/local-guest/src/payment-page.ts
  var run = () => {
    for (const button of document.querySelectorAll("button[data-copy-text]")) {
      const status = button.parentElement?.querySelector("[data-copy-status]") ?? null;
      button.hidden = false;
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyText ?? "");
          if (status) status.textContent = "Account number copied";
        } catch {
          if (status) status.textContent = "Copying is not available. Select the account number to copy it.";
        }
      });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();
