// Guest gallery walkthrough: a guest server whose first apartment has seven generated photos. Local test data only.
// The photos use the pilot-local.invalid host, which the full page (localPhotoUrl) and the chat client both map to
// this origin; a small front server generates them and proxies everything else to the guest server.
import { createServer, request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";

const HOST = "https://pilot-local.invalid";
const colours = ["#2f6f4f", "#8a5a2b", "#3a5a8c", "#7a3b5c", "#4f6b2f", "#8c6a3a", "#2f5f6f"];
const rooms = ["Living room", "Main bedroom", "Kitchen", "Second bedroom", "Bathroom", "Balcony", "Pool"];

const environment = new LocalGuestEnvironment({ databasePath: join(mkdtempSync(join(tmpdir(), "gallery-walk-")), "guest.sqlite") });
const unit = environment.unitRepository.findAll()[0]!;
environment.unitRepository.save({ ...unit, photoUrls: rooms.map((_, index) => `${HOST}/photos/photo-${index + 1}.svg`) });
const guest = startLocalGuestServer({ port: 0, environment, localPhotoUrl: (url) => url.startsWith(`${HOST}/photos/`) ? url.slice(HOST.length) : url });
const guestPort = await guest.listen();

const front = createServer((req, res) => {
  const photo = /^\/photos\/photo-(\d)\.svg$/.exec(new URL(req.url ?? "/", "http://localhost").pathname);
  if (photo) {
    const index = Number(photo[1]) - 1;
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="${colours[index] ?? "#555"}"/><text x="600" y="430" font-family="sans-serif" font-size="84" fill="#fff" text-anchor="middle">${rooms[index] ?? "Photo"}</text><text x="600" y="540" font-family="sans-serif" font-size="56" fill="#fff" text-anchor="middle" opacity=".8">Photo ${index + 1} of ${rooms.length}</text></svg>`);
    return;
  }
  const upstream = request({ host: "127.0.0.1", port: guestPort, path: req.url, method: req.method, headers: req.headers }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end("Guest server unavailable"); });
  req.pipe(upstream);
});
front.listen(3019, () => console.log(`Gallery walkthrough on http://localhost:3019/stays/${unit.id}`));
