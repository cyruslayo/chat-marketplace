import { startMerchantServer } from "./merchant-server.js";
import { MerchantEnvironment } from "./merchant-environment.js";
import { merchantPaymentReferenceKeysFromEnv } from "./merchant-startup.js";

// Refuses to start while commerce is off (ADR 0104), and requires the payment reference key pair when it is on (ADR 0075).
// The key comes from the environment and is never printed. Messages name variables only.
const environment = MerchantEnvironment.openNode({ paymentReferenceKeys: merchantPaymentReferenceKeysFromEnv(process.env) });
const { listen } = startMerchantServer(environment);

listen().then((port) => {
  console.log(`Merchant back office: http://localhost:${port}`);
  console.log(`Merchant: ${environment.config.merchantName} (${environment.config.merchantId})`);
  console.log(`Store: ${environment.config.storeId}`);
});
