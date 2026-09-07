import { LocalApartmentOwnerEnvironment, startLocalOwnerServer } from "../apps/local-owner/src/index.js";
import { launchRealBrowser } from "../test/helpers/chrome-devtools.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "operator-chromium-"));
const db = join(dir, "pilot.sqlite");
const env = new LocalApartmentOwnerEnvironment({ databasePath: db });
const server = startLocalOwnerServer({ port: 0, environment: env });
const port = await server.listen();
const browser = await launchRealBrowser();
try {
  const tab = await browser.createTab(`http://localhost:${port}/operator/login`);
  await tab.waitForSelector("#token");
  const token = JSON.stringify(env.provisionOperatorAccessToken());
  await tab.evaluate(`document.querySelector('#token').value = ${token}`);
  if (!(await tab.clickButton("Sign in"))) throw new Error("Sign-in button was not found");
  await tab.waitForText("Operator workspace");
  console.log("operator chromium login: passed");
  await tab.close();
} finally {
  await browser.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
