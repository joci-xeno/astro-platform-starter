// Multimodal fabric (85-capability audit: GE02, P15, G08, G09, A01, A02, A05, A06, P12, P18). What ATLASZ can really do with documents, images, audio and video
// WITHOUT any paid or external provider - and an honest account of what it cannot.
//
// BUILT-IN (pure JS, bounded, never throws on hostile input; nothing is executed or written):
//   * format identification by magic bytes (the file extension is never trusted)
//   * metadata: PNG/JPEG/GIF/WEBP/BMP dimensions; JPEG EXIF camera/date and a GPS-PRESENT flag (coordinates are NOT extracted); WAV/MP3/OGG/FLAC audio properties; MP4/MOV duration, size, tracks
//   * documents: text extraction through the existing Document Center extractors (DOCX/XLSX/PPTX/ODF/RTF/PDF text layer)
//   * privacy flags (GPS, camera, creation time, tags) so an observation can be classified before it is remembered
// EXTERNAL (not built in; slots exist, NONE is connected, so the fabric reports EXTERNAL_PROVIDER_REQUIRED and never fakes a result):
//   OCR (scanned PDFs and images), speech-to-text, image/video understanding (vision model), image generation, text-to-speech.
// A slot becomes LIVE only after a provider is attached AND our own probe succeeds; paid providers are refused (no-spend default); provider output is UNTRUSTED
// text, screened by the Security Brain, and always labelled unverified.
import crypto from "node:crypto";
import { extractBuffer } from "./doc-extractors.mjs";

export const SLOTS = Object.freeze({ ocr: ["image", "document"], stt: ["audio", "video"], vision: ["image"], video_understanding: ["video"], image_generation: [], tts: [] });
export const LIMITS = Object.freeze({ maxBytes: 50 * 1024 * 1024, maxPngChunks: 200, maxBoxes: 500, maxExifEntries: 100, maxProviderChars: 100000 });
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const ascii = (b, s, e) => b.toString("latin1", s, Math.min(e, b.length));

// ---------- identification ----------
export function identify(b) {
  if (!Buffer.isBuffer(b) || b.length < 4) return { format: "unknown", kind: "unknown" };
  const is = (off, str) => ascii(b, off, off + str.length) === str;
  if (b.length >= 8 && b[0] === 0x89 && is(1, "PNG\r\n")) return { format: "png", kind: "image" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: "jpeg", kind: "image" };
  if (is(0, "GIF87a") || is(0, "GIF89a")) return { format: "gif", kind: "image" };
  if (is(0, "RIFF") && is(8, "WEBP")) return { format: "webp", kind: "image" };
  if (is(0, "RIFF") && is(8, "WAVE")) return { format: "wav", kind: "audio" };
  if (is(0, "BM") && b.length > 30) return { format: "bmp", kind: "image" };
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return { format: "tiff", kind: "image" };
  if (is(0, "OggS")) return { format: "ogg", kind: "audio" };
  if (is(0, "fLaC")) return { format: "flac", kind: "audio" };
  if (is(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) !== 0)) return { format: "mp3", kind: "audio" };
  if (b.length >= 12 && is(4, "ftyp")) return { format: "mp4", kind: "video" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { format: "webm", kind: "video" };
  if (is(0, "%PDF-")) return { format: "pdf", kind: "document" };
  if (is(0, "PK\x03\x04")) return { format: "zip", kind: "document" };
  if (is(0, "{\\rtf")) return { format: "rtf", kind: "document" };
  const head = b.subarray(0, Math.min(b.length, 4096));
  if (!head.includes(0)) { try { new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length - 3)); return { format: "text", kind: "text" }; } catch { /* not utf-8 */ } }
  return { format: "unknown", kind: "unknown" };
}

