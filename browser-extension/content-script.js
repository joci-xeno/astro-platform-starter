// ATLASZ Local Assistant - content script. Injected ONLY on demand into the active tab (chrome.scripting + activeTab) after the owner clicks a
// side-panel button. It READS visible text and the current selection and returns them to the extension's service worker. It never:
//   - reads form fields (input / textarea / select / contenteditable / anything inside a <form>), passwords or hidden elements;
//   - writes to the page, clicks, types, focuses, dispatches events or submits anything;
//   - receives the dashboard token or any model output (it has no message listener at all).
// The value of the last expression (the IIFE result) is what chrome.scripting.executeScript hands back.
(function (g) {
  "use strict";
  var MAX_SELECTION = 8000, MAX_PAGE = 20000, MAX_NODES = 50000;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, FRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, CANVAS: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, BUTTON: 1, FORM: 1, DATALIST: 1, OUTPUT: 1 };
  var FIELD = { INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, FORM: 1 };

  function attr(el, name) { try { return el && el.getAttribute ? el.getAttribute(name) : null; } catch (e) { return null; } }
  function editable(el) { var v = attr(el, "contenteditable"); return v !== null && String(v).toLowerCase() !== "false"; }
  function hidden(el, win) {
    if (attr(el, "hidden") !== null || attr(el, "aria-hidden") === "true" || String(attr(el, "type") || "").toLowerCase() === "password") return true;
    if (win && typeof win.getComputedStyle === "function") { try { var cs = win.getComputedStyle(el); if (cs && (cs.display === "none" || cs.visibility === "hidden")) return true; } catch (e) { return true; } }
    return false;
  }
  /** True when the node is inside something the owner may be typing into, or inside any form. */
  function insideSensitive(node) {
    for (var n = node, i = 0; n && i < 200; n = n.parentNode, i++) {
      if (n.nodeType === 1 && (FIELD[String(n.tagName).toUpperCase()] || editable(n) || String(attr(n, "type") || "").toLowerCase() === "password")) return true;
    }
    return false;
  }
  function luhn(d) { var s = 0, alt = false; for (var i = d.length - 1; i >= 0; i--) { var x = d.charCodeAt(i) - 48; if (alt) { x *= 2; if (x > 9) x -= 9; } s += x; alt = !alt; } return s % 10 === 0; }
  /** Client-side first pass: payment-card-like numbers are masked before the text leaves the page. The server scrubs credentials again. */
  function mask(t) {
    return String(t).replace(/(?:\d[ -]?){12,18}\d/g, function (m) { var d = m.replace(/[ -]/g, ""); return d.length >= 13 && d.length <= 19 && luhn(d) ? "[redacted-card]" : m; });
  }
  function collapse(t) { return String(t).replace(/[\t\r\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }

  function readSelection(doc, win) {
    var ae = doc && doc.activeElement;
    if (ae && ae.nodeType === 1 && (FIELD[String(ae.tagName).toUpperCase()] || editable(ae))) return { text: "", reason: "SELECTION_IN_FORM_OR_EDITABLE" };
    var sel = win && typeof win.getSelection === "function" ? win.getSelection() : null;
    if (!sel || !sel.rangeCount) return { text: "", reason: "SELECTION_EMPTY" };
    if (insideSensitive(sel.anchorNode) || insideSensitive(sel.focusNode)) return { text: "", reason: "SELECTION_IN_FORM_OR_EDITABLE" };
    var t = collapse(sel.toString());
    return { text: mask(t.slice(0, MAX_SELECTION)), reason: t ? null : "SELECTION_EMPTY" };
  }
  function readPage(doc, win) {
    var out = [], len = 0, visited = 0, stack = [doc && doc.body].filter(Boolean);
    while (stack.length && len < MAX_PAGE && visited < MAX_NODES) {
      var n = stack.pop(); visited++;
      if (n.nodeType === 3) { var v = String(n.nodeValue || ""); if (v.trim()) { out.push(v); len += v.length; } continue; }
      if (n.nodeType !== 1) continue;
      var tag = String(n.tagName).toUpperCase();
      if (SKIP[tag] || editable(n) || hidden(n, win)) continue;
      var kids = n.childNodes || [];
      if (/^(P|DIV|LI|H[1-6]|TR|BR|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE)$/.test(tag)) stack.push({ nodeType: 3, nodeValue: "\n" });
      for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return mask(collapse(out.join(" ")).slice(0, MAX_PAGE));
  }
  function collect(doc, win) {
    var s = readSelection(doc, win);
    return { version: 1, selection: s.text, reason: s.reason, pageText: readPage(doc, win), title: String((doc && doc.title) || "").slice(0, 200) };
  }
  if (typeof g.__ATLASZ_CAPTURE_TEST__ === "function") g.__ATLASZ_CAPTURE_TEST__({ collect: collect, readSelection: readSelection, readPage: readPage, mask: mask, insideSensitive: insideSensitive });
  return g.document ? collect(g.document, g) : null;
})(globalThis);
