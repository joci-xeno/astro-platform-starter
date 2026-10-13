#!/usr/bin/env python3
# Records for the 2A preparation (docs only). Reads threat_catalog.json + brain_work_plan.csv; writes
#   brain_security_gap_register.csv, brain_gap_fix_proposals.csv, brain_2a_dependency_clarification.csv
# Allocates NO ATL ids and changes no existing file. Proposed new tasks carry provisional labels (GAPFIX-n), not ATL ids.
import csv, json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
cat = json.load(open(os.path.join(here, '..', 'brain_spec', 'threat_catalog.json'), encoding='utf-8'))
plan = {r['id']: r for r in csv.DictReader(open(os.path.join(here, 'brain_work_plan.csv'), encoding='utf-8-sig'))}
dep = lambda i: [d.strip() for d in plan[i]['depends_on'].split(';') if d.strip()]

PROPOSALS = [
 ("GAPFIX-1", "guardrail-engine: engedélylista (ismeretlen akciónév = megtagadás) és névkanonizálás hasonmás/szóköz/szinonima ellen", "ATL-SEC-0017 guardrail-engine", "PRV-009; PRV-010", "futó komponens módosítása", "ATL-DEC-0058 + ATL-DEC-0068 (runtime-release)", "a negatív teszt PRV-009/010 BLOCKED-et vár és a meglévő guardrail-tesztek zöldek"),
 ("GAPFIX-2", "reasoning-common.callModel: kimenő prompt titokmentesítése a modellhívás előtt (minden hívóra, nem csak a Gatewayre)", "ATL-BRN-0031 reasoning-common", "LEK-009", "futó komponens módosítása", "ATL-DEC-0058 + ATL-DEC-0068 (runtime-release)", "a spy-adapter nem láthat kulcsszerű szöveget a promptban"),
 ("GAPFIX-3", "agent-memory: magyar utasításszerű jegyzetek elutasítása (looksLikeInstruction magyar + ékezetmentes minták)", "agent-memory (ATL-WRK-0016 'Részleges' komponens)", "MEM-002", "futó komponens módosítása", "ATL-DEC-0058 + ATL-DEC-0068 (runtime-release)", "MEM-002 BLOCKED, ártatlan jegyzet (BEN-004) továbbra is eltárolható"),
 ("GAPFIX-4", "security-brain: költségminta alapvonal nélkül (első nagy költés) → jóváhagyási küszöb / büdzsé-ellenőrzés", "ATL-SEC-0008 security-brain", "CST-007", "futó komponens módosítása", "ATL-DEC-0058 + ATL-DEC-0068 (runtime-release)", "CST-007 ESCALATED vagy BLOCKED"),
 ("GAPFIX-5", "human-core: ékezetmentes bevitel felismerése a krízis-, szomorúság- és nyomás-jelzésekben (ideiglenes javítás a 0824 motor előtt; biztonsági prioritás)", "human-core (ATL-WRK-0031 'Részleges' komponens); ATL-WRK-0794 normalizáló", "EMO-013; EMO-015", "futó komponens módosítása", "ATL-DEC-0058 + ATL-DEC-0068 (runtime-release)", "EMO-013/015 ESCALATED; ártatlan szöveg nem jelez hamisan"),
]
M = {  # gap -> (original_adequacy, corrected_primary, corrected_note, target_expectation, gateway_2a_interaction)
 'INJ-006': ('PARTIAL', 'ATL-WRK-0803', 'hatáskör-bővítés: bemeneti (külső szöveg) tekintély-állítás jelzése, nem csak modell-kimenet', 'ESCALATED', 'Gateway: külső tartalom EXTERNAL_CONTENT = csak adat, hívó nem lehet; a hézag a komponensben marad'),
 'LEK-010': ('PARTIAL', 'ATL-WRK-0803', 'hatáskör-bővítés: távoli URL/kép-kiszivárogtatás jelzése szövegrétegben; a UI-megjelenítés védelme külön igazolandó', 'ESCALATED', 'nincs'),
 'PRV-009': ('WRONG_TASK', 'GAPFIX-1', 'az eredeti hozzárendelés (0789 Gateway) nem javítja a guardrail-engine-t', 'BLOCKED', 'Gateway act: engedélylista a Gateway hívóira; NEM zárja a komponens-hibát'),
 'PRV-010': ('WRONG_TASK', 'GAPFIX-1', 'ugyanaz', 'BLOCKED', 'ugyanaz'),
 'LEK-009': ('PARTIAL', 'GAPFIX-2', 'a 0790 csak a Gateway hívóit védi; a callModel közvetlen hívói (3 következtető motor) maradnak', 'BLOCKED', 'Context Builder (0790): kitakarás a Gateway útvonalon; NEM zárja a komponens-hibát'),
 'CST-007': ('PARTIAL', 'GAPFIX-4', 'a 0802 költségszámlálás, de az első-minta logika a security-brainben van', 'ESCALATED', 'Gateway: alapért. maxCostUsd=0 → minden fizetős hívás tiltott; NEM zárja a komponens-hibát'),
 'CST-010': ('ADEQUATE', 'ATL-WRK-0802', "a leírás kimondja: 'ismeretlen költség sosem nulla'; függ: ATL-WRK-0801", 'BLOCKED', 'Gateway: ismeretlen költség = BUDGET_EXCEEDED/megtagadás a Gateway útvonalon; NEM zárja a komponens-hibát'),
 'EMO-013': ('WRONG_TASK', 'GAPFIX-5', 'a 0829 értékelő/teszt tétel, nem javítás', 'ESCALATED', 'nincs'),
 'EMO-015': ('WRONG_TASK', 'GAPFIX-5', 'a 0829 értékelő/teszt tétel, nem javítás; biztonsági prioritás', 'ESCALATED', 'nincs'),
 'EMO-016': ('WRONG_TASK', 'ATL-WRK-0824', 'bizonytalansági érték + több fordulós követés; a 0829 csak mér', 'ESCALATED', 'nincs'),
 'MEM-002': ('WRONG_TASK', 'GAPFIX-3', 'a 0803 modell-kimenet védelem, nem memória-írás szűrő', 'BLOCKED', 'nincs'),
}
for k in ('INJ-008','INJ-009','INJ-010','INJ-011','INJ-012','INJ-013','INJ-014'):
    M[k] = ('PARTIAL', 'ATL-WRK-0803', 'hatáskör-bővítés: bemeneti injekció-osztályozás magyarul és ékezetmentesen (security-brain), parafrázis-álló; ékezet-normalizálás: ATL-WRK-0794', 'BLOCKED', 'Gateway: bemeneti szűrés a Gateway hívóira; NEM zárja a komponens-hibát')
