import { issueLocalOperatorToken } from "./local-pilot.js";

const token = issueLocalOperatorToken();
console.log("Local pilot one-time Operator login token (printed once):");
console.log(token);
console.log("Open /operator/login and paste this token.");
