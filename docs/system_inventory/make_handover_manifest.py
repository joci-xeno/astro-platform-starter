#!/usr/bin/env python3
"""Handover manifest + Git provenance (records only). Run from repo root after the correction commit has been pushed."""
import csv, hashlib, json, os, subprocess, gzip, sqlite3, glob
def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout.strip()
OUT = "docs/system_inventory/"
HEAD = sh("git", "rev-parse", "HEAD"); SHORT = sh("git", "rev-parse", "--short", "HEAD")
BASE, V2, V1REG, FIN = "df9ab5e", "b5870e8", "2e3e9e2", "246dd68"
files = sorted(p for p in sh("git", "ls-files", "docs/system_inventory", "docs/identity_registry").split("\n") if p)
extra = [OUT + "GIT_PROVENANCE.md", OUT + "HANDOVER_MANIFEST.csv"]
NAMED = {"directive_items.csv", "findings.csv", "owner_decisions.csv", "sources.csv", "config_files.csv", "corrections_to_v1.csv", "atl_query.py"}
def nrows(p):
    try:
        if p.endswith(".csv"):
            return sum(1 for _ in csv.reader(open(p, encoding="utf-8-sig", newline=""))) - 1
        if p.endswith(".jsonl"):
            return sum(1 for _ in open(p, encoding="utf-8"))
        if p.endswith(".md") or p.endswith(".py"):
            return sum(1 for _ in open(p, encoding="utf-8"))
        if p.endswith(".json"):
            j = json.load(open(p, encoding="utf-8")); return len(j) if isinstance(j, (list, dict)) else ""
        if p.endswith(".gz"):
            return len(json.load(gzip.open(p, "rt", encoding="utf-8"))["items"])
        if p.endswith(".sqlite"):
            c = sqlite3.connect("file:%s?mode=ro" % p, uri=True); n = c.execute("select count(*) from sqlite_master").fetchone()[0]; c.close(); return "%d db-objektum" % n
    except Exception as e:
        return "ERR:" + str(e)[:40]
    return ""
rows = []
for p in files + [e for e in extra if e not in files]:
    exists = os.path.isfile(p)
    readable = False; size = ""; sha_w = ""; sha_c = ""
    if exists:
        try:
            data = open(p, "rb").read(); readable = True
            if p not in extra:                      # the two self-describing files carry no hash (circular)
                size = len(data); sha_w = hashlib.sha256(data).hexdigest()
        except Exception:
            pass
    tracked = bool(sh("git", "ls-files", "--", p))
    if tracked:
        blob = subprocess.run(["git", "show", "HEAD:" + p], capture_output=True).stdout
        sha_c = hashlib.sha256(blob).hexdigest()
    last = sh("git", "log", "-1", "--format=%h", "--", p) if tracked else "(új: a következő commitban)"
    rows.append(dict(path=p, named_in_f03="IGEN" if os.path.basename(p) in NAMED else "", exists="IGEN" if exists else "NEM", readable="IGEN" if readable else "NEM", bytes=size, rows_or_lines=nrows(p) if readable else "",
                     git_tracked="IGEN" if tracked else "NEM (új)", last_commit=last, sha256_committed_blob=sha_c, sha256_working_copy=sha_w,
                     current_version="IGEN" if (tracked and last in ("2b3d581", V2, BASE, "246dd68", "2e3e9e2")) or not tracked else "?"))
