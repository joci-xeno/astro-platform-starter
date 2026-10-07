// Owner Command Layer (V7.3 Brain §13): natural language (EN/HU) -> a fixed whitelist of controlled, audited operations.
// Language only SELECTS an operation. It never grants anything: consequential operations need a signed owner approval bound to the operation.
import { createAuditChain } from "../audit-chain.mjs";
import { redactSecrets } from "./black-box.mjs";

const L = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const COMMANDS = Object.freeze({
  SHOW_AGENTS: { consequential: false, re: [/\b(show|list|mutasd|listazd)\b.*\b(all )?(30 )?agents?\b/, /\bagens(ek|eket)?\b/, /\bugynok/] },
  FIND_OPPORTUNITIES: { consequential: false, re: [/\b(find|show|best)\b.*\bopportunit/, /\blehetoseg/] },
  SHOW_JOBS: { consequential: false, re: [/\b(show|list)\b.*\bjobs?\b/, /\bmai (munkak|feladatok)\b/, /\bmunkak\b/] },
  SHOW_REVENUE: { consequential: false, re: [/\b(verified )?revenue\b/, /\bbevetel/] },
  SHOW_COSTS_PROFIT: { consequential: false, re: [/\bcosts?\b.*\bprofit\b/, /\bprofit\b/, /\bkoltseg|\bnyereseg/] },
  SHOW_BROKEN: { consequential: false, re: [/\bwhat('?s| is) broken\b/, /\bshow what is broken\b/, /\bmi (rossz|hibas|romlott)\b/] },
  RUN_DOCTOR: { consequential: false, re: [/\bsystem doctor\b/, /\brun (the )?doctor\b/, /\bdoktor\b/] },
  PAUSE_EXTERNAL: { consequential: true, re: [/\bpause\b.*\bexternal\b/, /\bpause all\b/, /\bfuggeszd\b.*\bkulso\b/, /\ballitsd le\b/] },
  RESUME_SYSTEM: { consequential: true, re: [/\bresume\b/, /\bindits ujra\b/, /\bfolytasd\b/] },
  CREATE_RESTORE_POINT: { consequential: true, re: [/\b(create|make)\b.*\brestore point\b/, /\bmentesi pont\b/, /\bbackup now\b/] },
  TEST_NEXT_UPDATE: { consequential: true, re: [/\btest\b.*\bupdate\b/, /\bteszteld\b.*\bfrissites/] },
  ROLLBACK_LAST_STABLE: { consequential: true, re: [/\brollback\b/, /\bvisszaallit/] }
});

export function createOwnerCommandLayer({ ownerAuth, handlers = {}, auditPath = null, now = () => new Date().toISOString() } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const audit = createAuditChain({ filePath: auditPath, now });
  /** Ordered so that more specific consequential phrases win over generic read-only ones. */
  function parse(text) {
    const t = L(String(text ?? ""));
    const order = Object.entries(COMMANDS).sort((a, b) => Number(b[1].consequential) - Number(a[1].consequential));
    for (const [intent, c] of order) if (c.re.some(r => r.test(t))) return intent;
    return null;
  }
  async function handle(text, { ownerApproval = null } = {}) {
    const intent = parse(text), clean = redactSecrets(String(text ?? "")).slice(0, 300);
    if (!intent) { audit.append("CMD_UNRECOGNIZED", { text: clean }); return { status: "UNRECOGNIZED", note: "No operation executed." }; }
    const c = COMMANDS[intent];
    if (c.consequential) {
      const need = { action: "OWNER_COMMAND_" + intent, subject: intent };
      if (!ownerApproval) { audit.append("CMD_NEEDS_APPROVAL", { intent, text: clean }); return { status: "NEEDS_APPROVAL", intent, required: need }; }
      const v = ownerAuth.verifyApproval(ownerApproval, need);
      if (!v.allowed) { audit.append("CMD_APPROVAL_REJECTED", { intent, reason: v.reason }); return { status: "NEEDS_APPROVAL", intent, required: need, reason: v.reason }; }
    }
    const h = handlers[intent];
    if (typeof h !== "function") { audit.append("CMD_NOT_CONNECTED", { intent }); return { status: "NOT_CONNECTED", intent, note: "No handler is connected for this operation." }; }
    try { const r = await h({ text: clean }); audit.append("CMD_EXECUTED", { intent, consequential: c.consequential }); return { status: "EXECUTED", intent, result: r }; }
    catch (e) { audit.append("CMD_FAILED", { intent, error: String(e.message).slice(0, 120) }); return { status: "FAILED", intent, error: String(e.message).slice(0, 200) }; }
  }
  return { parse, handle, audit: { verify: () => audit.verify(), entries: () => audit.entries() } };
}
