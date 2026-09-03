import { DEFAULT_LOCAL_GUEST_CONFIG, resetLocalGuestFixture } from "./fixture.js";

resetLocalGuestFixture(DEFAULT_LOCAL_GUEST_CONFIG.databasePath);
console.log("Local guest demo fixture reset. Deterministic state will be re-seeded on next start.");
