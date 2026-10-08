import zlib from "node:zlib";
// Synthetic media fixtures built from the file-format specs (no external files).
const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }, le32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }, le16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }, be16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => Buffer.concat([be32(d.length), Buffer.from(t), d, be32(crc(Buffer.concat([Buffer.from(t), d])))]);
const PNG = (w, h, extra = []) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.concat([be32(w), be32(h), Buffer.from([8, 2, 0, 0, 0])])), ...extra, chunk("IDAT", zlib.deflateSync(Buffer.alloc(h * (w * 3 + 1)))), chunk("IEND", Buffer.alloc(0))]);
function exifBlock({ gps = false, make = "TestCam", model = "T-1000", date = "2026:10:07 12:00:00" } = {}) {
  const entries = []; const strs = []; let strOff = 8 + 2 + 4 * 12 + 4 + (gps ? 2 + 12 + 4 : 0);   // ifd0 header(8) + count + entries + next + optional gps ifd
  const add = (tag, type, count, val) => entries.push(Buffer.concat([le16(tag), le16(type), le32(count), val]));
  const s = (txt) => { const b = Buffer.from(txt + "\0"); const off = strOff; strs.push(b); strOff += b.length; return { n: b.length, off }; };
  const mk = s(make), md = s(model), dt = s(date);
  add(0x010f, 2, mk.n, le32(mk.off)); add(0x0110, 2, md.n, le32(md.off)); add(0x0132, 2, dt.n, le32(dt.off)); add(0x8825, 4, 1, le32(8 + 2 + 4 * 12 + 4));
  const gpsIfd = gps ? Buffer.concat([le16(1), Buffer.concat([le16(1), le16(2), le32(2), Buffer.from("N\0\0\0")]), le32(0)]) : Buffer.concat([le16(0), le32(0)]);
  const ifd0 = Buffer.concat([Buffer.from("II"), le16(42), le32(8), le16(4), ...entries, le32(0)]);
  return Buffer.concat([ifd0, gpsIfd, ...strs]);
}
const JPEG = (w, h, ex = null) => { const parts = [Buffer.from([0xff, 0xd8])]; if (ex) { const body = Buffer.concat([Buffer.from("Exif\0\0"), ex]); parts.push(Buffer.from([0xff, 0xe1]), be16(body.length + 2), body); } parts.push(Buffer.from([0xff, 0xc0]), be16(17), Buffer.from([8]), be16(h), be16(w), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.from([0xff, 0xd9])); return Buffer.concat(parts); };
const GIF = (w, h) => Buffer.concat([Buffer.from("GIF89a"), le16(w), le16(h), Buffer.from([0, 0, 0, 0x3b])]);
const WAV = (sec, rate = 8000, ch = 1, bits = 16) => { const data = Buffer.alloc(Math.round(sec * rate * ch * bits / 8)); const fmt = Buffer.concat([le16(1), le16(ch), le32(rate), le32(rate * ch * bits / 8), le16(ch * bits / 8), le16(bits)]); return Buffer.concat([Buffer.from("RIFF"), le32(36 + data.length), Buffer.from("WAVE"), Buffer.from("fmt "), le32(16), fmt, Buffer.from("data"), le32(data.length), data]); };
const FLAC = (rate, ch, total) => { const si = Buffer.alloc(34); const v = BigInt(rate) << 44n | BigInt(ch - 1) << 41n | 15n << 36n | BigInt(total); si.writeBigUInt64BE(v, 10); return Buffer.concat([Buffer.from("fLaC"), Buffer.from([0x80, 0, 0, 34]), si]); };
const box = (t, ...c) => { const body = Buffer.concat(c); return Buffer.concat([be32(8 + body.length), Buffer.from(t), body]); };
const MP4 = (sec, w, h) => box("ftyp", Buffer.from("isom"), be32(512), Buffer.from("isomiso2")) .length && Buffer.concat([box("ftyp", Buffer.from("isom"), be32(512), Buffer.from("isomiso2")),
  box("moov", box("mvhd", Buffer.alloc(4), be32(0), be32(0), be32(1000), be32(sec * 1000), Buffer.alloc(80)),
    box("trak", box("tkhd", Buffer.alloc(80), be32(w * 65536), be32(h * 65536)), box("mdia", box("hdlr", Buffer.alloc(8), Buffer.from("vide"), Buffer.alloc(12)))),
    box("trak", box("tkhd", Buffer.alloc(80), be32(0), be32(0)), box("mdia", box("hdlr", Buffer.alloc(8), Buffer.from("soun"), Buffer.alloc(12))))), box("mdat", Buffer.alloc(16))]);
const MP3 = (frames = 40) => { const id3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), Buffer.from([0, 0, 0, 0x20]), Buffer.concat([Buffer.from("TIT2"), be32(8), Buffer.from([0, 0]), Buffer.from("\0Hello\0")]), Buffer.alloc(32 - 17)]); const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; return Buffer.concat([id3, ...Array.from({ length: frames }, () => f)]); };
const OGG = (rate, ch, granule) => { const head = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(22), Buffer.from("\x01vorbis"), le32(0), Buffer.from([ch]), le32(rate), Buffer.alloc(12)]); const last = Buffer.concat([Buffer.from("OggS"), Buffer.from([0, 4]), Buffer.alloc(8), Buffer.alloc(12)]); last.writeBigUInt64LE(BigInt(granule), 6); return Buffer.concat([head, Buffer.alloc(50), last]); };


export { be32, le32, le16, be16, crc, chunk, PNG, exifBlock, JPEG, GIF, WAV, FLAC, box, MP4, MP3, OGG };