for k in ('EMO-005','EMO-006','EMO-007','EMO-008','EMO-009','EMO-010','EMO-011'):
    M[k] = ('WRONG_TASK', 'ATL-WRK-0803', "a leírás: 'emberi érzelem birtoklásának állítása (HU+EN, parafrázis-álló) tiltva' – ez a javítás; a 0829 csak utólagos parafrázis-teszt", 'BLOCKED', 'Gateway: kimenő assertNoFalseClaims-átjáró a Gateway útvonalon; NEM zárja a komponens-hibát')

CLOSURE = ("ZÁRT csak ha: (1) a komponens-javítás saját tulajdonosi jóváhagyással megtörtént; (2) a CÉL-negatív teszt a valós komponens ellen a védett kimenetet (BLOCKED/ESCALATED) várja és megfelel; "
           "(3) az ártatlan kontrollok (BEN-001..006) zöldek; (4) a mai rögzítő (jellemző) teszt átfordítva és a katalógus-státusz frissítve; (5) a tulajdonos megerősíti. "
           "A mai zöld teszt a hibás viselkedést RÖGZÍTI, nem igazolja a védelmet.")
rows = []
for a in cat['attacks']:
    st = a['claimed_status']
    if st not in ('OPEN_GAP', 'CONTAINED'): continue
    if st == 'OPEN_GAP':
        oa, prim, note, tgt, gw = M[a['id']]
        rows.append([a['id'], a['class_name'], a['title'], 'VÉDELEM HIÁNYOS (DEFENSE_DEFICIENT)', 'IGEN', a['component'], a['remediation_wrk'] or '', oa, prim, note,
                     f"{a['id']} (cél-állapot): {tgt}", 'brain-threat-negative.test: ' + a['id'] + ' ma OPEN_GAP-et rögzít', gw, 'IGEN – futó komponens módosítása', 'ATL-DEC-0058 + ATL-DEC-0068 (runtime-release)', CLOSURE])
    else:
        rows.append([a['id'], a['class_name'], a['title'], 'ENYHÍTVE, NEM BLOKKOLVA (MITIGATED_NOT_BLOCKED)', 'NEM (eldöntendő)', a['component'], '', 'n/a', 'TULAJDONOSI DÖNTÉS', "El kell dönteni: elegendő-e a megbízhatatlan-adat címkézés (untrusted + prov-agent + kerítés), vagy blokkolás kell. Addig nem 'megfelelő'.", 'MEM-' + a['id'][-3:] + ': döntés szerint', 'ma CONTAINED-et rögzít', 'nincs', 'döntéstől függ', 'ATL-DEC-0058', 'Tulajdonosi döntés rögzítése; ha blokkolás kell, külön javítási tétel.'])
hdr = ['gap_id','osztaly','hezag','jelenlegi_minosites','komponens_hiba_nyitott','komponens','eredeti_javitasi_tetel_0788','eredeti_hozzarendeles_megfelelosege','javitott_javitasi_tetel','javitott_hozzarendeles_megjegyzes','cel_negativ_teszt','mai_rogzito_teszt','2A_kapcsolat_nem_zaras','futo_rendszer_modositas','jovahagyasi_kapu','lezarasi_szabaly']
with open(os.path.join(here,'brain_security_gap_register.csv'),'w',newline='',encoding='utf-8-sig') as f:
    w = csv.writer(f); w.writerow(hdr); w.writerows(rows)
