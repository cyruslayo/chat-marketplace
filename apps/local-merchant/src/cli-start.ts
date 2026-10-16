import { startMerchantServer } from "./merchant-server.js";
import { MerchantEnvironment } from "./merchant-environment.js";

const environment = MerchantEnvironment.openNode();
const { listen } = startMerchantServer(environment);

listen().then((port) => {
  console.log(`Merchant back office: http://localhost:${port}`);
  console.log(`Merchant: ${environment.config.merchantName} (${environment.config.merchantId})`);
  console.log(`Store: ${environment.config.storeId}`);
});
