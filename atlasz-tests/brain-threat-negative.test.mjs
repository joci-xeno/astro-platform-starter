// ATL-WRK-0788 – Brain negative test set (fixture). Runs every documented attack against the REAL defensive components and compares the
// observed outcome with the catalogue claim. No network, no spend, no credentials; nothing in the running system is modified or wired.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACKS, BENIGN, CLASSES, STATUSES, expectedObserved } from "./support/threat-attacks.mjs";
import { installNetworkGuard } from "./support/fake-model-adapters.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerText = fs.readFileSync(path.join(root, "docs/identity_registry/id_ledger.json"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "docs/brain_spec/threat_catalog.json"), "utf8"));
const guard = installNetworkGuard();
test.after(() => { guard.restore(); });

for (const a of ATTACKS) {
  test(`${a.id} [${a.status}] ${a.title}`, async () => {
    const observed = await a.run();
    assert.equal(observed, expectedObserved(a.status),
      a.status === "OPEN_GAP" ? `${a.id}: a hézag megszűnt vagy megváltozott (mért: ${observed}) – frissítse a katalógus státuszát és futtassa a make_threat_catalog.mjs-t`
        : `${a.id}: a védelem nem azt teszi, amit a katalógus állít (mért: ${observed}, állított: ${a.status})`);
  });
}
for (const b of BENIGN) test(`${b.id} ártatlan kontroll: ${b.title}`, async () => { assert.equal(await b.run(), true); });

test("katalógus: mind a 6 kötelező osztály jelen van, osztályonként legalább 6 támadás", () => {
  for (const k of ["INJ", "PRV", "LEK", "CST", "EMO", "MEM"]) { assert.ok(CLASSES[k]); assert.ok(ATTACKS.filter(a => a.cls === k).length >= 6, k); }
  assert.deepEqual([...new Set(ATTACKS.map(a => a.cls))].sort(), Object.keys(CLASSES).sort());
});
test("katalógus: egyedi azonosítók, érvényes státuszok, mindegyiknél védelem- és komponensleírás", () => {
  const ids = ATTACKS.map(a => a.id); assert.equal(new Set(ids).size, ids.length);
  for (const a of ATTACKS) { assert.match(a.id, /^(INJ|PRV|LEK|CST|EMO|MEM)-\d{3}$/); assert.ok(STATUSES.includes(a.status), a.id); assert.ok(a.title.length > 5 && a.defense.length > 3 && a.component, a.id); assert.equal(typeof a.run, "function"); }
});
test("minden OPEN_GAP-hez létező ATL munkatétel tartozik (nincs gazdátlan hézag), a nem-hézagokhoz nem kell", () => {
  for (const a of ATTACKS.filter(x => x.status === "OPEN_GAP")) { assert.match(a.remediation ?? "", /^ATL-WRK-\d{4}$/, a.id); assert.ok(ledgerText.includes(a.remediation), a.id + " → " + a.remediation + " nincs a főkönyvben"); }
});
test("a nyitott hézagok rögzítve vannak, nem elrejtve: a magyar nyelvű és a költség-hézagok szerepelnek", () => {
  const gaps = ATTACKS.filter(a => a.status === "OPEN_GAP").map(a => a.id);
  for (const id of ["INJ-008", "INJ-009", "EMO-005", "EMO-015", "MEM-002", "PRV-009", "LEK-009", "CST-010"]) assert.ok(gaps.includes(id), id);
});
test("a threat_catalog.json szinkronban van a végrehajtható katalógussal (nem avulhat el)", () => {
  assert.deepEqual(catalog.attacks.map(a => [a.id, a.claimed_status]), ATTACKS.map(a => [a.id, a.status]));
  assert.equal(catalog.summary.total, ATTACKS.length); assert.equal(catalog.evidenceState, "FIXTURE"); assert.equal(catalog.live, false);
  for (const s of STATUSES) assert.equal(catalog.summary[s], ATTACKS.filter(a => a.status === s).length, s);
});
test("elfogadási jelentés igaz: 'minden támadás blokkolva/eszkalálva' csak akkor igaz, ha nincs nyitott hézag", () => {
  const gaps = ATTACKS.filter(a => a.status === "OPEN_GAP").length;
  assert.equal(catalog.summary.acceptance_all_blocked_or_escalated, gaps === 0);
  const md = fs.readFileSync(path.join(root, "docs/brain_spec/THREAT_MODEL_EREDMENY.md"), "utf8");
  assert.ok(md.includes(gaps === 0 ? "TELJESÜLT" : "NEM TELJESÜLT"));
  const doc = fs.readFileSync(path.join(root, "docs/brain_spec/THREAT_MODEL.md"), "utf8");
  assert.ok(doc.includes(String(ATTACKS.length) + " támadás") && doc.includes(gaps + " támadás nyitott hézag"), "a dokumentum számai egyeznek a katalógussal");
});
test("a fenyegetésmodell hivatkozásai (ATL, elvek) érvényesek", () => {
  const doc = fs.readFileSync(path.join(root, "docs/brain_spec/THREAT_MODEL.md"), "utf8");
  for (const id of new Set(doc.match(/ATL-[A-Z]{3}-\d{4}/g))) assert.ok(ledgerText.includes(id), id);
  for (const p of ["P1", "P2", "P7", "P8", "P9"]) assert.ok(doc.includes(p));
});
test("a teljes negatív készlet hálózat nélkül futott", () => { assert.deepEqual(guard.hits, []); });
