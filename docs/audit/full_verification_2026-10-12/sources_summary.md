# Források és nyilvántartások ellenőrzése: 85 + 23 + 150 (olvasás-csak audit)

Repó: /home/claude/atlasz/src, HEAD 246dd68 (a repó nem módosult). Kimenet: out_sources_85_23_150.json (258 sor, mezők a PROTOCOL.md szerint + source, evidenceLevel, name).

## (a) Megvan-e a tételes forrás?
| Lista | Eredeti szöveg a repóban? | Tételes lista | Hol |
|---|---|---|---|
| 85 | NEM (az eredeti direktíva nincs a repóban) | IGEN, 85 azonosító (M01-M13, C01-C13, G01-G13, GE01-GE13, A01-A13, P01-P20), leírás+státusz+bizonyíték | docs/atlasz_capability_audit_85.json/.csv/.md; docs/capabilities/reconciliation_85.json (elavult) |
| 23 | NEM | RÉSZBEN: csak 23 rövid cím + egysoros státusz kézzel beírva (docs/audit/unified_audit.py `p23`, ATLASZ_V73_UNIFIED_AUDIT.md §4); az eredeti 23 pont követelményrészletei (alpontok, biztonsági kapuk 1-12) a repóban NINCSENEK | a repóban csak hivatkozások (p23_refs, "23-point item N" a modulfejlécekben) |
| 150 | NEM | IGEN, 150 azonosító (S01-S15, AS, OP, SN, HK, MR, GR, GE, O5xx, S5xx) leírással | docs/audit/pkg150_source_ids.json, pkg150_traceability.csv, pkg150_status.csv |

A repón KÍVÜL megtaláltam az eredeti beküldött szövegeket (a munkamenet feltöltései), és ezekkel vetettem össze a repó listáit: /root/.claude/uploads/<session>/
- 5fc6d187-attachment.txt = 85-ös direktíva (85 azonosító, a repó audit-azonosítóival egyező halmaz)
- 53bfb152-__ATLASZ_V7.3___MASTER_DEVELOPMENT232323.txt = 23 pontos direktíva (23 fejezet + 12 biztonsági kapu)
- 08c729c0-__ATLASZ___MASTER_DEVELOPMENT_DIREC_150.txt = 150-es direktíva (150 azonosító, a repó pkg150_source_ids.json-nal egyező halmaz)
Megjegyzés: a 23 pontnál a repó nyilvántartása a forrást nem tartalmazza, ezért a 23 sor a kimenetben az uploads-fájlra hivatkozik. A 12 biztonsági elfogadási kaput (Security acceptance gates) külön sorként NEM vettem fel (a 23 pont részét képezik a 22. pont alatt).

## (b) Státusz-eloszlás (PROTOCOL.md státuszkészlet)
- CAP85 (85): EXTERNAL_BLOCKER 22, PARTIAL 52, STRUCTURAL_ONLY 2, VERIFIED_WORKING 9
- SEC23 (23): PARTIAL 21, VERIFIED_WORKING 2
- IDEA150 (150): EXTERNAL_BLOCKER 15, MISSING 1, PARTIAL 123, STRUCTURAL_ONLY 8, VERIFIED_WORKING 3
- Összesen 258: EXTERNAL_BLOCKER 37, MISSING 1, PARTIAL 196, STRUCTURAL_ONLY 10, VERIFIED_WORKING 14
- 150-es halasztott (deferred:true): 16 tétel (külső szolgáltatóhoz kötött vagy nincs kód: S01, S13, HK09, MR10, GR01, GR02, GR06, GR07, GR09, GR12, GR13, GR14, GE06, GE08, GE12, S506). A többi 134 tétel aktiválva van (64db7065 direktíva, a "begin the 150-capability development phase" mondattal), de a hatókörük nem teljes.
- Egyetlen tétel sem LIVE: nincs élő szolgáltató, kulcs, Windows-futás (live_verified_items = 0 a gap registerben is).
- Teszt: a kapcsolódó teszt-fájlok mind ok a gate_results.json szerint (245 fájl, 0 hibás); 17 sor "nincs teszt" (kód nélküli/külső tételek).

