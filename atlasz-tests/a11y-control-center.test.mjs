// A13 through the real Control Center: authenticated route, complete vs incomplete verdicts, fixed targets only (no URL/path/SSRF), size and field limits, worker timeout/failure, UI view present.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot(extra = {}) {
  const base = tmp("a11yc-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort(), ...extra }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (b, t = token, raw_) => raw(port, "/api/a11y/audit", { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: raw_ ?? JSON.stringify(b) });
  return { post, port, H, token, done: async () => { await cc.close?.(); rm(base); } };
}
const BAD = { target: "custom", html: "<html><body><img src=x></body></html>", css: ":root{--bg:#fff;--panel:#fff;--ink:#000}.low{color:#ccc;background:#fff}" };

test("route is authenticated; the console audit completes with real colour pairs and reports no WCAG claim", async () => {
  const t = await boot();
  try {
    assert.equal((await t.post({}, null)).status, 401); assert.equal((await t.post({}, "wrong")).status, 401);
    const r = await t.post({}); assert.equal(r.status, 200, r.body); const a = JSON.parse(r.body).result;
    assert.equal(a.ok, true); assert.equal(a.target, "control-center"); assert.equal(a.wcagClaim, "NONE"); assert.ok(a.contrast.pairsChecked >= 40); assert.equal(a.complete, true); assert.equal(a.verdict, "NO_FAILS_BY_THESE_CHECKS");
    assert.match(a.note, /cannot establish compliance/);
  } finally { await t.done(); }
});

test("findings carry severity, location and remediation; a partial audit is INCOMPLETE and never clean", async () => {
  const t = await boot();
  try {
    const a = JSON.parse((await t.post(BAD)).body).result; assert.equal(a.verdict, "FAIL_FOUND");
    for (const rule of ["CONTRAST", "IMG_ALT", "LANDMARK_MAIN"]) { const f = a.findings.find(x => x.rule === rule); assert.ok(f, rule); assert.ok(["FAIL", "WARN", "INFO"].includes(f.severity)); assert.ok(f.location && f.remediation.length > 20, rule); }
    assert.match(a.findings.find(x => x.rule === "CONTRAST").location, /\.low/);
    const partial = JSON.parse((await t.post({ target: "custom", html: "<!doctype html><html lang=en><head><title>t</title><meta name=viewport content='width=device-width'></head><body><main>x</main></body></html>" })).body).result;
    assert.equal(partial.verdict, "INCOMPLETE_AUDIT"); assert.equal(partial.complete, false); assert.ok(partial.incomplete.includes("NO_CSS_SUPPLIED"));
    const empty = JSON.parse((await t.post({ target: "custom" })).body).result; assert.notEqual(empty.verdict, "NO_FAILS_BY_THESE_CHECKS");
  } finally { await t.done(); }
});

test("negative: no URL / path / file fetching, no unknown fields, bad types, text with the console target, oversize and non-JSON bodies", async () => {
  const t = await boot(); const err = async (b, raw_) => { const r = await t.post(b, undefined, raw_); assert.equal(r.status, 400, r.body); return r.body; };
  try {
    for (const k of ["url", "path", "file", "href", "src", "__proto__", "command"]) assert.match(await err(JSON.parse(`{"${k}":"http://169.254.169.254/latest/meta-data/"}`)), /A11Y_UNSUPPORTED_FIELD/, k);
    assert.match(await err({ target: "http://example.org" }), /A11Y_TARGET_INVALID/); assert.match(await err({ target: "file:///etc/passwd" }), /A11Y_TARGET_INVALID/);
    assert.match(await err({ target: "custom", html: 5 }), /A11Y_TEXT_MUST_BE_STRINGS/); assert.match(await err({ target: "custom", html: { a: 1 } }), /A11Y_TEXT_MUST_BE_STRINGS/);
    assert.match(await err({ html: "<p>x</p>" }), /A11Y_TEXT_ONLY_WITH_CUSTOM_TARGET/); assert.match(await err({ target: "custom", html: "a".repeat(61000) }), /A11Y_INPUT_TOO_LARGE/);
    await err(null, "[1,2]"); await err(null, "not json");
    assert.equal((await t.post(null, undefined, JSON.stringify({ target: "custom", html: "a".repeat(70000) }))).status, 413);
    assert.equal((await raw(t.port, "/api/a11y/audit", { method: "POST", headers: { host: "evil.example", "content-type": "application/json", "x-atlasz-token": t.token }, body: "{}" })).status, 403);
  } finally { await t.done(); }
});

