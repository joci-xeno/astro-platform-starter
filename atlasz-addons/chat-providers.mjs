// 23-point item 7: Chat providers center. A catalogue of 15 chat platforms + a per-account state machine + inbound adapter interface + one-by-one approved outbox.
// WHAT THIS IS: the policy and plumbing. WHAT IT IS NOT: a connector. No adapter ships here; every adapter is INJECTED (tests use fakes). Nothing here is LIVE.
//   catalogue        honest `officialApi` per platform (YES / LIMITED / NO). Where only unofficial automation exists (personal-account clients, reverse-engineered
//                    protocols, browser automation) the platform stays UNAVAILABLE with the reason (`unofficialRouteRefused: true`). The facts are the author's
//                    offline knowledge (CATALOGUE_EVIDENCE): verify each provider's current terms before configuring.
//   states           UNCONFIGURED -> CONFIGURED -> LISTENING_READONLY -> SEND_ENABLED (and back down at any time; going down never needs approval).
//                    configure: data only (credential REFERENCE name, never a value). listen: an injected READ-ONLY adapter (an adapter that can send is refused).
//                    SEND_ENABLED: a signed owner approval CHAT_SEND_ENABLE bound to provider + account + scope (REPLY_ONLY | NEW_CONVERSATION) and an injected send adapter.
//   outbox           DRAFT != SENT. Outgoing text is only a draft until the owner approves THAT draft (CHAT_SEND, subject = draft id + content hash); one approval, one draft,
//                    one send attempt. SENT needs a provider message id from the send adapter; otherwise SEND_UNCONFIRMED / SEND_FAILED. No bulk send exists.
//   inbound          adapter.fetchInbound({limit}) -> validated, size-bounded, secret-scrubbed (secret-patterns via screenText), injection-flagged, fenced as
//                    <<UNTRUSTED_CHAT_MESSAGE>> and ingested into the existing universal-inbox shape (inbox.ingest). Inbound text is data, never an instruction.
//   limits           per-provider inbound/minute and outbound/hour windows (the owner may LOWER them, never raise above the catalogue default); kill switch
//                    (emergency-stop emergencyGate) blocks listening, polling, enabling and sending; PAUSE_ALL also blocks drafting.
// Status honesty: IMPLEMENTED + unit TESTED with fake adapters. Not CONNECTED (no real adapter exists in the repository). Not LIVE. State is in memory
// (a restart returns every account to UNCONFIGURED, which is fail-closed); the audit log is durable when `dir` is given.
import crypto from "node:crypto";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { emergencyGate } from "./emergency-stop.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";
import { screenText, defang } from "./reasoning-common.mjs";

export const CHAT_STATES = Object.freeze(["UNAVAILABLE", "UNCONFIGURED", "CONFIGURED", "LISTENING_READONLY", "SEND_ENABLED"]);
export const SEND_SCOPES = Object.freeze(["REPLY_ONLY", "NEW_CONVERSATION"]);
export const DRAFT_STATES = Object.freeze(["DRAFT", "SENDING", "SENT", "SEND_UNCONFIRMED", "SEND_FAILED", "DISCARDED"]);
export const CHAT_LIMITS = Object.freeze({ maxText: 4000, maxInboundBatch: 50, maxDrafts: 1000, maxAccountsPerProvider: 5, adapterTimeoutMs: 10000, maxFrom: 200, maxSeen: 5000, maxHosts: 10 });
export const CATALOGUE_EVIDENCE = "AUTHOR_KNOWLEDGE_OFFLINE_UNVERIFIED: platform API facts as known at build time; verify current terms, pricing and approval requirements before configuring.";
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,99}$/, EXT_RE = /^[\x21-\x7e]{1,200}$/, REF_RE = /^[A-Z][A-Z0-9_]{2,63}$/, ADAPTER_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const sha = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const canon = v => (Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v ?? null));
const CTL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Zl}\p{Zp}\p{Cf}]/gu, CTL1 = new RegExp(CTL.source, "u");

const P = (id, displayName, officialApi, o) => Object.freeze({ id, displayName, officialApi, unofficialRouteRefused: officialApi === "NO", available: officialApi !== "NO", inboxSource: id === "email" ? "EMAIL" : "CONNECTOR_EVENT", ...o,
  egressHosts: Object.freeze([...(o.egressHosts ?? [])]), refusedRoutes: Object.freeze([...(o.refusedRoutes ?? [])]), rateDefaults: Object.freeze({ ...o.rateDefaults }) });
