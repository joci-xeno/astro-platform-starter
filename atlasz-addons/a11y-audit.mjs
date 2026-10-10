// Static accessibility audit for the Control Center (85-capability audit A13 Visual Accessibility and Guidance: the UI-checklist part).
// Pure and deterministic: it reads the SOURCE TEXT of the page (html, css, js) it is given; it opens no browser, runs no script and fetches nothing.
// What it can honestly say: WCAG 2.x contrast ratios of the colour pairs the stylesheet actually declares (light and dark theme), a few structural HTML checks,
// and advisory notes about script-built form controls. What it cannot: screen-reader behaviour, keyboard flow in a live page, or real-user accessibility.
// The verdict therefore never says "accessible": FAIL_FOUND / WARNINGS_ONLY / NO_FAILS_BY_THESE_CHECKS.
export const LIMITS = Object.freeze({ maxInputChars: 2_000_000, minNormal: 4.5, minLarge: 3, maxFindings: 300, maxTags: 200000 });

/** Parse #rgb / #rrggbb (also #rgba / #rrggbbaa: alpha is rejected as unresolved). Returns [r,g,b] or null. */
export function parseHex(s) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim()); if (!m) return null; let h = m[1]; if (h.length === 3) h = [...h].map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const lin = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** Unrounded WCAG contrast ratio of two hex colours (thresholds are compared on this value: 4.499 is not 4.5); null when either is not a plain hex colour. */
export function contrastRatio(fg, bg) {
  const a = parseHex(fg), b = parseHex(bg); if (!a || !b) return null; const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** The same ratio rounded to two decimals, for display. */
export const contrast = (fg, bg) => { const r = contrastRatio(fg, bg); return r === null ? null : Math.round(r * 100) / 100; };

const NEUTRAL_AT = /^@(?:font-face|page|property|counter-style|keyframes|-webkit-keyframes|namespace|import|charset|view-transition)\b/i, GROUPING_AT = /^@(?:media|supports|layer|container|scope|document)\b/i;
const DARK_ONLY = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*$/i, LAYER = /^@layer\b/i, ROOTS = /^(?:html|:root|html:root|:root:root)$/i;
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", tab: "\t", newline: "\n" };
/** Character references in attribute values and text (numeric and the common named ones): aria-hidden="&#116;rue" is "true" to a browser. */
const decodeEnt = t => typeof t === "string" && t.includes("&") ? t.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([A-Za-z][A-Za-z0-9]{1,8}));?/g, (m, h, d, n) => { if (h || d) { try { return String.fromCodePoint(h ? parseInt(h, 16) : Number(d)); } catch { return m; } } return ENT[n] ?? m; }) : t;
/** Split declarations on ";" outside quotes and parentheses (content:"a;b" and url(data:...;base64,..) are one declaration). */
function splitDecls(body) { const out = []; let q = null, par = 0, st = 0; for (let i = 0; i < body.length; i++) { const c = body[i]; if (c === "\\") { i++; continue; } if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === "(") par++; else if (c === ")") par = Math.max(0, par - 1); else if (c === ";" && !par) { out.push(body.slice(st, i)); st = i + 1; } } out.push(body.slice(st)); return out; }
const AFFECT = new Set(["opacity", "filter", "backdrop-filter", "-webkit-text-fill-color", "background-image", "mix-blend-mode", "-webkit-background-clip", "background-clip"]);      // change the colour a user sees without being a colour: a rule that also declares colours is not evaluated
const tabIdx = v => { const m = /^[\s]*([+-]?\d+)/.exec(v ?? ""); return m ? Number(m[1]) : NaN; };      // browsers read the leading integer ("1abc" is 1)
/** Brace-aware CSS reader (linear). Returns the rules AND an account of what it could not understand: unsupported at-rules and nested rules make the audit incomplete instead of being skipped silently.
 *  Each rule carries its context: dark (prefers-color-scheme: dark or [data-theme=dark]) and cond (the text of any other @media/@supports/@container condition it sits in: those rules are evaluated as separate variants, never merged into the base). */