// ---------- images ----------
function exif(b, start, end) {
  const out = { make: null, model: null, dateTime: null, orientation: null, gpsPresent: false };
  const le = ascii(b, start, start + 2) === "II"; if (!le && ascii(b, start, start + 2) !== "MM") return out;
  const u16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o), u32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
  if (u16(start + 2) !== 42) return out;
  const str = (e, base) => { const n = u32(e + 4), off = n > 4 ? start + u32(e + 8) : e + 8; return ascii(b, off, off + Math.min(n, 64)).replace(/\0.*$/, "").trim() || null; };
  const ifd = (off, visit) => { const o = start + off; if (o + 2 > end) return; const n = Math.min(u16(o), LIMITS.maxExifEntries); for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; if (e + 12 > end) break; visit(u16(e), e); } };
  ifd(u32(start + 4), (tag, e) => {
    if (tag === 0x010f) out.make = str(e); else if (tag === 0x0110) out.model = str(e); else if (tag === 0x0132) out.dateTime = str(e); else if (tag === 0x0112) out.orientation = u16(e + 8);
    else if (tag === 0x8825) { const g = start + u32(e + 8); if (g + 2 <= end) out.gpsPresent = u16(g) > 0; }               // presence only: coordinates are deliberately NOT read
    else if (tag === 0x8769) ifd(u32(e + 8), (t2, e2) => { if (t2 === 0x9003) out.dateTime ??= str(e2); });
  });
  return out;
}
function png(b) {
  const m = { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25], textKeys: [], hasExif: false }; let o = 8, n = 0;
  while (o + 8 <= b.length && n++ < LIMITS.maxPngChunks) { const len = b.readUInt32BE(o), t = ascii(b, o + 4, o + 8); if (t === "tEXt" || t === "iTXt") m.textKeys.push(ascii(b, o + 8, o + 8 + Math.min(len, 40)).split("\0")[0]); if (t === "eXIf") m.hasExif = true; if (t === "IEND") break; o += 12 + len; }
  return m;
}
function jpeg(b) {
  const m = { width: null, height: null, components: null, exif: null }; let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) { o++; continue; } const mk = b[o + 1]; if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01 || mk === 0xff) { o += mk === 0xff ? 1 : 2; continue; } if (mk === 0xd9 || mk === 0xda) break;
    const len = b.readUInt16BE(o + 2); if (len < 2) break;
    if (mk === 0xe1 && ascii(b, o + 4, o + 10) === "Exif\0\0") m.exif = exif(b, o + 10, o + 2 + len);
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { m.height = b.readUInt16BE(o + 5); m.width = b.readUInt16BE(o + 7); m.components = b[o + 9]; }
    o += 2 + len;
  }
  return m;
}
function webp(b) {
  const t = ascii(b, 12, 16);
  if (t === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), variant: "VP8X" };
  if (t === "VP8L") { const v = b.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff), variant: "VP8L" }; }
  if (t === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, variant: "VP8" };
  return { width: null, height: null };
}
// ---------- audio ----------
function wav(b) {
  const m = { channels: null, sampleRate: null, bitsPerSample: null, durationSec: null, format: null }; let o = 12, dataBytes = null, byteRate = null, n = 0;
  while (o + 8 <= b.length && n++ < 50) { const id = ascii(b, o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "fmt ") { m.format = b.readUInt16LE(o + 8); m.channels = b.readUInt16LE(o + 10); m.sampleRate = b.readUInt32LE(o + 12); byteRate = b.readUInt32LE(o + 16); m.bitsPerSample = b.readUInt16LE(o + 22); } else if (id === "data") dataBytes = Math.min(sz, b.length - o - 8); o += 8 + sz + (sz & 1); }
  if (dataBytes != null && byteRate > 0) m.durationSec = Number((dataBytes / byteRate).toFixed(3)); return m;
}
const BR = { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] };
function mp3(b) {
  const m = { id3: false, title: null, artist: null, bitrateKbps: null, sampleRate: null, durationSecEstimate: null }; let o = 0;
  if (ascii(b, 0, 3) === "ID3") { m.id3 = true; const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f); let p = 10; const end = Math.min(10 + size, b.length);
    while (p + 10 <= end) { const id = ascii(b, p, p + 4), sz = b.readUInt32BE(p + 4); if (!/^[A-Z0-9]{4}$/.test(id) || sz <= 0 || p + 10 + sz > end) break; if (id === "TIT2" || id === "TPE1") { const v = b.toString("utf8", p + 11, p + 10 + Math.min(sz, 200)).replace(/\0/g, "").trim(); if (id === "TIT2") m.title = v; else m.artist = v; } p += 10 + sz; } o = 10 + size; }
  for (let i = o; i + 4 < Math.min(b.length, o + 65536); i++) { if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) { const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3; if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) continue;
    const table = BR[layer === 3 ? (ver === 3 ? 1 : 2) : layer === 2 ? 3 : 3]; const rates = ver === 3 ? [44100, 48000, 32000] : ver === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000]; m.bitrateKbps = table?.[bri] ?? null; m.sampleRate = rates[sri]; if (m.bitrateKbps) m.durationSecEstimate = Number(((b.length - i) * 8 / (m.bitrateKbps * 1000)).toFixed(1)); break; } }
  return m;
}
function ogg(b) {
  const m = { codec: null, channels: null, sampleRate: null, durationSec: null }; const i = b.indexOf("\x01vorbis", 0, "latin1"), j = b.indexOf("OpusHead", 0, "latin1");
  if (i >= 0 && i < 200) { m.codec = "vorbis"; m.channels = b[i + 11]; m.sampleRate = b.readUInt32LE(i + 12); } else if (j >= 0 && j < 200) { m.codec = "opus"; m.channels = b[j + 9]; m.sampleRate = 48000; }
  const last = b.lastIndexOf("OggS", b.length, "latin1"); if (last >= 0 && m.sampleRate) { const g = Number(b.readBigUInt64LE(last + 6)); if (g > 0 && g < 2 ** 50) m.durationSec = Number((g / m.sampleRate).toFixed(2)); } return m;
}
function flac(b) { const v = b.readUInt32BE(18) >>> 12, sr = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4), ch = ((b[20] >> 1) & 7) + 1, total = ((b[21] & 0x0f) * 2 ** 32) + b.readUInt32BE(22); return { sampleRate: sr, channels: ch, totalSamples: total, durationSec: sr ? Number((total / sr).toFixed(2)) : null }; }
// ---------- video ----------
function mp4(b) {
  const m = { brand: ascii(b, 8, 12), durationSec: null, width: null, height: null, tracks: [] }; let boxes = 0;
  const walk = (s, e, depth, ctx) => {
    let o = s; while (o + 8 <= e && boxes++ < LIMITS.maxBoxes) {
      let sz = b.readUInt32BE(o), hdr = 8; const t = ascii(b, o + 4, o + 8); if (sz === 1) { sz = Number(b.readBigUInt64BE(o + 8)); hdr = 16; } else if (sz === 0) sz = e - o; if (sz < hdr || o + sz > e + 0) { if (o + sz > e) sz = e - o; if (sz < hdr) break; }
      const bs = o + hdr, be = o + sz;
      if (t === "mvhd") { const v = b[bs]; const ts = v === 1 ? b.readUInt32BE(bs + 20) : b.readUInt32BE(bs + 12), du = v === 1 ? Number(b.readBigUInt64BE(bs + 24)) : b.readUInt32BE(bs + 16); if (ts > 0) m.durationSec = Number((du / ts).toFixed(2)); }
      else if (t === "tkhd") { const v = b[bs], w = b.readUInt32BE(be - 8) / 65536, h = b.readUInt32BE(be - 4) / 65536; ctx.dims = [Math.round(w), Math.round(h)]; void v; }
      else if (t === "hdlr") ctx.handler = ascii(b, bs + 8, bs + 12);
      else if (["moov", "trak", "mdia"].includes(t) && depth < 5) { const c = t === "trak" ? {} : ctx; walk(bs, be, depth + 1, c); if (t === "trak") { m.tracks.push({ type: c.handler === "vide" ? "video" : c.handler === "soun" ? "audio" : c.handler ?? "other", width: c.handler === "vide" ? c.dims?.[0] : undefined, height: c.handler === "vide" ? c.dims?.[1] : undefined }); if (c.handler === "vide" && c.dims && c.dims[0] > 0 && m.width == null) { m.width = c.dims[0]; m.height = c.dims[1]; } } }
      o += sz;
    }
  };
  walk(0, b.length, 0, {}); return m;
}