/** 21 platforms (the 15 of the owner's 23-point item 7 plus 6 more). officialApi: YES = an official API for automated messaging exists for the stated account scope; LIMITED = official but restricted
 *  (business/professional accounts only, messaging windows, partner agreements); NO = no official automation route (UNAVAILABLE). */
export const CHAT_PROVIDER_CATALOGUE = Object.freeze([
  P("whatsapp-business", "WhatsApp Business", "YES", { apiName: "WhatsApp Business Platform (Cloud API)", accountScope: "a WhatsApp Business phone number registered to a verified business", egressHosts: ["graph.facebook.com"], sendCost: "PROVIDER_PRICING_APPLIES", rateDefaults: { inboundPerMin: 60, outboundPerHour: 30 }, refusedRoutes: ["personal WhatsApp account automation (WhatsApp Web / reverse-engineered clients)"], notes: "Business-initiated messages outside the customer-service window need pre-approved templates." }),
  P("telegram", "Telegram", "YES", { apiName: "Telegram Bot API", accountScope: "a bot account (cannot read a person's private chats)", egressHosts: ["api.telegram.org"], sendCost: "FREE_API", rateDefaults: { inboundPerMin: 60, outboundPerHour: 60 }, refusedRoutes: ["user-account automation through third-party MTProto clients"], notes: "Bots only see messages sent to them or in groups they are added to." }),
  P("slack", "Slack", "YES", { apiName: "Slack Web API + Events API", accountScope: "a Slack app installed in a workspace", egressHosts: ["slack.com"], sendCost: "FREE_API", rateDefaults: { inboundPerMin: 60, outboundPerHour: 60 }, refusedRoutes: ["browser/session-cookie automation"], notes: "Workspace admin may need to approve the app." }),
  P("discord", "Discord", "YES", { apiName: "Discord Bot API (gateway + REST)", accountScope: "a bot user added to a server", egressHosts: ["discord.com"], sendCost: "FREE_API", rateDefaults: { inboundPerMin: 60, outboundPerHour: 60 }, refusedRoutes: ["self-bots (automating a user account), which Discord's terms prohibit"], notes: "Message-content access is a privileged intent." }),
  P("microsoft-teams", "Microsoft Teams", "YES", { apiName: "Microsoft Graph / Bot Framework", accountScope: "an app registration in a Microsoft 365 tenant", egressHosts: ["graph.microsoft.com"], sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 30, outboundPerHour: 30 }, refusedRoutes: ["desktop-client automation"], notes: "Tenant admin consent is usually required; some Graph messaging APIs are metered." }),
  P("google-chat", "Google Chat", "YES", { apiName: "Google Chat API", accountScope: "a Chat app in a Google Workspace domain", egressHosts: ["chat.googleapis.com"], sendCost: "FREE_API", rateDefaults: { inboundPerMin: 30, outboundPerHour: 30 }, refusedRoutes: ["browser automation of a personal account"], notes: "Workspace accounts only." }),
  P("signal", "Signal", "NO", { apiName: null, accountScope: null, egressHosts: [], sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 1, outboundPerHour: 1 }, refusedRoutes: ["signal-cli and other unofficial clients registered to a phone number"], unavailableReason: "Signal publishes no official API for automated messaging; the only routes are unofficial clients. Refused.", notes: "" }),
  P("messenger", "Facebook Messenger", "LIMITED", { apiName: "Messenger Platform (Pages)", accountScope: "a Facebook Page's conversations only (not a personal profile)", egressHosts: ["graph.facebook.com"], sendCost: "FREE_API", rateDefaults: { inboundPerMin: 30, outboundPerHour: 20 }, refusedRoutes: ["personal profile automation"], notes: "A standard messaging window applies; app review is required." }),
  P("instagram-dm", "Instagram DMs", "LIMITED", { apiName: "Instagram Messaging (Graph API)", accountScope: "a professional (business/creator) account linked to a Page", egressHosts: ["graph.facebook.com"], sendCost: "FREE_API", rateDefaults: { inboundPerMin: 30, outboundPerHour: 20 }, refusedRoutes: ["personal account automation / private mobile API"], notes: "Messaging window and app review apply." }),
  P("line", "LINE", "YES", { apiName: "LINE Messaging API", accountScope: "a LINE Official Account", egressHosts: ["api.line.me"], sendCost: "PROVIDER_PRICING_APPLIES", rateDefaults: { inboundPerMin: 30, outboundPerHour: 30 }, refusedRoutes: ["personal LINE account automation"], notes: "Push messages count against the plan's monthly quota." }),
  P("viber", "Viber", "LIMITED", { apiName: "Viber REST Bot API", accountScope: "a Viber bot", egressHosts: ["chatapi.viber.com"], sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 30, outboundPerHour: 20 }, refusedRoutes: ["personal account automation"], notes: "New bots may need a commercial agreement with Viber; verify current terms." }),
  P("wechat", "WeChat", "LIMITED", { apiName: "WeChat Official Accounts Platform API", accountScope: "a verified Official Account (entity/region restrictions)", egressHosts: ["api.weixin.qq.com"], sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 30, outboundPerHour: 10 }, refusedRoutes: ["personal WeChat account automation (web/desktop protocol bots)"], notes: "Customer-service messages only within an interaction window." }),
  P("sms-gateway", "SMS via a gateway", "YES", { apiName: "the chosen licensed SMS gateway's API (owner selects the gateway)", accountScope: "a sender number/ID rented from the gateway", egressHosts: [], hostsRequiredAtConfigure: true, sendCost: "PROVIDER_PRICING_APPLIES", rateDefaults: { inboundPerMin: 30, outboundPerHour: 10 }, refusedRoutes: ["phone/modem automation without a licensed gateway"], notes: "Every SMS costs money; sender registration rules differ by country." }),
  P("email", "Email", "YES", { apiName: "IMAP/SMTP or the mailbox provider's API", accountScope: "a mailbox the owner controls", egressHosts: [], hostsRequiredAtConfigure: true, sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 60, outboundPerHour: 20 }, refusedRoutes: ["webmail browser automation"], notes: "The existing connector-catalog Gmail descriptor is read-only." }),
  P("matrix", "Matrix", "YES", { apiName: "Matrix Client-Server API", accountScope: "a bot/user account on a homeserver the owner chooses", egressHosts: [], hostsRequiredAtConfigure: true, sendCost: "FREE_API", rateDefaults: { inboundPerMin: 60, outboundPerHour: 60 }, refusedRoutes: [], notes: "Open standard; bridges to other networks inherit those networks' terms." }),
  // Added so that every platform in the owner's 23-point item 7 is present (the original 15 above stay). Facts are offline author knowledge: verify before configuring.
  P("apple-messages", "Apple Messages / iMessage", "LIMITED", { apiName: "Messages for Business through an Apple-approved Messaging Service Provider", accountScope: "a registered business account served by an approved provider (personal iMessage has no automation API)", egressHosts: [], hostsRequiredAtConfigure: true, sendCost: "PROVIDER_PRICING_APPLIES", rateDefaults: { inboundPerMin: 30, outboundPerHour: 10 }, refusedRoutes: ["personal iMessage automation (AppleScript, jailbroken or relay hacks)"], notes: "Business registration and a provider agreement are required; personal iMessage stays refused." }),
  P("nextcloud-talk", "Nextcloud Talk", "YES", { apiName: "Nextcloud Talk bot / OCS API", accountScope: "a bot or user on the owner's Nextcloud server", egressHosts: [], hostsRequiredAtConfigure: true, sendCost: "FREE_API", rateDefaults: { inboundPerMin: 60, outboundPerHour: 60 }, refusedRoutes: [], notes: "Self-hosted; the owner names the server host. Bot support depends on the server version." }),
  P("nostr", "Nostr", "LIMITED", { apiName: "Nostr relays (open protocol, signed events)", accountScope: "a keypair the owner controls", egressHosts: [], hostsRequiredAtConfigure: true, sendCost: "FREE_API", rateDefaults: { inboundPerMin: 30, outboundPerHour: 10 }, refusedRoutes: ["storing the private key outside the vault"], notes: "No central API or account approval; events are public by default. Needs signing with the owner's private key, so it stays unconfigured until a vault-held key flow is approved." }),
  P("tor-messenger", "Tor Messenger", "NO", { apiName: null, accountScope: null, egressHosts: [], sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 1, outboundPerHour: 1 }, refusedRoutes: ["any automation of an anonymity client"], unavailableReason: "Tor Messenger was discontinued by the Tor Project and had no automation API; routing agent traffic through anonymity tooling is also outside this system's egress policy. Refused.", notes: "" }),
  P("zalo", "Zalo (Official Account)", "LIMITED", { apiName: "Zalo Official Account API", accountScope: "a verified Zalo Official Account", egressHosts: ["openapi.zalo.me"], sendCost: "PROVIDER_PRICING_APPLIES", rateDefaults: { inboundPerMin: 30, outboundPerHour: 10 }, refusedRoutes: ["personal Zalo account automation"], notes: "Official Account verification and regional terms apply." }),
  P("zalo-personal", "Zalo Personal", "NO", { apiName: null, accountScope: null, egressHosts: [], sendCost: "UNKNOWN", rateDefaults: { inboundPerMin: 1, outboundPerHour: 1 }, refusedRoutes: ["unofficial personal-account clients"], unavailableReason: "Zalo offers no official automation for personal accounts; the only routes are unofficial clients that violate the terms. Refused.", notes: "" }),
]);
export const sendEnableSubject = (providerId, accountId, scope) => `chat-send-enable:${providerId}:${accountId}:${scope}`;

