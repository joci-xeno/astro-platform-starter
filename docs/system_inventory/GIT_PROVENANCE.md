# GIT-VERZIÓ ÉS EREDET (PROVENANCE) – ATLASZ AURÓRA V7.3 nyilvántartás

*Rögzítve: 2026-10-12, a javítás commit (`2b3d581`) elküldése után. Csak nyilvántartás; kódváltozás nincs.*

## 1. Melyik commitból készült a leltár?

| kérdés | válasz |
|---|---|
| Központi azonosító-regiszter (v1, 898 komponens) | `df9ab5e` (`docs(registry)…`) |
| A v2 leltár **kiinduló kód-állapota** (a generátor ezt a HEAD-et olvasta: ezért szerepel a fájlokban `git_head: df9ab5e`, és az akkor kiosztott v2 azonosítók `first_seen_commit: df9ab5e`; a javító körben kiosztott 8 új azonosítóé `b5870e8`) | `df9ab5e` |
| A v2 leltár fájljait **tartalmazó** commit (az átadási jelentés ezt hivatkozta) | `b5870e8` |
| A javító (nyilvántartási korrekció) commit | `2b3d581` |
| Ez a két dokumentum (GIT_PROVENANCE.md, HANDOVER_MANIFEST.csv) | a javító commitot követő, csak-docs commit (lásd `git log -1 -- docs/system_inventory/GIT_PROVENANCE.md`) |

Magyarázat az eltérésre: `df9ab5e` és `b5870e8` **között nincs kódváltozás** – a `b5870e8` kizárólag a docs/ alatti v2 leltárt adta hozzá. A leltár tehát a `df9ab5e` kód-állapotra vonatkozik; a `b5870e8` az a commit, amelyben a leltár fájljai megjelentek. Mindkét címke helyes, más-más dolgot jelöl.
A `docs/` kívüli különbség `df9ab5e`..HEAD között: **nincs (0 fájl)**.

## 2. Helyi és távoli ág

- helyi `atlasz-v73-integration`: `2b3d581dc86b1259e8046e473f2dbd79ceac1178`
- távoli `github/atlasz-v73-integration`: `2b3d581dc86b1259e8046e473f2dbd79ceac1178`
- egyezés a verifikáláskor: **IGEN**
- A Stop-hook „nincs távoli ág” üzenete téves riasztás: az elavult `origin`-t nézi; a hivatalos távoli: `github`.

## 3. A korábbi 898 ATL azonosító

- v1 ledger-kulcsok (`df9ab5e`): 3015; ebből elveszett vagy más azonosítót kapott: **0**
- 898 komponens (`df9ab5e` → HEAD): átnevezett/megváltozott azonosító: **0**; v1 forrás-CSV-k (components, requirements, source_sets, links, work_list) változatlanok: **IGEN**
- a ledger összes azonosítója egyedi: **IGEN** (16983 azonosító)
- `history.jsonl` csak bővült (3015 → 16996 sor), a korábbi sorok változatlanok: **IGEN**

## 4. `main` ág

- távoli `main` (ha van): `b506c42e9237c352eced4985db7072773dde9c55`
- a javító commitot tartalmazó távoli ágak: `github/atlasz-v73-integration`
- `main` módosítása / push `main`-re: **nem történt** (kizárólag `git push github atlasz-v73-integration:atlasz-v73-integration`, force nélkül).

## 5. Legutóbbi commitok

```
2b3d581 2026-10-12 docs(inventory): owner registry correction round - FUT-0141 planned module, 54 work-row links, provenance fixes (records only, no code change)
b5870e8 2026-10-12 docs(inventory): expanded full system inventory v2 - planned modules, requirement matrix, work plan (records only, no code change)
df9ab5e 2026-10-12 docs(registry): central permanent ATL identifier registry and full system inventory (records only, no code change)
2e3e9e2 2026-10-12 docs(audit): full 23-chapter verification report and registry (records only, no code change)
246dd68 2026-10-12 Financial and revenue engine v2: Vancouver day, ABOVE_MINIMUM, documented-rate conversion, owner-attested cost completeness, event-time refunds/chargebacks, NET_PROFIT stage authority, webhook receiver; gate 2237/2237
7fd895f 2026-10-12 Fix lost hand-offs between processes (locked read-modify-write) and audit-chain open/reload race; concurrency/interruption/corruption tests incl. 5 real processes; gate 2205/2205
```

## 6. F-03 – a megnevezett fájlok állapota

| fájl | létezik | olvasható | bájt | sorok | utolsó commit | verzió |
|---|---|---|---|---|---|---|
| docs/system_inventory/atl_query.py | IGEN | IGEN | 7208 | 92 | b5870e8 | IGEN |
| docs/system_inventory/config_files.csv | IGEN | IGEN | 6168 | 41 | b5870e8 | IGEN |
| docs/system_inventory/corrections_to_v1.csv | IGEN | IGEN | 3021 | 11 | b5870e8 | IGEN |
| docs/system_inventory/directive_items.csv | IGEN | IGEN | 4210704 | 12476 | 2b3d581 | IGEN |
| docs/system_inventory/findings.csv | IGEN | IGEN | 57082 | 302 | 2b3d581 | IGEN |
| docs/system_inventory/owner_decisions.csv | IGEN | IGEN | 15114 | 57 | 2b3d581 | IGEN |
| docs/system_inventory/sources.csv | IGEN | IGEN | 22920 | 159 | b5870e8 | IGEN |

Teljes átadási manifest: `HANDOVER_MANIFEST.csv` (49 fájl; nem létező vagy nem olvasható: **0**). A `sha256_committed_blob` a Gitben tárolt (LF) tartalom hash-e; a `sha256_working_copy` a lemezen lévő (esetleg CRLF) fájlé – ezért térhetnek el.

## 7. A regiszter összesített darabszámai (atlasz_system_inventory.json)

```
{
 "inventory_items": 1047,
 "existing_components": 950,
 "planned_modules": 97,
 "requirement_rows": 2117,
 "directive_items": 12476,
 "sources": 159,
 "config_files": 41,
 "work_items": 784,
 "findings": 302,
 "decisions": 57
}
```
