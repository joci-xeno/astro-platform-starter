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
/** Brace-aware CSS reader (linear). Returns the rules AND an account of what it could not understand: unsupported at-rules and nested rules make the audit incomplete instead of being skipped silently. */
function blocks(css) {
  const out = []; out.unsupported = [];
  { let r = "", i = 0; for (;;) { const a = css.indexOf("/*", i); if (a < 0) { r += css.slice(i); break; } r += css.slice(i, a); const z = css.indexOf("*/", a + 2); if (z < 0) break; i = z + 2; } css = r; }   // strip comments in linear time; an unterminated comment swallows the rest
  const close = (t, from) => { let d = 1, j = from; while (j < t.length) { const c = t[j]; if (c === '"' || c === "'") { const e = t.indexOf(c, j + 1); j = e < 0 ? t.length : e + 1; continue; } if (c === "{") d++; else if (c === "}") { d--; if (!d) return j; } j++; } return -1; };
  const darkSel = sel => /\[data-theme\s*=\s*["']?dark["']?\]/i.test(sel), lightSel = sel => /\[data-theme\s*=\s*["']?light["']?\]/i.test(sel), stripTheme = sel => sel.replace(/\[data-theme\s*=\s*["']?(?:dark|light)["']?\]/ig, "").trim() || ":root";
  const walk = (t, dark, depth) => {
    let i = 0;
    while (i < t.length) {
      const semi = t.indexOf(";", i), open = t.indexOf("{", i);
      if (open < 0) break;
      if (semi >= 0 && semi < open) { i = semi + 1; continue; }                                    // statement at-rule such as @import / @charset
      const prelude = t.slice(i, open).trim(), end = close(t, open + 1); if (end < 0) { out.unsupported.push("UNBALANCED_BRACES"); break; }
      const body = t.slice(open + 1, end);
      if (prelude.startsWith("@")) {
        if (NEUTRAL_AT.test(prelude)) { /* no text-colour rules of interest */ }
        else if (GROUPING_AT.test(prelude) && depth < 8) walk(body, dark || (/^@media/i.test(prelude) && /prefers-color-scheme\s*:\s*dark/i.test(prelude)), depth + 1);
        else out.unsupported.push("UNSUPPORTED_AT_RULE:" + prelude.slice(0, 30));
      } else {
        const nested = body.includes("{"); if (nested) out.unsupported.push("NESTED_CSS_RULES:" + prelude.slice(0, 30));
        const own = nested ? body.slice(0, body.indexOf("{")).split(";").slice(0, -1).join(";") : body;      // declarations before the first nested rule
        const decls = new Map(); for (const d of own.split(";")) { const k = d.indexOf(":"); if (k > 0) decls.set(d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()); }
        for (const sel0 of prelude.split(",")) { const sel = sel0.trim(); if (!sel) continue; const isDark = dark || darkSel(sel); out.push({ sel: darkSel(sel) || lightSel(sel) ? stripTheme(sel) : sel, decls, dark: isDark }); }
      }
      i = end + 1;
    }
  };
  walk(css, false, 0); return out;
}
const tokensFor = (bl, dark) => { const t = {}; for (const pass of dark ? [false, true] : [false]) for (const b of bl) if (b.sel === ":root" && b.dark === pass) for (const [k, v] of b.decls) t[k] = v; return t; };   // light first, dark overrides it
const resolve = (v, tok) => { if (typeof v !== "string") return null; const m = /^var\((--[a-z0-9-]+)\)$/i.exec(v); return m ? (tok[m[1]] ?? v) : v; };   // an unknown token stays as text, so the pair is counted as unresolved instead of silently skipped   // declaration values are already trimmed
const bgOf = d => d.get("background") ?? d.get("background-color") ?? "";

