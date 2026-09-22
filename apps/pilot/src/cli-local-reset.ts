import { LOCAL_PILOT_DIRECTORY, resetLocalPilot } from "./local-pilot.js";

resetLocalPilot();
console.log(`Reset local pilot data: ${LOCAL_PILOT_DIRECTORY}`);
console.log("Next: npm run pilot:local:bootstrap");
