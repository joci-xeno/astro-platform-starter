// ATLASZ Control Center local server. Binds 127.0.0.1 ONLY. Defences: per-launch random token, Host allow-list (DNS rebinding),
// Origin check on POST (CSRF), JSON-only bodies <= 64 KB, passphrases never logged or echoed, no CORS.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createControlCenterCore } from "./core.mjs";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createControlCenterServer(opts = {}) {
  const core = createControlCenterCore(opts);
  const token = opts.token ?? randomBytes(24).toString("hex");
  let port = 0;
  const get = { "/api/status": () => core.status(), "/api/opportunities": () => core.opportunities(), "/api/approvals": () => core.approvals(), "/api/backups": () => core.backups(),
    "/api/finance": () => core.finance(), "/api/documents": () => core.documents(), "/api/brain": () => core.brain(), "/api/inbox": () => core.inbox(), "/api/voice": () => core.voice(), "/api/connectors": () => core.connectors(), "/api/techwatch": () => core.techWatch(), "/api/evidence": () => core.evidence(), "/api/brief": () => core.brief(), "/api/prefs": () => core.prefs(), "/api/plugins": () => core.plugins(), "/api/theme": () => core.theme(), "/api/doctor": () => core.doctor(), "/api/updates": () => core.updates() };
  const post = {
    "/api/owner-key": b => core.provisionOwnerKey(b), "/api/approvals/decide": b => core.decideApproval(b), "/api/emergency": b => core.setEmergency(b), "/api/safe-mode/exit": b => core.exitSafeMode(b),
    "/api/brain/command": b => core.brainCommand(b), "/api/runtime/start": () => core.startRuntime(), "/api/runtime/stop": () => core.stopRuntime(),
    "/api/backup": b => core.backupNow(b), "/api/backup/drill": () => core.drill(), "/api/backup/mark-lkg": b => core.markLastKnownGood(b),
    "/api/restore/lkg": b => core.restoreLastKnownGood(b), "/api/restore/backup": b => core.restoreFromBackup(b),
    "/api/updates/check": () => core.updateActions.check(), "/api/updates/test": b => core.updateActions.test(b), "/api/updates/install": b => core.updateActions.install(b),
    "/api/chat": b => core.chat(b), "/api/prefs": b => core.setPrefs(b), "/api/plugins/enable": b => core.pluginActions.enable(b), "/api/plugins/disable": b => core.pluginActions.disable(b), "/api/plugins/theme": b => core.pluginActions.setTheme(b), "/api/plugins/reset": b => core.pluginActions.resetQuarantine(b),
    "/api/updates/rollback": b => core.updateActions.rollback(b), "/api/updates/auto": b => core.updateActions.setAuto(b), "/api/updates/unfreeze": b => core.updateActions.unfreeze(b)
  };
  const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(obj)); };
  const readBody = req => new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on("data", c => { n += c.length; if (n > 65536) { reject(new Error("BODY_TOO_LARGE")); req.destroy(); } else parts.push(c); });
    req.on("end", () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {}); } catch { reject(new Error("INVALID_JSON")); } });
    req.on("error", reject);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || "");
      if (host !== "127.0.0.1:" + port && host !== "localhost:" + port) return send(res, 403, { error: "HOST_NOT_ALLOWED" });
      const url = new URL(req.url, "http://" + host);
      const route = url.pathname;
      if (!route.startsWith("/api/")) {                                   // static UI (no secrets inside); token handed over via URL once, then sessionStorage
        const file = route === "/" ? "index.html" : route.slice(1);
        const full = path.resolve(PUBLIC, file);
        if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || req.method !== "GET") return send(res, 404, { error: "NOT_FOUND" });
        res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] ?? "application/octet-stream", "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
        return res.end(fs.readFileSync(full));
      }
      if (!safeEq(req.headers["x-atlasz-token"] ?? "", token)) return send(res, 401, { error: "TOKEN_REQUIRED" });
      if (req.method === "GET" && get[route]) return send(res, 200, await get[route]());
      if (req.method === "POST" && post[route]) {
        const origin = req.headers.origin;
        if (origin && origin !== "http://127.0.0.1:" + port && origin !== "http://localhost:" + port) return send(res, 403, { error: "ORIGIN_NOT_ALLOWED" });
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "JSON_REQUIRED" });
        const body = await readBody(req);
        try { return send(res, 200, { ok: true, result: await post[route](body) }); }
        catch (e) { return send(res, 400, { ok: false, error: String(e.message).replace(/passphrase[^,}]*/gi, "[redacted]") }); }   // owner-denied / validation errors, never the secret
      }
      return send(res, 404, { error: "NOT_FOUND" });
    } catch (e) { return send(res, 400, { error: String(e.message) }); }
  });
  const listen = (p = 0) => new Promise(resolve => server.listen(p, "127.0.0.1", () => { port = server.address().port; resolve({ port, token, url: "http://127.0.0.1:" + port + "/#" + token }); }));
  const close = async () => { await core.stopRuntime(); await new Promise(r => server.close(r)); };
  return { core, server, listen, close, token };
}

// Direct launch (used by the Electron shell and by `npm run control-center` for development in a normal browser).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.ATLASZ_HOME || path.join(process.env.APPDATA || path.join(process.env.HOME || ".", ".config"), "ATLASZ");
  const cc = createControlCenterServer({ stateDir: path.join(base, "state"), configDir: path.join(base, "config"), port: Number(process.env.ATLASZ_RUNTIME_PORT || 8080) });
  cc.listen(Number(process.env.ATLASZ_CC_PORT || 0)).then(i => {
    console.log("ATLASZ Control Center: " + i.url);
    // Interim launcher (no Electron): open the default browser on the token URL. Set ATLASZ_OPEN_BROWSER=0 to disable.
    if (process.env.ATLASZ_OPEN_BROWSER !== "0") {
      const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", i.url]] : process.platform === "darwin" ? ["open", [i.url]] : ["xdg-open", [i.url]];
      try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref(); } catch { /* user can open the URL manually */ }
    }
  });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => cc.close().then(() => process.exit(0)));
}