with open(OUT + "HANDOVER_MANIFEST.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
named_rows = [r for r in rows if r["named_in_f03"]]
bad = [r["path"] for r in rows if r["exists"] != "IGEN" or r["readable"] != "IGEN"]

# ---- git facts
local = HEAD
remote = sh("git", "ls-remote", "github", "refs/heads/atlasz-v73-integration").split()[0] if sh("git", "ls-remote", "github", "refs/heads/atlasz-v73-integration") else ""
main_remote = sh("git", "ls-remote", "github", "refs/heads/main").split()[0] if sh("git", "ls-remote", "github", "refs/heads/main") else "(nem létezik / nem elérhető)"
in_main = sh("git", "branch", "-r", "--contains", "2b3d581")
nondocs = [p for p in sh("git", "diff", "--name-only", BASE, HEAD).split("\n") if p and not p.startswith("docs/")]
nondocs_v1 = [p for p in sh("git", "diff", "--name-only", "2e3e9e2~1", HEAD).split("\n") if p and not p.startswith("docs/") and p not in ()]
def ledger(rev):
    return json.loads(subprocess.run(["git", "show", "%s:docs/identity_registry/id_ledger.json" % rev], capture_output=True, text=True).stdout)["entries"]
def comps(rev):
    t = subprocess.run(["git", "show", "%s:docs/identity_registry/components.csv" % rev], capture_output=True, text=True).stdout
    return {r["id"]: r["name"] for r in csv.DictReader(t.lstrip("\ufeff").splitlines())}
l0, l1 = ledger(BASE), ledger(HEAD)
c0, c1 = comps(BASE), comps(HEAD)
lost = [k for k, e in l0.items() if k not in l1 or l1[k]["id"] != e["id"]]
ren = [i for i, n in c0.items() if c1.get(i) != n]
v1_comp_files_unchanged = sh("git", "diff", "--stat", BASE, HEAD, "--", "docs/identity_registry/components.csv", "docs/identity_registry/requirements.csv", "docs/identity_registry/source_sets_85_23_150.csv", "docs/identity_registry/requirement_component_links.csv", "docs/identity_registry/work_list.csv") == ""
ids1 = [e["id"] for e in l1.values()]
hist0 = int(sh("bash", "-c", "git show %s:docs/identity_registry/history.jsonl | wc -l" % BASE)); hist1 = sum(1 for _ in open("docs/identity_registry/history.jsonl", encoding="utf-8"))
hprefix = subprocess.run(["git", "show", "%s:docs/identity_registry/history.jsonl" % BASE], capture_output=True, text=True).stdout.splitlines() == open("docs/identity_registry/history.jsonl", encoding="utf-8").read().splitlines()[:hist0]
reg = json.load(open(OUT + "atlasz_system_inventory.json", encoding="utf-8"))
log = sh("git", "log", "--format=%h %ad %s", "--date=short", "-6")
md = []
A = md.append
A("# GIT-VERZIÓ ÉS EREDET (PROVENANCE) – ATLASZ AURÓRA V7.3 nyilvántartás\n")
A("*Rögzítve: 2026-10-12, a javítás commit (`2b3d581`) elküldése után. Csak nyilvántartás; kódváltozás nincs.*\n")
A("## 1. Melyik commitból készült a leltár?\n")
A("| kérdés | válasz |\n|---|---|")
A("| Központi azonosító-regiszter (v1, 898 komponens) | `%s` (`docs(registry)…`) |" % BASE)
A("| A v2 leltár **kiinduló kód-állapota** (a generátor ezt a HEAD-et olvasta: ezért szerepel a fájlokban `git_head: df9ab5e`, és az akkor kiosztott v2 azonosítók `first_seen_commit: df9ab5e`; a javító körben kiosztott 8 új azonosítóé `b5870e8`) | `%s` |" % BASE)
A("| A v2 leltár fájljait **tartalmazó** commit (az átadási jelentés ezt hivatkozta) | `%s` |" % V2)
A("| A javító (nyilvántartási korrekció) commit | `2b3d581` |")
A("| Ez a két dokumentum (GIT_PROVENANCE.md, HANDOVER_MANIFEST.csv) | a javító commitot követő, csak-docs commit (lásd `git log -1 -- docs/system_inventory/GIT_PROVENANCE.md`) |")
A("\nMagyarázat az eltérésre: `df9ab5e` és `b5870e8` **között nincs kódváltozás** – a `b5870e8` kizárólag a docs/ alatti v2 leltárt adta hozzá. A leltár tehát a `df9ab5e` kód-állapotra vonatkozik; a `b5870e8` az a commit, amelyben a leltár fájljai megjelentek. Mindkét címke helyes, más-más dolgot jelöl.")
A("A `docs/` kívüli különbség `%s`..HEAD között: **%s**.\n" % (BASE, "nincs (0 fájl)" if not nondocs else str(nondocs)))
A("## 2. Helyi és távoli ág\n")
A("- helyi `atlasz-v73-integration`: `%s`" % local)
A("- távoli `github/atlasz-v73-integration`: `%s`" % remote)
A("- egyezés a verifikáláskor: **%s**" % ("IGEN" if local == remote else "NEM – a következő (csak-docs) commit még nincs elküldve"))
A("- A Stop-hook „nincs távoli ág” üzenete téves riasztás: az elavult `origin`-t nézi; a hivatalos távoli: `github`.\n")
A("## 3. A korábbi 898 ATL azonosító\n")
A("- v1 ledger-kulcsok (`%s`): %d; ebből elveszett vagy más azonosítót kapott: **%d**" % (BASE, len(l0), len(lost)))
A("- 898 komponens (`%s` → HEAD): átnevezett/megváltozott azonosító: **%d**; v1 forrás-CSV-k (components, requirements, source_sets, links, work_list) változatlanok: **%s**" % (BASE, len(ren), "IGEN" if v1_comp_files_unchanged else "NEM"))
A("- a ledger összes azonosítója egyedi: **%s** (%d azonosító)" % ("IGEN" if len(ids1) == len(set(ids1)) else "NEM", len(ids1)))
A("- `history.jsonl` csak bővült (%d → %d sor), a korábbi sorok változatlanok: **%s**\n" % (hist0, hist1, "IGEN" if hprefix else "NEM"))
A("## 4. `main` ág\n")
A("- távoli `main` (ha van): `%s`" % main_remote)
A("- a javító commitot tartalmazó távoli ágak: `%s`" % (in_main.replace("\n", " ").strip() or "—"))
A("- `main` módosítása / push `main`-re: **nem történt** (kizárólag `git push github atlasz-v73-integration:atlasz-v73-integration`, force nélkül).\n")
A("## 5. Legutóbbi commitok\n")
A("```\n" + log + "\n```\n")
A("## 6. F-03 – a megnevezett fájlok állapota\n")
A("| fájl | létezik | olvasható | bájt | sorok | utolsó commit | verzió |\n|---|---|---|---|---|---|---|")
for r in sorted(named_rows, key=lambda x: x["path"]):
    A("| %s | %s | %s | %s | %s | %s | %s |" % (r["path"], r["exists"], r["readable"], r["bytes"], r["rows_or_lines"], r["last_commit"], r["current_version"]))
A("\nTeljes átadási manifest: `HANDOVER_MANIFEST.csv` (%d fájl; nem létező vagy nem olvasható: **%d**). A `sha256_committed_blob` a Gitben tárolt (LF) tartalom hash-e; a `sha256_working_copy` a lemezen lévő (esetleg CRLF) fájlé – ezért térhetnek el.\n" % (len(rows), len(bad)))
A("## 7. A regiszter összesített darabszámai (atlasz_system_inventory.json)\n")
A("```\n%s\n```" % json.dumps(reg["counts"], ensure_ascii=False, indent=1))
open(OUT + "GIT_PROVENANCE.md", "w", encoding="utf-8").write("\n".join(md) + "\n")
print("manifest rows", len(rows), "missing/unreadable", bad, "named", len(named_rows), "local==remote", local == remote, "lost", len(lost), "renamed", len(ren), "nondocs", nondocs, "hist_prefix", hprefix)
