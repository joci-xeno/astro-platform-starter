// Least-privilege launcher for Node child processes that run code ATLASZ did not write itself: plugin hooks and update self-tests (Task 4 / M1.2, ATLASZ-T3-002).
// Before this, those children were plain `node` processes with a scrubbed environment, a timeout and an output cap - but full filesystem and network access.
//
// What is enforced (and what is not):
//   FILESYSTEM  Node's permission model (`--permission`): the child can read only the directories listed and write only where listed; it cannot spawn processes, start workers,
//               load native addons or use WASI. Enforced by the Node runtime, not by us.
//   NETWORK     On Linux, when `unshare` works, the child runs in its own user+net+PID namespace = no network at all and no way to signal host processes (it cannot even see them). Node's permission model does NOT restrict the network, so where
//               the namespace is unavailable (Windows, locked-down hosts) the network is NOT blocked: the result says so (`networkBlocked:false`), and callers that need
//               "no network" can refuse to run (`requireNoNetwork`).
//   ENVIRONMENT Only the variables passed in are visible (plus PATH and, under Electron, ELECTRON_RUN_AS_NODE). No inherited secrets.
//   HOST        Plain PERMISSION (no namespace) does not hide host processes: the child could signal them. `hostIsolated` says whether a namespace is in use; `requireHostIsolation` refuses to run otherwise.
//   LIFETIME    `maxLifetimeSec` wraps the child in `timeout -s KILL` (when available) so it dies even if the manager is SIGKILLed; `lifetimeLimited` reports it.
// Fail closed: if the host's Node has no permission model (older Node, some Electron builds) the launcher returns {ok:false, reason:"SANDBOX_UNAVAILABLE"}; it never silently runs unrestricted.
import { spawnSync } from "node:child_process";

const cache = new Map();
const IS_WIN = process.platform === "win32";
const probe = (cmd, args, env) => { try { return spawnSync(cmd, args, { timeout: 4000, stdio: "ignore", windowsHide: true, env }).status === 0; } catch { return false; } };

/** What this host can really enforce for a given node binary. Probed once per binary; nothing is assumed. */
export function detectNodeRestrictions(nodeBin = process.execPath, { fresh = false } = {}) {
  if (!fresh && cache.has(nodeBin)) return cache.get(nodeBin);
  const env = baseEnv({});
  const permission = probe(nodeBin, ["--permission", "-e", "0"], env);
  const namespace = permission && !IS_WIN && process.platform === "linux" && probe("unshare", ["--user", "--map-root-user", "--net", "--pid", "--fork", "--kill-child", "setsid", "--wait", "true"]);
  const pidNamespace = permission && !IS_WIN && process.platform === "linux" && probe("unshare", ["--user", "--map-root-user", "--pid", "--fork", "--kill-child", "setsid", "--wait", "true"]);      // PID namespace WITHOUT a network namespace: for plugins that were granted NETWORK
  const timeoutCmd = permission && !IS_WIN && probe("timeout", ["-s", "KILL", "5", "true"]);      // coreutils `timeout`: lets the child kill itself even when its manager dies
  const r = { permission, namespace, pidNamespace, timeoutCmd, platform: process.platform };
  cache.set(nodeBin, r); return r;
}
export function baseEnv(extra = {}) {
  const e = { PATH: process.env.PATH ?? "", ...extra };
  if (process.versions.electron) e.ELECTRON_RUN_AS_NODE = "1";             // packaged app: the Electron binary doubles as Node
  return e;
}
const norm = d => String(d);

/**
 * Build the command line for running `script` under restriction. Does not spawn.
 * @returns {{ok:true, cmd, args, env, level, networkBlocked, filesystemRestricted} | {ok:false, reason}}
 */
export function restrictedNodeCommand({ nodeBin = process.execPath, script, scriptArgs = [], readDirs = [], writeDirs = [], env = {}, allowNetwork = false, requireNoNetwork = false, requireHostIsolation = false, maxLifetimeSec = 0, nodeFlags = [], caps = null } = {}) {
  if (!script) return { ok: false, reason: "SCRIPT_REQUIRED" };
  if (typeof script !== "string" || script.startsWith("-")) return { ok: false, reason: "SCRIPT_INVALID" };      // a script path that starts with "-" would be read as a node option
  const c = caps ?? detectNodeRestrictions(nodeBin);
  if (!c.permission) return { ok: false, reason: "SANDBOX_UNAVAILABLE" };
  const wantNetBlock = !allowNetwork;
  if (wantNetBlock && requireNoNetwork && !c.namespace) return { ok: false, reason: "NETWORK_ISOLATION_UNAVAILABLE" };
  if (requireHostIsolation && !IS_WIN && !(c.namespace || c.pidNamespace)) return { ok: false, reason: "HOST_ISOLATION_UNAVAILABLE" };      // plain PERMISSION leaves the host's processes visible/signalable
  const args = ["--permission", ...[...new Set([script, ...readDirs])].map(d => "--allow-fs-read=" + norm(d)), ...[...new Set(writeDirs)].map(d => "--allow-fs-write=" + norm(d)), ...nodeFlags, script, ...scriptArgs];
  const useNs = wantNetBlock && c.namespace;
  const usePid = !useNs && Boolean(c.pidNamespace) && (allowNetwork || !requireNoNetwork);      // network granted: the host stays reachable on the network, but its processes are still invisible (it cannot signal them)
  const life = Number.isFinite(maxLifetimeSec) && maxLifetimeSec > 0 && c.timeoutCmd ? ["timeout", "-s", "KILL", String(Math.ceil(maxLifetimeSec))] : [];      // child self-destructs even if its manager is SIGKILLed
  const out = useNs ? { cmd: "unshare", args: ["--user", "--map-root-user", "--net", "--pid", "--fork", "--kill-child", "setsid", "--wait", ...life, nodeBin, ...args] } : usePid ? { cmd: "unshare", args: ["--user", "--map-root-user", "--pid", "--fork", "--kill-child", "setsid", "--wait", ...life, nodeBin, ...args] } : life.length ? { cmd: life[0], args: [...life.slice(1), nodeBin, ...args] } : { cmd: nodeBin, args };
  return { ok: true, ...out, env: baseEnv(env), level: useNs ? "PERMISSION+NETWORK_NAMESPACE" : usePid ? "PERMISSION+PID_NAMESPACE" : "PERMISSION", networkBlocked: useNs, hostIsolated: useNs || usePid, lifetimeLimited: life.length > 0, filesystemRestricted: true };
}
