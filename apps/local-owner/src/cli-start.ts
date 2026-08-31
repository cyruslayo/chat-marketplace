import { startLocalOwnerServer } from "./local-owner-server.js";

const port = parseInt(process.env.PORT ?? "3000", 10);
const instance = startLocalOwnerServer({ port });

instance.listen().then((actualPort) => {
  console.log(`\n===============================================================`);
  console.log(`🚀 Shortlet Local Apartment-Owner Test Surface Started!`);
  console.log(`📍 URL: http://localhost:${actualPort}`);
  console.log(`👤 Operator: Eko Prime Living Ltd (op-lagos-owner-001)`);
  console.log(`🔑 Representative: Babatunde Adeleke (person-owner-001)`);
  console.log(`🏢 Unit: Luxury 2-Bedroom Apartment in Old Ikoyi`);
  console.log(`===============================================================\n`);
});
