"use strict";
// Focused accessibility / usability check, run in REAL ELECTRON (not headless Chromium):
//   <electron> app/test-browser/a11y-check.electron.js
// The real renderer/index.html + renderer.js run in a hidden BrowserWindow against the in-memory fake window.api in
// api-stub.js (no main process, no network, no files, no downloads, no audio). Keys are sent with
// webContents.sendInputEvent (real Tab / Shift+Tab / Enter / Space / Escape); roles, names and states come from
// Chromium's accessibility tree through the DevTools protocol (Accessibility.getPartialAXTree).
// Env: RENDERER_DIR (default ../renderer), BEFORE_DIR (optional: an older renderer folder, compared at the normal
//      width for layout / style / pixel differences), OUT_DIR (optional: screenshots + report.json).
// Exit code 1 if any check fails. Output: one line per check.
const { app, BrowserWindow } = require("electron");
const fs = require("fs"), os = require("os"), path = require("path");

const RENDERER = path.resolve(process.env.RENDERER_DIR || path.join(__dirname, "..", "renderer"));
const BEFORE = process.env.BEFORE_DIR ? path.resolve(process.env.BEFORE_DIR) : null;
const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : null;
const STUB = path.join(__dirname, "api-stub.js");
const NORMAL = 980, NARROW = 720;                       // main.js: width 980, minWidth 720
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? "" : String(detail) });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined && (!ok || process.env.VERBOSE) ? "  -> " + detail : ""));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Preload (page world, contextIsolation off): installs the stub, then gives it a realistic folder / queue set.
const PRELOAD = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "a11y-preload-")), "preload.js");
fs.writeFileSync(PRELOAD, `
const fs = require("fs");
(0, eval)(fs.readFileSync(${JSON.stringify(STUB)}, "utf8"));
const ctl = window.__ctl, base = window.api, LANG = process.env.A11Y_LANG || "es";
window.__calls = { togglePin: [] };
const over = {
  getSettings: async () => ({ lang: LANG, main_folder: "/Users/test/Music", prevent_duplicates: false, auto_tag: true,
    loudnorm: false, lufs: -14, pinned: ["f:House"], cookies_browser: "", folder_view: "chips", folder_density: "compact" }),
  listFolders: async () => ({ folders: ["Bachata", "House", "Salsa", "Techno"] }),
  getFavorites: async () => [{ name: "Warmup", path: "/Users/test/Warmup", available: true },
                             { name: "Missing", path: "/Users/test/Missing", available: false }],
  togglePin: async (id) => { window.__calls.togglePin.push(id); return { ok: true }; },
};
window.api = new Proxy({}, { get: (t, k) => (k in over ? over[k] : base[k]) });
ctl.queue = [{ id: "q-1", status: "pending", url: "https://example.com/a", title: "Test tone 1 kHz" },
             { id: "q-2", status: "pending", url: "https://example.com/b", title: null }];
`);

async function openWin(rendererDir, width, lang) {
  process.env.A11Y_LANG = lang || "es";
  const win = new BrowserWindow({ show: false, width, height: 760, useContentSize: true,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, preload: PRELOAD } });
  const errors = [];
  win.webContents.on("console-message", (e, level, msg) => { if (level >= 3) errors.push(msg); });
  await win.loadFile(path.join(rendererDir, "index.html"));
  await sleep(500);
  const wc = win.webContents;
  wc.focus();
  const send = (m, p) => wc.debugger.sendCommand(m, p);
  wc.debugger.attach("1.3");
  await send("DOM.enable"); await send("Accessibility.enable");
  const w = {
    win, wc, errors,
    ev: (js) => wc.executeJavaScript(js, true),
    async key(k, mods) {
      const m = mods || [];
      wc.sendInputEvent({ type: "keyDown", keyCode: k, modifiers: m });
      if (k === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r", modifiers: m });
      if (k === " ") wc.sendInputEvent({ type: "char", keyCode: " ", modifiers: m });
      wc.sendInputEvent({ type: "keyUp", keyCode: k, modifiers: m });
      await sleep(40);
    },
    async axAll(sel) {
      const doc = await send("DOM.getDocument", { depth: 0 });
      const q = await send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: sel });
      const out = [];
      for (const nodeId of q.nodeIds) {
        const r = await send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
        const n = r.nodes[0] || {};
        out.push({ ignored: !!n.ignored, role: n.role && n.role.value, name: n.name && n.name.value,
          props: Object.fromEntries((n.properties || []).map(p => [p.name, p.value && p.value.value])) });
      }
      return out;
    },
    async ax(sel) { return (await this.axAll(sel))[0] || null; },
    async axText(sel) {      // all text the accessibility tree exposes below one element (walks child nodes of the full tree)
      const doc = await send("DOM.getDocument", { depth: 0 });
      const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: sel });
      const d = await send("DOM.describeNode", { nodeId: q.nodeId });
      const full = await send("Accessibility.getFullAXTree");
      const byId = new Map(full.nodes.map(n => [n.nodeId, n]));
      const root = full.nodes.find(n => n.backendDOMNodeId === d.node.backendNodeId);
      const out = [];
      (function walk(n) { if (!n) return; if (!n.ignored && n.role && n.role.value === "StaticText" && n.name) out.push(n.name.value);
        (n.childIds || []).forEach(id => walk(byId.get(id))); })(root);
      return out.join(" ");
    },
    async size(width) { win.setContentSize(width, 760); await sleep(250); },
    async shot(name) { if (!OUT) return null; const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, name + ".png"), img.toPNG()); return img; },
  };
  return w;
}

