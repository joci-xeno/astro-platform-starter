# -*- coding: utf-8 -*-
# Part 5: summary printout
print("components", len(comps), "PLN", len(PLN), "WORK", len(WORK), "FND", len(FINDINGS), "DEC", len(DECISIONS), "SRC", len(SOURCES), "CFG", len(CONFIGS), "DIR", len(DIR_ROWS), "REQ", len(REQ_MATRIX))
print("validation errors", V["errors"], "warnings", V["warnings"])
for c in V["checks"]:
    if not c["ok"]:
        print(c["level"], c["check"], "|", c["detail"][:300])
print(V["hours"])
