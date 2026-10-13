# ATLASZ központi azonosító-nyilvántartás

Csak nyilvántartás – a futó rendszer kódját nem módosítja. Az azonosító nem jelent kész állapotot.

* `RENDSZERLELTAR_JELENTES.md` – ember által olvasható magyar jelentés.
* `atlasz_id_registry.json` / `atlasz_id_registry.sqlite` – géppel feldolgozható teljes nyilvántartás (rendszerelemek, követelmények, 85/23/150 tételek, kapcsolatok, régi azonosítók, napló).
* `components.csv`, `requirements.csv`, `requirement_component_links.csv`, `legacy_id_map.csv`, `source_sets_85_23_150.csv`, `id_ledger.csv`, `requirements_without_component.csv`, `components_without_requirement.csv`, `work_list.csv`.
* `id_ledger.json` – tartós kiosztási főkönyv (természetes kulcs → ATL-azonosító). **Soha nem szerkesztendő kézzel; azonosító nem osztható ki újra.**
* `history.jsonl` – csak hozzáfűzhető változásnapló (kiosztás, visszavonás, névváltozás).
* `build_identity_registry.py`, `render_identity_report.py` – újraépítés a repó gyökeréből: `python3 docs/identity_registry/build_identity_registry.py && python3 docs/identity_registry/render_identity_report.py`.

Későbbi javítás/módosítás ugyanahhoz az ATL-azonosítóhoz kapcsolódik; a `history.jsonl`-be új sor kerül (mi változott, melyik commitban, mely követelményt érinti, mely tesztek futottak, előző/új állapot, ki hagyta jóvá).


> **2. kiadás:** a kibővített leltár (tervezett modulok, direktíva-sorok, munkaterv, órabecslés, korrekciók) a `docs/system_inventory/` mappában van; az itteni v1 fájlok történeti pillanatképek (az azonosítók érvényesek maradnak).
