// Pure request-building logic shared by the service worker (background.js) and the Node tests. No browser API, no network here.
// The ONLY destination is the owner's local ATLASZ Control Center on 127.0.0.1. The token travels in a header, never in the URL or body.
export const API_PATH = "/api/extension/assist";
export const KINDS = Object.freeze(["EXPLAIN", "TRANSLATE", "ANALYSE", "SUMMARIZE_PAGE"]);
export const LANGS = Object.freeze(["HU", "EN"]);
export const MAX_SELECTION_CHARS = 8000;
export const MAX_PAGE_CHARS = 20000;
export const UNTRUSTED_LABEL = "AI-generated, untrusted - check before you rely on it or copy it anywhere.";
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Port typed by the owner. Only unprivileged ports; anything else is refused. */
export function parsePort(v) {
  const s = String(v ?? "").trim();
  if (!/^\d{4,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1024 && n <= 65535 ? n : null;
}
/** Dashboard token pasted once by the owner (hex from the Control Center URL fragment). */
export function parseToken(v) {
  const s = String(v ?? "").trim().replace(/^.*#/, "");      // pasting the whole "http://127.0.0.1:port/#token" URL also works
  return TOKEN_RE.test(s) ? s : null;
}
/** The one URL this extension ever calls. Host is fixed; only the port varies. */
export function endpointFor(port) {
  const p = parsePort(port);
  if (p === null) throw new Error("PORT_INVALID");
  return "http://127.0.0.1:" + p + API_PATH;
}
/** Only an http(s) page origin is reported (never the full URL with path/query, which can carry personal data). */
export function pageOriginOf(url) {
  try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
}
/**
 * Build the JSON body for one request from what the content script captured.
 * capture: {selection, pageText, title, reason?}; returns {ok:true, body} or {ok:false, reason}.
 */
export function buildBody({ kind, targetLang = "EN", capture = {}, pageUrl = null } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, reason: "KIND_INVALID" };
  if (!LANGS.includes(targetLang)) return { ok: false, reason: "LANG_INVALID" };
  const page = kind === "SUMMARIZE_PAGE";
  const raw = String((page ? capture.pageText : capture.selection) ?? "");
  const text = raw.trim();
  if (!text) return { ok: false, reason: page ? "PAGE_TEXT_EMPTY" : (capture.reason || "SELECTION_EMPTY") };
  const max = page ? MAX_PAGE_CHARS : MAX_SELECTION_CHARS;
  const body = { kind, targetLang, text: text.slice(0, max), truncated: text.length > max, pageTitle: String(capture.title ?? "").slice(0, 200), pageOrigin: pageOriginOf(pageUrl) };
  return { ok: true, body };
}
/** Options for the single HTTP call. No credentials/cookies, no redirects followed, no caching. */
export function fetchOptions(token, body) {
  const t = parseToken(token);
  if (!t) throw new Error("TOKEN_INVALID");
  return { method: "POST", headers: { "Content-Type": "application/json", "X-Atlasz-Token": t }, body: JSON.stringify(body), credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" };
}
/** Normalise whatever the server answered into what the side panel shows. Output is always labelled untrusted. */
export function readReply(status, json) {
  if (status === 401) return { ok: false, reason: "TOKEN_REJECTED" };
  if (status === 403) return { ok: false, reason: String(json?.error ?? "FORBIDDEN") };
  if (!json || typeof json !== "object") return { ok: false, reason: "BAD_REPLY" };
  const r = json.result ?? json;
  if (json.ok === false || r.ok === false) return { ok: false, reason: String(r.reason ?? json.error ?? "FAILED").slice(0, 120) };
  const text = typeof r.text === "string" ? r.text.slice(0, 20000) : "";
  if (!text) return { ok: false, reason: "EMPTY_REPLY" };
  return { ok: true, text, family: typeof r.family === "string" ? r.family.slice(0, 40) : null, label: UNTRUSTED_LABEL };
}
