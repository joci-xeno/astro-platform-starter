# 30-agent runtime evidence 2026-10-11

SANDBOX fixtures, one workforce instance; proves the mechanism per agent identity, not commercial work

Fully proven: 30/30. Integrity: {"events":true,"registry":true,"coordination":true,"ledger":true}

| Agent | Task received | Output | Independent check (checker) | Refused when paused | Recovered | Unapproved tool refused |
|---|---|---|---|---|---|---|
| SEARCH-1 | true | true | ACCEPT (SEARCH-2) | true | true | n/a |
| SEARCH-2 | true | true | ACCEPT (SEARCH-3) | true | true | n/a |
| SEARCH-3 | true | true | ACCEPT (SEARCH-4) | true | true | n/a |
| SEARCH-4 | true | true | ACCEPT (SEARCH-5) | true | true | n/a |
| SEARCH-5 | true | true | ACCEPT (SEARCH-1) | true | true | n/a |
| EXECUTION-1 | true | true | ACCEPT (EXECUTION-10) | true | true | true |
| EXECUTION-2 | true | true | ACCEPT (EXECUTION-11) | true | true | true |
| EXECUTION-3 | true | true | ACCEPT (EXECUTION-12) | true | true | true |
| EXECUTION-4 | true | true | ACCEPT (EXECUTION-13) | true | true | true |
| EXECUTION-5 | true | true | ACCEPT (EXECUTION-14) | true | true | true |
| EXECUTION-6 | true | true | ACCEPT (EXECUTION-15) | true | true | true |
| EXECUTION-7 | true | true | ACCEPT (EXECUTION-16) | true | true | true |
| EXECUTION-8 | true | true | ACCEPT (EXECUTION-17) | true | true | true |
| EXECUTION-9 | true | true | ACCEPT (EXECUTION-18) | true | true | true |
| EXECUTION-10 | true | true | ACCEPT (EXECUTION-19) | true | true | true |
| EXECUTION-11 | true | true | ACCEPT (EXECUTION-20) | true | true | true |
| EXECUTION-12 | true | true | ACCEPT (EXECUTION-21) | true | true | true |
| EXECUTION-13 | true | true | ACCEPT (EXECUTION-22) | true | true | true |
| EXECUTION-14 | true | true | ACCEPT (EXECUTION-23) | true | true | true |
| EXECUTION-15 | true | true | ACCEPT (EXECUTION-24) | true | true | true |
| EXECUTION-16 | true | true | ACCEPT (EXECUTION-25) | true | true | true |
| EXECUTION-17 | true | true | ACCEPT (EXECUTION-1) | true | true | true |
| EXECUTION-18 | true | true | ACCEPT (EXECUTION-19) | true | true | true |
| EXECUTION-19 | true | true | ACCEPT (EXECUTION-2) | true | true | true |
| EXECUTION-20 | true | true | ACCEPT (EXECUTION-21) | true | true | true |
| EXECUTION-21 | true | true | ACCEPT (EXECUTION-22) | true | true | true |
| EXECUTION-22 | true | true | ACCEPT (EXECUTION-23) | true | true | true |
| EXECUTION-23 | true | true | ACCEPT (EXECUTION-24) | true | true | true |
| EXECUTION-24 | true | true | ACCEPT (EXECUTION-25) | true | true | true |
| EXECUTION-25 | true | true | ACCEPT (EXECUTION-3) | true | true | true |

## Not proven per agent
- memory retrieval per agent (generic gateway + project scope tested in m5-memory-integration and master-coordinator tests, scenario E; not exercised for each of the 30 identities here)
- model use per agent (0 providers LIVE, so no agent can call an AI model)
- real external work (no connector source approved; no customer, contract, or payment exists)