/** Describe a media buffer. Never throws; malformed input yields status MALFORMED_OR_TRUNCATED with whatever was readable. */
export function describe(buf, { name = null } = {}) {
  if (!Buffer.isBuffer(buf)) return { status: "INVALID_INPUT" }; if (buf.length > LIMITS.maxBytes) return { status: "TOO_LARGE", bytes: buf.length };
  const id = identify(buf), base = { status: "OK", format: id.format, kind: id.kind, bytes: buf.length, sha256: sha(buf), nameExtension: name ? String(name).split(".").pop().toLowerCase() : null, metadata: {}, privacy: { exifGps: false, cameraInfo: false, creationTime: false, embeddedTags: false, hint: null } };
  try {
    let md = {};
    switch (id.format) {
      case "png": md = png(buf); base.privacy.embeddedTags = md.textKeys.length > 0; break;
      case "jpeg": { md = jpeg(buf); const e = md.exif; if (e) { base.privacy.exifGps = e.gpsPresent; base.privacy.cameraInfo = Boolean(e.make || e.model); base.privacy.creationTime = Boolean(e.dateTime); } break; }
      case "gif": md = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }; break;
      case "webp": md = webp(buf); break;
      case "bmp": md = { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)), bitsPerPixel: buf.readUInt16LE(28) }; break;
      case "wav": md = wav(buf); break; case "mp3": md = mp3(buf); base.privacy.embeddedTags = Boolean(md.title || md.artist); break; case "ogg": md = ogg(buf); break; case "flac": md = flac(buf); break;
      case "mp4": md = mp4(buf); break;
      case "webm": md = { container: "matroska/webm", note: "container identified; duration and tracks are not parsed" }; break;
      default: break;
    }
    base.metadata = md;
    if (id.kind === "image" || id.kind === "audio" || id.kind === "video") base.privacy.hint = base.privacy.exifGps || base.privacy.cameraInfo || base.privacy.creationTime || base.privacy.embeddedTags ? "PERSONAL: identifying metadata present" : "PERSONAL: media of unknown origin should be treated as personal until classified";
    if (base.nameExtension && id.format !== "unknown" && !extMatches(id.format, base.nameExtension)) base.extensionMismatch = true;
  } catch { base.status = "MALFORMED_OR_TRUNCATED"; }
  return base;
}
const EXT = { jpeg: ["jpg", "jpeg"], mp4: ["mp4", "m4v", "mov", "m4a"], text: ["txt", "md", "csv", "json", "xml", "html", "log"], zip: ["zip", "docx", "xlsx", "pptx", "odt", "ods", "odp"], tiff: ["tif", "tiff"], mp3: ["mp3"], ogg: ["ogg", "oga", "opus"] };
const extMatches = (fmt, ext) => (EXT[fmt] ?? [fmt]).includes(ext);

