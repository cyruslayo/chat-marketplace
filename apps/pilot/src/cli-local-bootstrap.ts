import { bootstrapLocalPilot, localPilotPaths } from "./local-pilot.js";

const paths = localPilotPaths();
const result = bootstrapLocalPilot(paths);
console.log(result.created ? "Local Shortlet pilot bootstrapped" : "Local Shortlet pilot already bootstrapped");
console.log(`Data: ${paths.directory}`);
console.log("Listings: Abuja / Wuse 2; Lagos / Old Ikoyi");
console.log("Next: npm run pilot:local");
console.log("Operator token: npm run pilot:local:operator-token");
