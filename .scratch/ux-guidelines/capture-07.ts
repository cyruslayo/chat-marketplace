// Issue 07 captures: the payment-callback failure page and the thread notice at 320/390/768/1280, light and dark.
// Writes screenshots to screenshots/07/ and a findings file with horizontal overflow and controls under 44x44.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DirectPaystackClient } from "../../packages/platform-core/src/payments/index.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { createPaystackHttpFake } from "../../test/helpers/paystack-http.js";

const out = join(import.meta.dirname, "screenshots", "07");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient({ secretKey: "sk_test_synthetic_fixture", environment: "test", callbackBaseUrl: "https://demo.example.test" }, createPaystackHttpFake().fetcher) });
const browser = await launchRealBrowser();
const tab = await browser.createTab();
const [cookieName, cookieValue] = fixture.cookie.split("=", 2);
try {
  await tab.setCookie(cookieName!, cookieValue!, fixture.base);
  const pages = [
    ["callback-failure", `${fixture.base}/payments/paystack/callback`],
    ["thread-notice", `${fixture.base}/?payment=not-confirmed`],
  ] as const;
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      for (const [name, url] of pages) {
        const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
        await size(900);
        await tab.navigate(url);
        await tab.waitForFunction("document.readyState === 'complete'", 10_000);
        await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const metrics = await tab.evaluate<{ height: number; overflow: number; small: readonly { tag: string; text: string; width: number; height: number }[] }>(`(() => {
          const height = document.documentElement.scrollHeight;
          const overflow = document.documentElement.scrollWidth - innerWidth;
          const small = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
            .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) }; })
            .filter((entry) => entry.width > 0 && entry.height > 0 && (entry.width < 44 || entry.height < 44));
          return { height, overflow, small };
        })()`);
        await size(Math.min(metrics.height, 4000));
        await new Promise((resolve) => setTimeout(resolve, 200));
        writeFileSync(join(out, `${name}-${theme}-${width}.png`), await tab.captureScreenshot());
        const line = `${name} ${theme} ${width}: height ${metrics.height}${metrics.overflow > 0 ? ` HORIZONTAL OVERFLOW ${metrics.overflow}px` : " no horizontal overflow"}`;
        findings.push(line);
        for (const entry of metrics.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
        console.log(line);
      }
    }
  }
} finally {
  await tab.close();
  await browser.close();
  await fixture.close();
}
writeFileSync(join(out, "findings-07.txt"), `${findings.join("\n")}\n`);