const ACTIVE = `(() => { const a = document.activeElement; if (!a || a === document.body) return null;
  return { tag: a.tagName, id: a.id, cls: a.className && a.className.baseVal === undefined ? a.className : "",
    inSettings: !!a.closest("#settings"), label: a.getAttribute("aria-label") || (a.textContent || "").trim().slice(0, 30) }; })()`;

(async () => {
  await app.whenReady();
  const A = await openWin(RENDERER, NORMAL, "es");

  // ---------------------------------------------------------------- 1. Settings dialog
  check("page loads with no console errors", A.errors.length === 0, A.errors.slice(0, 3).join(" | "));
  await A.ev(`document.getElementById("openSettingsBtn").focus()`);
  await A.key("Enter");
  check("Enter on the gear opens Settings", await A.ev(`document.getElementById("settings").classList.contains("show")`));
  const dlg = await A.ax("#settings .modal");
  const h3 = await A.ev(`document.getElementById("settingsTitle").textContent.trim()`);
  check("Settings exposes role=dialog named by its visible heading (\"" + h3 + "\")", dlg && dlg.role === "dialog" && h3 && dlg.name === h3, JSON.stringify(dlg));
  check("Settings dialog is aria-modal", await A.ev(`document.querySelector("#settings .modal").getAttribute("aria-modal") === "true"`));
  let act = await A.ev(ACTIVE);
  check("focus moves into the dialog on open", act && act.inSettings, JSON.stringify(act));
  check("page behind the dialog is inert", await A.ev(`[...document.body.children].filter(e => e.id !== "settings" && e.tagName !== "SCRIPT").every(e => e.inert)`));
  const bgLang = await A.ax("#langBtn");
  check("background control (language button) is ignored by the accessibility tree while open", !bgLang || bgLang.ignored, JSON.stringify(bgLang));
  const stops = [];
  for (let i = 0; i < 70; i++) { await A.key("Tab"); stops.push(await A.ev(ACTIVE)); }
  check("70 x Tab never leaves the dialog", stops.every(s => s && s.inSettings), JSON.stringify(stops.find(s => !s || !s.inSettings)));
  check("Tab never reaches the language button behind it", stops.every(s => s && s.id !== "langBtn"));
  check("Tab wraps (Done button then first control again)", stops.some(s => s && s.id === "closeSettingsBtn") && new Set(stops.map(s => s.id + s.cls)).size < 70);
  await A.ev(`document.querySelector("#settings .modal").focus()`);
  await A.key("Tab", ["shift"]);
  act = await A.ev(ACTIVE);
  check("Shift+Tab from the dialog wraps to the last control (Done)", act && act.id === "closeSettingsBtn", JSON.stringify(act));
  await A.key("Escape");
  check("Escape closes Settings", await A.ev(`!document.getElementById("settings").classList.contains("show")`));
  act = await A.ev(ACTIVE);
  check("focus returns to the gear that opened it", act && act.id === "openSettingsBtn", JSON.stringify(act));
  check("page is interactive again (not inert)", await A.ev(`[...document.body.children].every(e => !e.inert)`));
  await A.key("Enter");                                            // reopen, then close with the Done button via keyboard
  await A.ev(`document.getElementById("closeSettingsBtn").focus()`);
  await A.key(" ");
  check("Space on Done closes Settings and returns focus", await A.ev(`!document.getElementById("settings").classList.contains("show") && document.activeElement.id === "openSettingsBtn"`));
  // Escape inside an inline folder rename cancels the rename only
  await A.key("Enter");
  await A.ev(`document.querySelector("#mngList .mng-item button").click()`);
  check("inline rename input appears", await A.ev(`!!document.querySelector("#mngList .mng-rename")`));
  await A.key("Escape");
  check("Escape in the rename field cancels the rename but keeps Settings open",
    await A.ev(`!document.querySelector("#mngList .mng-rename") && document.getElementById("settings").classList.contains("show")`));
  await A.key("Escape");
  check("second Escape then closes Settings", await A.ev(`!document.getElementById("settings").classList.contains("show")`));

  // ---------------------------------------------------------------- 2. Folder chips / add controls (Spanish)
  const chipAx = await A.axAll("#folderChips .chip > .dest-main");
  check("every folder chip is a button in the accessibility tree", chipAx.length >= 7 && chipAx.every(c => c.role === "button" && !c.ignored), JSON.stringify(chipAx.map(c => c.role)));
  const names = chipAx.map(c => c.name);
  check("chip names are the folder names", ["Bachata", "House", "Salsa", "Techno", "Warmup"].every(n => names.some(x => x && x.includes(n))), JSON.stringify(names));
  const addAx = await A.axAll("#folderActions .chip.add");
  check("'Nueva carpeta' and 'Añadir carpeta' are buttons with names",
    addAx.length === 2 && addAx.every(a => a.role === "button" && a.name), JSON.stringify(addAx.map(a => [a.role, a.name])));
  const sel0 = await A.ev(`[...document.querySelectorAll("#folderChips .dest-main")].filter(b => b.getAttribute("aria-pressed") === "true").length`);
  check("exactly one chip is pressed at start (main folder)", sel0 === 1, sel0);
  const pins = await A.axAll("#folderChips .pin");
  check("pin stars are named buttons (localized)", pins.length >= 4 && pins.every(p => p.role === "button" && /fijar|fijadas/i.test(p.name || "")), JSON.stringify(pins.slice(0, 2)));
  const missing = await A.ev(`(() => { const c = [...document.querySelectorAll("#folderChips .chip")].find(c => c.dataset.favPath === "/Users/test/Missing");
    return c && { cls: c.className, dis: c.querySelector(".dest-main").getAttribute("aria-disabled") }; })()`);
  check("unavailable folder is exposed as disabled", missing && missing.dis === "true", JSON.stringify(missing));

  // keyboard: Tab order through the folder area, then select by Space, pin by Enter
  await A.ev(`document.getElementById("folderFilter") && document.getElementById("folderFilter").focus()`);
  const walk = [];
  for (let i = 0; i < 40; i++) { await A.key("Tab"); walk.push(await A.ev(`(() => { const a = document.activeElement; const h = a.closest("#folderChips .chip, #folderChips .frow");
    return { tag: a.tagName, role: a.getAttribute("role"), cls: a.className, inChips: !!h, folder: h && (h.dataset.folder || h.dataset.favPath), outline: h ? getComputedStyle(h).outlineStyle : getComputedStyle(a).outlineStyle }; })()`)); }
  const inChips = walk.filter(s => s.inChips);
  check("Tab reaches folder chips (main + pin) with button semantics", inChips.length >= 8 && inChips.every(s => s.tag === "BUTTON" || s.role === "button"), JSON.stringify(inChips.find(s => !(s.tag === "BUTTON" || s.role === "button"))));
  check("a visible focus ring is drawn on the focused chip", inChips.filter(s => s.cls.includes("dest-main")).every(s => s.outline !== "none"), JSON.stringify(inChips.filter(s => s.cls.includes("dest-main") && s.outline === "none")[0]));
  check("Tab reaches 'Nueva carpeta' / 'Añadir carpeta' as buttons", walk.filter(s => String(s.cls).includes("chip add")).length >= 2);

  await A.ev(`[...document.querySelectorAll("#folderChips .chip")].find(c => c.dataset.folder === "Salsa").querySelector(".dest-main").focus()`);
  await A.key(" ");
  const afterSel = await A.ev(`(() => { const on = [...document.querySelectorAll("#folderChips .chip")].filter(c => c.classList.contains("active")).map(c => c.dataset.folder);
    const pressed = [...document.querySelectorAll("#folderChips .dest-main")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.closest(".chip").dataset.folder);
    const a = document.activeElement; return { on, pressed, focus: a.closest(".chip") && a.closest(".chip").dataset.folder, isMain: a.classList.contains("dest-main"), target: document.getElementById("targetFolder").value }; })()`);
  check("Space on a chip selects it (visual .active == aria-pressed == hidden target)", JSON.stringify(afterSel.on) === '["Salsa"]' && JSON.stringify(afterSel.pressed) === '["Salsa"]' && afterSel.target === "Salsa", JSON.stringify(afterSel));
  check("keyboard focus stays on the chip after the list re-renders", afterSel.focus === "Salsa" && afterSel.isMain, JSON.stringify(afterSel));
  await A.ev(`[...document.querySelectorAll("#folderChips .chip")].find(c => c.dataset.folder === "Techno").querySelector(".pin").focus()`);
  await A.key("Enter");
  const pinRes = await A.ev(`({ calls: window.__calls.togglePin, target: document.getElementById("targetFolder").value, focusPin: document.activeElement.classList.contains("pin"), focusFolder: document.activeElement.closest(".chip") && document.activeElement.closest(".chip").dataset.folder })`);
  check("Enter on a pin star toggles only the pin (not the selection) and keeps focus",
    JSON.stringify(pinRes.calls) === '["f:Techno"]' && pinRes.target === "Salsa" && pinRes.focusPin && pinRes.focusFolder === "Techno", JSON.stringify(pinRes));
  await A.ev(`[...document.querySelectorAll("#folderActions .chip.add")][0].focus()`);
  await A.key("Enter");
  check("Enter on 'Nueva carpeta' opens the inline name field (behaviour unchanged)", await A.ev(`!!document.querySelector("#folderActions .chip-input input, #folderChips .chip-input input")`));
  await A.key("Escape");

  // list view + density toggles expose their state
  await A.ev(`document.getElementById("viewList").click()`); await sleep(120);
  const rows = await A.axAll("#folderChips .frow > .dest-main");
  check("list view rows are buttons too", rows.length >= 7 && rows.every(r => r.role === "button"), rows.length);
  const tog = await A.ev(`["viewChips","viewList","densCompact","densComfort"].map(id => document.getElementById(id).getAttribute("aria-pressed") + ":" + document.getElementById(id).classList.contains("active"))`);
  check("view / density buttons expose aria-pressed that matches .active", tog.every(s => s.split(":")[0] === s.split(":")[1]) , JSON.stringify(tog));
  await A.ev(`document.getElementById("viewChips").click()`); await sleep(120);
  const grp = await A.ax("#folderChips");
  check("folder area is a named group", grp && /carpeta/i.test(grp.name || ""), JSON.stringify(grp));

  // ---------------------------------------------------------------- 3. Labels, toggles, queue (ES)
  const lbl = async (inputSel, labelSel) => {
    const n = await A.ax(inputSel), t = await A.ev(`(document.querySelector(${JSON.stringify(labelSel)}) || {}).textContent || ""`);
    return { n, t: t.trim() };
  };
  for (const [inp, lab] of [["#url", 'label[for="url"]'], ["#format", 'label[for="format"]'], ["#bitrate", 'label[for="bitrate"]']]) {
    const r = await lbl(inp, lab);
    check(`${inp}: accessible name = visible label ("${r.t}")`, r.t && r.n && r.n.name && r.n.name.toLowerCase().includes(r.t.toLowerCase()), JSON.stringify(r.n && r.n.name));
  }
  const dup = await A.ax("#dupToggle");
  check("'Evitar duplicados' toggle: button named 'Evitar duplicados', state exposed", dup && dup.role === "button" && /Evitar duplicados/.test(dup.name || "") && "pressed" in dup.props, JSON.stringify(dup));
  await A.ev(`document.querySelector('[data-tab="queue"]').click()`); await sleep(250);
  { const r = await lbl("#queueInput", 'label[for="queueInput"]');
    check(`#queueInput: accessible name = visible label ("${r.t}")`, r.t && r.n && r.n.name && r.n.name.toLowerCase().includes(r.t.toLowerCase()), JSON.stringify(r.n && r.n.name)); }
  const qrem = await A.axAll(".q-remove");
  check("queue remove buttons have meaningful names (ES)", qrem.length === 2 && qrem.every(q => /^Quitar: /.test(q.name || "")) && qrem[0].name.includes("Test tone"), JSON.stringify(qrem.map(q => q.name)));
  check("preview close (icon-only) button carries a localized aria-label", await A.ev(`document.getElementById("prevClose").getAttribute("aria-label")`) === "Cerrar");
  await A.ev(`document.querySelector('[data-tab="dl"]').click()`);

  // ---------------------------------------------------------------- 4. Layout: toggle labels, status label at both widths
  const layoutProbe = `(() => {
    const clipped = [...document.querySelectorAll(".toggles-row .toggle")].map(t => { const s = t.querySelector("span:not(.sw)");
      return s && { text: s.textContent.trim(), clippedX: s.scrollWidth > s.clientWidth + 1, clippedY: s.scrollHeight > s.clientHeight + 1, ellipsis: getComputedStyle(s).textOverflow }; }).filter(Boolean);
    const st = document.getElementById("statusText"), r = st.getBoundingClientRect(), h = document.querySelector("header.app");
    const kids = [...h.children].map(k => k.getBoundingClientRect());
    return { clipped, statusDisplay: getComputedStyle(st).display, statusW: Math.round(r.width), statusText: st.textContent,
      hScroll: document.documentElement.scrollWidth > window.innerWidth, headerOverflow: kids.some(k => k.right > h.getBoundingClientRect().right + 1) }; })()`;
  await A.ev(`window.__ctl.h.setup.forEach(cb => cb("Ready."))`);
  for (const w of [NORMAL, 899, 800, NARROW]) {
    await A.size(w); await sleep(300);
    const p = await A.ev(layoutProbe);
    check(`${w}px: no toggle label is cut off (incl. "Evitar duplicados")`, p.clipped.length >= 4 && p.clipped.every(c => !c.clippedX && !c.clippedY), JSON.stringify(p.clipped.filter(c => c.clippedX || c.clippedY)));
    check(`${w}px: status shows its text ("${p.statusText}"), not just a dot`, p.statusDisplay !== "none" && p.statusW > 20 && /listo/i.test(p.statusText), JSON.stringify([p.statusDisplay, p.statusW]));
    check(`${w}px: no horizontal page scroll / header overflow`, !p.hScroll && !p.headerOverflow, JSON.stringify([p.hScroll, p.headerOverflow]));
    const st = await A.ax("#status"), stText = await A.axText("#status");
    check(`${w}px: status is a polite live region and its text is in the accessibility tree`, st && st.role === "status" && st.props.live === "polite" && /listo/i.test(stText), JSON.stringify([st && st.role, stText]));
    await A.shot(`after-es-${w}`);
  }
  await A.size(NORMAL);

  // ---------------------------------------------------------------- 5. English
  const E = await openWin(RENDERER, NORMAL, "en");
  const ep = await E.axAll("#folderChips .pin");
  check("pin names in English", ep.every(p => /pin|unpin/i.test(p.name || "")) && ep.length >= 4, JSON.stringify(ep.slice(0, 2).map(p => p.name)));
  const eadd = await E.axAll("#folderActions .chip.add");
  check("add buttons named in English", eadd.length === 2 && eadd.every(a => a.role === "button" && /folder/i.test(a.name || "")), JSON.stringify(eadd.map(a => a.name)));
  await E.ev(`document.querySelector('[data-tab="queue"]').click()`); await sleep(250);
  const eq = await E.axAll(".q-remove");
  check("queue remove buttons named in English", eq.length === 2 && eq.every(q => /^Remove: /.test(q.name || "")), JSON.stringify(eq.map(q => q.name)));
  await E.ev(`document.querySelector('[data-tab="dl"]').click()`);
  await E.ev(`document.getElementById("openSettingsBtn").focus()`); await E.key("Enter");
  const edlg = await E.ax("#settings .modal");
  const eh3 = await E.ev(`document.getElementById("settingsTitle").textContent.trim()`);
  check("Settings dialog named by its English heading (\"" + eh3 + "\")", edlg && edlg.role === "dialog" && eh3 && edlg.name === eh3, JSON.stringify(edlg));
  const eclose = await E.ev(`document.getElementById("prevClose").getAttribute("aria-label")`);
  check("preview close label is English", eclose === "Close", eclose);
  check("no console errors (EN window)", E.errors.length === 0, E.errors.slice(0, 3).join(" | "));
  E.win.destroy();
  check("no console errors (ES window, whole run)", A.errors.length === 0, A.errors.slice(0, 3).join(" | "));

  // ---------------------------------------------------------------- 6. Before / after (appearance preserved)
  if (BEFORE) {
    const B = await openWin(BEFORE, NORMAL, "es");
    await B.ev(`window.__ctl.h.setup.forEach(cb => cb("Ready."))`);
    for (const w of [NORMAL, 899, 800, NARROW]) {       // what the ORIGINAL did at each width (settled layout)
      await B.size(w); await sleep(300);
      const bp = await B.ev(layoutProbe);
      console.log(`INFO original @${w}: status label display=${bp.statusDisplay}; cut-off toggle labels: ${JSON.stringify(bp.clipped.filter(c => c.clippedX || c.clippedY).map(c => c.text))}`);
    }
    await B.size(NORMAL);
    await B.shot("before-es-" + NORMAL);
    const rectsJs = `(() => { const q = s => [...document.querySelectorAll(s)].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 2) / 2); });
      return { chips: q("#folderChips .chip"), add: q("#folderActions .chip.add"), header: q("header.app > *"), tabs: q("[role=tab]"), url: q("#url"), selects: q("#format,#bitrate"), toggles: q(".toggles-row .toggle") }; })()`;
    const styleJs = `(() => { const pick = e => { if (!e) return null; const c = getComputedStyle(e); return ["backgroundColor","color","borderTopStyle","borderTopWidth","borderTopColor","borderRadius","fontSize","fontWeight","fontFamily","minHeight","paddingLeft","paddingTop","display","justifyContent","boxShadow","lineHeight","letterSpacing","textTransform","alignItems","gap"].map(k => k + "=" + c[k]).join(";"); };
      return { chip: pick(document.querySelector("#folderChips .chip")), chipActive: pick(document.querySelector("#folderChips .chip.active")), add: pick(document.querySelector("#folderActions .chip.add")), pin: pick(document.querySelector("#folderChips .pin")) }; })()`;
    const A2 = await openWin(RENDERER, NORMAL, "es");
    await A2.ev(`window.__ctl.h.setup.forEach(cb => cb("Ready."))`);
    const pick = `[...document.querySelectorAll("#folderChips .chip")].find(c => c.dataset.folder === "Salsa").click()`;
    for (const view of ["chips", "list"]) {
      for (const W of [B, A2]) {
        await W.ev(view === "list" ? `document.getElementById("viewList").click()` : `document.getElementById("viewChips").click()`);
        await W.ev(view === "list" ? `document.querySelector("#folderChips .frow") && [...document.querySelectorAll("#folderChips .frow")].find(c => c.dataset.folder === "Salsa").click()` : pick);
        await sleep(200);
      }
      const rectsJsV = rectsJs.replace('"#folderChips .chip"', '"#folderChips .chip, #folderChips .frow"');
      const rb = await B.ev(rectsJsV), ra = await A2.ev(rectsJsV);
      for (const k of ["chips", "add", "header", "tabs", "url", "selects"]) {
        const same = JSON.stringify(rb[k]) === JSON.stringify(ra[k]);
        check(`@${NORMAL} ${view} view geometry unchanged: ${k}`, same, same ? "" : "before " + JSON.stringify(rb[k]) + " after " + JSON.stringify(ra[k]));
      }
      const sb = await B.ev(styleJs), sa = await A2.ev(styleJs);
      for (const k of ["chip", "chipActive", "add", "pin"]) {
        check(`@${NORMAL} ${view} view computed style unchanged: ${k}`, sb[k] === sa[k], sb[k] === sa[k] ? "" : "\n   before " + sb[k] + "\n   after  " + sa[k]);
      }
      const ib = await B.wc.capturePage(), ia = await A2.wc.capturePage();
      const bb = ib.toBitmap(), ba = ia.toBitmap(), sz = ib.getSize(), sz2 = ia.getSize(), k = sz.width / NORMAL;
      const tr = await A2.ev(`(() => { const r = document.querySelector(".toggles-row").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
      if (sz.width === sz2.width && sz.height === sz2.height) {
        let diff = 0, outside = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
        for (let i = 0; i < bb.length; i += 4) {
          if (Math.abs(bb[i] - ba[i]) > 8 || Math.abs(bb[i + 1] - ba[i + 1]) > 8 || Math.abs(bb[i + 2] - ba[i + 2]) > 8) {
            diff++; const px = (i / 4) % sz.width / k, py = Math.floor(i / 4 / sz.width) / k;
            if (px < tr[0] - 4 || px > tr[2] + 4 || py < tr[1] - 4 || py > tr[3] + 4) { outside++; bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py); }
          }
        }
        console.log(`INFO ${view} view @${NORMAL}: ${diff} px differ, ${outside} of them outside the toggle row` + (outside ? ` (css box x ${bx0.toFixed(0)}-${bx1.toFixed(0)}, y ${by0.toFixed(0)}-${by1.toFixed(0)})` : ""));
        if (outside) { const d = await A2.ev(`(() => { const e = document.elementFromPoint(${(bx0 + bx1) / 2}, ${(by0 + by1) / 2}); return e ? e.tagName + "#" + e.id + "." + e.className + " :: " + (e.textContent || "").trim().slice(0, 80) + " :: parent " + e.parentElement.tagName + "#" + e.parentElement.id + "." + e.parentElement.className : null; })()`);
          const d0 = await B.ev(`(() => { const e = document.elementFromPoint(${(bx0 + bx1) / 2}, ${(by0 + by1) / 2}); return e ? (e.textContent || "").trim().slice(0, 80) : null; })()`);
          console.log("INFO diff element (after): " + d + " | before text: " + d0); }
        if (OUT) fs.writeFileSync(path.join(OUT, `after-es-${NORMAL}-${view}.png`), ia.toPNG()), fs.writeFileSync(path.join(OUT, `before-es-${NORMAL}-${view}.png`), ib.toPNG());
        check(`@${NORMAL} ${view} view: every pixel outside the toggle row is identical to the original`, outside === 0, outside);
        if (view === "chips") { fs.writeFileSync(OUT ? path.join(OUT, "before-es-" + NORMAL + ".png") : os.tmpdir() + "/before.png", ib.toPNG()); }
      } else console.log("INFO screenshot sizes differ, pixel diff skipped");
    }
    // narrower widths: the only intended differences are the header status label (visible again) and the toggle row
    for (const W of [B, A2]) await W.ev(`document.getElementById("viewChips").click()`);
    for (const w of [899, 800, NARROW]) {
      await B.size(w); await A2.size(w); await sleep(300);
      const ib = await B.wc.capturePage(), ia = await A2.wc.capturePage();
      const bb = ib.toBitmap(), ba = ia.toBitmap(), sz = ib.getSize(), k = sz.width / w;
      const allow = await A2.ev(`["header.app", ".toggles-row"].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })`);
      let diff = 0, outside = 0;
      for (let i = 0; i < bb.length; i += 4) {
        if (Math.abs(bb[i] - ba[i]) > 8 || Math.abs(bb[i + 1] - ba[i + 1]) > 8 || Math.abs(bb[i + 2] - ba[i + 2]) > 8) {
          diff++; const px = (i / 4) % sz.width / k, py = Math.floor(i / 4 / sz.width) / k;
          if (!allow.some(r => px >= r[0] - 4 && px <= r[2] + 4 && py >= r[1] - 4 && py <= r[3] + 4)) outside++;
        }
      }
      console.log(`INFO @${w}: ${diff} px differ from the original, ${outside} outside header + toggle row`);
      check(`@${w}: everything except the header status label and the toggle row is pixel-identical to the original`, outside === 0 && sz.width === ia.getSize().width, outside);
      if (OUT) fs.writeFileSync(path.join(OUT, `before-es-${w}.png`), ib.toPNG()), fs.writeFileSync(path.join(OUT, `after-es-${w}-compare.png`), ia.toPNG());
    }
    A2.win.destroy();
    B.win.destroy();
  }

  A.win.destroy();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (OUT) fs.writeFileSync(path.join(OUT, "a11y-report.json"), JSON.stringify(results, null, 2));
  app.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("CHECK CRASHED:", e && e.stack || e); app.exit(2); });
