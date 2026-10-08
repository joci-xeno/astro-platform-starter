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
  const namespace = permission && !IS_WIN && process.platform === "linux" && probe("unshare", ["--user", "--map-root-user", "--net", "--pid", "--fork", "--kill-child", "true"]);
  const r = { permission, namespace, platform: process.platform };
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
export function restrictedNodeCommand({ nodeBin = process.execPath, script, scriptArgs = [], readDirs = [], writeDirs = [], env = {}, allowNetwork = false, requireNoNetwork = false, nodeFlags = [], caps = null } = {}) {
  if (!script) return { ok: false, reason: "SCRIPT_REQUIRED" };
  const c = caps ?? detectNodeRestrictions(nodeBin);
  if (!c.permission) return { ok: false, reason: "SANDBOX_UNAVAILABLE" };
  const wantNetBlock = !allowNetwork;
  if (wantNetBlock && requireNoNetwork && !c.namespace) return { ok: false, reason: "NETWORK_ISOLATION_UNAVAILABLE" };
  const args = ["--permission", ...[...new Set([script, ...readDirs])].map(d => "--allow-fs-read=" + norm(d)), ...[...new Set(writeDirs)].map(d => "--allow-fs-write=" + norm(d)), ...nodeFlags, script, ...scriptArgs];
  const useNs = wantNetBlock && c.namespace;
  const out = useNs ? { cmd: "unshare", args: ["--user", "--map-root-user", "--net", "--pid", "--fork", "--kill-child", nodeBin, ...args] } : { cmd: nodeBin, args };
  return { ok: true, ...out, env: baseEnv(env), level: useNs ? "PERMISSION+NETWORK_NAMESPACE" : "PERMISSION", networkBlocked: useNs, filesystemRestricted: true };
}
