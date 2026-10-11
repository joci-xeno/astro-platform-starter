// ATLASZ Local Assistant - service worker (Manifest V3, module).
// Data flow: side panel button -> this worker -> content-script.js injected into the ACTIVE tab only (activeTab, after a user gesture)
// -> captured selection/page text -> POST to http://127.0.0.1:<port>/api/extension/assist with the owner's dashboard token -> reply to the side panel.
// The token lives in chrome.storage.session (memory only, cleared when the browser closes, not readable by content scripts). It is never sent to
// a page, never written to persistent extension storage, never logged. Nothing here submits forms, clicks, types, or contacts any other host.
import { buildBody, endpointFor, fetchOptions, readReply, parsePort, parseToken } from "./lib/request.js";

const PANEL_URL = chrome.runtime.getURL("sidepanel.html");
const TIMEOUT_MS = 60000;

chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});      // every worker start: content scripts can never read the token
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const fromOwnPanel = sender => sender && sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === "string" && sender.url.startsWith(PANEL_URL);

async function settings() {
  const s = await chrome.storage.session.get(["atlaszPort", "atlaszToken"]);
  return { port: parsePort(s.atlaszPort), token: parseToken(s.atlaszToken) };
}

async function capture(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ["content-script.js"] });
  return res && res.result && typeof res.result === "object" ? res.result : { selection: "", pageText: "", title: "", reason: "CAPTURE_FAILED" };
}

async function ask({ kind, targetLang }) {
  const { port, token } = await settings();
  if (!port || !token) return { ok: false, reason: "NOT_CONFIGURED" };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== "number" || !/^https?:/.test(String(tab.url || ""))) return { ok: false, reason: "NO_ACCESSIBLE_TAB" };
  let cap;
  try { cap = await capture(tab.id); } catch { return { ok: false, reason: "NO_PAGE_ACCESS_CLICK_THE_TOOLBAR_ICON_FIRST" }; }
  const b = buildBody({ kind, targetLang, capture: cap, pageUrl: tab.url });
  if (!b.ok) return b;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(endpointFor(port), { ...fetchOptions(token, b.body), signal: ctl.signal });
    let json = null; try { json = await r.json(); } catch { json = null; }
    return readReply(r.status, json);
  } catch { return { ok: false, reason: "CONTROL_CENTER_UNREACHABLE" }; }
  finally { clearTimeout(timer); }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!fromOwnPanel(sender) || !msg || typeof msg !== "object") return false;      // only our own side panel may talk to the worker
  if (msg.type === "SAVE_SETTINGS") {
    const port = parsePort(msg.port), token = parseToken(msg.token);
    if (!port || !token) { reply({ ok: false, reason: "PORT_OR_TOKEN_INVALID" }); return false; }
    chrome.storage.session.set({ atlaszPort: port, atlaszToken: token }).then(() => reply({ ok: true }), () => reply({ ok: false, reason: "STORAGE_FAILED" }));
    return true;
  }
  if (msg.type === "FORGET_SETTINGS") { chrome.storage.session.remove(["atlaszPort", "atlaszToken"]).then(() => reply({ ok: true })); return true; }
  if (msg.type === "STATUS") { settings().then(s => reply({ ok: true, configured: Boolean(s.port && s.token), port: s.port })); return true; }
  if (msg.type === "ASK") { ask({ kind: msg.kind, targetLang: msg.targetLang }).then(reply, () => reply({ ok: false, reason: "FAILED" })); return true; }
  return false;
});
