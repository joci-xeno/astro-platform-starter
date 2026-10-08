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
const NAMES = { home: "Home", pcc: "Tasks / Reminders", observations: "Observation Memory", media: "Multimodal", sandbox: "Code Sandbox", research: "Research Ledger", knowledge: "Knowledge Projects", owner_safety: "OWNER SAFETY / CONTROL", overview: "Overview", plugins: "Plugins / Themes", finance: "Revenue / Costs / Profit", evidence: "Evidence / Audit", agents: "Agents (5+25)", jobs: "Jobs / Opportunities", money: "Money Engine", crm_inbox: "CRM / Graph / Inbox", approvals: "Approvals", providers: "Model / Tool health", errors: "Errors & Blockers", owner: "Owner Controls", backup: "Backup / Restore / LKG", doctor: "System Doctor", updates: "Update Center", voice: "Voice", documents: "Documents", inbox: "Inbox", connectors: "Connectors", techwatch: "Tech Watch", brain_status: "Brain · Status", brain_orchestrator: "Brain · Orchestrator", brain_planning: "Brain · Planning", brain_capabilities: "Brain · Capability Graph", brain_knowledge: "Brain · Knowledge", brain_simulation: "Brain · Simulation", brain_verification: "Brain · Verification", brain_security: "Brain · Security", brain_opportunities: "Brain · Opportunities", brain_factory: "Brain · Business Factory", brain_blackbox: "Brain · Black Box", brain_recovery: "Brain · Recovery", brain_behavior: "Brain · Behavior Anomalies", brain_health: "Brain · Health", brain_command: "Owner Command" };
let current = "home";
async function render() {
  $("#nav").replaceChildren(h("h1", {}, "ATLASZ"), h("button", { class: "btn danger big", style: "margin:6px 10px;width:calc(100% - 20px)", onclick: async () => { const r = await ask({ title: "EMERGENCY STOP", text: "Stops all new dispatch and external actions at once. Nothing is deleted.", fields: [PASS], danger: true, ok: "EMERGENCY STOP" }); if (r) act("Emergency stop", "/api/owner-safety/action", { action: "EMERGENCY_STOP", passphrase: r.passphrase }); } }, "EMERGENCY STOP"), ...Object.entries(NAMES).map(([k, n]) => h("button", { "aria-current": k === current ? "page" : null, onclick: () => { current = k; render(); } }, n)));
  const main = $("#main");
  try {
    const nodes = await views[current](); main.replaceChildren(...nodes.flat().filter(Boolean));
    const s = await api("/api/status"); const b = $("#banner"); b.hidden = !s.emergency.banner; b.textContent = s.emergency.banner ? s.emergency.banner + " — " + s.emergency.mode : "";
  } catch (e) { main.replaceChildren(h("h2", {}, NAMES[current]), note(e.message === "TOKEN_REQUIRED" ? "Session token missing. Start the Control Center from the ATLASZ icon." : "Error: " + e.message, "bad")); }
}
applyTheme(); render(); setInterval(() => { if (!$("#dlg").open && ["overview", "agents", "jobs", "money", "finance"].includes(current)) render(); }, 10000);
