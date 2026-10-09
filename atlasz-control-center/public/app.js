// ATLASZ Control Center UI. All dynamic text goes through textContent (runtime data includes external text).
const TOKEN = (() => { const h = location.hash.slice(1); if (h) { try { sessionStorage.setItem("t", h); } catch {} history.replaceState(null, "", location.pathname); } try { return sessionStorage.getItem("t") || ""; } catch { return h; } })();
const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); if (/^(input|textarea|select)$/.test(tag) && attrs.placeholder && !attrs["aria-label"] && !attrs.id) e.setAttribute("aria-label", String(attrs.placeholder)); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? { headers: { "x-atlasz-token": TOKEN } } : { method: "POST", headers: { "x-atlasz-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "BAD_RESPONSE" }));
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
};
const tone = s => /^(OK|LIVE|HEALTHY|RUNNING|INSTALLED|SCHEDULED|READY|UNLOCKED|NORMAL)$/.test(s) ? "ok" : /FAIL|BLOCKED|BROKEN|STOP|PAUSE|SAFE_MODE|HALTED|UNHEALTHY|TAMPER|NOT_RUNNING|ERROR|PLACEHOLDER|LOCKED/.test(s) ? "bad" : "warn";
const pill = s => h("span", { class: "pill " + tone(String(s)) }, String(s ?? "—"));
const card = (k, v, d) => h("div", { class: "card" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), d ? h("div", { class: "d" }, d) : null);
const note = (t, c = "") => h("div", { class: "note " + c }, t);
const table = (cols, rows) => h("table", {}, h("thead", {}, h("tr", {}, cols.map(c => h("th", {}, c)))), h("tbody", {}, rows.length ? rows.map(r => h("tr", {}, r.map(c => h("td", { class: "wrap" }, c)))) : h("tr", {}, h("td", { colspan: cols.length }, "Nothing to show."))));

function ask({ title, text, fields = [], confirmWord = null, danger = false, ok = "Confirm" }) {
  return new Promise(resolve => {
    const dlg = $("#dlg"), form = $("#dlgForm"); form.replaceChildren();
    const inputs = {};
    form.append(h("h3", {}, title), text ? h("p", {}, text) : null);
    for (const f of fields) { const i = f.long ? h("textarea", { rows: 3 }) : h("input", { type: f.secret ? "password" : "text", autocomplete: "off" }); inputs[f.name] = i; form.append(h("label", {}, f.label), i); }
    let typed = null; if (confirmWord) { typed = h("input", { type: "text", autocomplete: "off" }); form.append(h("label", {}, 'Type "' + confirmWord + '" to confirm'), typed); }
    const err = h("div", { class: "note bad", hidden: true });
    form.append(err, h("div", { class: "row", style: "margin-top:14px" },
      h("button", { class: "btn " + (danger ? "danger" : "primary"), type: "button", onclick: () => { if (confirmWord && typed.value !== confirmWord) { err.hidden = false; err.textContent = "Confirmation text does not match."; return; } const out = {}; for (const [k, i] of Object.entries(inputs)) out[k] = i.value; dlg.close(); resolve(out); } }, ok),
      h("button", { class: "btn", type: "button", onclick: () => { dlg.close(); resolve(null); } }, "Cancel")));
    dlg.showModal();
  });
}
const PASS = { name: "passphrase", label: "Owner key passphrase", secret: true };
async function act(label, path, body, after) {
  try { const r = await api(path, body); toast(label + ": done", "ok"); if (after) await after(r); render(); return r; }
  catch (e) { toast(label + " failed: " + e.message, "bad"); return null; }
}
let toastEl; function toast(t, c) { toastEl?.remove(); toastEl = note(t, c); $("#main").prepend(toastEl); setTimeout(() => toastEl?.remove(), 9000); }

const fmtUp = sec => { const d = Math.floor(sec / 86400), hh = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return (d ? d + "d " : "") + hh + "h " + m + "m"; };
const usd = n => "$" + Number(n ?? 0).toFixed(2);
const THEME_OK = /^--[a-z][a-z0-9-]{0,40}$/;
async function applyTheme() { try { const t = await api("/api/theme"); for (const [k, v] of Object.entries(t.variables ?? {})) if (THEME_OK.test(k)) document.documentElement.style.setProperty(k, String(v)); } catch { /* theme is cosmetic */ } }
const views = {
  async home() {
    const b = await api("/api/brief");
    const out = h("div", { class: "card mono", id: "chatout", style: "white-space:pre-wrap;margin-top:12px" }, "Ask: status, approvals, money.");
    const inp = h("input", { id: "chatin", placeholder: "status / approvals / money", style: "width:60%;padding:8px" });
    const send = async () => { const r = await api("/api/chat", { q: inp.value }); out.textContent = r.text; inp.value = ""; };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
    return [h("h2", {}, "Home"), h("div", { class: "card", style: "white-space:pre-wrap" }, b.text), note("Brief built only from current state. No language model is connected, so chat answers are limited and never guessed."),
      h("div", { class: "row" }, inp, h("button", { class: "btn primary", onclick: send }, "Ask")), out,
      h("h2", {}, "Greeting settings"), h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => act("Language", "/api/prefs", { language: b.prefs.language === "hu" ? "en" : "hu" }) }, "Language: " + b.prefs.language.toUpperCase() + " (switch)"),
        h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Signature phrase", fields: [{ name: "signaturePhrase", label: "Phrase", value: b.prefs.signaturePhrase }], ok: "Save" }); if (r) act("Save phrase", "/api/prefs", { signaturePhrase: r.signaturePhrase }); } }, "Change phrase")), note("The phrase is only a friendly signature - never a credential.")];
  },
  async plugins() {
    const p = await api("/api/plugins"), mcpv = await api("/api/mcp"), repov = await api("/api/repos"), protov = await api("/api/prototypes");
    const PASS2 = PASS;
    return [h("h2", {}, "Plugins / Extensions / Themes"), note(p.note),
      table(["Name", "Kind", "Version", "Permissions", "Status", "Actions"], p.plugins.map(x => [x.name + " (" + x.id + ")", x.kind, x.version, x.permissions.join(", ") || "none", pill(x.status) , 
        h("div", { class: "row", style: "margin:0" },
          ["THEME", "SKIN"].includes(x.kind)
            ? h("button", { class: "btn", onclick: async () => { await act(x.activeTheme ? "Clear theme" : "Apply theme", "/api/plugins/theme", { id: x.activeTheme ? null : x.id }); applyTheme(); } }, x.activeTheme ? "Clear theme" : "Apply theme")
            : (x.status === "DISABLED" ? h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Enable " + x.name, text: "Declared permissions: " + (x.permissions.join(", ") || "none") + ". Runs in an isolated process with no secrets.", fields: [PASS2], ok: "Enable" }); if (r) act("Enable plugin", "/api/plugins/enable", { id: x.id, passphrase: r.passphrase }); } }, "Enable")
              : x.status === "QUARANTINED" ? h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Reset quarantine " + x.name, fields: [PASS2], ok: "Reset" }); if (r) act("Reset quarantine", "/api/plugins/reset", { id: x.id, passphrase: r.passphrase }); } }, "Reset quarantine")
              : h("span", {}, h("button", { class: "btn", onclick: () => act("Disable plugin", "/api/plugins/disable", { id: x.id }) }, "Disable"), x.kind === "PLUGIN" ? h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Run a hook of " + x.name, text: "Runs the exact code you approved, in an isolated process. Its answer is shown as untrusted data.", fields: [{ name: "hook", label: "Hook name (lowercase)" }], ok: "Run" }); if (r) act("Plugin hook (answer is untrusted data)", "/api/plugins/invoke", { id: x.id, hook: r.hook }); } }, "Run hook") : null)))])),
      h("h2", {}, "Install a package"), note("Put a package folder (plugin.json + files) into the plugin-inbox folder of your config directory. Installing needs your passphrase and is bound to the exact file contents (hash). New and upgraded plugins start DISABLED."),
      (p.inbox ?? []).length ? table(["Folder", "Plugin", "Permissions", "Content hash", "Action"], p.inbox.map(x => [x.name, x.ok ? x.id + " " + x.version + " (" + x.kind + ")" : "REJECTED: " + x.problems.join(", "), x.ok ? x.permissions.join(", ") || "none" : "-", x.ok ? x.hash.slice(0, 16) + "..." : "-",
        x.ok ? h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Install " + x.id + " " + x.version, text: "Files: " + x.files + ". Permissions: " + (x.permissions.join(", ") || "none") + ". It will be installed DISABLED.", fields: [PASS2], ok: "Install" }); if (r) act("Install plugin", "/api/plugins/install", { name: x.name, passphrase: r.passphrase }); } }, "Install") : "-"])) : note("The inbox is empty."),
      (p.installed ?? []).filter(x => x.installed).length ? [h("h2", {}, "Installed versions"), table(["Plugin", "Installed", "Kept for rollback", "Actions"], p.installed.filter(x => x.installed).map(x => [x.id, x.installed.version, x.kept.map(k => k.version).join(", ") || "-",
        h("div", { class: "row", style: "margin:0" }, ...x.kept.map(k => h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Roll back " + x.id + " to " + k.version, fields: [PASS2], ok: "Roll back" }); if (r) act("Roll back", "/api/plugins/rollback", { id: x.id, version: k.version, passphrase: r.passphrase }); } }, "Roll back to " + k.version)),
          h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Uninstall " + x.id, text: "Older versions stay available for rollback.", fields: [PASS2], ok: "Uninstall" }); if (r) act("Uninstall", "/api/plugins/uninstall", { id: x.id, passphrase: r.passphrase }); } }, "Uninstall"))]))] : null,
      h("h2", {}, "MCP tool servers (local only)"), note(mcpv.note),
      mcpv.servers.length ? table(["Server", "Description", "Status", "Tools", "Actions"], mcpv.servers.map(x => [x.id, x.description, pill(x.running ? "RUNNING" : "STOPPED"), x.tools.join(", ") || "-",
        h("div", { class: "row", style: "margin:0" }, x.running ? h("button", { class: "btn", onclick: () => act("Stop MCP server", "/api/mcp/stop", { id: x.id }) }, "Stop")
          : h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Start MCP server " + x.id, text: "Runs foreign code in a read-only, no-network sandbox. Approval is bound to the exact folder content.", fields: [PASS2], ok: "Start" }); if (r) act("Start MCP server", "/api/mcp/start", { id: x.id, passphrase: r.passphrase }); } }, "Start"),
          x.running ? h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Call a tool on " + x.id, text: "Tools: " + x.tools.join(", "), fields: [{ name: "tool", label: "Tool name" }, { name: "args", label: "Arguments (JSON)", value: "{}" }, PASS2], ok: "Call (signs these exact arguments)" }); if (r) act("MCP tool call", "/api/mcp/call", { id: x.id, tool: r.tool, args: JSON.parse(r.args || "{}"), passphrase: r.passphrase }); } }, "Call tool") : null)])) : note("No MCP server folders found in mcp-servers/."),
      mcpv.rejected.length ? note("Rejected MCP folders: " + mcpv.rejected.map(x => x.name + " (" + x.problems.join(", ") + ")").join("; "), "warn") : null,
      h("h2", {}, "Repositories (read-only analysis, sandboxed tests)"), note(repov.note),
      repov.repos.length ? table(["Repository", "Actions"], repov.repos.map(name => [name, h("div", { class: "row", style: "margin:0" },
        h("button", { class: "btn", onclick: () => act("Analyse " + name, "/api/repos/analyze", { name }, r => { window.__repoResult = { name, kind: "analysis", r: r.result?.result ?? r.result ?? r }; }) }, "Analyse"),
        h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Run tests of " + name, text: "Each test file runs alone in a read-only, no-network, no-child-process sandbox. Approval is bound to the exact analysed content.", fields: [PASS2], ok: "Run (signs this content)" }); if (r) act("Run tests", "/api/repos/test", { name, passphrase: r.passphrase }, x => { window.__repoResult = { name, kind: "tests", r: x.result?.result ?? x.result ?? x }; }); } }, "Run tests"))])) : note("No repository folders found in the config 'repos' folder."),
      window.__repoResult ? [h("h3", {}, "Last " + window.__repoResult.kind + ": " + window.__repoResult.name), h("pre", { class: "code" }, JSON.stringify(window.__repoResult.r, null, 2).slice(0, 6000))] : null,
      h("h2", {}, "Prototype builder (sandbox templates with generated tests)"), note(protov.note ?? protov.reason ?? "", protov.state === "CONNECTED" ? "info" : "warn"),
      protov.state === "CONNECTED" ? [h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "New prototype", text: "Templates: " + protov.templates.map(t => t.id).join(", ") + ". Parameters are JSON, e.g. {\"ops\":[\"slugify\"]} or {\"routes\":[{\"path\":\"/\",\"body\":\"hi\"}]}. Nothing is written until you press Generate.", fields: [{ name: "template", label: "Template", value: "text-transform" }, { name: "name", label: "Folder name (a-z, 0-9, -)" }, { name: "idea", label: "Idea (one line)" }, { name: "params", label: "Parameters (JSON)", value: "{}" }], ok: "Preview" }); if (!r) return; let params; try { params = JSON.parse(r.params || "{}"); } catch { return note("Parameters are not valid JSON.", "bad"); } const spec = { template: r.template, name: r.name, idea: r.idea, params };
          act("Preview prototype", "/api/prototypes/action", { op: "preview", args: spec }, async x => { const pv = x.result?.result ?? x.result ?? x; window.__protoResult = { kind: "preview", r: pv }; if (pv.ok) { const g = await ask({ title: "Generate " + spec.name + "?", text: "Files: " + pv.files.map(f => f.path).join(", "), ok: "Generate" }); if (g) act("Generate prototype", "/api/prototypes/action", { op: "generate", args: spec }); } }); } }, "New prototype…")),
      protov.prototypes.length ? table(["Prototype", "Template", "Status", "Actions"], protov.prototypes.map(x => [x.name, x.template, pill(x.status), h("div", { class: "row", style: "margin:0" },
        h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Run generated tests of " + x.name, text: "Runs in a read-only, no-network, no-child-process sandbox. Approval is bound to the exact content; a pass is not a production-readiness claim.", fields: [PASS2], ok: "Run (signs this content)" }); if (r) act("Run prototype tests", "/api/prototypes/action", { op: "test", args: { name: x.name, passphrase: r.passphrase } }, y => { window.__protoResult = { kind: "tests", name: x.name, r: y.result?.result ?? y.result ?? y }; }); } }, "Run tests"), x.template === "static-page" ? h("button", { class: "btn", onclick: () => act("Preview page", "/api/prototypes/action", { op: "previewPage", args: { name: x.name } }, y => { const r = y.result?.result ?? y.result ?? y; window.__protoResult = { kind: "page preview", name: x.name, r: r.ok ? { sha256: r.sha256, bytes: r.bytes, status: r.status, note: r.note } : r, srcdoc: r.ok ? r.srcdoc : null }; }) }, "Preview page") : null)])) : note("No prototypes yet."),
      window.__protoResult ? [h("h3", {}, "Last " + window.__protoResult.kind), window.__protoResult.srcdoc ? h("iframe", { sandbox: "", title: "Prototype page preview (sandboxed)", srcdoc: window.__protoResult.srcdoc, style: "width:100%;height:320px;border:1px solid #888;background:#fff" }) : null, h("pre", { class: "code" }, JSON.stringify(window.__protoResult.r, null, 2).slice(0, 6000))] : null] : null,
      p.rejected.length ? [h("h2", {}, "Rejected packages"), table(["Folder", "Problems"], p.rejected.map(x => [x.dir.split(/[\\/]/).slice(-1)[0], x.problems.join(", ")]))] : null];
  },
  async finance() {
    const f = await api("/api/finance");
    const jobs = Object.entries(f.profit.byJob ?? {});
    return [h("h2", {}, "Revenue / Costs / Profit"), note(f.note ?? "Only authoritative, evidenced figures are counted."),
      f.error ? note("Ledger problem: " + f.error, "bad") : null,
      h("div", { class: "grid" },
        card("Verified revenue", usd(f.revenue.verifiedReceivedUsd), f.revenue.source), card("Unconfirmed pipeline (not revenue)", usd(f.revenue.unconfirmedPipelineUsd), "invoiced/agreed, not received"),
        card("Documented costs", usd(f.costs.totalUsd), f.costs.records + " cost records"), card("Verified net profit", usd(f.profit.verifiedNetUsd), f.profit.basis ?? ""),
        card("Tokens in / out", f.costs.tokensIn + " / " + f.costs.tokensOut, "API token ledger"), card("Ledger integrity", pill(f.chain?.ok ? "OK" : "FAIL"), (f.entries ?? 0) + " entries")),
      h("h2", {}, "Costs by provider"), table(["Provider", "USD"], Object.entries(f.costs.byProvider).map(([k, v]) => [k, usd(v)])),
      h("h2", {}, "Per job"), table(["Job", "Verified received", "Cost", "Net"], jobs.map(([k, v]) => [k, usd(v.verifiedReceivedUsd), usd(v.costUsd), usd(v.verifiedNetProfitUsd)]))];
  },
  async evidence() {
    const e = await api("/api/evidence"); const liveList = h("ul", { class: "code", style: "max-height:16rem;overflow:auto;list-style:none;padding:.5rem;margin:0", "aria-live": "off" }), liveStatus = h("p", { class: "muted", role: "status" }, "Live: connecting...");
    startLive(liveList, liveStatus);
    return [h("h2", {}, "Live tool and progress feed"), note("Read-only stream of the Black Box (secrets redacted). It cannot change anything."), liveStatus, liveList, h("h2", {}, "Evidence / audit logs"), note(e.note), h("h2", {}, "Hash-chained logs"),
      table(["Log", "Present", "Intact", "Entries", "Head"], e.logs.map(l => [l.log, l.present ? "yes" : "no", l.present ? pill(l.ok ? "OK" : "FAIL") : "—", String(l.entries ?? ""), (l.head ?? "").slice(0, 16)])),
      h("h2", {}, "Evidence records"), e.records.length ? table(["File", "Environment", "Result", "When"], e.records.map(r => [r.file, r.environment ?? "?", r.result ?? "?", r.timestamp ?? ""])) : note("No evidence records found in the configured evidence directory.")];
  },
  async overview() {
    const s = await api("/api/status"), rt = s.runtime;
    return [h("h2", {}, "System status"), h("p", { class: "sub" }, "Honest status: nothing is shown LIVE without evidence."),
      h("div", { class: "grid" },
        card("Runtime", pill(rt.reachable ? rt.status : "NOT_RUNNING"), rt.reachable ? "v" + rt.version : String(rt.reason ?? "")),
        card("Topology", rt.reachable ? s.topology.actualSearch + " SEARCH + " + s.topology.actualExecution + " EXECUTION" : "Not running", "required 5 SEARCH + 25 EXECUTION = 30"),
        card("Owner key", pill(s.ownerKey.provisioned ? s.ownerKey.ownerAuthState : "NOT_PROVISIONED"), s.ownerKey.provisioned ? "Joci-only approvals" : "Owner Controls → create key"),
        card("Emergency stop", pill(s.emergency.mode), s.emergency.banner ?? ""),
        card("Safe Mode", pill(s.safeMode.mode), s.safeMode.reason ?? ""),
        card("Uptime", rt.reachable && s.uptime ? fmtUp(s.uptime.seconds) : "—", rt.reachable && s.uptime ? "since " + s.uptime.startedAt : "runtime not running"),
        card("Durable queue", s.queue ? s.queue.ready + " ready / " + s.queue.done + " done / " + s.queue.dead + " dead" : "—", s.queue ? "leased " + s.queue.leased : "runtime not reachable")),
      h("div", { class: "row" },
        h("button", { class: "btn primary big", disabled: rt.reachable && rt.managedByControlCenter, onclick: () => act("Start ATLASZ", "/api/runtime/start", {}) }, "Start ATLASZ"),
        h("button", { class: "btn big", onclick: () => act("Stop ATLASZ", "/api/runtime/stop", {}) }, "Stop ATLASZ")),
      s.blockers.length ? [h("h2", {}, "Blockers"), table(["Code", "Detail"], s.blockers.map(b => [b.code, b.detail]))] : null];
  },
  async agents() {
    const s = await api("/api/status"), row = a => [a.id, pill(a.status), a.currentTask ?? "", String(a.results), a.blocker ?? ""];
    const cols = ["Agent", "Status", "Task", "Results", "Blocker"];
    return [h("h2", {}, "Agents"), h("p", { class: "sub" }, "5 SEARCH/SALES + 25 EXECUTION = 30 (fixed)."), h("h2", {}, "SEARCH / SALES (" + s.agents.search.length + ")"), table(cols, s.agents.search.map(row)), h("h2", {}, "EXECUTION (" + s.agents.execution.length + ")"), table(cols, s.agents.execution.map(row))];
  },
  async jobs() {
    const o = await api("/api/opportunities");
    return [h("h2", {}, "Jobs / opportunities"), h("p", { class: "sub" }, "Leads need verification before any offer. Nothing here has been sent or won."),
      table(["Title", "Score", "Outreach", "Project", "Source"], o.items.map(l => [l.title ?? l.id, String(l.score ?? ""), l.outreachStatus, l.projectStatus, l.url ?? ""]))];
  },
  async money() {
    const s = await api("/api/status"), m = s.metrics ?? {};
    return [h("h2", {}, "Money Engine"), note(s.money.note), h("div", { class: "grid" },
      card("Confirmed paid (USD)", "$" + s.money.confirmedPaidUsd, "needs provider + signature + evidence"), card("Candidates found", String(m.candidatesFound ?? 0)), card("Active leads", String(m.activeLeads ?? 0)),
      card("Outreach sent", String(m.outreachSent ?? 0)), card("Won", String(m.won ?? 0)), card("Scope reviews", String(m.scopeReviews ?? 0))),
      ...await moneyEngineNodes()];
  },
  async approvals() {
    const a = await api("/api/approvals");
    const field = (k, v) => h("tr", {}, h("th", {}, k), h("td", { class: "wrap" }, v));
    const cardFor = r => h("div", { class: "card", style: "margin-bottom:12px" },
      h("div", { class: "k" }, r.action + " · " + r.subject + " · from " + r.requestedBy), h("div", { class: "v" }, r.what),
      h("table", {}, h("tbody", {}, field("Why", r.why), field("Cost", r.costUsd === 0 ? "$0 (no spend)" : "$" + r.costUsd), field("Risk", r.risk.level + " — " + r.risk.description), field("External effect", r.externalEffect),
        field("Reversible", r.reversible ? "Yes" : "NO — " + (r.irreversibleNote ?? "")), field("If you say no", r.ifOwnerSaysNo), field("No-spend alternative", r.noSpendAlternative), r.humanImpact ? field("Human impact", r.humanImpact.verdict + (r.humanImpact.reasons.length ? " — " + r.humanImpact.reasons.join(", ") : "")) : null)),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: async () => { const p = await ask({ title: "Approve: " + r.what, text: "Signs a 60-second approval with your key.", fields: [PASS], ok: "Approve" }); if (p) act("Approve", "/api/approvals/decide", { id: r.id, decision: "APPROVED", passphrase: p.passphrase }); } }, "Approve"),
        h("button", { class: "btn danger", onclick: () => act("Reject", "/api/approvals/decide", { id: r.id, decision: "REJECTED", reason: "Rejected in Control Center" }) }, "Reject")));
    return [h("h2", {}, "Approvals"), note(a.note), h("h2", {}, "Waiting for you (" + a.pending.length + ")"), a.pending.length ? a.pending.map(cardFor) : note("Nothing is waiting for approval.", "ok"),
      h("h2", {}, "Decided"), table(["Status", "Action", "What", "Reason"], a.decided.map(r => [pill(r.status), r.action, r.what, r.reason ?? ""])),
      h("h2", {}, "Signed approval history"), table(["Event", "Detail"], a.history.map(e => [e.event, JSON.stringify(e.data ?? {})]))];
  },
  async providers() {
    const s = await api("/api/status"), p = s.providers ?? {};
    const rows = Object.entries(p).filter(([, v]) => v && typeof v === "object").map(([k, v]) => [k, pill(v.state ?? (v.live ? "LIVE" : "—")), JSON.stringify(v).slice(0, 180)]);
    if (s.models) rows.unshift(["model-gateway", pill(s.models.live > 0 ? "LIVE" : "NO_PROVIDER_LIVE"), `registered ${s.models.registered} · live ${s.models.live} · degraded ${s.models.degraded} · untested ${s.models.untested} · no-spend default · ${s.models.note ?? ""}`]);
    return [h("h2", {}, "Model / tool / provider health"), h("p", { class: "sub" }, "LIVE requires probe evidence. Placeholders are shown as such."), table(["Component", "State", "Detail"], rows)];
  },
  async errors() {
    const [s, d] = await Promise.all([api("/api/status"), api("/api/doctor")]);
    return [h("h2", {}, "Errors & blockers"), table(["Source", "Error"], Object.entries(s.sourceErrors).map(([k, v]) => [k, v])), h("h2", {}, "Doctor findings"), table(["Severity", "Check", "Detail", "Remedy"], d.findings.map(f => [pill(f.severity), f.id, f.detail ?? "", f.remedy ?? ""]))];
  },
  async owner_safety() {
    const o = await api("/api/owner-safety"), out = [h("h2", {}, "Owner Safety / Control"), h("p", { class: "sub" }, "Joci is the final authority. Layers: owner authority → kill switch → security brain → financial firewall → independent verification → black box → safe mode → last known good → backup/restore → disaster recovery. Unknown stays UNKNOWN — never shown as healthy.")];
    const stop = async (label, mode, body) => { const r = await ask({ title: label, text: body, fields: [PASS], danger: true, ok: label }); if (r) act(label, "/api/owner-safety/action", { action: mode, passphrase: r.passphrase }); };
    out.push(o.killSwitch.banner ? note(o.killSwitch.banner + " — " + o.killSwitch.mode + ". Only Joci can release it.", "bad") : note("Kill switch armed — system RUNNING.", "ok"),
      h("div", { class: "row" },
        h("button", { class: "btn danger big", onclick: () => stop("EMERGENCY STOP", "EMERGENCY_STOP", "Stops all new dispatch and every external action. State, logs and evidence are preserved. Nothing is deleted.") }, "EMERGENCY STOP"),
        h("button", { class: "btn danger", onclick: () => stop("PAUSE EXTERNAL ACTIONS", "PAUSE_EXTERNAL_ACTIONS", "Blocks outbound/external actions only.") }, "PAUSE EXTERNAL ACTIONS"),
        h("button", { class: "btn", disabled: o.killSwitch.mode === "RUNNING", onclick: async () => { const r = await ask({ title: "RESUME", text: "Only Joci can release the stop.", fields: [PASS], confirmWord: "RESUME", ok: "Resume" }); if (r) act("Resume", "/api/owner-safety/action", { action: "RESUME", passphrase: r.passphrase, confirm: "RESUME" }); } }, "RESUME")));
    out.push(h("div", { class: "grid" },
      card("OWNER AUTHORITY", pill(o.ownerAuthority.state), "Owner: " + o.ownerAuthority.ownerId + (o.ownerAuthority.provisioned ? "" : " · key not created")),
      card("KILL SWITCH", pill(o.killSwitch.mode), o.killSwitch.banner ?? "armed"),
      card("APPROVALS", String(o.approvals.pending), "pending decisions"),
      card("SECURITY BRAIN", typeof o.securityBrain === "string" ? pill("UNKNOWN") : pill("ACTIVE"), typeof o.securityBrain === "string" ? o.securityBrain : "quarantined: " + (o.securityBrain.quarantined ?? 0)),
      card("FINANCIAL FIREWALL", pill(typeof o.financialFirewall === "string" ? "NO_SPEND" : o.financialFirewall.mode), typeof o.financialFirewall === "string" ? o.financialFirewall : "blocked spend attempts: " + (o.financialFirewall.blockedSpendAttempts ?? 0)),
      card("BLACK BOX", pill(o.blackBox.chainIntact === true || o.blackBox.chain === "OK" ? "OK" : o.blackBox.chain ?? "UNKNOWN"), o.blackBox.events !== undefined ? o.blackBox.events + " events" : ""),
      card("SAFE MODE", pill(o.safeMode.mode), o.safeMode.reason ?? ""),
      card("CURRENT VERSION", String(o.currentVersion)),
      card("LAST KNOWN GOOD", o.lastKnownGood ? pill("SET") : pill("NOT_CONFIGURED"), o.lastKnownGood?.backupId ?? "none verified yet"),
      card("LATEST BACKUP", o.latestBackup ? pill(o.latestBackup.ok ? "OK" : "BROKEN") : pill("NOT_CONFIGURED"), o.latestBackup ? o.latestBackup.id : "no backup"),
      card("RESTORE READINESS", pill(o.restoreReadiness)), card("RECOVERY STATUS", typeof o.recoveryStatus === "string" ? pill("UNKNOWN") : pill(o.recoveryStatus.passed ? "OK" : "FAILED"), typeof o.recoveryStatus === "string" ? o.recoveryStatus : "last drill " + o.recoveryStatus.lastDrill),
      card("SYSTEM HEALTH", pill(o.systemHealth.overall), JSON.stringify(o.systemHealth.counts))));
    const result = h("div", { class: "note" }, "Results appear here."), show = async (a, extra = {}) => { try { const r = await api("/api/owner-safety/action", { action: a, ...extra }); result.textContent = JSON.stringify(r.result ?? r, null, 1).slice(0, 6000); } catch (e) { result.textContent = "Failed: " + e.message; } };
    const signed = (label, action, text, extra = {}) => h("button", { class: "btn", onclick: async () => { const r = await ask({ title: label, text, fields: [PASS, ...(extra.fields ?? [])], danger: true, ok: label }); if (r) act(label, "/api/owner-safety/action", { action, ...r }); } }, label);
    out.push(h("h2", {}, "Recovery controls"), h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => show("RUN_SYSTEM_DOCTOR") }, "RUN SYSTEM DOCTOR"),
      h("button", { class: "btn primary", onclick: () => act("Create safe restore point", "/api/owner-safety/action", { action: "CREATE_SAFE_RESTORE_POINT" }) }, "CREATE SAFE RESTORE POINT"),
      h("button", { class: "btn", onclick: () => show("VERIFY_BACKUP") }, "VERIFY BACKUP"),
      signed("ROLL BACK TO LKG", "ROLL_BACK_TO_LKG", "Restores the last known good state. Needs Joci's signature. The current state is moved aside, never deleted."),
      signed("RESTORE", "RESTORE", "Restore from a chosen backup (id below). Needs Joci's signature.", { fields: [{ name: "id", label: "Backup id" }] })),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => show("VIEW_INCIDENTS") }, "VIEW INCIDENTS"), h("button", { class: "btn", onclick: () => show("VIEW_SECURITY_EVENTS") }, "VIEW SECURITY EVENTS"), h("button", { class: "btn", onclick: () => show("VIEW_APPROVALS") }, "VIEW APPROVALS")), result);
    if (o.approvals.gatewayPending.length) out.push(h("h2", {}, "Pending approval requests"), table(["Operation", "What", "Requested by", "Cost", "Financial / Security / Data risk", "Reversibility"], o.approvals.gatewayPending.map(x => [x.operation, x.what, x.requestedBy?.type + ":" + x.requestedBy?.id, usd(x.costUsd), `${x.financialRisk} / ${x.securityRisk} / ${x.dataRisk}`, x.reversibility])));
    return out;
  },
  async owner() {
    const s = await api("/api/status"), out = [h("h2", {}, "Owner controls"), h("p", { class: "sub" }, "Only Joci's passphrase-protected key can approve. No terminal needed.")];
    if (!s.ownerKey.provisioned) {
      out.push(note("Owner key not created yet. Until then every critical action is denied (honest PLACEHOLDER_UNCONNECTED)."),
        h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Create owner key", text: "Choose a passphrase (min 10 chars). Back up the key file offline; the passphrase cannot be recovered.", fields: [PASS], ok: "Create" }); if (r) act("Create owner key", "/api/owner-key", r); } }, "Create owner key"));
    } else out.push(h("div", { class: "card" }, h("div", { class: "k" }, "Owner public key"), h("div", { class: "mono" }, s.ownerKey.publicKeyB64)));
    out.push(h("h2", {}, "Emergency Stop"), s.emergency.banner ? note(s.emergency.banner + " — " + s.emergency.mode, "bad") : note("Running normally.", "ok"),
      h("div", { class: "row" },
        h("button", { class: "btn danger big", onclick: async () => { const r = await ask({ title: "PAUSE ALL", text: "Stops every dispatch immediately.", fields: [PASS], danger: true, ok: "PAUSE ALL" }); if (r) act("Pause all", "/api/emergency", { mode: "PAUSE_ALL", passphrase: r.passphrase, reason: "Control Center" }); } }, "PAUSE ALL"),
        h("button", { class: "btn danger", onclick: async () => { const r = await ask({ title: "STOP EXTERNAL ACTIONS", fields: [PASS], danger: true, ok: "Stop external" }); if (r) act("Stop external", "/api/emergency", { mode: "STOP_EXTERNAL_ACTIONS", passphrase: r.passphrase, reason: "Control Center" }); } }, "STOP EXTERNAL ACTIONS"),
        h("button", { class: "btn", disabled: s.emergency.mode === "RUNNING", onclick: async () => { const r = await ask({ title: "Resume", fields: [PASS], confirmWord: "RESUME", ok: "Resume" }); if (r) act("Resume", "/api/emergency", { mode: "RUNNING", passphrase: r.passphrase, confirm: "RESUME", reason: "Control Center" }); } }, "Resume")));
    out.push(h("h2", {}, "Safe Mode"), s.safeMode.mode === "SAFE_MODE" ? note("SAFE MODE: " + s.safeMode.reason, "bad") : note("Normal.", "ok"),
      h("button", { class: "btn", disabled: s.safeMode.mode !== "SAFE_MODE", onclick: async () => { const r = await ask({ title: "Leave Safe Mode", text: "Runs a self-check first; it must not FAIL.", fields: [PASS], ok: "Leave Safe Mode" }); if (r) act("Leave Safe Mode", "/api/safe-mode/exit", r); } }, "Leave Safe Mode"));
    return out;
  },
  async backup() {
    const b = await api("/api/backups");
    return [h("h2", {}, "Backup / restore / last known good"), b.lkg ? note("Last known good: " + b.lkg.backupId, "ok") : note("No last known good yet."),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => act("Backup", "/api/backup", { label: "manual" }) }, "Create backup"),
        h("button", { class: "btn", onclick: () => act("Recovery drill", "/api/backup/drill", {}, r => toast("Drill " + (r.result.passed ? "PASSED" : "FAILED") + " (" + r.result.files + " files)", r.result.passed ? "ok" : "bad")) }, "Run recovery drill"),
        h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Mark last known good", text: "Needs test evidence (reference of the passing test run).", fields: [{ name: "smokeEvidence", label: "Test evidence reference" }], ok: "Mark" }); if (r) act("Mark LKG", "/api/backup/mark-lkg", r); } }, "Mark last known good"),
        h("button", { class: "btn danger", disabled: !b.lkg, onclick: async () => { const r = await ask({ title: "Restore last known good", text: "Overwrites current state (old state is moved aside, not deleted).", fields: [PASS], confirmWord: "RESTORE", danger: true, ok: "Restore" }); if (r) act("Restore", "/api/restore/lkg", { passphrase: r.passphrase }); } }, "Restore last known good")),
      table(["Backup", "Verified", "Files", "Created"], b.items.map(i => [i.id, pill(i.ok ? "OK" : "FAIL"), String(i.files), i.createdAt ?? ""]))];
  },
  async doctor() {
    const d = await api("/api/doctor");
    return [h("h2", {}, "System Doctor"), h("p", { class: "sub" }, "Read-only checks of environment, durable state and tamper-evident logs."), h("div", { class: "grid" }, card("Overall", pill(d.level)), card("Runtime reachable", d.runtimeReachable ? "yes" : "no")),
      h("h2", {}, "Self-check"), table(["Check", "Status", "Detail"], d.selfCheck.checks.map(c => [c.id, pill(c.status), c.detail ?? ""])), h("h2", {}, "Findings"), table(["Severity", "Check", "Detail", "Remedy"], d.findings.map(f => [pill(f.severity), f.id, f.detail ?? "", f.remedy ?? ""])),
      h("h2", {}, "Audit chains"), table(["File", "Present", "Intact"], d.audits.map(a => [a.file, a.present ? "yes" : "no", a.present ? pill(a.ok ? "OK" : "FAIL") : "—"]))];
  },
  async updates() {
    const u = await api("/api/updates");
    const out = [h("h2", {}, "Update Center"), h("p", { class: "sub" }, "DETECT → COMPATIBILITY → BACKUP/LKG → STAGING → TEST → SECURITY/HEALTH → APPROVAL → INSTALL → POST-TEST → EVIDENCE. On failure: FREEZE → PRESERVE EVIDENCE → ROLLBACK → VERIFY → REPORT.")];
    if (u.notice) out.push(note(u.notice, "bad"));
    if (u.freeze.active) out.push(note("UNSAFE ACTIONS FROZEN by update " + u.freeze.updateId, "bad"), h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Unfreeze", fields: [PASS] }); if (r) act("Unfreeze", "/api/updates/unfreeze", r); } }, "Unfreeze (owner)"));
    out.push(h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => act("Check for updates", "/api/updates/check", {}) }, "Check for Updates"),
      h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Safe Automatic Updates", text: "Opt-in; installs only low-risk, non-protected, non-major updates. Currently " + (u.autoUpdate ? "ON" : "OFF") + ".", fields: [PASS], ok: u.autoUpdate ? "Turn OFF" : "Turn ON" }); if (r) act("Auto updates", "/api/updates/auto", { enabled: !u.autoUpdate, passphrase: r.passphrase }); } }, "Safe Automatic Updates: " + (u.autoUpdate ? "ON" : "OFF"))));
    out.push(table(["Component", "Version", "Protected"], u.components.map(c => [c.id, c.version, c.protected ? "yes" : "no"])));
    out.push(table(["Update", "State", "Risk / notes", "Actions"], u.updates.map(x => [x.id, pill(x.state), JSON.stringify(x.risk ?? x.reasons ?? "").slice(0, 160),
      h("div", { class: "row", style: "margin:0" },
        h("button", { class: "btn", disabled: !x.actions.testUpdate, onclick: () => act("Test update", "/api/updates/test", { id: x.id }) }, "Test Update"),
        h("button", { class: "btn primary", disabled: !x.actions.safeUpdate, onclick: async () => { const r = await ask({ title: "Safe Update " + x.id, text: "Approval is required for protected/high-risk updates.", fields: [{ ...PASS, label: "Owner key passphrase (leave empty if not required)" }] }); if (r) act("Safe update", "/api/updates/install", { id: x.id, passphrase: r.passphrase || null }); } }, "Safe Update"),
        h("button", { class: "btn", disabled: !x.actions.rollback, onclick: async () => { const r = await ask({ title: "Rollback " + x.id, fields: [PASS] }); if (r) act("Rollback", "/api/updates/rollback", { id: x.id, passphrase: r.passphrase }); } }, "Rollback"))])));
    return out;
  },
  async voice() { const v = await api("/api/voice"); if (v.conversationStore === "UNREADABLE") return [h("h2", {}, "Speak-to-Speak / Live Voice"), note(v.note, "bad")];
    const row = c => [c.startedAt.slice(0, 16), c.status + (c.endReason ? " (" + c.endReason + ")" : ""), c.providerMode, String(c.turnCount), c.purpose, h("span", {}, h("button", { class: "btn", onclick: async () => { const r = await api("/api/voice/action", { op: "get", id: c.id }); alert(r.result.turns.map(t => "YOU: " + (t.userText ?? "(ignored)") + "\nATLASZ: " + (t.replyText ?? "")).join("\n\n") || "(no turns)"); } }, "Read"), h("button", { class: "btn", onclick: async () => { const n = prompt("Remember which turn number as a memory note?", "1"); if (n) { await act("Remember turn", "/api/voice/action", { op: "remember", id: c.id, turn: Number(n) }); render(); } } }, "Remember a turn"), h("button", { class: "btn", onclick: async () => { if (confirm("Delete this transcript permanently?")) { await act("Delete transcript", "/api/voice/action", { op: "delete", id: c.id }); render(); } } }, "Delete"))];
    return [h("h2", {}, "Speak-to-Speak / Live Voice"), note(v.note ?? "Voice providers are attached.", v.live ? "" : "warn"),
      table(["State", "Enabled", "Mode", "Live"], [[pill(v.state), String(v.enabled), v.mode, pill(v.live ? "LIVE" : "NOT LIVE")]]),
      note("Voice can only request - it cannot approve, spend, send or change anything. Kill switch and Safe Mode stop every conversation. Mock providers are for tests and are labelled MOCK."),
      h("h3", {}, "Conversations (text transcripts only)"), table(["Started", "Status", "Providers", "Turns", "Purpose", ""], (v.conversations ?? []).map(row)),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { await act("Purge expired transcripts", "/api/voice/action", { op: "purge" }); render(); } }, "Purge expired transcripts"))]; },
  async documents() { const d = await api("/api/documents");
    return [h("h2", {}, "Document Center"), note("Total " + d.summary.total + " · unsupported formats " + d.summary.unsupported + " · secret " + d.summary.secret),
      table(["Name", "Type", "Class", "Extraction", "Job"], d.items.map(x => [x.name, x.type, pill(x.classification), pill(x.extraction?.status), x.jobId ?? "—"]))]; },
  async inbox() { const i = await api("/api/inbox");
    return [h("h2", {}, "Universal Inbox"), note(i.note), note("Total " + i.counts.total + " · new " + i.counts.new + " · critical " + i.counts.critical + " · chain " + (i.chain.ok === false ? "BROKEN" : "OK"), i.chain.ok === false ? "bad" : ""),
      table(["Priority", "Source", "Status", "Subject"], i.items.map(x => [pill(x.priority), x.source, pill(x.status), String(x.subject ?? x.title ?? "").slice(0, 120)]))]; },
  async connectors() { const c = await api("/api/connectors");
    return [h("h2", {}, "Connectors"), note("A connector is LIVE only after its own read-only probe passes. Live " + (c.live ?? 0) + " of " + (c.total ?? 0) + "; blocked (no credentials) " + (c.blockedNoCredentials ?? 0) + "; no safe probe " + (c.noSafeProbe ?? 0) + "."),
      table(["Connector", "State", "Needs"], (c.connectors ?? []).map(x => [x.id, pill(x.state), x.needs ?? x.note ?? ""]))]; },
  async techwatch() { const t = await api("/api/techwatch");
    return [h("h2", {}, "Tech Watch"), note(t.status === "NO_FEED" ? "NO_FEED: no feed files in the tech-watch folder, so no external news is claimed." : "Feeds: " + t.feeds.join(", ")),
      table(["Component", "Installed", "Available", "Severity", "Compatibility"], t.advisories.map(a => [a.componentId, a.installed, a.available, pill(a.severity), a.compatibility])),
      h("h3", {}, "Capability gaps (" + t.capabilityGaps.notLive + " not LIVE)"), table(["Item", "State"], t.capabilityGaps.items.map(g => [g.title ?? g.id, pill(g.state)]))]; }
};
// ---- Brain panels (read-only views of persisted Brain state; NOT CONNECTED / SANDBOX shown where nothing real exists) ----
const ncNote = x => (x && x.state === "NOT_CONNECTED" ? note(x.state + ": " + x.note, "warn") : null);
const BRAIN = {
  brain_status: ["Brain Status", b => [note(b.status.note ?? ""), ncNote(b.status), b.status.topology ? table(["Item", "Value"], [["Runtime", b.status.runtimeReported], ["Topology", JSON.stringify(b.status.topology)], ["Governance audit chain", String(b.status.governanceAuditOk)], ["Modules reported", (b.status.modules ?? []).join(", ") || "—"]]) : null]],
  brain_orchestrator: ["Orchestrator", b => [note("Pipeline: " + b.orchestrator.pipeline.join(" → ")), note(b.orchestrator.note ?? "Pipeline events recorded: " + b.orchestrator.pipelineEventsRecorded, b.orchestrator.note ? "warn" : ""), table(["State"], [[pill(b.orchestrator.state)]])]],
  brain_planning: ["Planning", b => [ncNote(b.planning), Array.isArray(b.planning) ? table(["Plan", "Goal", "Status", "Tasks done", "Approval points", "Est. cost (not authorized)"], b.planning.map(p => [p.id, p.goal, pill(p.status), p.done + "/" + p.tasks, String(p.approvalPoints), usd(p.estCostUsd)])) : null]],
  brain_capabilities: ["Capability Graph", b => [ncNote(b.capabilityGraph), Array.isArray(b.capabilityGraph) ? table(["Node", "Type", "Capabilities", "Probed", "Runs", "Reliability"], b.capabilityGraph.map(n => [n.id, n.type, n.capabilities.join(", "), n.probed ? "yes" : "no", String(n.runs), n.reliability === null ? "—" : Math.round(n.reliability * 100) + "%"])) : null]],
  brain_knowledge: ["Knowledge", b => [ncNote(b.knowledge), b.knowledge.items !== undefined ? table(["Kind", "Count"], Object.entries(b.knowledge.byKind).map(([k, v]) => [k, String(v)])) : null, note("Model guesses are stored as INFERENCE, never as FACT.")]],
  brain_simulation: ["Simulation / Digital Twin", b => [note(b.simulation.note, "warn"), table(["Environments (never confused)"], b.simulation.environments.map(e => [pill(e)]))]],
  brain_verification: ["Verification", b => [note(b.verification.note), table(["Independently accepted", "Rejected / not accepted", "Screening NOT independently verified"], [[String(b.verification.verified), String(b.verification.rejected), String(b.verification.screeningNotIndependentlyVerified)]])]],
  brain_security: ["Security Brain", b => [note("External text quarantined before reaching any agent: " + b.security.quarantinedExternalText), table(["Time", "Decision", "Agent", "Reason"], b.security.events.map(e => [e.at, pill(e.decision ?? e.kind), e.agentId ?? "—", e.reason ?? ""])), note("The Security Brain can only make the system stricter; it cannot grant permissions.")]],
  brain_opportunities: ["Opportunity Intelligence", b => [ncNote(b.opportunities), b.opportunities.items ? [note("Pipeline: " + b.opportunities.stages.join(" → ")), table(["Opportunity", "Stage", "Score", "Explanation"], b.opportunities.items.map(o => [o.title, pill(o.stage), o.score === null ? "—" : String(o.score), o.explanation]))] : null]],
  brain_factory: ["Business Factory", b => [ncNote(b.factory), Array.isArray(b.factory) ? table(["Service", "Offer type", "State", "Price set"], b.factory.map(s => [s.name, s.offerType, pill(s.state), String(s.priceSet)])) : null]],
  brain_blackbox: ["Observability / Black Box", b => [ncNote(b.observability), b.observability.events !== undefined ? [note("Chain " + (b.observability.chainOk ? "OK" : "BROKEN") + " · events " + b.observability.events + " · errors " + b.observability.errors + " · retries " + b.observability.retries, b.observability.chainOk ? "" : "bad"),
    table(["#", "Time", "Kind", "Agent", "Job", "Result / decision", "Correlation"], b.observability.timeline.map(e => [String(e.seq), e.at, e.kind, e.agentId ?? "—", e.jobId ?? "—", String(e.result ?? e.decision ?? e.error ?? ""), String(e.correlationId ?? "").slice(0, 14)]))] : null]],
  brain_recovery: ["Disaster Recovery", b => [note("Recovery readiness: " + b.disasterRecovery.status + (b.disasterRecovery.reasons.length ? " (" + b.disasterRecovery.reasons.join(", ") + ")" : ""), b.disasterRecovery.status === "PROVEN_RECOVERABLE" ? "" : "warn"),
    note("A backup that has never been restored in a drill is not proven recoverable. Last known good: " + b.disasterRecovery.lkg), note("Incident flow: " + b.disasterRecovery.flow.join(" → "))]],
  brain_behavior: ["Behavior Anomalies", b => [ncNote(b.behavior), b.behavior.items ? [note(b.behavior.note + " Open: " + b.behavior.open + " (high: " + b.behavior.high + ")", b.behavior.high ? "bad" : ""), table(["Kind", "Severity", "Subject", "Detail", "Recommendation", "Seen", "Status"], b.behavior.items.map(x => [x.kind, pill(x.severity), x.subject, x.detail, x.recommendation, String(x.count), pill(x.status)]))] : null]],
  brain_health: ["Brain Health", b => [b.health.metrics ? table(["Metric", "Value"], Object.entries(b.health.metrics).map(([k, v]) => [k, String(v)])) : note(JSON.stringify(b.health)), note("Recommendations only. Health metrics never change permissions or controls.")]]
};
for (const [key, [title, render]] of Object.entries(BRAIN)) views[key] = async () => { const b = await api("/api/brain"); return [h("h2", {}, title), ...render(b)]; };
views.brain_command = async () => {
  const inp = h("input", { id: "cmdin", placeholder: "e.g. Show me all 30 agents / Pause all external actions / Create a restore point", style: "width:70%;padding:8px" }), out = h("pre", { class: "card mono", style: "white-space:pre-wrap" }, "—");
  const run = async (passphrase, confirm) => { const r = await api("/api/brain/command", { text: inp.value, passphrase, confirm }); out.textContent = JSON.stringify(r, null, 1); return r; };
  const send = async () => { let r = await run(); if (r.status === "NEEDS_APPROVAL") { const p = await ask({ title: "Owner approval needed: " + r.intent, text: "This operation is consequential. Approving signs exactly this operation with your key.", fields: [PASS], ok: "Approve" }); if (p) { const c = r.intent === "RESUME_SYSTEM" ? "RESUME" : null; await run(p.passphrase, c); } } };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  const b = await api("/api/brain");
  return [h("h2", {}, "Owner Command"), note("Natural language only selects an operation. Consequential operations always ask for your key; unknown requests do nothing."), h("div", { class: "row" }, inp, h("button", { class: "btn primary", onclick: send }, "Run")), out,
    table(["Operation", "Needs your approval"], b.ownerCommand.commands.map(c => [c.intent, c.consequential ? "yes" : "no"])), note("Command audit chain " + (b.ownerCommand.audit.ok ? "OK" : "BROKEN") + " · entries " + b.ownerCommand.audit.entries)];
};
async function moneyEngineNodes() {
  const e = await api("/api/money-engine"), j = await api("/api/money-jobs"), g = await api("/api/money-agents"), rc = await api("/api/money-recurring");
  const kv = o => Object.entries(o ?? {}).map(([k, v]) => [k, String(v)]);
  const env = (t, x) => x ? [h("h3", {}, t), h("div", { class: "grid" }, card("Verified received (USD)", "$" + x.verifiedReceivedUsd), card("Claimed, NOT verified (USD)", "$" + x.claimedNotVerifiedUsd), card("Recorded actual cost (USD)", "$" + x.actualCostUsd), card("Outreach SENT", String(x.outreachSent))),
    table(["Area", "Status counts"], [["Deals", JSON.stringify(x.deals)], ["Jobs", JSON.stringify(x.jobs)], ["Invoices", JSON.stringify(x.invoices)], ["Payments", JSON.stringify(x.payments)], ["Deliveries", JSON.stringify(x.deliveries)]])] : [];
  return [h("h3", {}, "Engine ledger (recorded state)"), ncNote(e), e.live ? note(e.live.profitNote + " Verified net profit: $" + e.live.verifiedNetProfitUsd) : null, ...env("LIVE", e.live), ...env("SANDBOX — never revenue", e.sandbox),
    h("h3", {}, "Recurring / subscriptions"), ncNote(rc), rc.live ? [note(rc.live.note), table(["Environment", "Subscriptions", "Contracted MRR (claim)", "Verified received (USD)"], [["LIVE", JSON.stringify(rc.live.subscriptions), "$" + rc.live.contractedMrrUsd, "$" + rc.live.verifiedReceivedUsd], ["SANDBOX (never revenue)", JSON.stringify(rc.sandbox.subscriptions), "—", "—"]])] : null,
    h("h3", {}, "Engine jobs"), ncNote(j), table(["Job", "Goal", "Status", "Env", "Agents", "Artifacts"], (j.items ?? []).map(x => [x.id, x.goal ?? "", pill(x.status), x.environment, (x.agents ?? []).join(","), String(x.artifacts)])),
    h("h3", {}, "Agents in capability graph (" + (g.count ?? 0) + " / 30)"), ncNote(g), g.items?.length ? [note(g.topologyOk ? "Topology: exactly 30 agents." : "Topology MISMATCH: expected 30, found " + g.count, g.topologyOk ? "" : "bad"), table(["Agent", "Team", "Health", "Runs", "OK"], g.items.map(a => [a.id, a.team ?? "", pill(a.health), String(a.runs), String(a.ok)]))] : null];
}
views.crm_inbox = async () => {
  const x = await api("/api/crm-inbox"), kv = o => Object.entries(o ?? {}).map(([k, v]) => [k, String(v)]);
  return [h("h2", {}, "CRM / Entity Graph / Inbox"), note(x.note),
    h("h3", {}, "Entity graph"), ncNote(x.graph), x.graph.entities ? [table(["Type", "Count"], kv(x.graph.entities)), note(`Edges ${x.graph.edges} · tenants ${x.graph.tenants} · unresolved stubs ${x.graph.stubs} · dangling edges ${x.graph.danglingEdges}`, x.graph.danglingEdges ? "bad" : "")] : null,
    h("h3", {}, "Follow-ups"), ncNote(x.followups), x.followups.open !== undefined ? note(`Open ${x.followups.open} · overdue ${x.followups.overdue} · done ${x.followups.done}`, x.followups.overdue ? "warn" : "") : null,
    h("h3", {}, "Inbox pipeline"), ncNote(x.inbox), x.inbox.total !== undefined ? [note(`Items ${x.inbox.total} · quarantined ${x.inbox.quarantined} · needs your attention ${x.inbox.needsOwner}`, x.inbox.needsOwner ? "warn" : ""), table(["Item", "Kind", "Priority", "Route", "Route status", "Sender link", "Deals"], x.inbox.recent.map(i => [i.id, pill(i.kind), i.priority, i.route, pill(i.routeStatus), i.sender ?? "", (i.deals ?? []).join(",")]))] : null];
};
views.pcc = async () => {
  const x = await api("/api/pcc");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Tasks / Reminders / Deadlines"), note("Personal Command Center store is unreadable: " + (x.error ?? ""), "bad")];
  const a = x.agenda, row = i => [pill(i.type), i.title, i.dueAt ?? i.remindAt ?? "", i.priority, i.project ?? "", h("button", { class: "btn", onclick: async () => { await act("Complete", "/api/pcc/action", { op: "complete", id: i.id }); render(); } }, "Done")];
  const ti = h("input", { id: "pcc-title", placeholder: "New task / reminder / deadline", style: "width:40%;padding:8px" }), ty = h("select", { id: "pcc-type" }, ...["TASK", "REMINDER", "DEADLINE"].map(t => h("option", {}, t))), dt = h("input", { id: "pcc-when", type: "datetime-local" });
  const add = async () => { const when = dt.value ? new Date(dt.value).toISOString() : null, type = ty.value; await act("Add", "/api/pcc/action", { op: "add", type, title: ti.value, ...(type === "REMINDER" ? { remindAt: when } : { dueAt: when }) }); render(); };
  return [h("h2", {}, "Tasks / Reminders / Deadlines"), note(a.note),
    note(`Overdue ${a.overdue.length} · due today ${a.dueToday.length} · upcoming ${a.upcoming.length} · reminders due ${a.remindersDue.length} · undated tasks ${a.undated}`, a.overdue.length ? "warn" : ""),
    h("div", { class: "row" }, ti, ty, dt, h("button", { class: "btn primary", onclick: add }, "Add")),
    h("h3", {}, "Overdue"), table(["Type", "Title", "When", "Priority", "Project", ""], a.overdue.map(row)),
    h("h3", {}, "Due today"), table(["Type", "Title", "When", "Priority", "Project", ""], a.dueToday.map(row)),
    h("h3", {}, "Reminders due"), table(["Type", "Title", "When", "Priority", "Project", ""], a.remindersDue.map(i => [...row(i).slice(0, 5), h("button", { class: "btn", onclick: async () => { await act("Acknowledge", "/api/pcc/action", { op: "ack", id: i.id }); render(); } }, "Ack")])),
    h("h3", {}, "Upcoming"), table(["Type", "Title", "When", "Priority", "Project", ""], a.upcoming.map(row)),
    h("h3", {}, "Schedules"), x.schedules.state === "UNREADABLE" ? note("Schedule store unreadable - nothing will run until it is repaired.", "bad") : note(x.schedules.note ?? "Runs are at-least-once; tools called by a schedule still pass the control chain."),
    table(["Schedule", "Kind", "Tool", "State", "Next run", "Last result", "Missed", "Interrupted"], x.schedules.jobs.map(j => [j.name, j.kind, j.tool, pill(j.state), j.nextRunAt ?? "", j.lastStatus ?? "", j.missedRuns, j.interruptedRuns]))];
};
views.knowledge = async () => {
  const x = await api("/api/knowledge");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Knowledge Projects"), note("Knowledge store is unreadable and will not be replaced: " + (x.error ?? ""), "bad")];
  const nm = h("input", { id: "kp-name", placeholder: "New project name", style: "width:30%;padding:8px" });
  const q = h("input", { id: "kp-q", placeholder: "Ask a question about the sources", style: "width:50%;padding:8px" }), out = h("div", {});
  const ask = pid => async () => { const r = await api("/api/knowledge/action", { op: "ask", projectId: pid, query: q.value }); out.replaceChildren(r.answerable ? h("div", {}, note(`Answer (extractive, ${r.confidence} term-coverage ${r.coverage}) - ${r.note}`), ...r.passages.map(p => h("blockquote", {}, p.text, h("div", { class: "muted" }, `[${p.citation.kind}] ${p.citation.title} v${p.citation.version} @${p.citation.start}-${p.citation.end} sha ${p.citation.sha256.slice(0, 10)}${p.citation.url ? " " + p.citation.url : ""}`)))) : note("No supporting evidence in this project's sources (coverage " + r.coverage + "). Nothing was guessed.", "warn")); };
  return [h("h2", {}, "Knowledge Projects"), note("Keyword retrieval over your documents, notes and web snapshots - NOT semantic search. Answers are copied passages with citations; unsupported questions are refused. SECRET sources are never searched."),
    h("div", { class: "row" }, nm, h("button", { class: "btn primary", onclick: async () => { await act("Create project", "/api/knowledge/action", { op: "create", name: nm.value }); render(); } }, "Create")),
    h("div", { class: "row" }, q), out,
    ...x.projects.flatMap(p => [h("h3", {}, p.name + " (" + p.id + ")"), h("div", { class: "row" }, h("button", { class: "btn", onclick: ask(p.id) }, "Ask this project")),
      note(`Searchable chunks ${p.searchableChunks} · documents ${p.byKind.document} · notes ${p.byKind.note} · web snapshots ${p.byKind.webpage}`),
      table(["Kind", "Title", "Screening", "Class"], p.members.map(m => [m.kind, m.title, m.screening ?? "", m.classification ?? ""])),
      p.withheld.length ? note("Withheld from search: " + p.withheld.map(w => `${w.title} (${w.reason})`).join("; "), "warn") : ""])];
};
views.research = async () => {
  const x = await api("/api/research");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Research Ledger"), note("Research ledger store is unreadable and will not be replaced: " + (x.error ?? ""), "bad")];
  const sel = h("select", { id: "rl-proj" }, ...x.projects.map(p => h("option", { value: p.id }, p.name))), qt = h("input", { id: "rl-q", placeholder: "New research question", style: "width:50%;padding:8px" });
  const fq = (q, label, items, cls) => items.length ? [h("h4", {}, label + " (" + items.length + ")"), table(["Claim", "Status", "Confidence", "Why / evidence", "By"], items.map(f => [f.claim, pill(f.status), f.confidence, (f.reasons.join("; ") || "") + (f.evidence.length ? " · " + f.evidence.map(e => `${e.relation} ${e.verification}${e.aged ? " AGED" : ""} [${e.title} v${e.version}] "${String(e.quote).slice(0, 80)}"`).join(" | ") : ""), f.createdBy]))] : [];
  const sm = x.summary;
  return [h("h2", {}, "Research Ledger"), note("Findings are verified against the CURRENT sources on every view. Only VERIFIED findings are facts; unsupported claims, assumptions, outdated, conflicted and refuted findings are shown separately. Confidence = independent verified sources, not truth. Keyword retrieval, not semantic."),
    note(`Questions ${sm.questions} · unresolved ${sm.unresolved} · audit events ${sm.events} · audit chain ${sm.chain.ok ? "intact" : "BROKEN at event " + sm.chain.brokenAt}`, sm.chain.ok ? "" : "bad"),
    h("div", { class: "row" }, sel, qt, h("button", { class: "btn primary", onclick: async () => { await act("Open question", "/api/research/action", { op: "openQuestion", projectId: sel.value, text: qt.value }); render(); } }, "Open question")),
    ...x.questions.flatMap(r => [h("h3", {}, r.question.text), note(`${r.state} · ${r.question.id} · project ${r.question.projectId}. ${r.note}`, r.state === "ANSWERED" ? "" : "warn"),
      ...fq(r, "Verified facts", r.verifiedFacts), ...fq(r, "Conflicted", r.conflicted), ...fq(r, "Refuted", r.refuted), ...fq(r, "Outdated", r.outdated), ...fq(r, "Unverifiable", r.unverifiable), ...fq(r, "Unsupported claims (NOT facts)", r.unsupported), ...fq(r, "Assumptions (NOT facts)", r.assumptions), ...fq(r, "Rejected by owner", r.rejected),
      ...(r.contradictions.length ? [h("h4", {}, "Contradictions"), table(["Findings", "Note", "State", ""], r.contradictions.map(k => [k.a + " vs " + k.b, k.note, pill(k.state), k.state === "OPEN" ? h("span", {}, ...[k.a, k.b, null].map(wn => h("button", { class: "btn", onclick: async () => { const note_ = prompt("Resolution note (required)"); if (!note_) return; await act("Resolve", "/api/research/action", { op: "resolveContradiction", id: k.id, winner: wn, note: note_ }); render(); } }, wn ? "Winner " + wn.slice(0, 8) : "Not a conflict"))) : k.resolution?.note ?? ""]))] : [])]),
    h("h3", {}, "Recent audit events"), table(["#", "At", "Type", "By", "Ref"], x.events.map(e => [e.n, e.at, e.type, e.by, e.id ?? e.findingId ?? e.member ?? ""]))];
};
views.a11y = async () => {
  const out = h("div", {}), css = h("textarea", { id: "a11y-css", rows: 5, style: "width:100%;font-family:monospace", placeholder: "Custom CSS (only used with 'Audit pasted text')" }), html = h("textarea", { id: "a11y-html", rows: 5, style: "width:100%;font-family:monospace", placeholder: "Custom HTML" });
  const show = r => {
    if (!r.ok) return out.replaceChildren(note("Audit did not complete (" + (r.reason ?? "unknown") + "). " + (r.note ?? ""), "bad"));
    out.replaceChildren(note(`Verdict: ${r.verdict}. FAIL ${r.counts.FAIL}, WARN ${r.counts.WARN}. ${r.complete ? "" : "INCOMPLETE: " + r.incomplete.join(", ") + ". "}${r.note}`, r.verdict === "FAIL_FOUND" ? "bad" : r.complete ? "info" : "warn"),
      table(["Severity", "Rule", "Location", "What is wrong", "How to fix"], r.findings.map(f => [pill(f.severity), f.rule, f.location, f.message, f.remediation])),
      r.truncated ? note("The list was truncated: more findings exist than are shown.", "warn") : null);
  };
  const run = body => async () => { try { out.replaceChildren(note("Running audit...", "info")); show(await api("/api/a11y/audit", body())); } catch (e) { out.replaceChildren(note("Audit request failed: " + (e.message ?? e), "bad")); } };
  return [h("h2", {}, "Accessibility audit (A13)"), note("Static source checks: contrast of declared colour pairs in both themes, page structure, control names. It reads only this console's own files or text you paste; it fetches no URL and runs no script. It cannot prove WCAG compliance."),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: run(() => ({ target: "control-center" })) }, "Audit this console"), h("button", { class: "btn", onclick: run(() => ({ target: "custom", html: html.value, css: css.value })) }, "Audit pasted text")), html, css, out];
};
views.sandbox = async () => {
  const x = await api("/api/sandbox");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Code Sandbox"), note("Sandbox audit log is unreadable and will not be replaced: " + (x.error ?? ""), "bad")];
  const s = x.summary, lang = h("select", { id: "sb-lang" }, ...s.languages.map(l => h("option", {}, l))), code = h("textarea", { id: "sb-code", rows: 6, style: "width:100%;font-family:monospace", placeholder: "console.log(2+2)" }), out = h("pre", { class: "wrap" });
  const run = async () => { try { const r = await api("/api/sandbox/run", { language: lang.value, code: code.value }); out.textContent = `${r.status}${r.exitCode != null ? " exit " + r.exitCode : ""} · isolation ${r.isolation?.level ?? "-"} · network ${r.isolation?.network ?? "-"} · fs ${r.isolation?.filesystem ?? "-"}\n${r.stdout ?? ""}${r.stderr ?? ""}${r.reason ?? ""}`; } catch (e) { out.textContent = String(e.message); } };
  return [h("h2", {}, "Code Sandbox"), note(s.label + " Output is untrusted data."),
    note(`Isolation on this host: ${s.level}${s.level === "NAMESPACE" ? " (no network, own PID space)" : " - NO OS-level isolation: runs are refused unless the owner signs an approval for the exact code"} · Node fs permissions ${s.nodePermission ? "enforced" : "unavailable"} · languages ${s.languages.join(", ")} · audit ${s.audit.ok ? "intact" : "BROKEN at " + s.audit.brokenAt}`, s.level === "NAMESPACE" ? "" : "warn"),
    h("div", { class: "row" }, lang, h("button", { class: "btn primary", onclick: run }, "Run in sandbox")), code, out,
    h("h3", {}, "Recent runs"), table(["#", "At", "Language", "Status", "Isolation", "ms", "Actor", "Code SHA-256"], x.history.map(e => [e.n, e.at, e.language ?? "", pill(e.status), e.isolation ?? "", e.durationMs, e.actor, String(e.codeSha256).slice(0, 12)]))];
};
views.workbench = async () => {
  const x = await api("/api/workbench");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Workbench"), note("Workbench store unreadable and will not be replaced: " + (x.error ?? ""), "bad")];
  const call = async (op, args) => (await api("/api/workbench/action", { op, args })).result;
  const out = h("div", { class: "wrap" }), show = (title, obj) => out.replaceChildren(h("h3", {}, title), h("pre", { class: "wrap" }, JSON.stringify(obj, null, 1).slice(0, 6000)));
  const fail = e => out.replaceChildren(note("Refused: " + e.message, "bad"));
  const csv = h("textarea", { rows: 6, style: "width:100%;font-family:monospace", placeholder: "region,units,price\nN,10,2.5\nS,20,2.4\nN,30,2.2" });
  const runAnalyst = async () => { try { const r = await call("analyst.run", { csv: csv.value }); out.replaceChildren(h("h3", {}, "Analysis (deterministic; report hash " + r.report.reportHash.slice(0, 12) + ")"), h("pre", { class: "wrap" }, r.markdown), ...r.charts.map(c => c.dataUri ? h("img", { src: c.dataUri, alt: c.title, style: "max-width:100%;background:#fff;margin:6px 0;display:block" }) : note(c.title + ": " + c.error, "warn")), note(r.note)); } catch (e) { fail(e); } };
  const effortKind = h("select", {}, ...["LOOKUP", "SUMMARISE", "TRANSFORM", "DRAFT", "ANALYSE", "PLAN", "CODE", "DECIDE", "FINANCIAL"].map(k => h("option", {}, k))), effortRisk = h("select", {}, ...["LOW", "MEDIUM", "HIGH", "CRITICAL"].map(k => h("option", {}, k)));
  const txt = h("textarea", { rows: 4, style: "width:100%", placeholder: "Paste a long text to plan chunking" });
  const title = h("input", { placeholder: "New conversation title", style: "width:50%" }), msg = h("input", { placeholder: "Message", style: "width:60%" }), cid = h("input", { placeholder: "conversation id", style: "width:30%" }), model = h("input", { placeholder: "model id", style: "width:20%" });
  const ann = h("textarea", { rows: 3, style: "width:100%;font-family:monospace" }, JSON.stringify([{ type: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.2, color: "red", label: "Check" }]));
  return [h("h2", {}, "Workbench"), note(x.note, "warn"),
    h("h3", {}, "Analyst (M07)"), csv, h("div", { class: "row" }, h("button", { class: "btn primary", onclick: runAnalyst }, "Analyse (local, no code execution)")),
    h("h3", {}, "Reasoning effort (C10)"), h("div", { class: "row" }, effortKind, effortRisk, h("button", { class: "btn", onclick: async () => { try { show("Effort decision", await call("effort.choose", { task: { kind: effortKind.value, risk: effortRisk.value } })); } catch (e) { fail(e); } } }, "Choose")),
    h("h3", {}, "Large text (GE01)"), txt, h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { try { show("Chunk plan", await call("chunk.plan", { text: txt.value })); } catch (e) { fail(e); } } }, "Plan chunks")),
    h("h3", {}, "Annotation overlay (P18)"), ann, h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { try { const r = await call("annotate", { annotations: JSON.parse(ann.value), size: { width: 640, height: 360 } }); out.replaceChildren(h("h3", {}, "Overlay"), h("img", { src: r.dataUri, alt: "annotation overlay", style: "border:1px solid #888;background:#eee" })); } catch (e) { fail(e); } } }, "Render overlay")),
    h("h3", {}, "Conversations (M03 / P16)"), table(["Id", "Title", "Model", "Turns", "Switches", "Updated"], x.conversations.map(c => [c.id, c.title, c.model ?? "-", c.turns, c.switches, c.updatedAt.slice(0, 16)])),
    h("div", { class: "row" }, title, h("button", { class: "btn", onclick: async () => { try { const r = await call("conv.create", { title: title.value || "Conversation", model: model.value || null }); toast("Created " + r.id, "ok"); render(); } catch (e) { fail(e); } } }, "New")),
    h("div", { class: "row" }, cid, msg, model, h("button", { class: "btn", onclick: async () => { try { await call("conv.addTurn", { id: cid.value, text: msg.value }); if (model.value) await call("conv.setModel", { id: cid.value, model: model.value }); show("Context", await call("conv.context", { id: cid.value })); } catch (e) { fail(e); } } }, "Add my turn"), h("button", { class: "btn", onclick: async () => { try { show("Answer", await call("conv.complete", { id: cid.value })); render(); } catch (e) { fail(e); } } }, "Ask model")),
    out];
};
views.projects = async () => {
  const call = async (op, args) => (await api("/api/workbench/action", { op, args })).result;
  const out = h("div", { class: "wrap" }), show = (title, obj) => out.replaceChildren(h("h3", {}, title), h("pre", { class: "wrap" }, JSON.stringify(obj, null, 1).slice(0, 8000)));
  const guard = f => async () => { try { await f(); } catch (e) { out.replaceChildren(note("Refused: " + e.message, "bad")); } };
  const projects = (await call("memory.projects", {})).projects, templates = (await call("workflow.templates", {})).templates, insts = (await call("workflow.instances", {})).instances;
  const reading = await call("notes.readingList", {}), cloud = (await call("notes.cloud", {})).tags, courses = (await call("tutor.courses", {})).courses;
  const tcid = h("input", { placeholder: "course id" }), tjson = h("textarea", { rows: 4, style: "width:100%;font-family:monospace" }, JSON.stringify({ title: "My course", lessons: [{ id: "l1", title: "Lesson 1", text: "Your own material" }], questions: [{ id: "q1", lessonId: "l1", prompt: "A question?", choices: ["right", "wrong"], answerIndex: 0, explanation: "Why" }] }, null, 1));
  const pname = h("input", { placeholder: "Project name" }), pgoal = h("input", { placeholder: "Goal" }), pid = h("input", { placeholder: "project id" }), dtitle = h("input", { placeholder: "Decision title" }), dtext = h("input", { placeholder: "Decision", style: "width:40%" }), did = h("input", { placeholder: "decision id" });
  const nt = h("input", { placeholder: "Note title" }), ntext = h("input", { placeholder: "Text", style: "width:40%" }), ntags = h("input", { placeholder: "tags, comma separated" }), nq = h("input", { placeholder: "search text" }), nqt = h("input", { placeholder: "tags" });
  const tpl = h("textarea", { rows: 7, style: "width:100%;font-family:monospace" }, JSON.stringify({ id: "report", name: "CSV report", params: { csv: { type: "string", required: true } }, steps: [{ id: "an", action: "analyst.analyze", args: { csv: "{{p.csv}}" } }] }, null, 1));
  const wid = h("input", { placeholder: "instance / batch id" }), wtpl = h("input", { placeholder: "template id" }), wparams = h("input", { placeholder: 'params JSON, e.g. {"csv":"a,b\n1,2"}', style: "width:50%" }), wstep = h("input", { placeholder: "rewind to step id (empty = start)" });
  const pagesBox = h("textarea", { rows: 5, style: "width:100%;font-family:monospace" }, JSON.stringify([{ label: "A", text: "<h1>Widget</h1><p>Price $49.99</p>" }, { label: "B", text: "<h1>Widget</h1><p>Price $59.99</p>" }], null, 1));
  const tr = h("textarea", { rows: 5, style: "width:100%", placeholder: "Paste a WebVTT/SRT or plain-text transcript (nothing is downloaded or transcribed)" });
  const skillList = (await call("skill.list", {})).skills, sid = h("input", { placeholder: "skill id" }), sver = h("input", { placeholder: "version", style: "width:70px" }), sparams = h("input", { placeholder: 'params JSON', style: "width:50%" });
  const skillBox = h("textarea", { rows: 8, style: "width:100%;font-family:monospace" }, JSON.stringify({ id: "csv-rows", name: "CSV row count", params: { csv: { type: "string", required: true } }, permissions: ["analyst.analyze"], steps: [{ id: "an", action: "analyst.analyze", args: { csv: "{{p.csv}}" } }], tests: [{ name: "small csv", params: { csv: "a,b\n1,2\n" }, expect: { outputs: { an: { report: { rows: 1 } } } } }, { name: "empty csv is refused", negative: true, params: { csv: "" }, expect: { status: "FAILED" } }] }, null, 1));
  const pgBox = h("textarea", { rows: 5, style: "width:100%;font-family:monospace", placeholder: "Paste page HTML or text" }), pgQ = h("input", { placeholder: "Question about the page", style: "width:40%" });
  const skey = h("input", { placeholder: "suggestion key (e.g. approval:ap1)", style: "width:260px" }), pkey = h("input", { placeholder: "preference key, e.g. ui.language" }), pval = h("input", { placeholder: 'value (JSON), e.g. "en" or 5 or ["news"]' }), pprop = h("input", { placeholder: "proposal id" });
  const sdeck = h("input", { placeholder: "deck (e.g. bio)" }), stext = h("textarea", { rows: 3, style: "width:100%", placeholder: "The {{c1::heart}} pumps {{c2::blood}}." }), cid = h("input", { placeholder: "card id" }), cgrade = h("input", { placeholder: "grade 0-5", style: "width:80px" });
  const cpath = h("input", { placeholder: "file name, e.g. app.js" }), cbox = h("textarea", { rows: 8, style: "width:100%;font-family:monospace", placeholder: "Paste code to review" });
  const profileList = await call("profile.list", {}), pid2 = h("input", { placeholder: "profile id" }), prole = h("input", { placeholder: "SEARCH or EXECUTION", style: "width:150px" }), pagent = h("input", { placeholder: "agent id (one of the 30)", style: "width:170px" }), pconv = h("input", { placeholder: "conversation id", style: "width:150px" });
  const profBox = h("textarea", { rows: 6, style: "width:100%;font-family:monospace" }, JSON.stringify({ id: "scout", name: "Source scout", instructions: "Find and summarise sources for the open question.", tools: ["kp.search", "research.report"], skills: [], memoryScopes: ["project-a"] }, null, 1));
  const csv = s => s.split(",").map(x => x.trim()).filter(Boolean);
  return [h("h2", {}, "Projects, notes and workflows"), note("Local, sandbox, no spend. Decisions are proposed by anyone but ADOPTED only here (owner). Workflows can only run registered actions; steps with outside effects cannot be rewound.", "warn"),
    h("h3", {}, "Project memory and decision log (C07)"), table(["Id", "Name", "Goal", "Decisions"], projects.map(p => [p.id, p.name, p.goal, p.decisions])),
    h("div", { class: "row" }, pname, pgoal, h("button", { class: "btn", onclick: guard(async () => { await call("memory.createProject", { name: pname.value, goal: pgoal.value }); location.reload(); }) }, "Create project")),
    h("div", { class: "row" }, pid, dtitle, dtext, h("button", { class: "btn", onclick: guard(async () => show("Proposed", await call("memory.propose", { projectId: pid.value, title: dtitle.value, decision: dtext.value }))) }, "Propose"),
      h("button", { class: "btn", onclick: guard(async () => show("Decisions", await call("memory.decisions", { projectId: pid.value }))) }, "List")),
    h("div", { class: "row" }, did, h("button", { class: "btn primary", onclick: guard(async () => show("Adopted", await call("memory.adopt", { projectId: pid.value, decisionId: did.value }))) }, "Adopt (owner)"),
      h("button", { class: "btn", onclick: guard(async () => show("Revoked", await call("memory.revoke", { projectId: pid.value, decisionId: did.value }))) }, "Revoke"),
      h("button", { class: "btn", onclick: guard(async () => show("Log integrity", await call("memory.verify", {}))) }, "Verify log")),
    h("h3", {}, "Notes, reading list, ideas (P03)"), note("Tags: " + (cloud.map(t => t.tag + " (" + t.count + ")").join(", ") || "none") + " | Reading: " + reading.reading.length + ", to read: " + reading.toRead.length + ", done: " + reading.done.length),
    h("div", { class: "row" }, nt, ntext, ntags, h("button", { class: "btn", onclick: guard(async () => show("Note", await call("notes.addNote", { title: nt.value, text: ntext.value, tags: csv(ntags.value) }))) }, "Add note"),
      h("button", { class: "btn", onclick: guard(async () => show("Book", await call("notes.addBook", { title: nt.value, tags: csv(ntags.value) }))) }, "Add book"), h("button", { class: "btn", onclick: guard(async () => show("Idea", await call("notes.addIdea", { title: nt.value, text: ntext.value, tags: csv(ntags.value) }))) }, "Add idea")),
    h("div", { class: "row" }, nq, nqt, h("button", { class: "btn", onclick: guard(async () => show("Search", await call("notes.search", { q: nq.value, tags: csv(nqt.value) }))) }, "Search"), h("button", { class: "btn", onclick: guard(async () => show("Export", (await call("notes.export", {})).markdown)) }, "Export markdown")),
    h("h3", {}, "Learning tutor (P01) - your own lessons and questions"), note("Courses: " + (courses.map(c => c.id + " (" + c.questions + " questions)").join(", ") || "none") + ". The tutor schedules and grades; it never writes lessons or answers for you."),
    h("div", { class: "row" }, tcid, tjson, h("button", { class: "btn", onclick: guard(async () => show("Course created", await call("tutor.create", { id: tcid.value, ...JSON.parse(tjson.value) }))) }, "Create course")),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: guard(async () => { const r = await call("tutor.quiz", { courseId: tcid.value, count: 5 }); out.replaceChildren(h("h3", {}, "Quiz"), ...r.questions.map(q => h("div", { class: "card" }, h("div", {}, q.prompt + " [" + q.due + "]"), h("div", { class: "row" }, ...q.choices.map((c, i) => h("button", { class: "btn", onclick: guard(async () => { const a = await call("tutor.answer", { courseId: tcid.value, questionId: q.id, choiceIndex: i }); out.append(note((a.correct ? "Correct. " : "Not quite - answer: " + q.choices[a.correctIndex] + ". ") + a.explanation + " Next review " + a.nextReviewAt, a.correct ? "ok" : "bad")); }) }, c))))) ); }) }, "Start quiz"),
      h("button", { class: "btn", onclick: guard(async () => show("Progress (unknown is not zero)", await call("tutor.progress", { courseId: tcid.value }))) }, "Progress"), h("button", { class: "btn", onclick: guard(async () => show("Study plan", await call("tutor.plan", { courseId: tcid.value }))) }, "Plan")),
    h("h3", {}, "Workflows (GE11 / P06 / P08 / P05 / P11)"), table(["Template", "Name", "Version", "Steps", "Params"], templates.map(t => [t.id, t.name, t.version, t.steps, t.params.join(", ")])),
    table(["Instance", "Template", "Status", "Reason", "Steps"], insts.map(i => [i.id, i.templateId, i.status, i.reason ?? "", i.steps.join(" ")])),
    tpl, h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => { const t = JSON.parse(tpl.value); show("Saved", await call("workflow.save", t)); }) }, "Save template"), h("button", { class: "btn", onclick: guard(async () => show("Actions", await call("workflow.actions", {}))) }, "List actions")),
    h("div", { class: "row" }, wtpl, wparams, h("button", { class: "btn", onclick: guard(async () => show("Started", await call("workflow.start", { templateId: wtpl.value, params: wparams.value ? JSON.parse(wparams.value) : {} }))) }, "Start")),
    h("div", { class: "row" }, wid, h("button", { class: "btn primary", onclick: guard(async () => show("Run", await call("workflow.run", { id: wid.value }))) }, "Run"), h("button", { class: "btn", onclick: guard(async () => show("Resume", await call("workflow.resume", { id: wid.value }))) }, "Resume"),
      h("button", { class: "btn", onclick: guard(async () => show("Scheduled workflows run", await call("workflow.tick", {}))) }, "Run due scheduled"), h("button", { class: "btn", onclick: guard(async () => show("Instance", await call("workflow.instance", { id: wid.value }))) }, "Show"), h("button", { class: "btn", onclick: guard(async () => { const r = await ask({ title: "Cancel " + wid.value, text: "Ends this workflow instance. Signs a 60-second approval with your key.", fields: [PASS], ok: "Cancel it", danger: true }); if (r) show("Cancelled", await call("workflow.cancel", { id: wid.value, passphrase: r.passphrase })); }) }, "Cancel"),
      wstep, h("button", { class: "btn", onclick: guard(async () => { const r = await ask({ title: "Rewind " + wid.value, text: "Resets steps from the chosen step onward (refused past a side-effect step). Needs your key.", fields: [PASS], ok: "Rewind" }); if (r) show("Rewind", await call("workflow.rewind", { id: wid.value, toStepId: wstep.value || null, passphrase: r.passphrase })); }) }, "Rewind"), h("button", { class: "btn", onclick: guard(async () => { const r = await ask({ title: "Review step " + wstep.value, text: "A step that failed or timed out may have done part of its work. RETRY runs it again; SKIP leaves it out.", fields: [{ name: "decision", label: "RETRY or SKIP" }, PASS], ok: "Decide" }); if (r) show("Review", await call("workflow.review", { id: wid.value, stepId: wstep.value, decision: String(r.decision).toUpperCase(), passphrase: r.passphrase })); }) }, "Review step"), h("button", { class: "btn", onclick: guard(async () => show("Batch run", await call("workflow.batchRun", { id: wid.value }))) }, "Run batch")),
    h("h3", {}, "Compare pages (P13) - supplied text only"), pagesBox, h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => show("Comparison (untrusted data)", await call("compare.pages", { pages: JSON.parse(pagesBox.value) }))) }, "Compare")),
    h("h3", {}, "Transcript to steps (P02) - supplied transcript only"), tr, h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => show("Transcript analysis (extractive)", await call("transcript.analyze", { transcript: tr.value }))) }, "Analyse")),
    h("h3", {}, "Page text ingestion (M01 core) - supplied page only; nothing is fetched"), note("Paste a page's HTML or text. It is treated as untrusted data: scripts and markup are stripped, secrets redacted, injection phrases and hidden content are flagged, and suspicious lines are never returned as answers. The browser sidebar extension itself is not built."),
    pgBox, h("div", { class: "row" }, pgQ, h("button", { class: "btn", onclick: guard(async () => show("Page", await call("page.extract", { content: pgBox.value }))) }, "Extract"), h("button", { class: "btn primary", onclick: guard(async () => show("Answer", await call("page.ask", { content: pgBox.value, question: pgQ.value }))) }, "Ask the page")),
    h("h3", {}, "Skills (C05) - declarative, pure computation only"), note("A skill is a tested recipe of safe steps. It needs a passing test gate (incl. a negative test) and YOUR activation for the exact tested content. Editing creates a new version; the active one keeps running."),
    table(["Skill", "Active", "Versions (status)"], skillList.map(k => [k.id + " - " + k.name, k.active ?? "none", k.versions.map(v => "v" + v.version + " " + v.status).join(", ")])),
    skillBox, h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => show("Submitted", await call("skill.submit", JSON.parse(skillBox.value)))) }, "Submit draft"),
      sid, sver, h("button", { class: "btn", onclick: guard(async () => show("Test gate", await call("skill.gate", { id: sid.value, version: Number(sver.value) }))) }, "Run test gate"),
      h("button", { class: "btn primary", onclick: guard(async () => { const r = await ask({ title: "Activate " + sid.value + " v" + sver.value, text: "Signs this exact skill version and content. Single use.", fields: [PASS], ok: "Activate (signs)" }); if (r) show("Activated", await call("skill.activate", { id: sid.value, version: Number(sver.value), passphrase: r.passphrase })); }) }, "Activate (owner)"),
      h("button", { class: "btn", onclick: guard(async () => { const r = await ask({ title: "Roll back " + sid.value + " to v" + sver.value, text: "Signs this exact skill version and content. Single use.", fields: [PASS], ok: "Roll back (signs)" }); if (r) show("Rolled back", await call("skill.rollback", { id: sid.value, version: Number(sver.value), passphrase: r.passphrase })); }) }, "Roll back to version"),
      h("button", { class: "btn", onclick: guard(async () => { const r = await ask({ title: "Deactivate " + sid.value, text: "Switches off the active version. Signs this exact version. Single use.", fields: [PASS], ok: "Deactivate (signs)" }); if (r) show("Deactivated", await call("skill.deactivate", { id: sid.value, passphrase: r.passphrase })); }) }, "Deactivate"),
      h("button", { class: "btn", onclick: guard(async () => show("Skill", await call("skill.get", { id: sid.value }))) }, "Show")),
    h("div", { class: "row" }, sparams, h("button", { class: "btn primary", onclick: guard(async () => show("Skill run", await call("skill.run", { id: sid.value, params: sparams.value ? JSON.parse(sparams.value) : {} }))) }, "Run active skill")),
    h("h3", {}, "Assistant profiles (M12) - configuration only, no new agents"), note("A profile is a named set of instructions, tools, skills and memory scopes for the EXISTING agents. It can only narrow what the tool matrix already allows; it never adds an agent or a permission. Fields other than id, name, instructions, tools, skills and memoryScopes are refused."),
    table(["Profile", "Version", "Tools", "Skills", "Scopes"], profileList.profiles.map(x => [x.id + " - " + x.name, "v" + x.version, x.tools, x.skills, x.memoryScopes])), note("Grantable now - SEARCH: " + (profileList.grantable.SEARCH.join(", ") || "none") + " | EXECUTION: " + (profileList.grantable.EXECUTION.join(", ") || "none")),
    profBox, h("div", { class: "row" }, h("button", { class: "btn primary", onclick: guard(async () => show("Profile saved", await call("profile.create", JSON.parse(profBox.value)))) }, "Save profile (owner)"), pid2, prole, h("button", { class: "btn", onclick: guard(async () => show("Effective for the role", await call("profile.resolve", { id: pid2.value, role: prole.value }))) }, "Resolve"),
      h("button", { class: "btn", onclick: guard(async () => show("Profile", await call("profile.get", { id: pid2.value }))) }, "Show"), h("button", { class: "btn", onclick: guard(async () => show("Removed", await call("profile.remove", { id: pid2.value }))) }, "Remove"),
      pagent, h("button", { class: "btn", onclick: guard(async () => show("Assigned", await call("profile.assign", { agentId: pagent.value, profile: pid2.value || null }))) }, "Assign to agent (empty id = unassign)"), h("button", { class: "btn", onclick: guard(async () => show("Assignments", await call("profile.assignments", {}))) }, "Show assignments"), pconv, h("button", { class: "btn", onclick: guard(async () => show("Conversation profile", await call("conv.setProfile", { id: pconv.value, profile: pid2.value || null }))) }, "Set on conversation")),
    h("h3", {}, "Suggestions (A08 / P20) - pointers only; nothing here does anything"), note("Things that need you: pending approvals, proposed decisions, workflows needing review, tested-but-inactive skills, quarantined plugins, proposed preference changes. Dismissing only hides one (and counts toward a PROPOSAL to mute that source, never a silent change)."),
    h("div", { class: "row" }, skey, h("button", { class: "btn", onclick: guard(async () => show("Suggestions", await call("suggest.list", {}))) }, "Show suggestions"), h("button", { class: "btn", onclick: guard(async () => show("Dismissed", await call("suggest.dismiss", { key: skey.value }))) }, "Dismiss key"),
      h("button", { class: "btn", onclick: guard(async () => show("Acknowledged", await call("suggest.ack", { key: skey.value }))) }, "Acknowledge key"), h("button", { class: "btn", onclick: guard(async () => show("Un-snoozed", await call("suggest.unsnooze", { key: skey.value }))) }, "Show again"), h("button", { class: "btn", onclick: guard(async () => show("Snoozed", await call("suggest.status", {}))) }, "Snoozed")),
    h("h3", {}, "Preferences (A11)"), note("Only you change preferences. Learning only proposes (e.g. muting a source you keep dismissing); you confirm or reject. 'learning.confirmFirst' always stays on."),
    h("div", { class: "row" }, pkey, pval, h("button", { class: "btn", onclick: guard(async () => show("Preferences", await call("pref.all", {}))) }, "Show all"), h("button", { class: "btn primary", onclick: guard(async () => { let v = pval.value; try { v = JSON.parse(v); } catch { /* plain string */ } show("Set", await call("pref.set", { key: pkey.value, value: v })); }) }, "Set"), h("button", { class: "btn", onclick: guard(async () => show("Reset", await call("pref.reset", { key: pkey.value }))) }, "Reset"),
      h("button", { class: "btn", onclick: guard(async () => show("Learning (proposals only)", await call("pref.learn", {}))) }, "Run learning"), pprop, h("button", { class: "btn primary", onclick: guard(async () => show("Confirmed", await call("pref.confirm", { id: pprop.value }))) }, "Confirm proposal"), h("button", { class: "btn", onclick: guard(async () => show("Rejected", await call("pref.reject", { id: pprop.value }))) }, "Reject"),
      h("button", { class: "btn", onclick: guard(async () => show("Everything stored about you", await call("pref.export", {}))) }, "Export"), h("button", { class: "btn", onclick: guard(async () => { if (confirm("Delete all stored preferences, history and counters?")) show("Forgotten", await call("pref.forgetAll", { confirm: "FORGET" })); }) }, "Forget all")),
    h("h3", {}, "Study cards (P01) - spaced repetition"), note("Cloze cards come from your own text: The {{c1::heart}} pumps {{c2::blood}}. Grades 0-2 are lapses (the card returns tomorrow), 3-5 pass."),
    stext, h("div", { class: "row" }, sdeck, h("button", { class: "btn", onclick: guard(async () => show("Cloze cards", await call("study.cloze", { deck: sdeck.value, text: stext.value }))) }, "Make cloze cards"), h("button", { class: "btn", onclick: guard(async () => show("Due", await call("study.due", { deck: sdeck.value || null }))) }, "Due now"),
      cid, cgrade, h("button", { class: "btn", onclick: guard(async () => show("Card", await call("study.get", { id: cid.value }))) }, "Reveal"), h("button", { class: "btn primary", onclick: guard(async () => show("Reviewed", await call("study.review", { id: cid.value, grade: Number(cgrade.value) }))) }, "Grade"), h("button", { class: "btn", onclick: guard(async () => show("Study stats", await call("study.stats", {}))) }, "Stats")),
    h("h3", {}, "Code review (P07) - rule-based, supplied code only"), note("Paste one file. Heuristic rules only: a clean result is not a statement that the code is safe. Nothing is run."),
    cpath, cbox, h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => show("Review (heuristic)", await call("code.review", { files: [{ path: cpath.value || "snippet.js", content: cbox.value }] }))) }, "Review")),
    out];
};
views.media = async () => {
  const x = await api("/api/media");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Multimodal"), note("Document store unreadable: " + (x.error ?? ""), "bad")];
  return [h("h2", {}, "Multimodal (documents, images, audio, video)"), note(x.note, "warn"),
    h("h3", {}, "Built in (no provider needed)"), h("ul", {}, ...x.builtIn.map(b => h("li", {}, b))), note("Formats: " + x.formats.join(", ")),
    h("h3", {}, "External provider slots"), table(["Slot", "Provider", "State", "Applies to", "Note"], x.slots.map(s => [s.slot, s.provider ?? "none", pill(s.state), s.appliesTo.join(", ") || "-", s.note])),
    h("h3", {}, "Media documents (metadata only; no content is claimed)"), table(["Name", "Kind", "Format", "Size/duration", "Privacy hint", "Class"], x.documents.map(d => [d.name, d.kind, d.format, [d.width && d.height ? d.width + "x" + d.height : "", d.durationSec ? d.durationSec + "s" : d.durationSecEstimate ? "~" + d.durationSecEstimate + "s" : ""].filter(Boolean).join(" "), d.privacy?.hint ?? "", d.classification ?? ""]))];
};
views.observations = async () => {
  const x = await api("/api/observations");
  if (x.state !== "CONNECTED") return [h("h2", {}, "Observation Memory"), note("Observation store is unreadable and will not be replaced: " + (x.error ?? ""), "bad")];
  const sm = x.summary, txt = h("input", { id: "ob-text", placeholder: "Note something worth remembering (no secrets)", style: "width:55%;padding:8px" }), q = h("input", { id: "ob-q", placeholder: "Search memory", style: "width:30%;padding:8px" }), found = h("div", {});
  const row = i => [i.kind, i.modality, i.classification, i.scope, i.text, i.verification, i.source.type, i.retentionUntil.slice(0, 10), h("span", {}, h("button", { class: "btn", onclick: async () => { const t = prompt("Corrected text", i.text); if (t) { await act("Correct", "/api/observations/action", { op: "correct", id: i.id, text: t }); render(); } } }, "Correct"), h("button", { class: "btn", onclick: async () => { if (confirm("Delete this observation permanently?")) { await act("Delete", "/api/observations/action", { op: "forget", id: i.id, reason: "owner" }); render(); } } }, "Delete"))];
  const cols = ["Kind", "Modality", "Class", "Scope", "Text", "Verification", "Source", "Keep until", ""];
  return [h("h2", {}, "Observation Memory"), note("Consent, retention, correction and real deletion for personal observations. Raw media is never stored - only text and metadata. Recall is keyword-based, not semantic. Research findings are VERIFIED_AT_CAPTURE only."),
    note(`Records ${sm.total} (expired ${sm.expired}) · deleted ${sm.deleted} · audit chain ${sm.chain.ok ? "intact" : "BROKEN at " + sm.chain.brokenAt}`, sm.chain.ok ? "" : "bad"),
    h("div", { class: "row" }, txt, h("button", { class: "btn primary", onclick: async () => { await act("Remember", "/api/observations/action", { op: "observe", text: txt.value }); render(); } }, "Remember")),
    h("div", { class: "row" }, q, h("button", { class: "btn", onclick: async () => { const r = await api("/api/observations/action", { op: "search", query: q.value }); found.replaceChildren(table(cols, r.result.results.map(row))); } }, "Search")), found,
    h("h3", {}, "Recent"), table(cols, x.results.map(row)),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { await act("Purge expired", "/api/observations/action", { op: "purge" }); render(); } }, "Purge expired now"), h("button", { class: "btn", onclick: async () => { const c = prompt("Type the tenant id (JOCI) to delete ALL memory"); if (c) { await act("Forget all", "/api/observations/action", { op: "forgetAll", confirm: c }); render(); } } }, "Forget everything")),
    h("h3", {}, "Recent audit events (content-free)"), table(["#", "At", "Type", "By"], x.events.map(e => [e.n, e.at, e.type, e.by]))];
};
const NAMES = { home: "Home", a11y: "Accessibility audit", pcc: "Tasks / Reminders", observations: "Observation Memory", media: "Multimodal", sandbox: "Code Sandbox", workbench: "Workbench", projects: "Projects & Workflows", research: "Research Ledger", knowledge: "Knowledge Projects", owner_safety: "OWNER SAFETY / CONTROL", overview: "Overview", plugins: "Plugins / Themes", finance: "Revenue / Costs / Profit", evidence: "Evidence / Audit", agents: "Agents (5+25)", jobs: "Jobs / Opportunities", money: "Money Engine", crm_inbox: "CRM / Graph / Inbox", approvals: "Approvals", providers: "Model / Tool health", errors: "Errors & Blockers", owner: "Owner Controls", backup: "Backup / Restore / LKG", doctor: "System Doctor", updates: "Update Center", voice: "Voice", documents: "Documents", inbox: "Inbox", connectors: "Connectors", techwatch: "Tech Watch", brain_status: "Brain · Status", brain_orchestrator: "Brain · Orchestrator", brain_planning: "Brain · Planning", brain_capabilities: "Brain · Capability Graph", brain_knowledge: "Brain · Knowledge", brain_simulation: "Brain · Simulation", brain_verification: "Brain · Verification", brain_security: "Brain · Security", brain_opportunities: "Brain · Opportunities", brain_factory: "Brain · Business Factory", brain_blackbox: "Brain · Black Box", brain_recovery: "Brain · Recovery", brain_behavior: "Brain · Behavior Anomalies", brain_health: "Brain · Health", brain_command: "Owner Command" };
// G12 live feed: fetch-based SSE reader (EventSource cannot send the token header). Read-only; stops when the view changes.
let liveAbort = null;
function stopLive() { try { liveAbort?.abort(); } catch {} liveAbort = null; }
function startLive(list, status) {
  stopLive(); const ctl = new AbortController(); liveAbort = ctl; let n = 0, lastId = null, failures = 0;
  const wait = ms => new Promise(r => { const t = setTimeout(r, ms); ctl.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  (async () => {
    while (!ctl.signal.aborted) {
      try {
        const res = await fetch("/api/stream", { headers: lastId === null ? { "x-atlasz-token": TOKEN } : { "x-atlasz-token": TOKEN, "last-event-id": String(lastId) }, signal: ctl.signal });
        if (!res.ok) { status.textContent = res.status === 503 ? "Too many live streams are open. Retrying..." : "Live feed unavailable (" + res.status + "). Retrying..."; }
        else {
          status.textContent = "Live: connected (read-only)."; failures = 0; const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
          for (;;) {
            const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf("\n\n")) >= 0) {
              const f = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.*)$/m.exec(f)?.[1], dat = /^data: (.*)$/m.exec(f)?.[1], id = /^id: (\d+)$/m.exec(f)?.[1];
              if (!dat || ev === "reset" || ev === "stream-error" || ev === "gap") { if (ev) { status.textContent = ev === "reset" ? "Live: log restarted." : ev === "gap" ? "Live: some older entries were skipped." : "Live: source unreadable (will retry)."; if (ev === "reset") lastId = null; } continue; }
              let o = {}; try { o = JSON.parse(dat); } catch { continue; }
              if (id !== undefined) lastId = Number(id);
              list.prepend(h("li", {}, "#" + id + " " + (o.at ?? "") + " " + (o.event ?? ev) + " " + JSON.stringify(o.data ?? "").slice(0, 160))); if (++n > 200) list.lastChild?.remove();
            }
          }
          status.textContent = "Live: stream ended. Reconnecting...";
        }
      } catch (e) { if (e.name === "AbortError" || ctl.signal.aborted) return; status.textContent = "Live feed interrupted. Reconnecting..."; }
      failures++; await wait(Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
    }
  })();
}
let current = "home";
async function render() {
  if (current !== "evidence") stopLive();
  $("#nav").replaceChildren(h("h1", {}, "ATLASZ"), h("button", { class: "btn danger big", style: "margin:6px 10px;width:calc(100% - 20px)", onclick: async () => { const r = await ask({ title: "EMERGENCY STOP", text: "Stops all new dispatch and external actions at once. Nothing is deleted.", fields: [PASS], danger: true, ok: "EMERGENCY STOP" }); if (r) act("Emergency stop", "/api/owner-safety/action", { action: "EMERGENCY_STOP", passphrase: r.passphrase }); } }, "EMERGENCY STOP"), ...Object.entries(NAMES).map(([k, n]) => h("button", { "aria-current": k === current ? "page" : null, onclick: () => { current = k; render(); } }, n)));
  const main = $("#main");
  try {
    const nodes = await views[current](); main.replaceChildren(...nodes.flat().filter(Boolean));
    const s = await api("/api/status"); const b = $("#banner"); b.hidden = !s.emergency.banner; b.textContent = s.emergency.banner ? s.emergency.banner + " — " + s.emergency.mode : "";
  } catch (e) { main.replaceChildren(h("h2", {}, NAMES[current]), note(e.message === "TOKEN_REQUIRED" ? "Session token missing. Start the Control Center from the ATLASZ icon." : "Error: " + e.message, "bad")); }
}
applyTheme(); render(); setInterval(() => { if (!$("#dlg").open && ["overview", "agents", "jobs", "money", "finance"].includes(current)) render(); }, 10000);
