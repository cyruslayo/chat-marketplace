// The bank transfer pages' only script. The pages work without it (ADR 0080): the account number is plain text the
// Guest can select. This script reveals each hidden "Copy account number" button and announces the result in the
// button's status line.
const run = (): void => {
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy-text]")) {
    const status = button.parentElement?.querySelector<HTMLElement>("[data-copy-status]") ?? null;
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
