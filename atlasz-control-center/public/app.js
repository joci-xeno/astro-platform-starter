// ATLASZ Control Center UI. All dynamic text goes through textContent (runtime data includes external text).
const TOKEN = (() => { const h = location.hash.slice(1); if (h) { try { sessionStorage.setItem("t", h); } catch {} history.replaceState(null, "", location.pathname); } try { return sessionStorage.getItem("t") || ""; } catch { return h; } })();
const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
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
    const p = await api("/api/plugins");
    const PASS2 = PASS;
    return [h("h2", {}, "Plugins / Extensions / Themes"), note(p.note),
      table(["Name", "Kind", "Version", "Permissions", "Status", "Actions"], p.plugins.map(x => [x.name + " (" + x.id + ")", x.kind, x.version, x.permissions.join(", ") || "none", pill(x.status) , 
        h("div", { class: "row", style: "margin:0" },
          ["THEME", "SKIN"].includes(x.kind)
            ? h("button", { class: "btn", onclick: async () => { await act(x.activeTheme ? "Clear theme" : "Apply theme", "/api/plugins/theme", { id: x.activeTheme ? null : x.id }); applyTheme(); } }, x.activeTheme ? "Clear theme" : "Apply theme")
            : (x.status === "DISABLED" ? h("button", { class: "btn primary", onclick: async () => { const r = await ask({ title: "Enable " + x.name, text: "Declared permissions: " + (x.permissions.join(", ") || "none") + ". Runs in an isolated process with no secrets.", fields: [PASS2], ok: "Enable" }); if (r) act("Enable plugin", "/api/plugins/enable", { id: x.id, passphrase: r.passphrase }); } }, "Enable")
              : x.status === "QUARANTINED" ? h("button", { class: "btn", onclick: async () => { const r = await ask({ title: "Reset quarantine " + x.name, fields: [PASS2], ok: "Reset" }); if (r) act("Reset quarantine", "/api/plugins/reset", { id: x.id, passphrase: r.passphrase }); } }, "Reset quarantine")
              : h("button", { class: "btn", onclick: () => act("Disable plugin", "/api/plugins/disable", { id: x.id }) }, "Disable")))])),
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
    const e = await api("/api/evidence");
    return [h("h2", {}, "Evidence / audit logs"), note(e.note), h("h2", {}, "Hash-chained logs"),
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
      card("Outreach sent", String(m.outreachSent ?? 0)), card("Won", String(m.won ?? 0)), card("Scope reviews", String(m.scopeReviews ?? 0)))];
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
    return [h("h2", {}, "Model / tool / provider health"), h("p", { class: "sub" }, "LIVE requires probe evidence. Placeholders are shown as such."), table(["Component", "State", "Detail"], rows)];
  },
  async errors() {
    const [s, d] = await Promise.all([api("/api/status"), api("/api/doctor")]);
    return [h("h2", {}, "Errors & blockers"), table(["Source", "Error"], Object.entries(s.sourceErrors).map(([k, v]) => [k, v])), h("h2", {}, "Doctor findings"), table(["Severity", "Check", "Detail", "Remedy"], d.findings.map(f => [pill(f.severity), f.id, f.detail ?? "", f.remedy ?? ""]))];
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
  async voice() { return [h("h2", {}, "Speak-to-Speak / Live Voice"), note("NOT BUILT (V7.3 §5). No STT/TTS provider is attached, so voice is never shown LIVE. Planned for a later development round.")]; }
};
const NAMES = { home: "Home", overview: "Overview", plugins: "Plugins / Themes", finance: "Revenue / Costs / Profit", evidence: "Evidence / Audit", agents: "Agents (5+25)", jobs: "Jobs / Opportunities", money: "Money Engine", approvals: "Approvals", providers: "Model / Tool health", errors: "Errors & Blockers", owner: "Owner Controls", backup: "Backup / Restore / LKG", doctor: "System Doctor", updates: "Update Center", voice: "Voice (planned)" };
let current = "home";
async function render() {
  $("#nav").replaceChildren(h("h1", {}, "ATLASZ"), ...Object.entries(NAMES).map(([k, n]) => h("button", { "aria-current": k === current ? "page" : null, onclick: () => { current = k; render(); } }, n)));
  const main = $("#main");
  try {
    const nodes = await views[current](); main.replaceChildren(...nodes.flat().filter(Boolean));
    const s = await api("/api/status"); const b = $("#banner"); b.hidden = !s.emergency.banner; b.textContent = s.emergency.banner ? s.emergency.banner + " — " + s.emergency.mode : "";
  } catch (e) { main.replaceChildren(h("h2", {}, NAMES[current]), note(e.message === "TOKEN_REQUIRED" ? "Session token missing. Start the Control Center from the ATLASZ icon." : "Error: " + e.message, "bad")); }
}
applyTheme(); render(); setInterval(() => { if (!$("#dlg").open && ["overview", "agents", "jobs", "money", "finance"].includes(current)) render(); }, 10000);