function blocks(css) {
  const out = []; out.unsupported = [];
  { let r = "", i = 0, n = css.length, last = 0; while (i < n) { const c = css[i];                                   // string-aware comment stripper (linear): "/*" inside a quoted string is not a comment
      if (c === '"' || c === "'") { let j = i + 1; while (j < n && css[j] !== c) { if (css[j] === "\\") j++; j++; } i = Math.min(n, j + 1); continue; }
      if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4))) { let j = i + 4; while (j < n && /\s/.test(css[j])) j++; if (css[j] !== '"' && css[j] !== "'") { while (j < n && css[j] !== ")") { if (css[j] === "\\") j++; j++; } i = Math.min(n, j + 1); continue; } }      // an unquoted url( ... ) token: "/*" inside it is not a comment
      if (c === "/" && css[i + 1] === "*") { r += css.slice(last, i); const z = css.indexOf("*/", i + 2); if (z < 0) { last = n; i = n; break; } i = z + 2; last = i; continue; }
      i++; }
    r += css.slice(last); css = r; }   // strip comments in linear time
  if (/@[A-Za-z0-9_-]*\\|@import\b/i.test(css)) out.unsupported.push("EXTERNAL_STYLESHEET_NOT_EVALUATED:@import");   // any @import (or a CSS-escaped @\69mport) anywhere, with or without a following rule, in a string or not: the imported sheet is never read
  const close = (t, from) => { let d = 1, j = from; while (j < t.length) { const c = t[j]; if (c === "\\") { j += 2; continue; } if (c === '"' || c === "'") { let e = j + 1; while (e < t.length && t[e] !== c) { if (t[e] === "\\") e++; e++; } j = e + 1; continue; } if (c === "{") d++; else if (c === "}") { d--; if (!d) return j; } j++; } return -1; };
  const THEME = /\[data-theme\s*=\s*["']?(dark|light)["']?\]/ig, NOT_THEME = /:not\(\s*\[data-theme\s*=\s*["']?(?:dark|light)["']?\]\s*\)/ig;
  const decl = body => { const decls = new Map(), imp = new Set(); for (const d of splitDecls(body)) { const k = d.indexOf(":"); if (k > 0) { const name = d.slice(0, k).trim().toLowerCase(), val = d.slice(k + 1).trim(); if (name.includes("\\") && !out.unsupported.includes("ESCAPED_PROPERTY_NAME_NOT_EVALUATED")) out.unsupported.push("ESCAPED_PROPERTY_NAME_NOT_EVALUATED");
      const key = name === "background" || name === "background-color" ? "__bg" : name, isImp = /!\s*important\s*$/i.test(val); if (imp.has(key) && !isImp) continue; if (isImp) imp.add(key);      // an earlier !important declaration beats a later normal one
      decls.set(name, val); if (key === "__bg") decls.set("__bg", val); } }
    if ([...decls.keys()].some(k => AFFECT.has(k)) && (decls.has("color") || decls.has("__bg")) && !out.unsupported.includes("COLOUR_AFFECTING_PROPERTY_NOT_EVALUATED")) out.unsupported.push("COLOUR_AFFECTING_PROPERTY_NOT_EVALUATED");
    return decls; };   // __bg: whichever of the two was declared LAST wins, as in a browser
  const walk = (t, ctx, depth) => {
    let i = 0, semi = -2, open = -2;                                                               // the next ";" and "{" are searched again only after they have been passed (linear overall)
    while (i < t.length) {
      if (semi !== -1 && semi < i) semi = t.indexOf(";", i);
      if (open !== -1 && open < i) open = t.indexOf("{", i);
      if (open < 0) break;
      if (semi >= 0 && semi < open) { i = semi + 1; continue; }                                    // statement at-rule such as @import / @charset
      const prelude = t.slice(i, open).trim(), end = close(t, open + 1); if (end < 0) { out.unsupported.push("UNBALANCED_BRACES"); break; }
      const body = t.slice(open + 1, end);
      if (prelude.startsWith("@")) {
        if (/^@(?:-webkit-)?keyframes\b/i.test(prelude)) { if (/(?:^|[;{\s])(?:color|background(?:-color)?)\s*:/i.test(body)) out.unsupported.push("KEYFRAME_COLOURS_NOT_EVALUATED"); }
        else if (NEUTRAL_AT.test(prelude)) { /* no text-colour rules of interest */ }
        else if (GROUPING_AT.test(prelude) && depth < 8) walk(body, DARK_ONLY.test(prelude) ? { ...ctx, dark: true } : LAYER.test(prelude) ? (out.unsupported.includes("CASCADE_LAYERS_NOT_EVALUATED") || out.unsupported.push("CASCADE_LAYERS_NOT_EVALUATED"), ctx) : { ...ctx, cond: (ctx.cond ? ctx.cond + " > " : "") + prelude.replace(/\s+/g, " ").slice(0, 80) }, depth + 1);
        else out.unsupported.push("UNSUPPORTED_AT_RULE:" + prelude.slice(0, 30));
      } else {
        const nested = body.includes("{"); if (nested) out.unsupported.push("NESTED_CSS_RULES:" + prelude.slice(0, 30));
        const own = nested ? splitDecls(body.slice(0, body.indexOf("{"))).slice(0, -1).join(";") : body;      // declarations before the first nested rule
        const decls = decl(own);
        for (const sel0 of prelude.split(",")) {
          const sel = sel0.trim(); if (!sel) continue; let isDark = ctx.dark; const th = [...sel.matchAll(THEME)].map(m => m[1].toLowerCase()); if (th.includes("dark")) isDark = true;
          let clean = sel.replace(NOT_THEME, "").replace(THEME, "").trim() || ":root"; if (ROOTS.test(clean)) clean = ":root";      // html[data-theme=dark] and :root:not([data-theme=light]) are the root, in the dark context
          if (clean !== ":root" && clean !== "body" && [...decls.keys()].some(k => k.startsWith("--"))) out.unsupported.push("LOCAL_CUSTOM_PROPERTY_NOT_EVALUATED:" + clean.slice(0, 30));
          out.push({ sel: clean, decls, dark: isDark, cond: ctx.cond });
        }
      }
      i = end + 1;
    }
  };
  walk(css, { dark: false, cond: null }, 0); return out;
}
const inVariant = (b, cond) => b.cond === null || b.cond === cond;                          // a conditional rule takes part only in ITS variant, never in the base
const tokensFor = (bl, dark, cond = null) => { const t = {}; for (const pass of dark ? [false, true] : [false]) for (const b of bl) if ((b.sel === ":root" || b.sel === "body") && b.dark === pass && inVariant(b, cond)) for (const [k, v] of b.decls) t[k] = v; return t; };   // light first, dark overrides it
const resolve = (v, tok) => { if (typeof v !== "string") return null; const m = /^var\((--[a-z0-9-]+)\)$/i.exec(v); return m ? (tok[m[1]] ?? v) : v; };   // an unknown token stays as text, so the pair is counted as unresolved instead of silently skipped   // declaration values are already trimmed
const bgOf = d => d.get("__bg") ?? "";

/** Linear tokeniser: [{name, closing, attrs, text, map}] for every tag outside comments and raw-text elements (script/style/textarea/title bodies are not markup; <style> bodies are returned in .styles).
 *  Attributes are parsed as name[=value] tokens, so text inside a quoted value (title="alt=x") is never mistaken for an attribute. */
function tagEnd(h, from) {                                                                         // the ">" that closes a tag: one inside a quoted attribute value does not. A quote only opens a value right after an "=" that follows an attribute NAME ("=" starting a name, or "b=c=\"" inside an unquoted value, is just text)
  let st = 0, q = null, inName = false; let j0 = from; if (h[j0] === "/") j0++; while (j0 < h.length && !/[\s\/>]/.test(h[j0])) j0++;      // the tag NAME runs to whitespace, "/" or ">" (so "<style;=\"x>" is an unknown element, and a quote inside the name opens nothing)
  from = j0;                                                                                       // 0 name/space, 1 after "=" (value expected), 2 unquoted value, 3 quoted value
  for (let j = from; j < h.length && j < from + 20000; j++) { const c = h[j];
    if (st === 3) { if (c === q) { st = 0; inName = false; } continue; }
    if (st === 2) { if (/\s/.test(c)) { st = 0; inName = false; } else if (c === ">") return j; continue; }
    if (c === ">") return j;
    if (st === 1) { if (/\s/.test(c)) continue; if (c === '"' || c === "'") { q = c; st = 3; } else st = 2; continue; }
    if (/\s/.test(c)) continue;                                                                     // whitespace between a name and "=" keeps the name pending: title = ">" is still a quoted value
    if (c === "/") { inName = false; continue; }
    if (c === "=" && inName) { st = 1; continue; }
    inName = true; }
  return h.indexOf(">", from);                                                                     // an unterminated quote: fall back to the plain scan
}
function htmlTags(html) {
  const out = []; out.styles = []; let i = 0, p1 = -2, p2 = -2, foreign = 0;      // foreign: depth inside <svg>/<math>, where <title> and <textarea> are ordinary elements, not raw text
  const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  while (i < html.length && out.length < LIMITS.maxTags) {
    const a = html.indexOf("<", i); if (a < 0) break;
    if (html.startsWith("<!--", a)) { if (p1 !== -1 && p1 < a + 2) p1 = html.indexOf("-->", a + 2); if (p2 !== -1 && p2 < a + 2) p2 = html.indexOf("--!>", a + 2);   /* each terminator is searched again only after it has been passed: linear overall */
      const z1 = p1, z2 = p2, z = z1 < 0 ? z2 : z2 < 0 ? z1 : Math.min(z1, z2); if (z < 0) break; i = z + (z === z2 ? 4 : 3); continue; }       // "<!-->" is a complete (empty) comment, as in browsers
    const head3 = html.slice(a, a + 3), isTag = /^<\/?[A-Za-z]/.test(head3);
    if (!isTag && !/^<[!?]/.test(head3) && !/^<\/[^A-Za-z>]/.test(head3)) { i = a + 1; continue; }              // a stray "<" (as in "1 < 2") is text: it must not swallow the next real tag
    const z = isTag ? tagEnd(html, a + 1) : html.indexOf(">", a + 1); if (z < 0) break; const m = /^<(\/?)([A-Za-z][^\s\/>]*)/.exec(html.slice(a, a + 60)); i = z + 1; if (!m) continue;
    const nextLt = html.indexOf("<", z + 1), name0 = m[2].toLowerCase(), name = name0 === "image" && foreign === 0 ? "img" : name0, attrs = html.slice(a + m[0].length, z), map = new Map();
    for (const am of attrs.matchAll(ATTR)) { const k = am[1].toLowerCase(); if (!map.has(k)) map.set(k, decodeEnt(am[2] ?? am[3] ?? am[4] ?? "")); }
    out.push({ name, closing: m[1] === "/", attrs, map, text: m[1] ? "" : html.slice(z + 1, nextLt < 0 ? Math.min(html.length, z + 301) : Math.min(nextLt, z + 301)) });
    if (foreign > 0 && !m[1] && /^(?:title|textarea|foreignobject|desc|script|style|xmp|iframe|noembed|noframes)$/.test(name)) out.ambiguous = true;      // HTML integration points inside svg/math: browsers switch parsing rules here and this tokenizer does not follow them reliably
    if (name === "svg" || name === "math") { if (m[1]) foreign = Math.max(0, foreign - 1); else { const ams = [...attrs.matchAll(ATTR)], lastM = ams[ams.length - 1], selfClosed = /\/\s*$/.test(attrs) && !(lastM && lastM[4] !== undefined && /\/\s*$/.test(attrs) && lastM[4].endsWith("/")); if (!selfClosed) foreign++; } }
    if (!m[1] && foreign === 0 && name === "template") { (out.notes ??= []).includes("TEMPLATE_CONTENT_NOT_EVALUATED") || out.notes.push("TEMPLATE_CONTENT_NOT_EVALUATED"); const re = /<(\/?)template\b/ig; re.lastIndex = i; let depth = 1, mm; while (depth > 0 && (mm = re.exec(html))) depth += mm[1] ? -1 : 1; i = mm ? mm.index + 1 : html.length; if (mm) i = tagEnd(html, mm.index + 1) + 1 || html.length; }      // inert content: elements inside a <template> are not part of the page
    if (!m[1] && foreign === 0 && name === "noscript") (out.notes ??= []).includes("NOSCRIPT_CONTENT_AMBIGUOUS") || out.notes.push("NOSCRIPT_CONTENT_AMBIGUOUS");
    if (!m[1] && name === "plaintext") { out.ambiguous = true; i = html.length; }
    if (!m[1] && /^(?:script|style|textarea|title|xmp|iframe|noembed|noframes)$/.test(name) && foreign === 0) {       // raw text: skip to the matching close tag
      const re = new RegExp("</" + name + "\\b", "ig"); re.lastIndex = i; const e = re.exec(html);
      if (name === "style") { const sm = out[out.length - 1].map, med = (sm.get("media") ?? "").trim().toLowerCase(), ty = (sm.get("type") ?? "").trim().toLowerCase();
        if (sm.has("disabled") || (med && med !== "all" && med !== "screen") || (ty && ty !== "text/css")) ((out.notes ??= []).includes("CONDITIONAL_STYLE_NOT_EVALUATED") || out.notes.push("CONDITIONAL_STYLE_NOT_EVALUATED"));      // media=print, disabled or a non-CSS type: not part of the screen cascade, and not merged into it
        else out.styles.push(html.slice(i, e ? e.index : html.length).slice(0, LIMITS.maxInputChars)); }
      if (name === "title") { out[out.length - 1].text = html.slice(i, e ? e.index : html.length).slice(0, 300); }
      i = e ? e.index : html.length;
    }
  }
  if (i < html.length && out.length >= LIMITS.maxTags) out.truncated = true;
  return out;
}
/** Linear scan for calls like h("input", { ...}: returns [{args, end}] where args is the text up to the first "}" after the opening brace. */
function callArgs(js, re) {
  const out = []; let m; re.lastIndex = 0;
  while (out.length < LIMITS.maxTags && (m = re.exec(js))) { const end = js.indexOf("}", re.lastIndex); if (end < 0) break; out.push({ args: js.slice(re.lastIndex, end), end }); re.lastIndex = end + 1; }
  return out;
}

export const REMEDIATION = Object.freeze({
  CONTRAST: "Darken the text colour or lighten the background until the ratio reaches 4.5:1 (3:1 for large text); re-check both themes.",
  HTML_LANG: "Add a valid lang attribute to <html>, for example lang=\"hu\" or lang=\"en\".", TITLE: "Add a short, descriptive, non-empty <title>.",
  VIEWPORT: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.", LANDMARK_MAIN: "Wrap the primary content in a single <main> element.",
  NAV_LABEL: "Give each <nav> an aria-label that says what it navigates.", IMG_ALT: "Give every <img> an alt attribute (alt=\"\" for purely decorative images).",
  TABINDEX_POSITIVE: "Remove positive tabindex values; fix the DOM order instead.", FOCUS_REMOVED: "Do not remove the focus outline without a visible replacement (outline or box-shadow on :focus-visible).",
  PLACEHOLDER_ONLY_LABEL: "Add a <label> or aria-label; a placeholder is not an accessible name.", NO_LABEL_ELEMENTS: "Build <label> elements (or aria-label) for form controls.",
  BUTTON_NAME: "Give every button visible text or an aria-label.", INPUT_LABEL: "Associate a <label for=id> (or wrap the control in <label>) or add aria-label / aria-labelledby.", DUPLICATE_ID: "Make every id unique.", ARIA_HIDDEN_FOCUSABLE: "Remove aria-hidden from focusable elements, or make them non-focusable (disabled / tabindex=-1 / inert).", ZOOM_BLOCKED: "Do not disable zooming (user-scalable=no / maximum-scale < 2)."
});
export function auditAccessibility({ html = "", css = "", js = "", cssSources = [] } = {}) {
  const covered = new Set((Array.isArray(cssSources) ? cssSources : []).filter(x => typeof x === "string").slice(0, 10));   // hrefs of the <link> stylesheets whose text the caller supplied as `css`
  for (const x of [html, css, js]) if (typeof x !== "string" || x.length > LIMITS.maxInputChars) return { ok: false, reason: "INPUT_INVALID_OR_TOO_LARGE" };
  const findings = []; let truncated = false; const total = { FAIL: 0, WARN: 0, INFO: 0 }; const add = (severity, rule, message, detail = {}) => { total[severity]++; if (findings.length >= LIMITS.maxFindings) { truncated = true; return; } findings.push({ severity, rule, message, ...detail }); };
  // ---- contrast of declared pairs, per theme AND per condition variant (a conditional rule is evaluated in its own variant; it never hides a failure of the base)
  const tg = htmlTags(html), bl = blocks(css + "\n" + tg.styles.join("\n")), pairs = [], skipped = [];
  const conds = [...new Set(bl.map(b => b.cond).filter(c => c !== null))]; if (conds.length > 20) bl.unsupported.push("TOO_MANY_CONDITIONS:" + conds.length);
  for (const cond of [null, ...conds.slice(0, 20)]) for (const dark of [false, true]) {
    if (dark && !bl.some(b => b.dark && inVariant(b, cond))) continue; const tok = tokensFor(bl, dark, cond), theme = dark ? "dark" : "light", page = tok["--bg"] ?? null, panel = tok["--panel"] ?? null, ink = tok["--ink"] ?? null;
    const eff = new Map(); for (const pass of dark ? [false, true] : [false]) for (const b of bl) if (b.dark === pass && inVariant(b, cond)) { const m = eff.get(b.sel) ?? new Map(); for (const [k, v] of b.decls) m.set(k, v); eff.set(b.sel, m); }   // same-selector cascade: the dark block overrides the base
    for (const [sel, decls] of eff) {
      const b = { sel, decls }; const fg = resolve(b.decls.get("color"), tok), bgRaw = resolve(bgOf(b.decls), tok), bg = typeof bgRaw === "string" && /^(none|transparent|inherit|initial|unset)$/i.test(bgRaw.trim()) ? null : bgRaw;   // "no own background": the text sits on the page or panel colour
      const px = Number(/^(\d+(?:\.\d+)?)px$/.exec(b.decls.get("font-size") ?? "")?.[1] ?? 0), w = b.decls.get("font-weight") ?? "", bold = w === "bold" || Number(w) >= 700, large = px >= 24 || (px >= 18.66 && bold);   // WCAG large text
      if (fg && bg) pairs.push({ theme, cond, sel: b.sel, fg, bg, large });
      else if (fg) { let any = false; for (const base of [page, panel]) if (base) { any = true; pairs.push({ theme, cond, sel: b.sel, fg, bg: base, large, assumedBackground: true }); } if (!any) skipped.push(theme + (cond ? " (under " + cond + ")" : "") + ": " + b.sel + " (colour without a known page background)"); }                     // text colour only: it sits on the page or a panel
      else if (bg && ink && parseHex(bg)) pairs.push({ theme, cond, sel: b.sel, fg: ink, bg, large, assumedForeground: true });
      else if (bg && !fg && !/::backdrop\s*$/.test(b.sel) && !/^(none|transparent)$/i.test(String(bg)) && !/gradient|url\(/i.test(String(bg))) skipped.push(theme + (cond ? " (under " + cond + ")" : "") + ": " + b.sel + " (background without a known text colour)");                                              // background only: text inherits the ink colour
    }
  }
  // inline style="" attributes: evaluated when they declare both colours, otherwise reported as not evaluated
  for (const t of tg) { const st = t.closing ? undefined : t.map.get("style"); if (st !== undefined && st.includes("\\")) { skipped.push("inline style on <" + t.name + "> (escaped CSS not evaluated)"); continue; } if (st === undefined || !/(?:^|[;\s])(?:color|background(?:-color)?)\s*:/i.test(st)) continue; const d = new Map(); for (const x of splitDecls(st)) { const k = x.indexOf(":"); if (k > 0) { const nm = x.slice(0, k).trim().toLowerCase(), v = x.slice(k + 1).trim(); d.set(nm, v); if (nm === "background" || nm === "background-color") d.set("__bg", v); } }
    const fg = d.get("color"), bg = d.get("__bg"); if ([...d.keys()].some(k => AFFECT.has(k))) skipped.push("inline style on <" + t.name + "> (opacity/filter/background-image not evaluated)"); else if (fg && bg && parseHex(fg) && parseHex(bg)) pairs.push({ theme: "light", sel: "inline style on <" + t.name + ">", fg, bg, large: false }); else skipped.push("inline style on <" + t.name + "> (colours not fully declared)"); }
  const seen = new Set(); let checked = 0, unresolved = 0; const unresolvedList = [];
  for (const p of pairs) {
    const key = [p.theme, p.sel, p.fg, p.bg, p.large].join("|"); if (seen.has(key)) continue; seen.add(key); const raw = contrastRatio(p.fg, p.bg);
    if (raw === null) { unresolved++; if (unresolvedList.length < 20) unresolvedList.push({ theme: p.theme, selector: p.sel, fg: String(p.fg).slice(0, 60), bg: String(p.bg).slice(0, 60) }); continue; } checked++; const need = p.large ? LIMITS.minLarge : LIMITS.minNormal, r = Math.round(raw * 100) / 100;
    if (raw < need) add("FAIL", "CONTRAST", `${p.theme} theme${p.cond ? " (under " + p.cond + ")" : ""}: ${p.sel} has contrast ${r}:1 (${p.fg} on ${p.bg}), needs ${need}:1`, { theme: p.theme, ...(p.cond ? { condition: p.cond } : {}), selector: p.sel, ratio: r, required: need });
  }
  // ---- structure of the html shell (tags are tokenised in one linear pass; comments are skipped)
  const by = n => tg.filter(t => t.name === n && !t.closing), attr = (t, n) => t.map.get(n);
  const htmlOk = html.trim() !== "";   // an empty page is "nothing supplied" (reported as INCOMPLETE), not a list of invented failures
  if (htmlOk) {
  const root = by("html")[0], lang = root ? attr(root, "lang") : undefined; if (!lang || !/^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang)) add("FAIL", "HTML_LANG", "The <html> element has no valid lang attribute.");
  if (!by("title").some(t => decodeEnt(t.text).replace(/[\s\u00a0]+/g, ""))) add("FAIL", "TITLE", "The page has no non-empty <title>.");
  const vps = by("meta").filter(t => attr(t, "name")?.trim().toLowerCase() === "viewport"); if (!vps.length) add("WARN", "VIEWPORT", "No viewport meta tag."); else if (vps.some(vp => { const content = attr(vp, "content") ?? "", ms = /maximum-scale\s*=\s*([0-9.]+)/i.exec(content); return /user-scalable\s*=\s*(no|0)/i.test(content) || (ms && Number(ms[1]) < 2); })) add("FAIL", "ZOOM_BLOCKED", "The viewport meta tag stops users from zooming to 200%.");      // every viewport meta is read: a later one can override the first
  if (!by("main").length) add("FAIL", "LANDMARK_MAIN", "No <main> landmark."); if (by("nav").some(t => !attr(t, "aria-label")?.trim() && !attr(t, "aria-labelledby")?.trim())) add("WARN", "NAV_LABEL", "A <nav> has no aria-label.");
  for (const t of by("img")) if (attr(t, "alt") === undefined) add("FAIL", "IMG_ALT", "An <img> has no alt attribute.");
  { // form controls, buttons, ids, hidden-but-focusable (markup only; a control inside a <label> counts as labelled)
    const labelFor = new Set(by("label").map(t => attr(t, "for")).filter(x => x !== undefined)); let labelEnd = -1, unlabeled = 0, emptyButtons = 0; const ids = new Map(), dup = new Set();
    const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]), hid = [];
    for (let k = 0; k < tg.length; k++) { const t = tg[k];
      const hiddenSelf = !t.closing && String(attr(t, "aria-hidden") ?? "").trim().toLowerCase() === "true";
      if (hid.length && !hiddenSelf && t.name === hid.at(-1).name && !VOID.has(t.name)) { if (t.closing) { if (hid.at(-1).d === 0) hid.pop(); else hid.at(-1).d--; } else hid.at(-1).d++; }
      { const id0 = t.closing ? undefined : attr(t, "id"); if (id0 !== undefined && id0 !== "") { if (ids.has(id0)) dup.add(id0); ids.set(id0, 1); } }
      if (t.name === "label") { if (!t.closing) { labelEnd = -1; for (let j2 = k + 1; j2 < tg.length && j2 < k + 200; j2++) if (tg[j2].name === "label") { if (tg[j2].closing) labelEnd = j2; break; } } continue; }      // a <label> only wraps what is before ITS </label>: an unclosed one labels nothing
      if (t.closing) continue; const id = attr(t, "id");
      if (["input", "textarea", "select"].includes(t.name)) { const type = (attr(t, "type") ?? "text").toLowerCase(); if (type === "image") { if (!attr(t, "alt")?.trim() && !attr(t, "aria-label")?.trim() && !attr(t, "aria-labelledby")?.trim() && !attr(t, "title")?.trim()) unlabeled++; continue; } if (["hidden", "submit", "button", "reset"].includes(type)) continue;
        if (!(k < labelEnd) && !attr(t, "aria-label")?.trim() && !attr(t, "aria-labelledby")?.trim() && !(id && labelFor.has(id))) unlabeled++; }
      if (t.name === "button" && !attr(t, "aria-label")?.trim() && !attr(t, "aria-labelledby")?.trim() && !attr(t, "title")?.trim()) { let nextClose = -1; for (let j2 = k + 1; j2 < tg.length && j2 < k + 60; j2++) if (tg[j2].name === "button" && tg[j2].closing) { nextClose = j2; break; } const inner = tg.slice(k + 1, nextClose < 0 ? k + 1 : nextClose); if (!t.text.trim() && !inner.some(x => (x.name === "img" && attr(x, "alt")?.trim()) || attr(x, "aria-label")?.trim())) emptyButtons++; }
      if (hiddenSelf && !VOID.has(t.name)) hid.push({ name: t.name, d: 0 });
      if ((hiddenSelf || hid.length) && (["a", "button", "input", "select", "textarea", "summary", "iframe", "audio", "video"].includes(t.name) || (attr(t, "tabindex") !== undefined && tabIdx(attr(t, "tabindex")) >= 0) || (attr(t, "contenteditable") !== undefined && attr(t, "contenteditable").trim().toLowerCase() !== "false"))) add("FAIL", "ARIA_HIDDEN_FOCUSABLE", "A focusable <" + t.name + "> is hidden from assistive technology with aria-hidden=\"true\".");
    }
    if (unlabeled) add("FAIL", "INPUT_LABEL", unlabeled + " form control(s) in the markup have no label, aria-label or aria-labelledby.", { count: unlabeled });
    if (emptyButtons) add("FAIL", "BUTTON_NAME", emptyButtons + " <button> element(s) in the markup have no accessible name.", { count: emptyButtons });
    if (dup.size) add("FAIL", "DUPLICATE_ID", "Duplicate id value(s): " + [...dup].slice(0, 5).join(", ") + ".", { count: dup.size });
  }
  for (const t of tg) { const ti = attr(t, "tabindex"); if (ti !== undefined && tabIdx(ti) > 0) add("WARN", "TABINDEX_POSITIVE", "A positive tabindex changes the natural focus order."); }
  }
  // ---- focus visibility: outline removed on interactive selectors without a replacement
  for (const b of bl) { const strip = v => String(v ?? "").toLowerCase().replace(/!\s*important\s*$/, "").trim(), o = strip(b.decls.get("outline")), os = strip(b.decls.get("outline-style")), ow = strip(b.decls.get("outline-width")), oc = strip(b.decls.get("outline-color")), sh = strip(b.decls.get("box-shadow"));
    const removed = /^(?:none|0|0(?:px|em|rem)?|transparent|hidden)(?:\s|$)/.test(o) || /^(?:none|hidden)$/.test(os) || /^0(?:px|em|rem)?$/.test(ow) || oc === "transparent", replaced = sh !== "" && sh !== "none" && !/^0(?:px)?$/.test(sh);
    if (removed && (/\b(button|a|input|textarea|select|summary)\b|\[tabindex\]|\*/.test(b.sel) || /:focus/.test(b.sel)) && !replaced && !/:not\(\s*:focus-visible\s*\)/.test(b.sel)) add("FAIL", "FOCUS_REMOVED", `${b.sel} removes the focus outline without a replacement.`, { selector: b.sel }); }
  // ---- script-built controls (advisory): placeholder-only inputs and unlabeled controls
  const inputs = callArgs(js, /h\(\s*["'`](?:input|textarea|select)["'`]\s*,\s*\{/g); let placeholderOnly = 0, labelled = 0;
  const namesFromPlaceholder = /setAttribute\(\s*["']aria-label["']\s*,\s*String\(\s*attrs\.placeholder\s*\)/.test(js);                        // the element helper copies the placeholder into aria-label
  for (const m of inputs) { if (/aria-label|\bid\s*:/.test(m.args)) labelled++; else if (/placeholder/.test(m.args)) { if (namesFromPlaceholder) labelled++; else placeholderOnly++; } }
  if (placeholderOnly) add("WARN", "PLACEHOLDER_ONLY_LABEL", `${placeholderOnly} script-built form control(s) rely on a placeholder as their only label (it disappears on input and is not a reliable accessible name).`, { count: placeholderOnly });
  if (!/h\(\s*["'`]label["'`]/.test(js) && inputs.length && !namesFromPlaceholder) add("WARN", "NO_LABEL_ELEMENTS", "The script never builds <label> elements for its form controls.");
  for (const m of callArgs(js, /h\(\s*["'`]button["'`]\s*,\s*\{/g)) if (/^\s*,\s*(?:""|''|``)\s*\)/.test(js.slice(m.end + 1, m.end + 40))) add("FAIL", "BUTTON_NAME", "A script-built button has an empty name.");
  const sev = total;   // true totals, not only the findings that fit in the list
  const incomplete = []; if (truncated) incomplete.push("FINDINGS_TRUNCATED"); if (unresolved) incomplete.push("CONTRAST_PAIRS_UNRESOLVED:" + unresolved); if (!checked) incomplete.push("NO_CONTRAST_PAIRS_CHECKED"); for (const u of bl.unsupported.slice(0, 10)) incomplete.push(u); if (tg.some(t => t.name === "link" && !t.closing && (/(^|\s)stylesheet(\s|$)/i.test(attr(t, "rel") ?? "") || /&/.test(attr(t, "rel") ?? "")) && !covered.has(attr(t, "href") ?? ""))) incomplete.push("EXTERNAL_STYLESHEET_NOT_EVALUATED:<link>"); if (tg.ambiguous) incomplete.push("HTML_PARSING_AMBIGUOUS:svg_math_integration_point_or_plaintext"); for (const n of tg.notes ?? []) incomplete.push(n); if (tg.truncated) incomplete.push("TAG_LIMIT_REACHED:markup_after_the_limit_not_read"); if (skipped.length) incomplete.push("COLOUR_RULES_NOT_EVALUATED:" + skipped.length); if (!html.trim()) incomplete.push("NO_HTML_SUPPLIED"); if (!css.trim()) incomplete.push("NO_CSS_SUPPLIED");
  const enriched = findings.map(f => ({ ...f, location: f.selector ? "css: " + f.selector : "rule " + f.rule, remediation: REMEDIATION[f.rule] ?? "Review this item manually." }));
  // A clean-looking result is only ever reported for a COMPLETE audit; otherwise it is INCOMPLETE_AUDIT (failures that were found are still reported as FAIL_FOUND).
  return { ok: true, verdict: sev.FAIL ? "FAIL_FOUND" : incomplete.length ? "INCOMPLETE_AUDIT" : sev.WARN ? "WARNINGS_ONLY" : "NO_FAILS_BY_THESE_CHECKS", complete: incomplete.length === 0, incomplete, counts: sev, findings: enriched, truncated, contrast: { pairsChecked: checked, unresolved, unresolvedPairs: unresolvedList, notEvaluated: skipped.slice(0, 20) },
    notes: ["Static source checks only: no browser, no screen reader, no keyboard walk-through. 'NO_FAILS_BY_THESE_CHECKS' is not a statement that the interface is accessible."] };
}
