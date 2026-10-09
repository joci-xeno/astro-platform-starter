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
/** Brace-aware CSS reader (linear). Returns the rules AND an account of what it could not understand: unsupported at-rules and nested rules make the audit incomplete instead of being skipped silently.
 *  Each rule carries its context: dark (prefers-color-scheme: dark or [data-theme=dark]) and cond (the text of any other @media/@supports/@container condition it sits in: those rules are evaluated as separate variants, never merged into the base). */
function blocks(css) {
  const out = []; out.unsupported = [];
  { let r = "", i = 0; for (;;) { const a = css.indexOf("/*", i); if (a < 0) { r += css.slice(i); break; } r += css.slice(i, a); const z = css.indexOf("*/", a + 2); if (z < 0) break; i = z + 2; } css = r; }   // strip comments in linear time; an unterminated comment swallows the rest
  const close = (t, from) => { let d = 1, j = from; while (j < t.length) { const c = t[j]; if (c === '"' || c === "'") { const e = t.indexOf(c, j + 1); j = e < 0 ? t.length : e + 1; continue; } if (c === "{") d++; else if (c === "}") { d--; if (!d) return j; } j++; } return -1; };
  const THEME = /\[data-theme\s*=\s*["']?(dark|light)["']?\]/ig, NOT_THEME = /:not\(\s*\[data-theme\s*=\s*["']?(?:dark|light)["']?\]\s*\)/ig;
  const decl = body => { const decls = new Map(); for (const d of body.split(";")) { const k = d.indexOf(":"); if (k > 0) { const name = d.slice(0, k).trim().toLowerCase(), val = d.slice(k + 1).trim(); decls.set(name, val); if (name === "background" || name === "background-color") decls.set("__bg", val); } } return decls; };   // __bg: whichever of the two was declared LAST wins, as in a browser
  const walk = (t, ctx, depth) => {
    let i = 0;
    while (i < t.length) {
      const semi = t.indexOf(";", i), open = t.indexOf("{", i);
      if (open < 0) break;
      if (semi >= 0 && semi < open) { i = semi + 1; continue; }                                    // statement at-rule such as @import / @charset
      const prelude = t.slice(i, open).trim(), end = close(t, open + 1); if (end < 0) { out.unsupported.push("UNBALANCED_BRACES"); break; }
      const body = t.slice(open + 1, end);
      if (prelude.startsWith("@")) {
        if (/^@(?:-webkit-)?keyframes\b/i.test(prelude)) { if (/(?:^|[;{\s])(?:color|background(?:-color)?)\s*:/i.test(body)) out.unsupported.push("KEYFRAME_COLOURS_NOT_EVALUATED"); }
        else if (NEUTRAL_AT.test(prelude)) { /* no text-colour rules of interest */ }
        else if (GROUPING_AT.test(prelude) && depth < 8) walk(body, DARK_ONLY.test(prelude) ? { ...ctx, dark: true } : LAYER.test(prelude) ? ctx : { ...ctx, cond: (ctx.cond ? ctx.cond + " > " : "") + prelude.replace(/\s+/g, " ").slice(0, 80) }, depth + 1);
        else out.unsupported.push("UNSUPPORTED_AT_RULE:" + prelude.slice(0, 30));
      } else {
        const nested = body.includes("{"); if (nested) out.unsupported.push("NESTED_CSS_RULES:" + prelude.slice(0, 30));
        const own = nested ? body.slice(0, body.indexOf("{")).split(";").slice(0, -1).join(";") : body;      // declarations before the first nested rule
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
function htmlTags(html) {
  const out = []; out.styles = []; let i = 0;
  const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  while (i < html.length && out.length < LIMITS.maxTags) {
    const a = html.indexOf("<", i); if (a < 0) break;
    if (html.startsWith("<!--", a)) { const z = html.indexOf("-->", a + 2); if (z < 0) break; i = z + 3; continue; }       // "<!-->" is a complete (empty) comment, as in browsers
    const z = html.indexOf(">", a + 1); if (z < 0) break; const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(a, a + 60)); i = z + 1; if (!m) continue;
    const nextLt = html.indexOf("<", z + 1), name = m[2].toLowerCase(), attrs = html.slice(a + m[0].length, z), map = new Map();
    for (const am of attrs.matchAll(ATTR)) { const k = am[1].toLowerCase(); if (!map.has(k)) map.set(k, am[2] ?? am[3] ?? am[4] ?? ""); }
    out.push({ name, closing: m[1] === "/", attrs, map, text: m[1] ? "" : html.slice(z + 1, nextLt < 0 ? Math.min(html.length, z + 301) : Math.min(nextLt, z + 301)) });
    if (!m[1] && /^(?:script|style|textarea|title)$/.test(name) && !/\/\s*$/.test(attrs)) {       // raw text: skip to the matching close tag
      const re = new RegExp("</" + name + "\\b", "ig"); re.lastIndex = i; const e = re.exec(html);
      if (name === "style") out.styles.push(html.slice(i, e ? e.index : html.length).slice(0, LIMITS.maxInputChars));
      if (name === "title") { out[out.length - 1].text = html.slice(i, e ? e.index : html.length).slice(0, 300); }
      i = e ? e.index : html.length;
    }
  }
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
export function auditAccessibility({ html = "", css = "", js = "" } = {}) {
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
  for (const t of tg) { const st = t.closing ? undefined : t.map.get("style"); if (st === undefined || !/(?:^|[;\s])(?:color|background(?:-color)?)\s*:/i.test(st)) continue; const d = new Map(); for (const x of st.split(";")) { const k = x.indexOf(":"); if (k > 0) { const nm = x.slice(0, k).trim().toLowerCase(), v = x.slice(k + 1).trim(); d.set(nm, v); if (nm === "background" || nm === "background-color") d.set("__bg", v); } }
    const fg = d.get("color"), bg = d.get("__bg"); if (fg && bg && parseHex(fg) && parseHex(bg)) pairs.push({ theme: "light", sel: "inline style on <" + t.name + ">", fg, bg, large: false }); else skipped.push("inline style on <" + t.name + "> (colours not fully declared)"); }
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
  if (!by("title").some(t => t.text.trim())) add("FAIL", "TITLE", "The page has no non-empty <title>.");
  const vp = by("meta").find(t => attr(t, "name")?.toLowerCase() === "viewport"); if (!vp) add("WARN", "VIEWPORT", "No viewport meta tag."); else { const content = attr(vp, "content") ?? "", ms = /maximum-scale\s*=\s*([0-9.]+)/i.exec(content); if (/user-scalable\s*=\s*(no|0)/i.test(content) || (ms && Number(ms[1]) < 2)) add("FAIL", "ZOOM_BLOCKED", "The viewport meta tag stops users from zooming to 200%."); }
  if (!by("main").length) add("FAIL", "LANDMARK_MAIN", "No <main> landmark."); if (by("nav").some(t => attr(t, "aria-label") === undefined && attr(t, "aria-labelledby") === undefined)) add("WARN", "NAV_LABEL", "A <nav> has no aria-label.");
  for (const t of by("img")) if (attr(t, "alt") === undefined) add("FAIL", "IMG_ALT", "An <img> has no alt attribute.");
  { // form controls, buttons, ids, hidden-but-focusable (markup only; a control inside a <label> counts as labelled)
    const labelFor = new Set(by("label").map(t => attr(t, "for")).filter(x => x !== undefined)); let inLabel = 0, unlabeled = 0, emptyButtons = 0; const ids = new Map(), dup = new Set();
    for (let k = 0; k < tg.length; k++) { const t = tg[k];
      if (t.name === "label") { inLabel += t.closing ? -1 : 1; if (inLabel < 0) inLabel = 0; continue; }
      if (t.closing) continue; const id = attr(t, "id"); if (id !== undefined && id !== "") { if (ids.has(id)) dup.add(id); ids.set(id, 1); }
      if (["input", "textarea", "select"].includes(t.name)) { const type = (attr(t, "type") ?? "text").toLowerCase(); if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
        if (!inLabel && !attr(t, "aria-label")?.trim() && attr(t, "aria-labelledby") === undefined && !(id && labelFor.has(id))) unlabeled++; }
      if (t.name === "button" && !attr(t, "aria-label")?.trim() && attr(t, "aria-labelledby") === undefined && !attr(t, "title")?.trim()) { const nextClose = tg.findIndex((x, j) => j > k && x.name === "button" && x.closing), inner = tg.slice(k + 1, nextClose < 0 ? k + 1 : nextClose); if (!t.text.trim() && !inner.some(x => (x.name === "img" && attr(x, "alt")?.trim()) || attr(x, "aria-label")?.trim())) emptyButtons++; }
      if (attr(t, "aria-hidden") === "true" && (["a", "button", "input", "select", "textarea"].includes(t.name) || (attr(t, "tabindex") !== undefined && Number(attr(t, "tabindex")) >= 0))) add("FAIL", "ARIA_HIDDEN_FOCUSABLE", "A focusable <" + t.name + "> is hidden from assistive technology with aria-hidden=\"true\".");
    }
    if (unlabeled) add("FAIL", "INPUT_LABEL", unlabeled + " form control(s) in the markup have no label, aria-label or aria-labelledby.", { count: unlabeled });
    if (emptyButtons) add("FAIL", "BUTTON_NAME", emptyButtons + " <button> element(s) in the markup have no accessible name.", { count: emptyButtons });
    if (dup.size) add("FAIL", "DUPLICATE_ID", "Duplicate id value(s): " + [...dup].slice(0, 5).join(", ") + ".", { count: dup.size });
  }
  for (const t of tg) { const ti = attr(t, "tabindex"); if (ti !== undefined && Number(ti) > 0) add("WARN", "TABINDEX_POSITIVE", "A positive tabindex changes the natural focus order."); }
  }
  // ---- focus visibility: outline removed on interactive selectors without a replacement
  for (const b of bl) { const o = (b.decls.get("outline") ?? "").toLowerCase(), os = (b.decls.get("outline-style") ?? "").toLowerCase(); if ((o === "none" || o === "0" || os === "none") && (/\b(button|a|input|textarea|select|summary)\b|\[tabindex\]/.test(b.sel) || /:focus(?!-visible)/.test(b.sel)) && !b.decls.has("box-shadow") && !/:not\(\s*:focus-visible\s*\)/.test(b.sel)) add("FAIL", "FOCUS_REMOVED", `${b.sel} removes the focus outline without a replacement.`, { selector: b.sel }); }
  // ---- script-built controls (advisory): placeholder-only inputs and unlabeled controls
  const inputs = callArgs(js, /h\(\s*["'`](?:input|textarea|select)["'`]\s*,\s*\{/g); let placeholderOnly = 0, labelled = 0;
  const namesFromPlaceholder = /setAttribute\(\s*["']aria-label["']\s*,\s*String\(\s*attrs\.placeholder\s*\)/.test(js);                        // the element helper copies the placeholder into aria-label
  for (const m of inputs) { if (/aria-label|\bid\s*:/.test(m.args)) labelled++; else if (/placeholder/.test(m.args)) { if (namesFromPlaceholder) labelled++; else placeholderOnly++; } }
  if (placeholderOnly) add("WARN", "PLACEHOLDER_ONLY_LABEL", `${placeholderOnly} script-built form control(s) rely on a placeholder as their only label (it disappears on input and is not a reliable accessible name).`, { count: placeholderOnly });
  if (!/h\(\s*["'`]label["'`]/.test(js) && inputs.length && !namesFromPlaceholder) add("WARN", "NO_LABEL_ELEMENTS", "The script never builds <label> elements for its form controls.");
  for (const m of callArgs(js, /h\(\s*["'`]button["'`]\s*,\s*\{/g)) if (/^\s*,\s*(?:""|''|``)\s*\)/.test(js.slice(m.end + 1, m.end + 40))) add("FAIL", "BUTTON_NAME", "A script-built button has an empty name.");
  const sev = total;   // true totals, not only the findings that fit in the list
  const incomplete = []; if (truncated) incomplete.push("FINDINGS_TRUNCATED"); if (unresolved) incomplete.push("CONTRAST_PAIRS_UNRESOLVED:" + unresolved); if (!checked) incomplete.push("NO_CONTRAST_PAIRS_CHECKED"); for (const u of bl.unsupported.slice(0, 10)) incomplete.push(u); if (skipped.length) incomplete.push("COLOUR_RULES_NOT_EVALUATED:" + skipped.length); if (!html.trim()) incomplete.push("NO_HTML_SUPPLIED"); if (!css.trim()) incomplete.push("NO_CSS_SUPPLIED");
  const enriched = findings.map(f => ({ ...f, location: f.selector ? "css: " + f.selector : "rule " + f.rule, remediation: REMEDIATION[f.rule] ?? "Review this item manually." }));
  // A clean-looking result is only ever reported for a COMPLETE audit; otherwise it is INCOMPLETE_AUDIT (failures that were found are still reported as FAIL_FOUND).
  return { ok: true, verdict: sev.FAIL ? "FAIL_FOUND" : incomplete.length ? "INCOMPLETE_AUDIT" : sev.WARN ? "WARNINGS_ONLY" : "NO_FAILS_BY_THESE_CHECKS", complete: incomplete.length === 0, incomplete, counts: sev, findings: enriched, truncated, contrast: { pairsChecked: checked, unresolved, unresolvedPairs: unresolvedList, notEvaluated: skipped.slice(0, 20) },
    notes: ["Static source checks only: no browser, no screen reader, no keyboard walk-through. 'NO_FAILS_BY_THESE_CHECKS' is not a statement that the interface is accessible."] };
}
