// Safe preview renderer (85-capability programme: M13 Interactive Artifacts / C09, P18 Visual Highlighting, A07 Visual Guidance).
// Everything here produces INERT SVG/HTML from validated data: all text is escaped, numbers are checked finite, sizes are capped, nothing references an external resource,
// and every produced SVG passes checkSvgSafe() before it is returned (a failed self-check returns ok:false instead of markup). It never executes or evaluates input.
import { createHash } from "node:crypto";
export const LIMITS = Object.freeze({ maxPoints: 500, maxLabels: 50, labelChars: 40, maxNodes: 60, maxEdges: 200, maxAnnotations: 50, maxSteps: 30, maxPreviewChars: 20000 });
export const PALETTE = Object.freeze({ blue: "#2b6cb0", green: "#2f855a", amber: "#b7791f", red: "#c53030", grey: "#4a5568" });
const SERIES = ["#2b6cb0", "#2f855a", "#b7791f", "#805ad5", "#c53030", "#2c7a7b"];
const str = s => { try { return String(s ?? ""); } catch { return "?"; } };                 // a hostile toString() must not crash a render
export const esc = s => str(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");   // characters that are invalid in XML are dropped
const f = n => { const v = Math.round(n * 100) / 100; return Object.is(v, -0) ? 0 : v; };
const short = (s, n = LIMITS.labelChars) => { const t = str(s); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const fin = v => typeof v === "number" && Number.isFinite(v);
const num = v => fin(v) && Math.abs(v) <= 1e15;                                              // chart data: large enough for any real series, small enough that scaling arithmetic cannot overflow

/** Reject anything that could run code or reach out: scripts, handlers, javascript:, foreignObject, external href, DOCTYPE/ENTITY, <image>, <use> to other docs, css url(). */
export function checkSvgSafe(svg) {
  const problems = [], s = String(svg);
  // Text content is always escaped by this module, so "<" never appears inside text; attribute/handler/URL patterns are therefore checked INSIDE tags only (no false positives on labels like "one = 1").
  const rules = [[/<\s*script/i, "SCRIPT"], [/<[^>]*\son[a-z]+\s*=/i, "EVENT_HANDLER"], [/<[^>]*javascript\s*:/i, "JAVASCRIPT_URL"], [/<\s*foreignObject/i, "FOREIGN_OBJECT"], [/<!\s*(DOCTYPE|ENTITY)/i, "DOCTYPE_OR_ENTITY"], [/<\s*image\b/i, "IMAGE_ELEMENT"], [/<\s*(iframe|embed|object)\b/i, "EMBED"],
    [/<[^>]*(?:xlink:)?href\s*=\s*["'](?!#)/i, "EXTERNAL_HREF"], [/<[^>]*url\s*\(\s*["']?(?!#)/i, "CSS_URL"], [/@import/i, "CSS_IMPORT"], [/<\s*style\b/i, "STYLE_ELEMENT"], [/<\s*(animate|set)\b/i, "ANIMATION"]];
  for (const [re, name] of rules) if (re.test(s)) problems.push(name);
  return { safe: problems.length === 0, problems };
}
const done = (svg, extra = {}) => {
  const c = checkSvgSafe(svg); if (/="[^"]*(?:NaN|Infinity)[^"]*"/.test(svg)) c.problems.push("NON_FINITE_NUMBER_IN_MARKUP");
  return c.problems.length === 0 ? { ok: true, svg, bytes: svg.length, sha256: createHash("sha256").update(svg).digest("hex"), ...extra } : { ok: false, reason: "SVG_SELF_CHECK_FAILED", problems: c.problems };
};
export const svgToDataUri = svg => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
const frame = (w, h, title, desc, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d"><title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc><rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
function niceTicks(lo, hi, n = 5) { if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; } if (Math.abs(hi - lo) <= Math.max(Math.abs(lo), Math.abs(hi)) * 1e-9) { const pad = Math.max(Math.abs(lo) * 1e-3, 1); lo -= pad; hi += pad; } const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag, step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = []; for (let i = 0, v = a; v <= b + step / 2 && i < 50; i++, v = a + i * step) t.push(Math.round(v / step) * step); return { a, b, t }; }
const tickLabel = v => Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(1) : String(+v.toPrecision(4));

function renderChart_(spec, { width = 640, height = 360 } = {}) {
  if (!spec || typeof spec !== "object") return { ok: false, reason: "SPEC_REQUIRED" };
  for (const k of ["labels", "values", "x", "points"]) { const v = spec[k]; if (Array.isArray(v) && (Object.keys(v).length !== v.length || (k === "points" && v.some(q => Array.isArray(q) && Object.keys(q).length !== q.length)))) return { ok: false, reason: "SPARSE_ARRAY" }; }   // holes would be skipped by every(): a "3 point" chart with no data
  if (![width, height].every(n => Number.isInteger(n) && n >= 200 && n <= 2000)) return { ok: false, reason: "SIZE_INVALID" };
  const title = short(spec.title || "Chart", 80), M = { l: 56, r: 16, t: 36, b: 48 }, W = width - M.l - M.r, H = height - M.t - M.b;
  let series, xs = null, cats = null, kind = spec.type;
  if (kind === "bar") {
    if (!Array.isArray(spec.labels) || !Array.isArray(spec.values) || spec.labels.length !== spec.values.length || !spec.values.length) return { ok: false, reason: "BAR_DATA_INVALID" };
    if (spec.values.length > LIMITS.maxLabels || !spec.values.every(num)) return { ok: false, reason: "BAR_DATA_INVALID" }; cats = spec.labels.map(l => short(l)); series = spec.values;
  } else if (kind === "histogram") {
    const v = spec.values; if (!Array.isArray(v) || !v.length || !v.every(num) || v.length > 100000) return { ok: false, reason: "HISTOGRAM_DATA_INVALID" };
    const bins = Math.min(30, Math.max(3, Math.ceil(Math.log2(v.length) + 1))), lo = Math.min(...v), hi = Math.max(...v), w = (hi - lo) / bins || 1, cnt = new Array(bins).fill(0);
    for (const x of v) cnt[Math.min(bins - 1, Math.floor((x - lo) / w))]++; series = cnt; cats = cnt.map((_, i) => tickLabel(lo + i * w)); kind = "bar";
  } else if (kind === "line") {
    const y = spec.values; if (!Array.isArray(y) || y.length < 2 || y.length > LIMITS.maxPoints || !y.every(num)) return { ok: false, reason: "LINE_DATA_INVALID" }; series = y; xs = Array.isArray(spec.x) && spec.x.length === y.length && spec.x.every(num) ? spec.x : y.map((_, i) => i);
  } else if (kind === "scatter") {
    const p = spec.points; if (!Array.isArray(p) || !p.length || p.length > LIMITS.maxPoints || !p.every(q => Array.isArray(q) && q.length === 2 && q.every(num))) return { ok: false, reason: "SCATTER_DATA_INVALID" }; xs = p.map(q => q[0]); series = p.map(q => q[1]);
  } else return { ok: false, reason: "TYPE_UNKNOWN" };
  const yt = niceTicks(Math.min(0, ...series) === 0 && kind === "bar" ? 0 : Math.min(...series), Math.max(...series)), sy = v => f(M.t + H - ((v - yt.a) / (yt.b - yt.a || 1)) * H);
  let body = yt.t.map(t => `<line x1="${M.l}" x2="${M.l + W}" y1="${sy(t)}" y2="${sy(t)}" stroke="#e2e8f0"/><text x="${M.l - 6}" y="${f(sy(t) + 4)}" font-size="11" text-anchor="end" fill="#4a5568">${esc(tickLabel(t))}</text>`).join("");
  body += `<text x="${width / 2}" y="20" font-size="14" font-weight="bold" text-anchor="middle" fill="#1a202c">${esc(title)}</text><line x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${M.t + H}" stroke="#718096"/><line x1="${M.l}" x2="${M.l + W}" y1="${M.t + H}" y2="${M.t + H}" stroke="#718096"/>`;
  if (kind === "bar") { const n = series.length, bw = W / n; series.forEach((v, i) => { const y0 = sy(Math.max(0, yt.a)), y1 = sy(v); body += `<rect x="${f(M.l + i * bw + bw * 0.1)}" y="${f(Math.min(y0, y1))}" width="${f(bw * 0.8)}" height="${f(Math.abs(y0 - y1))}" fill="${SERIES[0]}"><title>${esc(cats[i])}: ${esc(tickLabel(v))}</title></rect>`; if (n <= 12) body += `<text x="${f(M.l + i * bw + bw / 2)}" y="${M.t + H + 16}" font-size="10" text-anchor="middle" fill="#4a5568">${esc(short(cats[i], 12))}</text>`; }); }
  else { const xt = niceTicks(Math.min(...xs), Math.max(...xs)), sx = v => f(M.l + ((v - xt.a) / (xt.b - xt.a || 1)) * W);
    body += xt.t.map(t => `<text x="${sx(t)}" y="${M.t + H + 16}" font-size="11" text-anchor="middle" fill="#4a5568">${esc(tickLabel(t))}</text>`).join("");
    if (kind === "line") body += `<polyline fill="none" stroke="${SERIES[0]}" stroke-width="2" points="${xs.map((x, i) => sx(x) + "," + sy(series[i])).join(" ")}"/>`;
    else body += xs.map((x, i) => `<circle cx="${sx(x)}" cy="${sy(series[i])}" r="3" fill="${SERIES[0]}" fill-opacity="0.7"/>`).join(""); }
  return done(frame(width, height, title, `${spec.type} chart with ${series.length} data point(s)`, body), { type: spec.type, points: series.length });
}

function renderDiagram_({ nodes, edges = [], title = "Diagram" } = {}) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > LIMITS.maxNodes || !Array.isArray(edges) || edges.length > LIMITS.maxEdges) return { ok: false, reason: "DIAGRAM_DATA_INVALID" };
  const ids = new Set(); for (const n of nodes) { if (!n || typeof n.id !== "string" || !n.id || ids.has(n.id)) return { ok: false, reason: "NODE_ID_INVALID" }; ids.add(n.id); }
  for (const e of edges) if (!e || !ids.has(e.from) || !ids.has(e.to)) return { ok: false, reason: "EDGE_REFERENCES_UNKNOWN_NODE" };
  // rank = longest path over the edges that remain after breaking cycles (an edge to a node still on the DFS stack is a back edge and is ignored for layout only)
  const out = new Map(nodes.map(n => [n.id, []])); for (const e of edges) out.get(e.from).push(e);
  const color = new Map(), back = new Set(), topo = [];
  const dfs = id => { color.set(id, 1); for (const e of out.get(id)) { const c = color.get(e.to); if (c === 1) back.add(e); else if (!c) dfs(e.to); } color.set(id, 2); topo.push(id); };
  for (const n of nodes) if (!color.get(n.id)) dfs(n.id);
  const rank = new Map(nodes.map(n => [n.id, 0]));
  for (const id of topo.slice().reverse()) for (const e of out.get(id)) if (!back.has(e)) rank.set(e.to, Math.max(rank.get(e.to), rank.get(id) + 1));
  const layers = []; for (const n of nodes) (layers[rank.get(n.id)] ??= []).push(n);
  const bw = 130, bh = 40, gx = 40, gy = 56, maxCols = Math.max(...layers.filter(Boolean).map(l => l.length)), width = Math.max(300, maxCols * (bw + gx) + gx), height = layers.length * (bh + gy) + gy;
  const at = new Map(); layers.forEach((l, r) => l?.forEach((n, c) => at.set(n.id, { x: gx + c * (bw + gx) + ((maxCols - l.length) * (bw + gx)) / 2, y: gy / 2 + r * (bh + gy) })));
  let body = `<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4a5568"/></marker></defs>`;
  for (const e of edges) { const a = at.get(e.from), b = at.get(e.to); if (!a || !b) continue; body += `<line x1="${f(a.x + bw / 2)}" y1="${f(a.y + bh)}" x2="${f(b.x + bw / 2)}" y2="${f(b.y)}" stroke="#4a5568" stroke-width="1.5" marker-end="url(#ar)"/>`; if (e.label) body += `<text x="${f((a.x + b.x) / 2 + bw / 2 + 4)}" y="${f((a.y + bh + b.y) / 2)}" font-size="10" fill="#4a5568">${esc(short(e.label, 20))}</text>`; }
  for (const n of nodes) { const p = at.get(n.id); body += `<rect x="${f(p.x)}" y="${f(p.y)}" width="${bw}" height="${bh}" rx="6" fill="#ebf8ff" stroke="${SERIES[0]}"/><text x="${f(p.x + bw / 2)}" y="${f(p.y + bh / 2 + 4)}" font-size="12" text-anchor="middle" fill="#1a202c">${esc(short(n.label ?? n.id, 18))}</text>`; }
  return done(frame(width, height, short(title, 80), `diagram with ${nodes.length} node(s) and ${edges.length} edge(s)`, body), { nodes: nodes.length, edges: edges.length });
}

/** Inert HTML preview of plain text: everything escaped, paragraphs only. Safe to assign with innerHTML; the UI should still prefer textContent. */
function renderTextPreview_(text, { maxChars = LIMITS.maxPreviewChars } = {}) {
  if (typeof text !== "string") return { ok: false, reason: "TEXT_REQUIRED" };
  const t = text.slice(0, maxChars), paras = t.split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return { ok: true, html: `<div class="preview">${paras}</div>`, truncated: text.length > maxChars };
}

// ---- P18 annotations / A07 guidance (coordinates are RELATIVE 0..1 so they work on any image size)
export const ANNOTATION_TYPES = Object.freeze(["rect", "ellipse", "arrow", "text", "marker"]);
const rel = v => fin(v) && v >= 0 && v <= 1;
function validateAnnotations_(list) {
  if (!Array.isArray(list)) return { ok: false, reason: "LIST_REQUIRED" };
  if (list.length > LIMITS.maxAnnotations) return { ok: false, reason: "TOO_MANY_ANNOTATIONS" };
  const out = [], problems = [];
  list.forEach((a, i) => {
    const bad = r => problems.push({ index: i, reason: r });
    if (!a || !ANNOTATION_TYPES.includes(a.type)) return bad("TYPE_INVALID");
    const color = a.color ?? "red"; if (typeof color !== "string" || !Object.hasOwn(PALETTE, color)) return bad("COLOR_INVALID");
    const label = a.label === undefined ? "" : str(a.label); if (label.length > 80) return bad("LABEL_TOO_LONG");
    if (a.type === "rect" || a.type === "ellipse") { if (![a.x, a.y, a.w, a.h].every(rel) || a.w <= 0 || a.h <= 0 || a.x + a.w > 1.0001 || a.y + a.h > 1.0001) return bad("REGION_INVALID"); out.push({ type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, color, label }); }
    else if (a.type === "arrow") { if (![a.x1, a.y1, a.x2, a.y2].every(rel)) return bad("REGION_INVALID"); out.push({ type: "arrow", x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color, label }); }
    else { if (![a.x, a.y].every(rel)) return bad("REGION_INVALID"); if (a.type === "text" && !label) return bad("TEXT_NEEDS_LABEL"); out.push({ type: a.type, x: a.x, y: a.y, color, label }); }
  });
  return problems.length ? { ok: false, reason: "ANNOTATIONS_INVALID", problems } : { ok: true, annotations: out };
}
/** Transparent overlay (to be layered over a screenshot/image the UI already shows); width/height are the displayed pixel size. */
function renderAnnotationOverlay_(list, { width = 800, height = 600, numbered = false } = {}) {
  const v = validateAnnotations(list); if (!v.ok) return v;
  if (![width, height].every(n => Number.isInteger(n) && n >= 50 && n <= 4000)) return { ok: false, reason: "SIZE_INVALID" };
  let body = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" context-fill="currentColor"/></marker></defs>`.replace(' context-fill="currentColor"', ' fill="#c53030"');
  v.annotations.forEach((a, i) => {
    const c = PALETTE[a.color], lab = (x, y) => a.label ? `<text x="${f(x)}" y="${f(Math.max(12, y))}" font-size="13" font-weight="bold" fill="${c}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(a.label)}</text>` : "";
    if (a.type === "rect") body += `<rect x="${f(a.x * width)}" y="${f(a.y * height)}" width="${f(a.w * width)}" height="${f(a.h * height)}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="3"/>${lab(a.x * width, a.y * height - 4)}`;
    else if (a.type === "ellipse") body += `<ellipse cx="${f((a.x + a.w / 2) * width)}" cy="${f((a.y + a.h / 2) * height)}" rx="${f(a.w * width / 2)}" ry="${f(a.h * height / 2)}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="3"/>${lab(a.x * width, a.y * height - 4)}`;
    else if (a.type === "arrow") body += `<line x1="${f(a.x1 * width)}" y1="${f(a.y1 * height)}" x2="${f(a.x2 * width)}" y2="${f(a.y2 * height)}" stroke="${c}" stroke-width="3" marker-end="url(#ah)"/>${lab(a.x1 * width + 4, a.y1 * height - 4)}`;
    else if (a.type === "marker") body += `<circle cx="${f(a.x * width)}" cy="${f(a.y * height)}" r="11" fill="${c}"/><text x="${f(a.x * width)}" y="${f(a.y * height + 4)}" font-size="12" text-anchor="middle" fill="#ffffff">${numbered ? i + 1 : "!"}</text>${lab(a.x * width + 14, a.y * height + 4)}`;
    else body += lab(a.x * width, a.y * height);
  });
  return done(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="annotation overlay with ${v.annotations.length} item(s)">${body}</svg>`, { count: v.annotations.length });
}
/** A07: ordered, validated guidance steps; each step may point at a region. Descriptors only - ATLASZ never clicks anything for the user. */
function buildGuidance_({ title, steps } = {}) {
  if (typeof title !== "string" || !title.trim() || title.length > 120) return { ok: false, reason: "TITLE_INVALID" };
  if (!Array.isArray(steps) || !steps.length || steps.length > LIMITS.maxSteps) return { ok: false, reason: "STEPS_INVALID" };
  const out = [];
  for (const [i, s] of steps.entries()) {
    if (!s || typeof s.text !== "string" || !s.text.trim() || s.text.length > 300) return { ok: false, reason: "STEP_TEXT_INVALID", step: i + 1 };
    let region = null; if (s.region) { const v = validateAnnotations([{ color: "amber", ...s.region }]); if (!v.ok) return { ok: false, reason: "STEP_REGION_INVALID", step: i + 1 }; region = v.annotations[0]; }
    out.push({ n: i + 1, text: s.text.trim(), region, performedByAtlasz: false });
  }
  return { ok: true, title: title.trim(), steps: out };
}
function renderGuidanceStep_(guidance, n, opts = {}) {
  const s = guidance?.steps?.[n - 1]; if (!s) return { ok: false, reason: "STEP_NOT_FOUND" };
  const list = s.region ? [s.region, ...(s.region.type === "marker" ? [] : [{ type: "marker", x: s.region.x ?? s.region.x1, y: s.region.y ?? s.region.y1, color: s.region.color, label: "" }])] : [];
  return renderAnnotationOverlay(list, { ...opts, numbered: false });
}

// Every public renderer is wrapped: whatever odd input arrives, the answer is a refusal, never an exception.
const guarded = fn => (...a) => { try { return fn(...a); } catch { return { ok: false, reason: "RENDER_FAILED" }; } };
export const renderChart = guarded(renderChart_), renderDiagram = guarded(renderDiagram_), renderTextPreview = guarded(renderTextPreview_), validateAnnotations = guarded(validateAnnotations_),
  renderAnnotationOverlay = guarded(renderAnnotationOverlay_), buildGuidance = guarded(buildGuidance_), renderGuidanceStep = guarded(renderGuidanceStep_);
