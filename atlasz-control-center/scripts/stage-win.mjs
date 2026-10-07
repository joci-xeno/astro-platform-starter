// Assembles ../dist-stage/ with the fixed relative layout the Control Center expects, so electron-builder can package it:
//   atlasz-control-center/  atlasz-addons/  atlasz-runtime/  (+ electron package.json at the root)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stage = path.join(root, "dist-stage");
fs.rmSync(stage, { recursive: true, force: true });
const copy = (rel, filter = () => true) => fs.cpSync(path.join(root, rel), path.join(stage, rel), { recursive: true, filter: s => !/node_modules|\.git$/.test(s) && filter(s) });
copy("atlasz-control-center", s => !/scripts|package\.json|build/.test(path.relative(path.join(root, "atlasz-control-center"), s)));
copy("atlasz-addons");
copy("atlasz-runtime", s => !/\.log$|data$/.test(s));
const cc = JSON.parse(fs.readFileSync(path.join(root, "atlasz-control-center", "package.json"), "utf8"));
const pkg = {
  name: "atlasz", productName: "ATLASZ", version: cc.version, description: "ATLASZ Control Center", author: "Joci", type: "module",
  main: "atlasz-control-center/electron/main.mjs", devDependencies: cc.devDependencies,
  build: {
    appId: "com.atlasz.controlcenter", productName: "ATLASZ", asar: false, directories: { output: "release", buildResources: "build" },
    files: ["atlasz-control-center/**", "atlasz-addons/**", "atlasz-runtime/**", "package.json"],
    win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "build/icon.png" },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "ATLASZ", runAfterFinish: true }
  }
};
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(pkg, null, 2));
fs.mkdirSync(path.join(stage, "build"), { recursive: true });
fs.copyFileSync(path.join(root, "atlasz-control-center", "build", "icon.png"), path.join(stage, "build", "icon.png"));
console.log("staged at " + stage);