/** Linear tokeniser: [{name, closing, attrs, text}] for every tag outside comments (text = the text right after an opening tag, up to the next "<"). */
function htmlTags(html) {
  const out = []; let i = 0;
  while (i < html.length && out.length < LIMITS.maxTags) {
    const a = html.indexOf("<", i); if (a < 0) break;
    if (html.startsWith("<!--", a)) { const z = html.indexOf("-->", a + 4); if (z < 0) break; i = z + 3; continue; }
    const z = html.indexOf(">", a + 1); if (z < 0) break; const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(a, a + 60)); i = z + 1; if (!m) continue;
    const nextLt = html.indexOf("<", z + 1); out.push({ name: m[2].toLowerCase(), closing: m[1] === "/", attrs: html.slice(a + m[0].length, z), text: m[1] ? "" : html.slice(z + 1, nextLt < 0 ? Math.min(html.length, z + 301) : Math.min(nextLt, z + 301)) });
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
  BUTTON_NAME: "Give every button visible text or an aria-label.", ZOOM_BLOCKED: "Do not disable zooming (user-scalable=no / maximum-scale < 2)."
});
export function auditAccessibility({ html = "", css = "", js = "" } = {}) {
  for (const x of [html, css, js]) if (typeof x !== "string" || x.length > LIMITS.maxInputChars) return { ok: false, reason: "INPUT_INVALID_OR_TOO_LARGE" };
  const findings = []; let truncated = false; const total = { FAIL: 0, WARN: 0, INFO: 0 }; const add = (severity, rule, message, detail = {}) => { total[severity]++; if (findings.length >= LIMITS.maxFindings) { truncated = true; return; } findings.push({ severity, rule, message, ...detail }); };
  // ---- contrast of declared pairs, per theme
  const bl = blocks(css), pairs = [], skipped = [];
  for (const dark of [false, true]) {
    if (dark && !bl.some(b => b.dark)) continue; const tok = tokensFor(bl, dark), theme = dark ? "dark" : "light", page = tok["--bg"] ?? null, panel = tok["--panel"] ?? null, ink = tok["--ink"] ?? null;
    const eff = new Map(); for (const pass of dark ? [false, true] : [false]) for (const b of bl) if (b.dark === pass) { const m = eff.get(b.sel) ?? new Map(); for (const [k, v] of b.decls) m.set(k, v); eff.set(b.sel, m); }   // same-selector cascade: the dark block overrides the base
    for (const [sel, decls] of eff) {
      const b = { sel, decls }; const fg = resolve(b.decls.get("color"), tok), bgRaw = resolve(bgOf(b.decls), tok), bg = typeof bgRaw === "string" && /^(none|transparent|inherit|initial|unset)$/i.test(bgRaw.trim()) ? null : bgRaw;   // "no own background": the text sits on the page or panel colour
      const px = Number(/^(\d+(?:\.\d+)?)px$/.exec(b.decls.get("font-size") ?? "")?.[1] ?? 0), w = b.decls.get("font-weight") ?? "", bold = w === "bold" || Number(w) >= 700, large = px >= 24 || (px >= 18.66 && bold);   // WCAG large text
      if (fg && bg) pairs.push({ theme, sel: b.sel, fg, bg, large });
      else if (fg) { let any = false; for (const base of [page, panel]) if (base) { any = true; pairs.push({ theme, sel: b.sel, fg, bg: base, large, assumedBackground: true }); } if (!any) skipped.push(theme + ": " + b.sel + " (colour without a known page background)"); }                     // text colour only: it sits on the page or a panel
      else if (bg && ink && parseHex(bg)) pairs.push({ theme, sel: b.sel, fg: ink, bg, large, assumedForeground: true });
      else if (bg && !fg && !/::backdrop\s*$/.test(b.sel) && !/^(none|transparent)$/i.test(String(bg)) && !/gradient|url\(/i.test(String(bg))) skipped.push(theme + ": " + b.sel + " (background without a known text colour)");                                              // background only: text inherits the ink colour
    }
  }
  const seen = new Set(); let checked = 0, unresolved = 0; const unresolvedList = [];
  for (const p of pairs) {
    const key = [p.theme, p.sel, p.fg, p.bg, p.large].join("|"); if (seen.has(key)) continue; seen.add(key); const raw = contrastRatio(p.fg, p.bg);
    if (raw === null) { unresolved++; if (unresolvedList.length < 20) unresolvedList.push({ theme: p.theme, selector: p.sel, fg: String(p.fg).slice(0, 60), bg: String(p.bg).slice(0, 60) }); continue; } checked++; const need = p.large ? LIMITS.minLarge : LIMITS.minNormal, r = Math.round(raw * 100) / 100;
    if (raw < need) add("FAIL", "CONTRAST", `${p.theme} theme: ${p.sel} has contrast ${r}:1 (${p.fg} on ${p.bg}), needs ${need}:1`, { theme: p.theme, selector: p.sel, ratio: r, required: need });
  }
  // ---- structure of the html shell (tags are tokenised in one linear pass; comments are skipped)
  const tg = htmlTags(html), by = n => tg.filter(t => t.name === n && !t.closing), attr = (t, n) => new RegExp("(?:^|[\\s\"'])" + n + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", "i").exec(t.attrs)?.slice(1).find(x => x !== undefined);
  const htmlOk = html.trim() !== "";   // an empty page is "nothing supplied" (reported as INCOMPLETE), not a list of invented failures
  if (htmlOk) {
  const root = by("html")[0], lang = root ? attr(root, "lang") : undefined; if (!lang || !/^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang)) add("FAIL", "HTML_LANG", "The <html> element has no valid lang attribute.");
  if (!by("title").some(t => t.text.trim())) add("FAIL", "TITLE", "The page has no non-empty <title>.");
  const vp = by("meta").find(t => attr(t, "name")?.toLowerCase() === "viewport"); if (!vp) add("WARN", "VIEWPORT", "No viewport meta tag."); else { const content = attr(vp, "content") ?? "", ms = /maximum-scale\s*=\s*([0-9.]+)/i.exec(content); if (/user-scalable\s*=\s*(no|0)/i.test(content) || (ms && Number(ms[1]) < 2)) add("FAIL", "ZOOM_BLOCKED", "The viewport meta tag stops users from zooming to 200%."); }
  if (!by("main").length) add("FAIL", "LANDMARK_MAIN", "No <main> landmark."); if (by("nav").some(t => attr(t, "aria-label") === undefined && attr(t, "aria-labelledby") === undefined)) add("WARN", "NAV_LABEL", "A <nav> has no aria-label.");
  for (const t of by("img")) if (attr(t, "alt") === undefined) add("FAIL", "IMG_ALT", "An <img> has no alt attribute.");
  for (const t of tg) { const ti = attr(t, "tabindex"); if (ti !== undefined && Number(ti) > 0) add("WARN", "TABINDEX_POSITIVE", "A positive tabindex changes the natural focus order."); }
  }
  // ---- focus visibility: outline removed on interactive selectors without a replacement
  for (const b of bl) { const o = (b.decls.get("outline") ?? "").toLowerCase(), os = (b.decls.get("outline-style") ?? "").toLowerCase(); if ((o === "none" || o === "0" || os === "none") && (/\b(button|a|input|textarea|select|summary)\b|\[tabindex\]/.test(b.sel) || /:focus(?!-visible)/.test(b.sel)) && !b.decls.has("box-shadow") && !/:not\(\s*:focus-visible\s*\)/.test(b.sel)) add("FAIL", "FOCUS_REMOVED", `${b.sel} removes the focus outline without a replacement.`, { selector: b.sel }); }
  // ---- script-built controls (advisory): placeholder-only inputs and unlabeled controls
  const inputs = callArgs(js, /h\(\s*"(?:input|textarea|select)"\s*,\s*\{/g); let placeholderOnly = 0, labelled = 0;
  const namesFromPlaceholder = /setAttribute\(\s*["']aria-label["']\s*,\s*String\(\s*attrs\.placeholder\s*\)/.test(js);                        // the element helper copies the placeholder into aria-label
  for (const m of inputs) { if (/aria-label|\bid\s*:/.test(m.args)) labelled++; else if (/placeholder/.test(m.args)) { if (namesFromPlaceholder) labelled++; else placeholderOnly++; } }
  if (placeholderOnly) add("WARN", "PLACEHOLDER_ONLY_LABEL", `${placeholderOnly} script-built form control(s) rely on a placeholder as their only label (it disappears on input and is not a reliable accessible name).`, { count: placeholderOnly });
  if (js.includes('h("label"') === false && inputs.length && !namesFromPlaceholder) add("WARN", "NO_LABEL_ELEMENTS", "The script never builds <label> elements for its form controls.");
  for (const m of callArgs(js, /h\(\s*"button"\s*,\s*\{/g)) if (/^\s*,\s*""\s*\)/.test(js.slice(m.end + 1, m.end + 40))) add("FAIL", "BUTTON_NAME", "A script-built button has an empty name.");
  const sev = total;   // true totals, not only the findings that fit in the list
  const incomplete = []; if (truncated) incomplete.push("FINDINGS_TRUNCATED"); if (unresolved) incomplete.push("CONTRAST_PAIRS_UNRESOLVED:" + unresolved); if (!checked) incomplete.push("NO_CONTRAST_PAIRS_CHECKED"); for (const u of bl.unsupported.slice(0, 10)) incomplete.push(u); if (skipped.length) incomplete.push("COLOUR_RULES_NOT_EVALUATED:" + skipped.length); if (!html.trim()) incomplete.push("NO_HTML_SUPPLIED"); if (!css.trim()) incomplete.push("NO_CSS_SUPPLIED");
  const enriched = findings.map(f => ({ ...f, location: f.selector ? "css: " + f.selector : "rule " + f.rule, remediation: REMEDIATION[f.rule] ?? "Review this item manually." }));
  // A clean-looking result is only ever reported for a COMPLETE audit; otherwise it is INCOMPLETE_AUDIT (failures that were found are still reported as FAIL_FOUND).
  return { ok: true, verdict: sev.FAIL ? "FAIL_FOUND" : incomplete.length ? "INCOMPLETE_AUDIT" : sev.WARN ? "WARNINGS_ONLY" : "NO_FAILS_BY_THESE_CHECKS", complete: incomplete.length === 0, incomplete, counts: sev, findings: enriched, truncated, contrast: { pairsChecked: checked, unresolved, unresolvedPairs: unresolvedList, notEvaluated: skipped.slice(0, 20) },
    notes: ["Static source checks only: no browser, no screen reader, no keyboard walk-through. 'NO_FAILS_BY_THESE_CHECKS' is not a statement that the interface is accessible."] };
}