test("an engine that crashes or hangs yields AUDIT_NOT_COMPLETED (never a clean verdict) and the server keeps serving", async () => {
  const dir = tmp("a11yw-"); const crash = path.join(dir, "crash.mjs"), hang = path.join(dir, "hang.mjs");
  fs.writeFileSync(crash, 'throw new Error("boom");'); fs.writeFileSync(hang, "while (true) {}");
  try {
    for (const [file, reason] of [[crash, "AUDIT_ENGINE_FAILED"], [hang, "AUDIT_TIMEOUT"]]) {
      const t = await boot({ a11yWorkerUrl: new URL("file://" + file), a11yTimeoutMs: 400 });
      try { const a = JSON.parse((await t.post({})).body).result; assert.equal(a.ok, false); assert.equal(a.verdict, "AUDIT_NOT_COMPLETED"); assert.equal(a.reason, reason); assert.equal(a.findings, undefined); assert.equal((await t.post(BAD)).status, 200); } finally { await t.done(); }
    }
  } finally { rm(dir); }
});

test("an engine that answers with a wrong-shaped result (a fake clean verdict) is rejected as AUDIT_ENGINE_FAILED", async () => {
  const dir = tmp("a11ys-"); const files = {
    clean: 'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ ok: true, result: { ok: true, verdict: "NO_FINDINGS_BY_THESE_RULES" } });',
    string: 'import { parentPort } from "node:worker_threads"; parentPort.postMessage("all good");',
    badFindings: 'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ ok: true, result: { ok: true, verdict: "NO_FINDINGS_BY_THESE_RULES", counts: { FAIL: 0, WARN: 0 }, findings: "none", complete: true } });',
  };
  try {
    for (const [name, src] of Object.entries(files)) {
      const f = path.join(dir, name + ".mjs"); fs.writeFileSync(f, src);
      const t = await boot({ a11yWorkerUrl: new URL("file://" + f), a11yTimeoutMs: 2000 });
      try { const a = JSON.parse((await t.post({})).body).result; assert.equal(a.ok, false, name); assert.equal(a.verdict, "AUDIT_NOT_COMPLETED", name); assert.equal(a.reason, "AUDIT_ENGINE_FAILED", name); } finally { await t.done(); }
    }
  } finally { rm(dir); }
});

