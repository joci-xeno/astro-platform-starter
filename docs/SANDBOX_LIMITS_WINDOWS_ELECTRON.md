# Process-sandbox limits on Windows and in the packaged (Electron) app — investigation and fail-closed behaviour

Scope: ATLASZ-T3-002. Plugin hooks and update self-tests run through `atlasz-addons/restricted-node.mjs`. Evidence level: SANDBOX (Linux, Node 22.22.0). Nothing here was run on Windows or inside Electron.

## What is VERIFIED here (Linux, Node 22.22.0, real child processes)
- `node --permission` restricts reads to listed paths, blocks writes unless granted, blocks `child_process` and workers.
- `unshare --user --map-root-user --net` removes all non-loopback network interfaces; Node's own permission model does NOT restrict the network.
- The launcher probes the actual binary (`--permission -e 0`, `unshare … true`) and never assumes. 18/18 mutants of the launcher are killed by the tests; plugin-manager 9/9; update adapters 4/4.

## What is NOT verified and why
| Host | Expected behaviour | Evidence |
|---|---|---|
| Windows, Node >= 22.13 | `--permission` works → filesystem/process restriction; **no network isolation** (no `unshare`); result reports `networkBlocked:false`, `level: PERMISSION`; `requireNoNetwork` refuses | Unit-simulated only (`restricted-node.test.mjs`, "simulated hosts"); not run on Windows |
| Packaged app, Electron `^33.2.0` (declared in `atlasz-control-center/package.json`) | Electron 33 bundles Node 20.x (from general knowledge — **verify** with `process.versions.node` inside the packaged app). Node's docs list the permission model as added in v20.0.0 and "no longer experimental" in v22.13.0; the plain `--permission` flag is only known to be present from the 22 line. If the packaged runtime rejects `--permission`, the probe returns false | Could not install a Node 20 binary here (download blocked), so the Electron path was **not** executed. Simulated by a fake `node` that rejects the flag |
| Any host where the probe fails | `restrictedNodeCommand` → `{ok:false, reason:"SANDBOX_UNAVAILABLE"}` | Tested with real child processes (fake node binary): hook/self-test is **not run**, a marker file is never written |

## Safe fail-closed behaviour (tested)
- **Plugin hooks:** not run; reason `SANDBOX_UNAVAILABLE`; audited as `PLUGIN_HOOK_NOT_RUN`; plugin is NOT quarantined (it did nothing wrong); the plugin stays ENABLED but inert.
- **Update self-tests:** not run; the test phase returns `passed:false` with `error: SANDBOX_UNAVAILABLE`; the update flow treats a failing self-test as a stop and never touches the installed version (existing test "a package that fails its own self-test never touches the install"). Packages without a self-test still get the integrity check, labelled as integrity-only.
- **Visibility:** Control Center System Doctor shows an informational `process_sandbox` component: BLOCKED (no `--permission`: hooks and self-tests will not run), DEGRADED (restriction active, no network isolation, e.g. Windows) or HEALTHY. It does not change the overall verdict, because fail-closed is the safe state.
- No unrestricted fallback exists anywhere in the code path (static test: the fake-node test proves the fallback never runs).

## Consequence for the Windows app
If the packaged app ships a Node without `--permission`, plugins with code and update self-tests will simply not run. That is safe but functionally limiting. Themes (data-only) are unaffected.

## Options for the owner (decision D9; nothing implemented)
1. Upgrade Electron to a release whose bundled Node supports `--permission` (current Electron stable lines are far newer than 33), then verify with a build **manually approved by you** (the Windows installer workflow stays manual-only).
2. Ship a separate pinned Node 22 binary for hooks/self-tests (adds size and an update path to maintain).
3. Add a Windows-native containment layer (Job Object limits, AppContainer / restricted token, firewall rule per child) — real work, needs a Windows test machine; the only way to get network isolation on Windows.
4. Accept "plugins with code and update self-tests are Linux/Node-22 only" for now.
Recommendation: 1, then verify on a real Windows machine before any claim.