export function createModalityFabric({ security = null, blackBox = null, now = () => new Date().toISOString() } = {}) {
  const slots = Object.fromEntries(Object.keys(SLOTS).map(k => [k, { slot: k, provider: null, state: "NOT_CONNECTED", lastProbe: null, note: "No provider attached. External dependency." }]));
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  /** Attach a provider: {id, costClass: "FREE"|"PAID", probe(): Promise<{ok}>, run(input): Promise<{text}>}. Not LIVE until probe() succeeds. */
  function attach(slot, provider) {
    if (!slots[slot]) throw new Error("UNKNOWN_SLOT"); if (!provider || typeof provider.run !== "function" || typeof provider.probe !== "function" || !provider.id) throw new Error("PROVIDER_INVALID");
    slots[slot] = { slot, provider, state: "CONNECTED_UNPROBED", lastProbe: null, note: "Attached but not probed: not LIVE." }; log("MODALITY_PROVIDER_ATTACHED", { slot, id: provider.id }); return { slot, state: slots[slot].state };
  }
  async function probe(slot) {
    const s = slots[slot]; if (!s?.provider) return { slot, state: "NOT_CONNECTED" };
    try { const r = await s.provider.probe(); s.lastProbe = now(); s.state = r?.ok === true ? "LIVE" : "PROBE_FAILED"; s.note = r?.ok === true ? "Probe succeeded." : "Probe did not succeed."; }
    catch (e) { s.lastProbe = now(); s.state = "PROBE_FAILED"; s.note = "Probe threw: " + String(e.message).slice(0, 80); }
    log("MODALITY_PROBE", { slot, state: s.state }); return { slot, state: s.state };
  }
  /** Use a slot. Refuses unless LIVE and FREE; output is untrusted text, screened, never labelled verified. */
  async function useSlot(slot, input) {
    const s = slots[slot]; if (!s) return { status: "UNKNOWN_SLOT" };
    if (s.state === "NOT_CONNECTED") return { status: "EXTERNAL_PROVIDER_REQUIRED", slot, note: s.note };
    if (s.state !== "LIVE") return { status: "PROVIDER_NOT_LIVE", slot, state: s.state };
    if (s.provider.costClass !== "FREE") return { status: "REFUSED_COST", slot, note: "Paid provider refused: the default policy is no spend without owner approval." };
    try {
      const r = await s.provider.run(input), text = typeof r?.text === "string" ? r.text.slice(0, LIMITS.maxProviderChars) : null; if (text == null) return { status: "PROVIDER_OUTPUT_INVALID", slot };
      const a = security ? security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "provider:" + s.provider.id, text }) : null;
      if (a && a.allowed === false) return { status: "OUTPUT_QUARANTINED", slot, reasons: a.reasons ?? [] };
      log("MODALITY_PROVIDER_USED", { slot, id: s.provider.id }); return { status: "PROVIDER_OUTPUT_UNVERIFIED", slot, producedBy: s.provider.id, text, screening: a?.decision ?? "NOT_SCREENED", verified: false, untrusted: true };
    } catch (e) { return { status: "PROVIDER_ERROR", slot, error: String(e.message).slice(0, 100) }; }
  }
  /** Full analysis: built-in metadata/text plus, for each applicable slot, either provider output or the explicit external requirement. */
  async function analyze(buf, { name = null, understand = true } = {}) {
    const d = describe(buf, { name }); d.text = { status: "NOT_APPLICABLE" }; d.understanding = {};
    if (d.status === "TOO_LARGE" || d.status === "INVALID_INPUT") return d;
    if (d.kind === "document" || d.kind === "text") {
      if (d.kind === "text") d.text = { status: "PLAIN_TEXT", chars: buf.length };
      else { const ext = d.format === "zip" ? "." + (d.nameExtension ?? "") : "." + d.format, r = extractBuffer(buf, ext); d.text = r.ok ? { status: "EXTRACTED", chars: r.text.length, truncated: r.truncated, method: "BUILTIN" } : { status: r.code === "PDF_NO_TEXT_LAYER" ? "NO_TEXT_LAYER" : "NOT_EXTRACTED", code: r.code }; }
    }
    if (understand) {
      for (const [slot, kinds] of Object.entries(SLOTS)) {
        if (!kinds.includes(d.kind)) continue; if (slot === "ocr" && d.kind === "document" && d.text.status !== "NO_TEXT_LAYER") continue;
        d.understanding[slot] = await useSlot(slot, { kind: d.kind, format: d.format, bytes: buf, metadata: d.metadata });
      }
    }
    return d;
  }
  const status = () => Object.values(slots).map(s => ({ slot: s.slot, provider: s.provider?.id ?? null, state: s.state, lastProbe: s.lastProbe, note: s.note, appliesTo: SLOTS[s.slot] }));
  const summary = () => ({ builtIn: ["format identification", "image/audio/video metadata", "EXIF presence flags (no coordinates)", "document text (DOCX/XLSX/PPTX/ODF/RTF/PDF text layer)"], formats: ["png", "jpeg", "gif", "webp", "bmp", "tiff(id only)", "wav", "mp3", "ogg", "flac", "mp4/mov", "webm(id only)", "pdf", "docx/xlsx/pptx/odf", "rtf", "text"],
    external: status().filter(s => s.state !== "LIVE").map(s => s.slot), slots: status(), note: "Content understanding (OCR, speech-to-text, vision) needs an external provider; none is connected." });
  return { identify, describe: (b, o) => describe(b, o), analyze, attach, probe, useSlot, status, summary };
}

/** Typed tools. Agents inspect Document Center files THROUGH the center's permission gates (tenant, role, never SECRET); they receive analysis, never raw bytes. */
export function registerModalityTools(registry, fabric, documents, { tenantId, role = "AGENT" } = {}) {
  const obj = { type: "object", additionalProperties: true, properties: {} };
  registry.register({ name: "media.inspect_document", description: "Built-in analysis of a stored document/image/audio/video: format, metadata, privacy flags, text status, and which external providers would be needed.", operation: "READ_STATUS",
    input: { type: "object", required: ["documentId"], properties: { documentId: { type: "string", minLength: 1, maxLength: 80 } } }, output: obj,
    handler: async a => { const buf = documents.readBytes(a.documentId, { tenantId, role }); if (!buf) return { status: "NOT_AVAILABLE", note: "Unknown, not permitted, or SECRET." }; const meta = documents.get(a.documentId, { tenantId, role }); const r = await fabric.analyze(buf, { name: meta?.name ?? null }); return r; } });
  registry.register({ name: "media.status", description: "What multimodal processing is built in and which provider slots are connected.", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: obj, handler: () => fabric.summary() });
}
