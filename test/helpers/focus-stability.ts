export type FocusAttemptResult = boolean | "active" | "stable";

export function synchronousFocusExpression(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    if (document.activeElement !== el && typeof el.focus === "function") el.focus();
    return document.activeElement === el ? "active" : false;
  })()`;
}

export function focusAttemptExpression(selector: string, frameTimeoutMs = 500): string {
  return `(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    if (document.activeElement !== el && typeof el.focus === "function") el.focus();
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(document.activeElement === el ? "active" : false), ${frameTimeoutMs});
      requestAnimationFrame(() => {
        const heldFirstFrame = document.activeElement === el;
        requestAnimationFrame(() => finish(heldFirstFrame && document.activeElement === el ? "stable" : false));
      });
    });
  })()`;
}

export async function waitForStableFocus(
  attempt: () => Promise<FocusAttemptResult>,
  timeoutMs = 8_000,
  intervalMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let activePolls = 0;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const attemptResult = await new Promise<FocusAttemptResult | undefined>((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), remainingMs);
      void attempt().then(
        (result) => { clearTimeout(timeout); resolve(result); },
        () => { clearTimeout(timeout); resolve(false); },
      );
    });
    if (attemptResult === undefined) return false;
    if (attemptResult === "stable") return true;
    if (attemptResult === "active") {
      activePolls += 1;
      if (activePolls >= 2) return true;
    } else {
      activePolls = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
