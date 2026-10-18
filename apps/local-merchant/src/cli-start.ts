import { startMerchantServer } from "./merchant-server.js";
import { MerchantEnvironment } from "./merchant-environment.js";

// The payment reference key comes from the environment (ADR 0075: secrets are never committed or logged). Fail closed:
// the message names the variables, never their values.
const referenceKey = process.env.COMMERCE_REFERENCE_HMAC_KEY;
const referenceKeyId = process.env.COMMERCE_REFERENCE_HMAC_KEY_ID;
if (!referenceKey || !referenceKeyId) {
  throw new Error("COMMERCE_REFERENCE_HMAC_KEY and COMMERCE_REFERENCE_HMAC_KEY_ID must be set to start the merchant back office");
}

const environment = MerchantEnvironment.openNode({ paymentReferenceKeys: { currentKeyId: referenceKeyId, currentKey: referenceKey } });
const { listen } = startMerchantServer(environment);

listen().then((port) => {
  console.log(`Merchant back office: http://localhost:${port}`);
  console.log(`Merchant: ${environment.config.merchantName} (${environment.config.merchantId})`);
  console.log(`Store: ${environment.config.storeId}`);
});
