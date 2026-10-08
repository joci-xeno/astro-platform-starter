// HTTP surface of the canonical runtime (Task 4 / M1.1, ATLASZ-T3-001). Before this module the server bound 0.0.0.0 and served the whole dashboard, the lead list and the event log
// to anyone who could reach the port. Now:
//   GET /health            open, MINIMAL: {ok, version}. It exists so a platform health check can work; it reveals no state, counts or topology.
//   everything else        needs the runtime token (header x-atlasz-token or Authorization: Bearer). Fail closed: with no token configured every protected route answers 503, never 200.
//   non-GET                405 for everyone (read-only surface).
// The token comes from ATLASZ_RUNTIME_TOKEN (the Control Center generates one per run and passes it to the runtime it starts). Comparison is constant-time. Repeated wrong
// tokens from one address are throttled (429) so the token cannot be brute-forced over the wire. The bind address is NOT changed here: changing external reachability is the owner's decision.
import { timingSafeEqual, createHash } from "node:crypto";

const MIN_TOKEN_LEN = 24;
const safeEq = (a, b) => { const x = createHash("sha256").update(String(a)).digest(), y = createHash("sha256").update(String(b)).digest(); return timingSafeEqual(x, y); };

export function createRuntimeHandler({ runtime, version, token = process.env.ATLASZ_RUNTIME_TOKEN, maxFailures = 10, windowMs = 60000, now = () => Date.now() }) {
  const configured = typeof token === "string" && token.length >= MIN_TOKEN_LEN;
  const fails = new Map();                                                 // remote address -> [timestamps]
  const throttled = addr => { const t = (fails.get(addr) ?? []).filter(x => now() - x < windowMs); fails.set(addr, t); return t.length >= maxFailures; };
  const failed = addr => { const t = fails.get(addr) ?? []; t.push(now()); fails.set(addr, t); if (fails.size > 1000) fails.clear(); };
  const presented = req => { const h = req.headers["x-atlasz-token"]; if (typeof h === "string" && h) return h; const a = req.headers.authorization; return typeof a === "string" && /^Bearer\s+/i.test(a) ? a.replace(/^Bearer\s+/i, "") : ""; };
  const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(obj)); };
  return function handle(req, res) {
    try {
      const route = (req.url || "/").split("?")[0];
      if (req.method !== "GET") return send(res, 405, { error: "read_only" });
      if (route === "/health") return send(res, 200, { ok: true, version });
      const addr = req.socket?.remoteAddress ?? "unknown";
      if (!configured) return send(res, 503, { error: "auth_not_configured" });
      if (throttled(addr)) return send(res, 429, { error: "too_many_attempts" });
      const given = presented(req);
      if (!given || !safeEq(given, token)) { failed(addr); return send(res, 401, { error: "unauthorized" }); }
      if (route === "/opportunities") {
        const rt = runtime;
        return send(res, 200, { count: rt.state.leads.length, topActionable: [], opportunities: rt.state.leads.map(({ description, assessment, ...l }) => ({ ...l, score: assessment.score, checks: assessment.checks })), warning: "Unverified candidates are not approved for outreach." });
      }
      if (route === "/events") return send(res, 200, runtime.state.events.slice(-100));
      if (route === "/" || route === "/status" || route === "/revenue") return send(res, 200, runtime.dashboard());
      return send(res, 404, { error: "not_found" });
    } catch { return send(res, 500, { error: "internal_error" }); }                  // never leak a stack or state through an error
  };
}
export const RUNTIME_TOKEN_MIN_LENGTH = MIN_TOKEN_LEN;
