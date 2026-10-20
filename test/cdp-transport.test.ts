import test from "node:test";
import assert from "node:assert/strict";
import { CDP_CALL_TIMEOUT_MS, createCdpTransport, type CdpSocket } from "./helpers/cdp-transport.js";

// A fake socket: records what the transport writes and lets a test deliver frames or close the socket.
class FakeSocket implements CdpSocket {
  readonly sent: string[] = [];
  private handlers: { message(data: unknown): void; close(details?: { readonly code?: number; readonly reason?: string }): void } | undefined;
  send(data: string): void {
    this.sent.push(data);
  }
  subscribe(handlers: { message(data: unknown): void; close(details?: { readonly code?: number; readonly reason?: string }): void }): void {
    this.handlers = handlers;
  }
  reply(frame: unknown): void {
    this.handlers?.message(JSON.stringify(frame));
  }
  close(details?: { readonly code?: number; readonly reason?: string }): void {
    this.handlers?.close(details);
  }
  lastId(): number {
    return (JSON.parse(this.sent[this.sent.length - 1]!) as { id: number }).id;
  }
}

function transportFor(socket: FakeSocket, defaultTimeoutMs?: number, onEvent?: (message: { method: string }) => void) {
  return createCdpTransport({
    socket,
    defaultTimeoutMs,
    describePage: (sessionId) => (sessionId ? "http://127.0.0.1:9/stays/unit-1" : "<unknown page>"),
    onEvent,
  });
}

test("A CDP call with no reply rejects after its timeout, naming the method and the page, and leaves nothing pending", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket);
  await assert.rejects(
    transport.send("Runtime.evaluate", { expression: "1" }, "session-1", { timeoutMs: 30 }),
    (error: unknown) => error instanceof Error &&
      error.message === "CDP Runtime.evaluate timed out after 30 ms (page http://127.0.0.1:9/<route:2>)"
  );
  assert.equal(transport.pendingCount(), 0, "the timed-out call was removed from the pending table");
});

test("A reply that arrives in time resolves the call and clears its timer", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket);
  const call = transport.send<{ value: number }>("Page.enable", {}, undefined, { timeoutMs: 10_000 });
  assert.equal(transport.pendingCount(), 1);
  socket.reply({ id: socket.lastId(), result: { value: 7 } });
  assert.deepEqual(await call, { value: 7 });
  assert.equal(transport.pendingCount(), 0);
});

test("A protocol error reply rejects the call with the error", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket);
  const call = transport.send("Target.closeTarget", { targetId: "t" });
  socket.reply({ id: socket.lastId(), error: { code: -32000, message: "No target" } });
  await assert.rejects(call, /No target/);
  assert.equal(transport.pendingCount(), 0);
});

test("When the socket closes, every pending call rejects naming its method, and nothing stays pending", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket);
  const first = transport.send("Page.navigate", { url: "about:blank" }, "session-1");
  const second = transport.send("Runtime.evaluate", { expression: "2" }, "session-1");
  assert.equal(transport.pendingCount(), 2);
  socket.close();
  await assert.rejects(first, /CDP socket closed \(code unknown, reason <empty>; browser exit status unavailable\) before Page\.navigate replied \(page http:\/\/127\.0\.0\.1:9\/<route:2>\)/);
  await assert.rejects(second, /CDP socket closed .* before Runtime\.evaluate replied/);
  assert.equal(transport.pendingCount(), 0);
});

test("Close diagnostics include scrubbed socket and browser status without URL credentials", async () => {
  const socket = new FakeSocket();
  const secret = "sentinel-private-reference";
  const pageUrl = `http://127.0.0.1:9/payments/paystack/callback/${secret}?reference=${secret}#${secret}`;
  const transport = createCdpTransport({
    socket,
    describePage: () => pageUrl,
    describeBrowserExit: () => "Chrome exit code 2, signal SIGTERM",
  });
  const pending = transport.send("Runtime.evaluate", { expression: "1" }, "session-1");
  socket.close({ code: 1006, reason: `connection ended at ${pageUrl}` });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /code 1006/);
    assert.match(error.message, /reason <redacted \d+ characters>/);
    assert.match(error.message, /Chrome exit code 2, signal SIGTERM/);
    assert.match(error.message, /http:\/\/127\.0\.0\.1:9\/<route:4>/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("A call made after the socket closed rejects at once and is not written to the socket", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket);
  socket.close();
  await assert.rejects(transport.send("Target.createTarget", { url: "about:blank" }), /CDP socket is closed; cannot send Target\.createTarget/);
  assert.equal(socket.sent.length, 0);
});

test("A per-call timeout overrides the transport default", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket, 60_000);
  await assert.rejects(transport.send("Page.reload", {}, "session-1", { timeoutMs: 5 }), /timed out after 5 ms/);
});

test("The default timeout is used when a call names none, and it is generous but finite", async () => {
  assert.ok(CDP_CALL_TIMEOUT_MS >= 30_000 && CDP_CALL_TIMEOUT_MS <= 120_000, `default ${CDP_CALL_TIMEOUT_MS} ms`);
  const socket = new FakeSocket();
  const transport = transportFor(socket, 5);
  await assert.rejects(transport.send("Page.enable", {}, "session-1"), /timed out after 5 ms/);
});

test("Event frames reach onEvent and do not settle a pending call", async () => {
  const socket = new FakeSocket();
  const events: string[] = [];
  const transport = transportFor(socket, 10_000, (message) => events.push(message.method));
  const call = transport.send("Page.enable", {}, "session-1");
  socket.reply({ method: "Page.frameNavigated", params: {}, sessionId: "session-1" });
  assert.deepEqual(events, ["Page.frameNavigated"]);
  assert.equal(transport.pendingCount(), 1, "the event did not settle the call");
  socket.reply({ id: socket.lastId(), result: {} });
  await call;
});

test("A frame that cannot be parsed is ignored and leaves pending calls alone", async () => {
  const socket = new FakeSocket();
  const transport = transportFor(socket, 10_000);
  const call = transport.send("Page.enable", {}, "session-1");
  (socket as unknown as { handlers: { message(data: unknown): void } }).handlers.message("not json");
  assert.equal(transport.pendingCount(), 1);
  socket.reply({ id: socket.lastId(), result: {} });
  await call;
});
