// Receive-only HTTP endpoint for processor webhooks. It is NOT started automatically and listens on loopback unless the owner explicitly chooses another host: exposing it to the internet
// (tunnel / reverse proxy / hosting) is an owner decision outside this code. It accepts POST /payments/webhook only, reads the RAW body with a hard size and time limit, and hands it to the
// payment-event ledger, which verifies the signature. It can never move money, reads no secret itself, and answers with status codes only (no internals).
import http from "node:http";

export const WEBHOOK_PATH = "/payments/webhook";
/** createWebhookReceiver({ingest, isStopped, maxBytes, readTimeoutMs}) -> {handler, start(port, host), stop()} */
export function createWebhookReceiver({ ingest, isStopped = () => false, maxBytes = 262144, readTimeoutMs = 5000 } = {}) {
  if (typeof ingest !== "function") throw new Error("INGEST_REQUIRED");
  let server = null;
  const reply = (res, code, body = "") => { if (!res.headersSent) { res.writeHead(code, { "content-type": "text/plain", "cache-control": "no-store" }); } res.end(body); };
  function handler(req, res) {
    if (req.url?.split("?")[0] !== WEBHOOK_PATH) return reply(res, 404);
    if (req.method !== "POST") { res.setHeader("allow", "POST"); return reply(res, 405); }
    if (isStopped()) return reply(res, 503, "stopped");                                         // processor retries later; nothing is recorded while the owner stop is active
    const len = Number(req.headers["content-length"]); if (Number.isFinite(len) && len > maxBytes) { req.destroy(); return reply(res, 413); }
    const chunks = []; let size = 0, done = false; const timer = setTimeout(() => { if (!done) { done = true; req.destroy(); reply(res, 408); } }, readTimeoutMs);
    req.on("data", c => { size += c.length; if (size > maxBytes) { if (!done) { done = true; clearTimeout(timer); reply(res, 413); req.destroy(); } return; } chunks.push(c); });
    req.on("error", () => { if (!done) { done = true; clearTimeout(timer); reply(res, 400); } });
    req.on("end", () => {
      if (done) return; done = true; clearTimeout(timer);
      let r; try { r = ingest({ provider: "stripe", rawBody: Buffer.concat(chunks), signatureHeader: String(req.headers["stripe-signature"] ?? "") }); } catch { return reply(res, 500); }
      const st = r?.status;
      if (r?.ok) return reply(res, 200, "ok");                                                   // PROCESSED, DUPLICATE, IGNORED_* and RECORDED_UNINTERPRETED all acknowledge (no retry storm)
      if (st === "SECRET_NOT_CONFIGURED") return reply(res, 503, "not configured");
      if (st === "CONFLICT") return reply(res, 409);
      return reply(res, st === "REJECTED_MALFORMED" ? 400 : 401);
    });
  }
  const start = (port, host = "127.0.0.1") => new Promise((resolve, reject) => { if (server) return reject(new Error("ALREADY_STARTED")); server = http.createServer(handler); server.requestTimeout = readTimeoutMs + 1000; server.headersTimeout = readTimeoutMs; server.once("error", reject); server.listen(port, host, () => resolve(server.address())); });
  const stop = () => new Promise(resolve => { if (!server) return resolve(); const s = server; server = null; s.close(() => resolve()); s.closeAllConnections?.(); });
  return { handler, start, stop, path: WEBHOOK_PATH };
}
