// ATLASZ Control Center — Electron shell (Windows desktop app). The window only shows the local, token-protected Control Center UI.
import { app, BrowserWindow, Menu, shell, dialog } from "electron";
import path from "node:path";
import { createControlCenterServer } from "../server.mjs";

if (!app.requestSingleInstanceLock()) app.quit();
const base = process.env.ATLASZ_HOME || path.join(app.getPath("appData"), "ATLASZ");
let cc = null, win = null;

async function boot() {
  cc = createControlCenterServer({ stateDir: path.join(base, "state"), configDir: path.join(base, "config"), port: Number(process.env.ATLASZ_RUNTIME_PORT || 8080) });
  const { url, port } = await cc.listen(0);
  win = new BrowserWindow({ width: 1320, height: 860, minWidth: 900, minHeight: 600, title: "ATLASZ Control Center", backgroundColor: "#0f1216", show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, u) => { if (!u.startsWith("http://127.0.0.1:" + port + "/")) { e.preventDefault(); if (/^https:\/\//.test(u)) shell.openExternal(u); } });
  await win.loadURL(url);
}
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(boot).catch(e => { dialog.showErrorBox("ATLASZ Control Center failed to start", String(e.message)); app.quit(); });
let closing = false;
app.on("before-quit", async e => { if (closing || !cc) return; e.preventDefault(); closing = true; try { await cc.close(); } finally { app.exit(0); } });   // graceful runtime stop
app.on("window-all-closed", () => app.quit());