function withTimeout(p, ms) { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error("ADAPTER_TIMEOUT"), { code: "ADAPTER_TIMEOUT" })), ms); })]).finally(() => clearTimeout(t)); }
const cleanLine = (s, max) => scrub(String(s ?? "").replace(CTL, "").slice(0, max)).replace(/[<>]{2,}/g, m => m.split("").join(" "));
export const fenceChat = (label, text) => "<<UNTRUSTED_CHAT_MESSAGE " + String(label).replace(/[^A-Za-z0-9:._@+-]/g, "_").slice(0, 80) + ">>\n" + defang(text) + "\n<<END_UNTRUSTED_CHAT_MESSAGE>>";

export function createChatProviders({ inbox, ownerAuth = null, gate = emergencyGate, dir = null, now = () => new Date().toISOString(), clock = () => Date.now(), adapterTimeoutMs = CHAT_LIMITS.adapterTimeoutMs } = {}) {
  if (!inbox || typeof inbox.ingest !== "function") throw new Error("INBOX_REQUIRED");
  const audit = createAuditChain({ filePath: dir ? path.join(dir, "chat-providers-audit.jsonl") : null, now });
  const cat = new Map(CHAT_PROVIDER_CATALOGUE.map(p => [p.id, p]));
  const accounts = new Map(), drafts = new Map(), inboundIndex = new Map(), rate = new Map();
  const key = (p, a) => p + "/" + a;
  const refuse = (reason, extra = {}) => { audit.append("CHAT_REFUSED", { reason, ...Object.fromEntries(Object.entries(extra).filter(([k]) => ["providerId", "accountId", "draftId"].includes(k))) }); return { ok: false, reason, ...extra }; };
  const gateOk = external => { try { const g = gate({ external }); return g && g.allowed === false ? "EMERGENCY_STOP:" + g.reason : null; } catch { return "EMERGENCY_STOP:GATE_ERROR"; } };
  const R = id => { if (!rate.has(id)) { const d = cat.get(id).rateDefaults; rate.set(id, { inboundPerMin: d.inboundPerMin, outboundPerHour: d.outboundPerHour, inbound: [], outbound: [] }); } return rate.get(id); };
  const used = (arr, windowMs) => { const t = clock(); while (arr.length && arr[0] <= t - windowMs) arr.shift(); return arr.length; };
  function acct(providerId, accountId) {
    const p = typeof providerId === "string" ? cat.get(providerId) : null; if (!p) return { error: "UNKNOWN_PROVIDER" };
    if (!p.available) return { error: "PROVIDER_UNAVAILABLE", p };
    if (typeof accountId !== "string" || !ACCOUNT_RE.test(accountId)) return { error: "ACCOUNT_ID_INVALID", p };
    return { p, a: accounts.get(key(providerId, accountId)) ?? null };
  }
  const view = a => a ? { providerId: a.providerId, accountId: a.accountId, state: a.state, credentialRef: a.credentialRef, hosts: [...a.hosts], sendScope: a.sendScope, inboundAdapter: a.inbound?.id ?? null, sendAdapter: a.sender?.id ?? null, connected: Boolean(a.inbound), live: false } : null;
  const validAdapter = (ad, providerId, fn) => ad && typeof ad === "object" && typeof ad[fn] === "function" && ad.providerId === providerId && typeof ad.id === "string" && ADAPTER_ID_RE.test(ad.id);

  function configure(providerId, { accountId, credentialRef = null, hosts = null } = {}) {
    const x = acct(providerId, accountId); if (x.error) return refuse(x.error, { providerId, accountId, ...(x.p?.unavailableReason ? { detail: x.p.unavailableReason } : {}) });
    if (x.a) return refuse("ALREADY_CONFIGURED", { providerId, accountId, state: x.a.state });
    if ([...accounts.values()].filter(a => a.providerId === providerId).length >= CHAT_LIMITS.maxAccountsPerProvider) return refuse("ACCOUNT_LIMIT", { providerId, accountId });
    if (credentialRef !== null && !(typeof credentialRef === "string" && REF_RE.test(credentialRef) && !containsSecret(credentialRef))) return refuse("CREDENTIAL_REF_MUST_BE_A_NAME", { providerId, accountId });
    let h = [...x.p.egressHosts];
    if (x.p.hostsRequiredAtConfigure) {
      if (!Array.isArray(hosts) || !hosts.length || hosts.length > CHAT_LIMITS.maxHosts || !hosts.every(s => typeof s === "string" && HOST_RE.test(s))) return refuse("HOSTS_REQUIRED_EXACT_NAMES", { providerId, accountId });
      h = [...new Set(hosts)];
    } else if (hosts !== null) return refuse("HOSTS_FIXED_BY_CATALOGUE", { providerId, accountId });
    accounts.set(key(providerId, accountId), { providerId, accountId, state: "CONFIGURED", credentialRef, hosts: h, sendScope: null, inbound: null, sender: null, seen: new Set(), configuredAt: now() });
    audit.append("CHAT_CONFIGURED", { providerId, accountId, credentialRef, hosts: h });
    return { ok: true, state: "CONFIGURED", account: view(accounts.get(key(providerId, accountId))) };
  }
  function startListening(providerId, accountId, { adapter } = {}) {
    const x = acct(providerId, accountId); if (x.error) return refuse(x.error, { providerId, accountId }); if (!x.a) return refuse("NOT_CONFIGURED", { providerId, accountId });
    if (x.a.state !== "CONFIGURED") return refuse("STATE_NOT_CONFIGURED", { providerId, accountId, state: x.a.state });
    if (!validAdapter(adapter, providerId, "fetchInbound")) return refuse("INBOUND_ADAPTER_INVALID", { providerId, accountId });
    if (typeof adapter.send === "function" || typeof adapter.post === "function" || typeof adapter.reply === "function") return refuse("INBOUND_ADAPTER_MUST_BE_READ_ONLY", { providerId, accountId });
    const g = gateOk(true); if (g) return refuse(g, { providerId, accountId });
    x.a.inbound = adapter; x.a.state = "LISTENING_READONLY"; audit.append("CHAT_LISTENING", { providerId, accountId, adapter: adapter.id });
    return { ok: true, state: x.a.state };
  }
  function enableSend(providerId, accountId, { scope, approval = null, sendAdapter } = {}) {
    const x = acct(providerId, accountId); if (x.error) return refuse(x.error, { providerId, accountId }); if (!x.a) return refuse("NOT_CONFIGURED", { providerId, accountId });
    if (x.a.state !== "LISTENING_READONLY") return refuse("STATE_NOT_LISTENING_READONLY", { providerId, accountId, state: x.a.state });
    if (!SEND_SCOPES.includes(scope)) return refuse("SCOPE_INVALID", { providerId, accountId });
    if (!validAdapter(sendAdapter, providerId, "send")) return refuse("SEND_ADAPTER_INVALID", { providerId, accountId });
    const g = gateOk(true); if (g) return refuse(g, { providerId, accountId });
    if (!ownerAuth) return refuse("OWNER_AUTH_NOT_CONFIGURED", { providerId, accountId });
    const subject = sendEnableSubject(providerId, accountId, scope);
    let v; try { v = ownerAuth.verifyApproval(approval, { action: "CHAT_SEND_ENABLE", subject }); } catch { v = { allowed: false, reason: "OWNER_APPROVAL_INVALID" }; }
    if (!v || v.allowed !== true) return refuse("OWNER_APPROVAL_REQUIRED", { providerId, accountId, detail: v?.reason ?? null, subject });
    x.a.sender = sendAdapter; x.a.sendScope = scope; x.a.state = "SEND_ENABLED"; audit.append("CHAT_SEND_ENABLED", { providerId, accountId, scope, approvalNonce: v.nonce ?? null, adapter: sendAdapter.id });
    return { ok: true, state: "SEND_ENABLED", scope };
  }
  /** Going down never needs approval and is allowed under the kill switch. */
  function step(providerId, accountId, to) {
    const a = accounts.get(key(providerId, accountId)); if (!a) return { ok: false, reason: "NOT_CONFIGURED" };
    const order = ["CONFIGURED", "LISTENING_READONLY", "SEND_ENABLED"]; if (order.indexOf(a.state) <= order.indexOf(to)) return { ok: true, unchanged: true, state: a.state };
    if (to !== "SEND_ENABLED") { a.sender = null; a.sendScope = null; } if (to === "CONFIGURED") a.inbound = null;
    a.state = to; audit.append("CHAT_STEPPED_DOWN", { providerId, accountId, to }); return { ok: true, state: to };
  }
  const disableSend = (p, a) => step(p, a, "LISTENING_READONLY"), stopListening = (p, a) => step(p, a, "CONFIGURED");
  function unconfigure(providerId, accountId) {
    const k = key(providerId, accountId); if (!accounts.has(k)) return { ok: true, unchanged: true, state: "UNCONFIGURED" };
    accounts.delete(k); for (const d of drafts.values()) if (d.providerId === providerId && d.accountId === accountId && d.state === "DRAFT") d.state = "DISCARDED";
    audit.append("CHAT_UNCONFIGURED", { providerId, accountId }); return { ok: true, state: "UNCONFIGURED" };
  }
  function setRateLimit(providerId, { inboundPerMin, outboundPerHour } = {}) {
    const p = cat.get(providerId); if (!p || !p.available) return { ok: false, reason: p ? "PROVIDER_UNAVAILABLE" : "UNKNOWN_PROVIDER" };
    const ok = (v, max) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= max);
    if (!ok(inboundPerMin, p.rateDefaults.inboundPerMin) || !ok(outboundPerHour, p.rateDefaults.outboundPerHour)) return { ok: false, reason: "RATE_LIMIT_MAY_ONLY_BE_LOWERED", max: p.rateDefaults };
    const r = R(providerId); if (inboundPerMin !== undefined) r.inboundPerMin = inboundPerMin; if (outboundPerHour !== undefined) r.outboundPerHour = outboundPerHour;
    audit.append("CHAT_RATE_LIMIT_SET", { providerId, inboundPerMin: r.inboundPerMin, outboundPerHour: r.outboundPerHour }); return { ok: true, inboundPerMin: r.inboundPerMin, outboundPerHour: r.outboundPerHour };
  }

  /** Pull inbound messages through the injected read-only adapter into the universal inbox (fenced, scrubbed). Never throws. */
  async function poll(providerId, accountId) {
    const x = acct(providerId, accountId); if (x.error) return refuse(x.error, { providerId, accountId }); if (!x.a) return refuse("NOT_CONFIGURED", { providerId, accountId });
    if (!["LISTENING_READONLY", "SEND_ENABLED"].includes(x.a.state) || !x.a.inbound) return refuse("NOT_LISTENING", { providerId, accountId, state: x.a.state });
    const g = gateOk(true); if (g) return refuse(g, { providerId, accountId });
    const r = R(providerId), remaining = r.inboundPerMin - used(r.inbound, 60_000); if (remaining <= 0) return refuse("RATE_LIMITED_INBOUND", { providerId, accountId });
    const limit = Math.min(remaining, CHAT_LIMITS.maxInboundBatch);
    let batch; try { batch = await withTimeout(Promise.resolve().then(() => x.a.inbound.fetchInbound({ limit })), adapterTimeoutMs); }
    catch (e) { return refuse(e?.code === "ADAPTER_TIMEOUT" ? "ADAPTER_TIMEOUT" : "ADAPTER_ERROR", { providerId, accountId, detail: scrub(String(e?.message ?? e)).replace(CTL, "").slice(0, 120) }); }
    if (!Array.isArray(batch)) return refuse("ADAPTER_RESPONSE_INVALID", { providerId, accountId });
    const dropped = Math.max(0, batch.length - limit), out = { ok: true, ingested: [], duplicates: 0, rejected: 0, dropped, flagged: 0 };
    for (const m of batch.slice(0, limit)) {
      if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.externalId !== "string" || !EXT_RE.test(m.externalId) || typeof m.text !== "string" || !m.text.length || typeof m.from !== "string" || !m.from.trim() || (m.threadId !== undefined && m.threadId !== null && !(typeof m.threadId === "string" && EXT_RE.test(m.threadId)))) { out.rejected++; continue; }
      if (x.a.seen.has(m.externalId)) { out.duplicates++; continue; }
      r.inbound.push(clock());
      const s = screenText(m.text, { max: CHAT_LIMITS.maxText }), from = cleanLine(m.from, CHAT_LIMITS.maxFrom);
      const label = providerId + ":" + accountId, extId = "chat:" + providerId + ":" + accountId + ":" + m.externalId;
      let res; try {
        res = inbox.ingest({ source: x.p.inboxSource, externalId: extId, from, subject: "[" + x.p.displayName + "] inbound message (untrusted)", body: fenceChat(label, s.text),
          meta: { channel: "CHAT", providerId, accountId, threadId: m.threadId ?? null, untrusted: true, secretRedacted: s.secretRedacted, injection: s.injection, injectionSignals: s.injectionSignals.slice(0, 6), truncated: s.oversized, adapter: x.a.inbound.id } });
      } catch (e) { out.rejected++; continue; }
      if (x.a.seen.size >= CHAT_LIMITS.maxSeen) x.a.seen.delete(x.a.seen.values().next().value); x.a.seen.add(m.externalId);
      if (res?.duplicate) { out.duplicates++; continue; }
      const inboxId = res?.id ?? x.p.inboxSource + ":" + extId;
      if (inboundIndex.size >= CHAT_LIMITS.maxSeen) inboundIndex.delete(inboundIndex.keys().next().value);
      inboundIndex.set(inboxId, { providerId, accountId, from: m.from.slice(0, CHAT_LIMITS.maxFrom), threadId: m.threadId ?? null, externalId: m.externalId });
      if (s.injection || s.secretRedacted) out.flagged++; out.ingested.push(inboxId);
    }
    audit.append("CHAT_POLLED", { providerId, accountId, ingested: out.ingested.length, duplicates: out.duplicates, rejected: out.rejected, dropped, flagged: out.flagged });
    return out;
  }

  const contentHash = d => sha(canon({ id: d.id, providerId: d.providerId, accountId: d.accountId, to: d.to, text: d.text, inReplyTo: d.inReplyTo, threadId: d.threadId })).slice(0, 32);
  const draftSubject = d => `chat-draft:${d.id}:${d.hash}`;
  /** A draft is text in the outbox. It is NOT sent. */
  function draft(providerId, accountId, { to = null, text, inReplyTo = null } = {}) {
    const x = acct(providerId, accountId); if (x.error) return refuse(x.error, { providerId, accountId }); if (!x.a) return refuse("NOT_CONFIGURED", { providerId, accountId });
    const g = gateOk(false); if (g) return refuse(g, { providerId, accountId });
    if (typeof text !== "string" || !text.trim() || text.length > CHAT_LIMITS.maxText || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return refuse("DRAFT_TEXT_INVALID", { providerId, accountId });
    if (containsSecret(text)) return refuse("DRAFT_CONTAINS_SECRET", { providerId, accountId });
    let thread = null;
    if (inReplyTo !== null) {
      const o = typeof inReplyTo === "string" ? inboundIndex.get(inReplyTo) : null;
      if (!o || o.providerId !== providerId || o.accountId !== accountId) return refuse("IN_REPLY_TO_UNKNOWN", { providerId, accountId });
      if (to !== null && to !== o.from) return refuse("REPLY_RECIPIENT_MISMATCH", { providerId, accountId });
      to = o.from; thread = o.threadId;
    }
    if (typeof to !== "string" || !to.trim() || to.length > CHAT_LIMITS.maxFrom || CTL1.test(to)) return refuse("RECIPIENT_INVALID", { providerId, accountId });
    if (drafts.size >= CHAT_LIMITS.maxDrafts) return refuse("OUTBOX_FULL", { providerId, accountId });
    const d = { id: "d-" + crypto.randomBytes(8).toString("hex"), providerId, accountId, to, text, inReplyTo, threadId: thread, state: "DRAFT", createdAt: now(), evidence: null };
    d.hash = contentHash(d); drafts.set(d.id, d);
    audit.append("CHAT_DRAFT_CREATED", { draftId: d.id, providerId, accountId, hash: d.hash, chars: text.length, reply: inReplyTo !== null });
    return { ok: true, draftId: d.id, state: "DRAFT", subject: draftSubject(d), note: "DRAFT != SENT. Sending needs the owner's approval for this exact draft." };
  }
  function discardDraft(draftId) { const d = drafts.get(draftId); if (!d) return { ok: false, reason: "UNKNOWN_DRAFT" }; if (d.state !== "DRAFT") return { ok: false, reason: "DRAFT_NOT_PENDING", state: d.state }; d.state = "DISCARDED"; audit.append("CHAT_DRAFT_DISCARDED", { draftId }); return { ok: true }; }

  /** Send ONE draft after the owner approved THAT draft. Never throws. */
  async function approveAndSend(draftId, { approval = null } = {}) {
    const d = typeof draftId === "string" ? drafts.get(draftId) : null; if (!d) return refuse("UNKNOWN_DRAFT", { draftId: String(draftId).slice(0, 40) });
    if (d.state !== "DRAFT") return refuse("DRAFT_NOT_PENDING", { draftId, state: d.state });
    if (contentHash(d) !== d.hash) return refuse("DRAFT_ALTERED", { draftId });
    const a = accounts.get(key(d.providerId, d.accountId)); if (!a || a.state !== "SEND_ENABLED" || !a.sender) return refuse("SEND_NOT_ENABLED", { draftId, providerId: d.providerId, accountId: d.accountId });
    if (a.sendScope === "REPLY_ONLY" && d.inReplyTo === null) return refuse("SCOPE_REPLY_ONLY", { draftId });
    const g = gateOk(true); if (g) return refuse(g, { draftId });
    const r = R(d.providerId); if (used(r.outbound, 3_600_000) >= r.outboundPerHour) return refuse("RATE_LIMITED_OUTBOUND", { draftId, providerId: d.providerId });
    if (!ownerAuth) return refuse("OWNER_AUTH_NOT_CONFIGURED", { draftId });
    let v; try { v = ownerAuth.verifyApproval(approval, { action: "CHAT_SEND", subject: draftSubject(d) }); } catch { v = { allowed: false, reason: "OWNER_APPROVAL_INVALID" }; }
    if (!v || v.allowed !== true) return refuse("OWNER_APPROVAL_REQUIRED", { draftId, detail: v?.reason ?? null, subject: draftSubject(d) });
    d.state = "SENDING"; r.outbound.push(clock());
    audit.append("CHAT_SEND_ATTEMPT", { draftId, providerId: d.providerId, accountId: d.accountId, hash: d.hash, approvalNonce: v.nonce ?? null });
    const orig = d.inReplyTo ? inboundIndex.get(d.inReplyTo) : null;
    let res; try { res = await withTimeout(Promise.resolve().then(() => a.sender.send({ accountId: d.accountId, to: d.to, text: d.text, threadId: d.threadId, replyToExternalId: orig?.externalId ?? null })), adapterTimeoutMs); }
    catch (e) { d.state = "SEND_FAILED"; const detail = scrub(String(e?.message ?? e)).replace(CTL, "").slice(0, 120); audit.append("CHAT_SEND_FAILED", { draftId, detail }); return { ok: false, reason: e?.code === "ADAPTER_TIMEOUT" ? "ADAPTER_TIMEOUT" : "SEND_FAILED", state: d.state, detail }; }
    const pmid = res && typeof res === "object" && typeof res.providerMessageId === "string" && EXT_RE.test(res.providerMessageId) ? res.providerMessageId : null;
    if (!pmid) { d.state = "SEND_UNCONFIRMED"; audit.append("CHAT_SEND_UNCONFIRMED", { draftId }); return { ok: false, reason: "NO_PROVIDER_ACCEPTANCE_EVIDENCE", state: d.state, note: "QUEUED/UNCONFIRMED is not SENT." }; }
    d.state = "SENT"; d.evidence = { providerMessageId: pmid, at: now(), adapter: a.sender.id };
    audit.append("CHAT_SENT", { draftId, providerId: d.providerId, accountId: d.accountId, providerMessageId: pmid });
    return { ok: true, state: "SENT", providerMessageId: pmid };
  }

  function catalogue() {
    return CHAT_PROVIDER_CATALOGUE.map(p => {
      const accts = [...accounts.values()].filter(a => a.providerId === p.id).map(view);
      return { ...p, state: !p.available ? "UNAVAILABLE" : accts.length ? null : "UNCONFIGURED", accounts: accts, rate: p.available ? (({ inboundPerMin, outboundPerHour }) => ({ inboundPerMin, outboundPerHour }))(R(p.id)) : null, evidence: CATALOGUE_EVIDENCE };
    });
  }
  const outbox = ({ state = null } = {}) => [...drafts.values()].filter(d => !state || d.state === state).map(d => ({ ...d, subject: draftSubject(d) }));
  const summary = () => ({ implementation: "IMPLEMENTED", connected: [...accounts.values()].filter(a => a.inbound).length, live: 0, providers: CHAT_PROVIDER_CATALOGUE.length, available: CHAT_PROVIDER_CATALOGUE.filter(p => p.available).length,
    unavailable: CHAT_PROVIDER_CATALOGUE.filter(p => !p.available).map(p => ({ id: p.id, reason: p.unavailableReason })), accounts: Object.fromEntries(CHAT_STATES.slice(2).map(s => [s, [...accounts.values()].filter(a => a.state === s).length])),
    outbox: Object.fromEntries(DRAFT_STATES.map(s => [s, outbox({ state: s }).length])), evidence: CATALOGUE_EVIDENCE, note: "No adapter ships with ATLASZ; 'connected' counts injected adapters only. Nothing here is LIVE." });
  return { catalogue, configure, startListening, enableSend, disableSend, stopListening, unconfigure, setRateLimit, poll, draft, discardDraft, approveAndSend, outbox,
    account: (p, a) => view(accounts.get(key(p, a))), summary, audit: () => audit.entries(), auditVerify: () => audit.verifyFile() };
}