test("the UI view exists, is navigable and uses only the audit route", () => {
  const js = fs.readFileSync(new URL("../atlasz-control-center/public/app.js", import.meta.url), "utf8");
  assert.match(js, /a11y: "Accessibility audit"/); assert.match(js, /views\.a11y = async/); assert.match(js, /\/api\/a11y\/audit/); assert.match(js, /Audit this console/);
  assert.ok(!/fetch\(\s*(?:x|u|url)/i.test(js.slice(js.indexOf("views.a11y"), js.indexOf("views.sandbox"))), "the view never fetches a user-supplied address");
});

test("engine: every reason for an incomplete audit blocks a clean verdict on its own", async () => {
  const { auditAccessibility } = await import("../atlasz-addons/a11y-audit.mjs");
  const HTML = "<!doctype html><html lang=en><head><title>t</title><meta name=viewport content='width=device-width, initial-scale=1'></head><body><main>x</main></body></html>";
  const CSS = ":root{--bg:#fff;--panel:#fff;--ink:#000}body{color:var(--ink);background:var(--bg)}";
  const ok = auditAccessibility({ html: HTML, css: CSS }); assert.equal(ok.verdict, "NO_FAILS_BY_THESE_CHECKS"); assert.deepEqual(ok.incomplete, []);
  const unresolved = auditAccessibility({ html: HTML, css: CSS + ".x{color:var(--missing)}" }); assert.equal(unresolved.verdict, "INCOMPLETE_AUDIT"); assert.ok(unresolved.incomplete.some(r => r.startsWith("CONTRAST_PAIRS_UNRESOLVED")));
  const none = auditAccessibility({ html: HTML, css: "/* nothing declared */ .y{margin:0}" }); assert.equal(none.verdict, "INCOMPLETE_AUDIT"); assert.ok(none.incomplete.includes("NO_CONTRAST_PAIRS_CHECKED"));
  const noHtml = auditAccessibility({ html: "  ", css: CSS }); assert.ok(noHtml.incomplete.includes("NO_HTML_SUPPLIED")); assert.notEqual(noHtml.verdict, "NO_FAILS_BY_THESE_CHECKS");
  const imgs = "<img src=x>".repeat(400); const trunc = auditAccessibility({ html: HTML.replace("<main>x</main>", "<main>" + imgs + "</main>"), css: CSS });
  assert.equal(trunc.truncated, true); assert.equal(trunc.verdict, "FAIL_FOUND");
  const warnTrunc = auditAccessibility({ html: HTML.replace("<main>x</main>", "<main>" + "<a tabindex=3>a</a>".repeat(400) + "</main>"), css: CSS }); assert.equal(warnTrunc.truncated, true); assert.ok(warnTrunc.incomplete.includes("FINDINGS_TRUNCATED"));
});

test("verifier findings: at-rules, nested CSS, dropped selectors and [data-theme=dark] can never yield a clean verdict by silence; empty html invents no failures; totals are true totals", async () => {
  const { auditAccessibility } = await import("../atlasz-addons/a11y-audit.mjs");
  const HTML = "<!doctype html><html lang=en><head><title>t</title><meta name=viewport content='width=device-width, initial-scale=1'></head><body><main>x</main></body></html>";
  const GOOD = "z{color:#000;background:#fff}", a = css => auditAccessibility({ html: HTML, css });
  assert.equal(a(GOOD).verdict, "NO_FAILS_BY_THESE_CHECKS");
  for (const css of ["@supports (display:grid){b{color:#ccc;background:#fff}}", "@layer base{b{color:#ccc;background:#fff}}", "@container (min-width:1px){b{color:#ccc;background:#fff}}"]) { const r = a(GOOD + css); assert.equal(r.verdict, "FAIL_FOUND", css); assert.ok(r.findings.some(f => f.rule === "CONTRAST"), "grouping at-rules are read, not skipped: " + css); }
  const weird = a(GOOD + "@unknownrule x{b{color:#ccc;background:#fff}}"); assert.equal(weird.verdict, "INCOMPLETE_AUDIT"); assert.ok(weird.incomplete.some(x => x.startsWith("UNSUPPORTED_AT_RULE")));
  const nested = a(GOOD + "p{color:#000;& i{color:#ccc;background:#fff}}"); assert.equal(nested.verdict, "INCOMPLETE_AUDIT"); assert.ok(nested.incomplete.some(x => x.startsWith("NESTED_CSS_RULES")));
  const drop = a(GOOD + "b{color:#ccc}"); assert.equal(drop.verdict, "INCOMPLETE_AUDIT"); assert.ok(drop.incomplete.some(x => x.startsWith("COLOUR_RULES_NOT_EVALUATED")), JSON.stringify(drop.incomplete));
  const dark = a(":root{--bg:#fff;--panel:#fff;--ink:#000}:root[data-theme=dark]{--bg:#000;--panel:#000;--ink:#111}body{color:var(--ink);background:var(--bg)}"); assert.equal(dark.verdict, "FAIL_FOUND", "dark theme via data-theme is audited"); assert.ok(dark.findings.some(f => f.rule === "CONTRAST" && f.theme === "dark"));
  const empty = auditAccessibility({ html: "", css: GOOD }); assert.deepEqual(empty.findings.filter(f => ["HTML_LANG", "TITLE", "LANDMARK_MAIN"].includes(f.rule)), [], "nothing supplied is not a failure of the page"); assert.equal(empty.verdict, "INCOMPLETE_AUDIT");
  const focus = a(GOOD + ".btn:focus{outline:none}.k:focus{outline-style:none}"); assert.equal(focus.findings.filter(f => f.rule === "FOCUS_REMOVED").length, 2);
  const many = auditAccessibility({ html: HTML.replace("<main>x</main>", "<main>" + "<img src=x>".repeat(400) + "</main>"), css: GOOD }); assert.equal(many.truncated, true); assert.equal(many.counts.FAIL, 400, "counts are the true totals");
});

test("UI: the real view code renders the real HTTP response (verdict, counts, findings table) and a failed audit message", async () => {
  const js = fs.readFileSync(new URL("../atlasz-control-center/public/app.js", import.meta.url), "utf8");
  const src = js.slice(js.indexOf("const show = r => {", js.indexOf("views.a11y")), js.indexOf("const run = body =>", js.indexOf("views.a11y")));
  const seen = []; const h = (...a) => ({ h: a }), note = (t, k) => { seen.push(["note", t, k]); return { note: t }; }, table = (cols, rows) => { seen.push(["table", cols, rows]); return { table: rows }; }, pill = x => String(x);
  const out = { replaceChildren: (...c) => seen.push(["out", c.length]) };
  const show = new Function("out", "note", "table", "pill", src + "; return show;")(out, note, table, pill);
  const t = await boot();
  try {
    const res = JSON.parse((await t.post(BAD)).body); show(res.result);
    assert.ok(seen.some(x => x[0] === "note" && /Verdict: FAIL_FOUND/.test(x[1]))); const tb = seen.find(x => x[0] === "table"); assert.ok(tb[2].length >= 3 && tb[2].every(r => r.length === 5));
    seen.length = 0; show({ ok: false, reason: "AUDIT_TIMEOUT", note: "x" }); assert.ok(seen.some(x => x[0] === "note" && /did not complete \(AUDIT_TIMEOUT\)/.test(x[1]) && x[2] === "bad"));
  } finally { await t.done(); }
});