with open(os.path.join(here,'brain_gap_fix_proposals.csv'),'w',newline='',encoding='utf-8-sig') as f:
    w = csv.writer(f); w.writerow(['ideiglenes_cimke','javasolt_tetel','komponens','lezart_hezagok','jelleg','kapu','elfogadasi_kriterium','ATL_azonosito']); [w.writerow(list(p)+['NINCS KIOSZTVA – tulajdonosi jóváhagyás kell a főkönyvi kiosztáshoz']) for p in PROPOSALS]

# ---- dependency clarification (build-time vs bind-time) and closure proof
TWOA = ['ATL-WRK-0789','ATL-WRK-0792','ATL-WRK-0791','ATL-WRK-0790','ATL-WRK-0793']
DONE = {'ATL-WRK-0785','ATL-WRK-0787','ATL-WRK-0788'}
D = {
 'ATL-WRK-0789': ('ATL-WRK-0785', 'ATL-WRK-0786', 'Gateway szerződés-megvalósítás, jogosultság, hibakódok, audit, degradálás; Brain-rendszer BEFECSKENDEZVE (gyárfüggvény, tmp könyvtár vagy fake); broker: tesztlokális példány', 'Ráépítés a TÉNYLEGES futó Brain-példányra / közös állapotmappára; az egyetlen megosztott példány', 'RÉSZBEN: az A-szakasz (befecskendezett) kész; "Minden fogyasztó egy API-n át" csak a kötés után teljesül'),
 'ATL-WRK-0792': ('ATL-WRK-0789', '', 'Degradált-állapot objektum és szabályalapú válaszok, "MODELL NINCS BEKÖTVE" jelzés a Gateway válaszában', 'Megjelenítés "minden felületen" (Control Center, AURÓRA UI)', 'RÉSZBEN: szerződés és Gateway-válasz kész; felületi bekötés a kötési szakaszban'),
 'ATL-WRK-0791': ('ATL-WRK-0789', '', 'Verziózott, hash-elt, auditált prompt-készlet; változtatás csak aláírt jóváhagyással (tesztkulcs, offline)', 'Éles prompt-használat a modell-hívásokban', 'IGEN (a könyvtár és változásnapló kész; használat a Gateway-en belül tesztelve)'),
 'ATL-WRK-0790': ('ATL-WRK-0789', '', 'Kontextus-csomag építés befecskendezett forrásokból (memória, állapot, preferencia, persona, jogosultság), titokszűrés, token-keret, forrásjelölés', 'Valódi memória/állapot-források bekötése (pl. ATL-WRK-0819)', 'RÉSZBEN: reprodukálható csomag fake forrásokkal bizonyítva; "minden Brain-híváshoz" a kötés után'),
 'ATL-WRK-0793': ('ATL-WRK-0789', '', 'Előfizetők tesztlokális Brain-buszon (createBrainBus + createBrainSystem tmp könyvtárban), hurokvédelem, ACL', 'Előfizetés a FUTÓ rendszer buszára', 'RÉSZBEN: koordináció bizonyítva ugyanazzal a kóddal, de nem a futó példányon'),
}
rows2 = []
for t in TWOA:
    declared = plan[t]['depends_on']; bt, bind, delivered, deferred, acc = D[t]
    # build-time deps must be in DONE or in TWOA (closure), never 0786/0003/0004/0005
    bad = [d for d in [x for x in [bt] if x] if d not in DONE and d not in TWOA]
    if bad: sys.exit('2A closure violated: ' + t + ' ' + str(bad))
    rows2.append([t, plan[t]['title'], declared, bt, bind, delivered, deferred, plan[t]['acceptance'], acc, plan[t]['est_total_h']])
with open(os.path.join(here,'brain_2a_dependency_clarification.csv'),'w',newline='',encoding='utf-8-sig') as f:
    w = csv.writer(f); w.writerow(['atl','cim','tervben_deklaralt_fuggoseg','epitesi_idoben_szukseges','kotesi_idoben_szukseges_0786_utan','2A_szakaszban_leszallitott','kotesi_szakaszra_halasztott','tervezett_elfogadasi_kriterium','elfogadas_2A_utan','becsult_ora']); w.writerows(rows2)
# acyclicity + closure proof on the declared graph with the clarification applied
eff = {t: [d for d in [D[t][0]] if d] for t in TWOA}
order = []; seen = set()
def visit(n, stack=()):
    if n in stack: sys.exit('cycle ' + str(stack + (n,)))
    if n in seen or n in DONE: return
    for d in eff.get(n, []): visit(d, stack + (n,))
    seen.add(n); order.append(n)
for t in TWOA: visit(t)
print('2A topological order:', order)
print('hours total:', sum(int(plan[t]['est_total_h']) for t in TWOA))
from collections import Counter
print('gap rows:', len(rows), Counter(r[7] for r in rows))
print('forbidden deps in effective 2A graph:', [d for t in TWOA for d in eff[t] if d in ('ATL-WRK-0786','ATL-WRK-0003','ATL-WRK-0004','ATL-WRK-0005')])
