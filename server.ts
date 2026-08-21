import express, { type Request, type Response } from "express";
import cors from "cors";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { CopilotRuntime, InMemoryAgentRunner, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createGeminiAgent } from "./apps/web-agent/src/copilotkit-agent.js";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required to start the CopilotKit runtime.");
}

const runtime = new CopilotRuntime({
  agents: {
      default: createGeminiAgent({
        // ADR 0072: this read-only adapter port is the seam for platform-owned commands.
        // Development fixture only; replace with the platform availability port before deployment.
        browseEligibleUnits: async ({ location, nights }) => [{
        id: "unit-123",
        name: "Lagos Executive Suite",
        pricePerNight: 150000,
        eligible: true,
        requestedLocation: location,
        requestedNights: nights
      }]
    })
  },
  runner: new InMemoryAgentRunner()
});
const copilotHandler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", cors: false });

function toFetchRequest(req: Request, signal: AbortSignal): globalThis.Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new globalThis.Request(new URL(req.originalUrl, `http://${req.headers.host ?? "localhost"}`), {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    signal
  });
}

export const app = express();
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-copilot-cloud-public-api-key"],
  credentials: true
}));
app.use(express.json());
app.use("/api/copilotkit", async (req: Request, res: Response) => {
  const abortController = new AbortController();
  req.on("aborted", () => abortController.abort());
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });
  const response = await copilotHandler(toFetchRequest(req, abortController.signal));
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as unknown as NodeReadableStream).pipe(res);
});

// Basic health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`[API Server] Running on http://localhost:${PORT}`);
    console.log(`[CopilotKit] Ready at http://localhost:${PORT}/api/copilotkit`);
    console.log(`[CopilotKit] Info: http://localhost:${PORT}/api/copilotkit/info`);
    console.log(`[Gemini] Adapter active (model: gemini-3.5-flash, Interactions API, stateless)`);
  });
}
