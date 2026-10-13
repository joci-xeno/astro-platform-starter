// Generates docs/brain_spec/threat_catalog.json and THREAT_MODEL_EREDMENY.md from the executable catalog (atlasz-tests/support/threat-attacks.mjs).
// Usage: node docs/brain_spec/make_threat_catalog.mjs   (offline, fixture only; no network, no cost)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACKS, BENIGN, CLASSES, runAll, expectedObserved } from "../../atlasz-tests/support/threat-attacks.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const observed = await runAll();
const rows = ATTACKS.map(a => { const o = observed.find(x => x.id === a.id); return { id: a.id, class: a.cls, class_name: CLASSES[a.cls], title: a.title, input: a.input ?? null, component: a.component, defense: a.defense, claimed_status: a.status, observed_outcome: o.observed, matches: o.observed === expectedObserved(a.status), remediation_wrk: a.remediation ?? null, note: a.note ?? null }; });
const benign = []; for (const b of BENIGN) benign.push({ id: b.id, title: b.title, passed: await b.run() });
const count = s => rows.filter(r => r.claimed_status === s).length, byClass = {};
for (const r of rows) { byClass[r.class] ??= { name: r.class_name, total: 0, BLOCKED: 0, ESCALATED: 0, CONTAINED: 0, OPEN_GAP: 0 }; byClass[r.class].total++; byClass[r.class][r.claimed_status]++; }
const summary = { total: rows.length, BLOCKED: count("BLOCKED"), ESCALATED: count("ESCALATED"), CONTAINED: count("CONTAINED"), OPEN_GAP: count("OPEN_GAP"), all_claims_match_observation: rows.every(r => r.matches), benign_controls_passed: benign.every(b => b.passed), benign_total: benign.length };
summary.acceptance_all_blocked_or_escalated = summary.OPEN_GAP === 0;
const cat = { work_item: "ATL-WRK-0788", depends_on: "ATL-WRK-0785", planned_module: "ATL-PLN-0116", evidenceState: "FIXTURE", live: false, generated_by: "docs/brain_spec/make_threat_catalog.mjs", summary, by_class: byClass, attacks: rows, benign_controls: benign };
fs.writeFileSync(path.join(here, "threat_catalog.json"), JSON.stringify(cat, null, 1) + "\n");
const gaps = rows.filter(r => r.claimed_status === "OPEN_GAP");
const md = ["# Fenyegetésmodell – mért eredmény (ATL-WRK-0788)", "", "Automatikusan generált: `node docs/brain_spec/make_threat_catalog.mjs`. Minden sor VALÓS komponens ellen futott (FIXTURE; nincs hálózat, nincs költség). A „állított” státuszt a teszt összeveti a mért eredménnyel.", "",
  `**Összesen ${summary.total} támadás:** BLOCKED ${summary.BLOCKED} · ESCALATED ${summary.ESCALATED} · CONTAINED ${summary.CONTAINED} · **OPEN_GAP ${summary.OPEN_GAP}**. Ártatlan kontrollok (nem szabad blokkolni): ${benign.filter(b => b.passed).length}/${benign.length} rendben.`, "",
  `**Elfogadási feltétel „minden dokumentált támadás blokkolva vagy eszkalálva”: ${summary.acceptance_all_blocked_or_escalated ? "TELJESÜLT" : "NEM TELJESÜLT – " + summary.OPEN_GAP + " nyitott hézag"}.**`, "", "## Osztályonként", "", "| Osztály | Összes | BLOCKED | ESCALATED | CONTAINED | OPEN_GAP |", "|---|---|---|---|---|---|",
  ...Object.entries(byClass).map(([k, v]) => `| ${k} – ${v.name} | ${v.total} | ${v.BLOCKED} | ${v.ESCALATED} | ${v.CONTAINED} | ${v.OPEN_GAP} |`), "", "## Nyitott hézagok (a mai kód NEM állítja meg)", "", "| ID | Támadás | Komponens | Lezáró munkatétel |", "|---|---|---|---|",
  ...gaps.map(g => `| ${g.id} | ${g.title.replace(/\|/g, "/")} | ${g.component} | ${g.remediation_wrk} |`), "", "A hézagok javítása a futó rendszer módosítását jelentené; ezt az 1. munkacsomag tiltja, ezért a javítás a megnevezett, külön jóváhagyandó munkatételekre marad. A hézag-tesztek „rögzítik” a mai viselkedést: ha valaki lezár egy hézagot, a teszt elbukik, amíg a katalógus státusza nem frissül.", "",
  "## Teljes lista", "", "| ID | Státusz | Mért | Támadás | Védelem |", "|---|---|---|---|---|", ...rows.map(r => `| ${r.id} | ${r.claimed_status} | ${r.observed_outcome} | ${r.title.replace(/\|/g, "/")} | ${String(r.defense).replace(/\|/g, "/")} |`), ""].join("\n");
fs.writeFileSync(path.join(here, "THREAT_MODEL_EREDMENY.md"), md);
console.log(JSON.stringify(summary));
