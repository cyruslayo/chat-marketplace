// ADR 0075: one redactor for interaction projections, audit and telemetry.
const sensitiveKeys = new Set([
  "bvn", "nin", "passportnumber", "nationalid", "iddocument", "cardnumber", "cvv", "pin",
  "bankaccountsecret", "accountnumber", "doorcode", "keyboxcode", "pincode", "accesscode",
  "bearertoken", "secretkey", "apikey", "password", "authorization", "rawchainofthought",
  "rawreasoning", "internalcot", "modelreasoning", "cookie", "setcookie", "cookies",
  "phone", "phonenumber", "mobile", "mobilenumber", "token", "accesstoken", "refreshtoken",
  "confirmationtoken", "sessionsecret", "csrftoken", "otp", "onetimepassword",
  "verificationcode", "signincode", "paymentreference", "pspreference",
]);

export function redactSensitiveData(data: unknown): unknown {
  if (typeof data === "string") {
    return data
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, "[REDACTED]")
      .replace(/\b(bvn|nin)\s*[:=]\s*\d{11}\b/gi, "$1: [REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/(?:\+234|234|0)[789][01]\d{8}\b/g, "[REDACTED]")
      .replace(/\+\d(?:[\s()-]*\d){7,14}\b/g, "[REDACTED]")
      .replace(/\b(cookie|set-cookie|access[_ -]?code|confirmation[_ -]?token|phone(?:number)?)\s*[:=]\s*[^\r\n;,]+/gi, "$1: [REDACTED]");
  }
  if (Array.isArray(data)) return data.map(redactSensitiveData);
  if (data !== null && typeof data === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      copy[key] = sensitiveKeys.has(key.toLowerCase().replace(/[-_\s]/g, ""))
        ? "[REDACTED]" : redactSensitiveData(value);
    }
    return copy;
  }
  return data;
}
