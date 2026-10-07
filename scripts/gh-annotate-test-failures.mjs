// Turns node:test TAP output into GitHub annotations (::error) so failures are visible even when raw logs are not downloadable. Read-only; no network.
import fs from "node:fs";
const text = fs.readFileSync(process.argv[2], "utf8").replace(/\r/g, ""), lines = text.split("\n"), out = [];
const esc = s => s.replace(/%/g, "%25").replace(/\n/g, "%0A").slice(0, 900);
lines.forEach((l, i) => {
  const m = /^\s*not ok \d+ - (.*)$/.exec(l); if (!m) return;
  const detail = []; for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) { if (/^\s*(ok|not ok) \d+/.test(lines[j])) break; if (/error:|code:|location:|actual|expected|Error/.test(lines[j]) || /^\s{4,}\S/.test(lines[j])) detail.push(lines[j].trim()); }
  out.push(`::error title=${esc(m[1]).replace(/[:,]/g, " ").slice(0, 120)}::${esc(detail.slice(0, 8).join(" | "))}`);
});
console.log(out.length ? out.join("\n") : "::notice::no 'not ok' lines found in test output"); 
