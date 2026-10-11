// Side panel UI. Renders model output with textContent only (never as HTML). The token input is cleared right after it is handed to the
// service worker; the panel itself keeps no copy. Nothing here touches the web page.
const $ = id => document.getElementById(id);
const send = msg => chrome.runtime.sendMessage(msg);
const show = (text, error = "") => { $("output").textContent = text; $("error").textContent = error; $("label").hidden = !text; };

async function refresh() {
  const s = await send({ type: "STATUS" }).catch(() => null);
  $("setup-status").textContent = s && s.configured ? "Connected settings saved for this session (port " + s.port + ")." : "Not configured.";
}
$("save").addEventListener("click", async () => {
  const r = await send({ type: "SAVE_SETTINGS", port: $("port").value, token: $("token").value }).catch(() => ({ ok: false, reason: "FAILED" }));
  $("token").value = "";
  $("setup-status").textContent = r.ok ? "Saved for this session." : "Not saved: " + r.reason;
  refresh();
});
$("forget").addEventListener("click", async () => { await send({ type: "FORGET_SETTINGS" }).catch(() => null); show(""); refresh(); });
for (const b of document.querySelectorAll("button[data-kind]")) {
  b.addEventListener("click", async () => {
    show("", ""); $("output").textContent = "Working...";
    const r = await send({ type: "ASK", kind: b.dataset.kind, targetLang: $("lang").value }).catch(() => ({ ok: false, reason: "FAILED" }));
    if (r && r.ok) show(r.text + (r.family ? "\n\n(model family: " + r.family + ")" : ""));
    else show("", "Not done: " + (r && r.reason ? r.reason : "FAILED"));
  });
}
refresh();