## (c) Ellentmondások a nyilvántartások és a kód között
Az 85-ös nyilvántartás saját besorolását 11 tételnél felülbíráltam:
- CAP85-M01: nyilvántartás MISSING -> STRUCTURAL_ONLY
- CAP85-M13: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-C02: nyilvántartás PARTIAL -> STRUCTURAL_ONLY
- CAP85-C09: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-C10: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-A07: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-P02: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-P04: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-P13: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-P15: nyilvántartás VERIFIED_WORKING -> PARTIAL
- CAP85-P18: nyilvántartás VERIFIED_WORKING -> PARTIAL
Okok (összefoglalva): VERIFIED_WORKING túl jó bizonyítékhoz képest:
1. M13/C09 (interaktív artefaktum): a render.mjs csak statikus, szkriptmentes SVG/szöveget állít elő (checkSvgSafe tiltja a script/eseménykezelőt); nincs interaktív előnézet, és a render.* op-ot az app.js nem hivatkozza (nincs UI).
2. C10 (adaptív érvelés-allokáció): az effort-allocation csak a workbench-ből hívható; a cost-model-router/model-gateway nem használja (grep: egyetlen importáló sem), tehát nincs bekötve az élő routerbe.
3. A07/P18/P15: tisztán leíró/séma/tanácsadó kód (guidance.*, annotációk, detail.choose), mögötte nincs képernyő/multimodális feldolgozás, és az app.js nem hivatkozza őket.
4. P02/P13: csak a tulajdonos által megadott átirat/oldalszöveg; videó- illetve weblap-letöltés nincs (a követelmény "videók"/"weboldalak").
5. P04: 4 sablonból épít, szabad-formájú ötlet->kód modell nélkül nincs.
6. A "független R5/R6 verifikáció" a nyilvántartásban alügynökök állítása; a tulajdonos nem erősítette meg, ezért a megmaradt 9 VERIFIED_WORKING (C05, C11, C12, C13, P03, P05, P06, P08, P11) is csak a teszt-zöld + kód + bekötés alapján áll.

Elavult / egymásnak ellentmondó dokumentumok:
- M01 "MISSING" az audit_85-ben, de a repóban van MV3 bővítmény (browser-extension/) + browser-extension-guard + teszt. Viszont az /api/extension/assist route NINCS mountolva a Control Center szerverben (grep: csak a bővítmény és a guard említi), bővítmény böngészőben nem futott -> STRUCTURAL_ONLY (a MR01, MR02, MR13, MR15, HK14 ugyanezért).
- C01 "no code EDIT workflow" és C06 "MCP transport absent" elavult: code-edit-workflow.mjs (+m2 teszt) és mcp-client.mjs (+mcp-hosted teszt) létezik.
- docs/capabilities/reconciliation_85.json régebbi állapot: M07, C01, P01, P02, P04, P13, P15, P18, A07 még MISSING; ellentmond az audit_85-nek.
- ATLASZ_V73_UNIFIED_AUDIT.md §4 (23 pont): a 2, 6, 7, 9, 10, 16 pontot MISSING-nek mondja, de a kód létezik és tesztelt (quarantine/malware-scanner, local-ai-manager, chat-providers (21 platform, a kért 15 mind benne), memory-store FTS5+RRF, agent-coordination). A 9. pont (FTS5) a node:sqlite FTS5-tel ezen a gépen ténylegesen működik (próbával ellenőrizve) -> VERIFIED_WORKING.
- pkg150_status.csv: a 33 "IMPLEMENTED_TESTED_NOT_CONNECTED" modul "connected: NO", de 2026-10-12-től broker typed tool (registrations/tools.mjs, safety.mjs); az ügynöki hívásuk a D12 tulajdonosi döntésig tiltott, Control Center nézetük nincs. OP02 és S03 "NOT_STARTED/absent", miközben a code-edit-workflow létezik. SN01/S501 a campaign-managerre van leképezve, de az nem fejlesztő-ügynök és nem broker-regisztrált.
- docs/atlasz_master_gap_register.json: "orphan_modules" 6 db (a11y-audit, digital-twin, evidence-record, handoff-ledger, tenant-isolation, a11y-worker); az importgráf szerint ma csak 3 modul nincs a core/server/supervisor gráfon (a11y-worker, alt-solution-harness, history-scan-patterns); a többit a 10-12-i broker-regisztráció importálja. A register 10-09-i, elavult.
- Modell-registry: 14 szolgáltató van; a kért 13 mind benne, plusz egy nem kért "merlin" placeholder hosttal (api.merlin.example).
- Vault: a backup/restore és auto-lock modulszinten megvan, de a vault-panel UI-n nincs (set/delete/revoke/lock/verify van). A memória (23/8): a kért MEMORY.md + memory/YYYY-MM-DD.md elrendezés nincs, helyette egy-jegyzet-egy-fájl Markdown.
- Repóban kóbor .claude/worktrees/* másolatok vannak a forrásfájlokról (zajt okoznak grep-nél; nem módosítottam).

## Korlátok
- A 150-es tételeknél a PARTIAL_PRE_EXISTING (95) státuszokat a ledger modul-listájára építettem; ezeknél csak modul-szintű automatikus ellenőrzés (létezés, importgráf, broker, gate) történt, tétel-szintű kézi kódolvasás nem (evidenceLevel mezőben jelölve).
- Nincs Windows, élő modell, szkenner (clamscan/ollama nincs telepítve), külső hálózat; ezek miatt a 37 EXTERNAL_BLOCKER és az éles működés nem ellenőrizhető.
