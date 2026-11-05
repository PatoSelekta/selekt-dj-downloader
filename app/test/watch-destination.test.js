"use strict";
// Watch-folder destination: the Settings select must be SAVED, SHOWN again when Settings is reopened, and APPLIED to
// the download items the watcher queues. Before this fix the renderer used the field name `folder` while main.js used
// `destid`, so the choice was never stored and watched items always went to the main folder.
// What runs here: the REAL app/main.js (via h3-harness.js: isolated temp userData, fake yt-dlp/ffmpeg, no network, a
// stubbed file watcher), the REAL Settings code cut out of renderer.js (run in a small fake page: it is NOT a real
// window), and the shared destId -> options module the renderer also loads. A watched item is "run" the way
// h3-harness.runQueueLikeRenderer starts the production main queue runner. All folders live under a temp dir.
// NOT covered: the real iCloud/Dropbox inbox, a real chokidar watcher, a real window or a real download.
// Run:  node --test app/test/watch-destination.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { withHarness, runQueueLikeRenderer } = require("./h3-harness");

const APP = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(APP, "renderer", "renderer.js"), "utf8");
const T = { timeout: 20000 };
const URL1 = "https://example.com/watch-a";

function cutBlock(src, startMarker, open = "{", close = "}") {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `renderer.js has ${startMarker}`);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === open) depth++; else if (src[i] === close && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const I18N = vm.runInNewContext("(" + cutBlock(RENDERER, "const I18N = ").replace(/^const I18N = /, "") + ")");
// The Settings watch section, as shipped: from `let watchSettings` up to the fingerprint section.
const WATCH_SRC = (() => {
  const a = RENDERER.indexOf("let watchSettings = {};");
  const marker = RENDERER.indexOf("// FEATURE 3 — FINGERPRINT SETTINGS");
  assert.ok(a > 0 && marker > a, "renderer.js has the watch settings section");
  return RENDERER.slice(a, RENDERER.lastIndexOf("// ====", marker));
})();
const SUPPORT_SRC = [
  RENDERER.split("\n").find(l => l.startsWith("function escapeHtml(")),
  cutBlock(RENDERER, "function buildFolderSelectOptions("),
  cutBlock(RENDERER, "function destOptionsHtml("),
].join("\n");

// ---- a minimal fake page: only what the watch section touches ----
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function parseOptions(html) {
  const out = [];
  html.replace(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g, (_m, v, attrs, label) => { out.push({ value: unesc(v), label: unesc(label), selected: /\bselected\b/.test(attrs), disabled: /\bdisabled\b/.test(attrs) }); return ""; });
  return out;
}
function makeDom() {
  const els = {};
  const mk = (id) => {
    const e = { id, style: {}, title: "", textContent: "", onclick: null, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {},
      addEventListener(type, fn) { this.listeners[type] = fn; } };
    if (id === "watchDestFolder") {   // behaves like a <select>: unmatched .value -> nothing selected
      let html = "", sel = -1;
      Object.defineProperty(e, "innerHTML", { get: () => html, set(v) { html = v; const o = parseOptions(v); sel = o.findIndex(x => x.selected); if (sel < 0 && o.length) sel = 0; } });
      Object.defineProperty(e, "value", { get: () => (sel >= 0 ? parseOptions(html)[sel].value : ""), set(v) { sel = parseOptions(html).findIndex(x => x.value === v); } });
      Object.defineProperty(e, "shownLabel", { get: () => (sel >= 0 ? parseOptions(html)[sel].label : null) });
      Object.defineProperty(e, "options", { get: () => parseOptions(html) });
    }
    return e;
  };
  return { $: (id) => (els[id] = els[id] || mk(id)) };
}
// "Open Settings": a fresh page whose lists come from the real main process, then the real refreshWatchSettings().
async function openSettings(h, lang = "en") {
  const dom = makeDom();
  const ctx = vm.createContext({
    $: dom.$, I18N, LANG: lang, console,
    api: { watchGet: () => h.invoke("watch-get"), watchSet: (v) => h.invoke("watch-set", v), watchStart: () => h.invoke("watch-start"), watchStop: () => h.invoke("watch-stop"), pickFolder: async () => null },
    knownFolders: (await h.invoke("list-folders")).folders || [],
    knownFavs: (await h.invoke("get-favorites")) || [],
  });
  vm.runInContext("function t(k) { return (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k; }\n" + SUPPORT_SRC + "\n" + WATCH_SRC, ctx);
  await ctx.refreshWatchSettings();
  const sel = dom.$("watchDestFolder");
  return {
    sel, dom, ctx,
    status: () => dom.$("watchStatus").textContent,
    choose: async (value) => { sel.value = value; await sel.listeners.change(); },
  };
}

async function setup(h) {
  const L = { fav: h.mkdir("ext", "Fav") };
  await h.invoke("create-folder", "Techno");
  h.setConfig({ favorite_folders: [{ path: L.fav, name: "Fav" }] });
  L.inbox = h.write("inbox/inbox.txt", URL1 + "\n");
  return L;
}
const startWatch = (h, L) => h.invoke("watch-set", { enabled: true, inbox_path: L.inbox });
const queued = async (h) => (await h.invoke("queue-get")).filter(i => i.source === "watch");
const filesIn = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter(n => !fs.statSync(path.join(d, n)).isDirectory()) : []);

// ---------------------------------------------------------------------------------------------------------------
test("the Settings select saves the destination under the field main.js reads, and shows it again when Settings is reopened", T, () =>
  withHarness({}, async (h) => {
    const L = await setup(h);
    let s = await openSettings(h);
    assert.equal(s.sel.value, "", "nothing chosen yet: main folder");
    assert.equal(h.config().watch_destid, undefined);

    await s.choose("f:Techno");
    assert.equal(h.config().watch_destid, "f:Techno", "saved in config as watch_destid (this was never written before the fix)");
    assert.deepEqual((await h.invoke("watch-get")).destid, "f:Techno");

    s = await openSettings(h);   // Settings closed and opened again: a brand-new page, state only from main
    assert.equal(s.sel.value, "f:Techno");
    assert.equal(s.sel.shownLabel, "Techno");

    await s.choose("p:" + L.fav);
    s = await openSettings(h);
    assert.equal(s.sel.value, "p:" + L.fav);
    assert.match(s.sel.shownLabel, /^Fav/);

    await s.choose("");   // back to the main folder, explicitly
    assert.equal(h.config().watch_destid, "");
    s = await openSettings(h);
    assert.equal(s.sel.value, "");
    assert.equal(s.sel.shownLabel, I18N.en.main_folder);
  }));

test("a configuration written before this change (no watch_destid, or an existing one) is preserved", T, () =>
  withHarness({}, async (h) => {
    const L = await setup(h);
    let s = await openSettings(h);
    assert.equal(s.sel.value, "", "no stored value: main-folder default");
    assert.equal(s.sel.shownLabel, I18N.en.main_folder);
    h.setConfig({ watch_destid: "f:Techno", watch_autorun: true });   // as an older/hand-edited config could hold it
    s = await openSettings(h);
    assert.equal(s.sel.value, "f:Techno", "an existing stored destination is shown, not reset");
    await h.invoke("watch-set", { autorun: false });
    assert.equal(h.config().watch_destid, "f:Techno", "saving another watch setting does not touch it");
    assert.equal(h.config().main_folder, h.music, "main-folder setting untouched");
  }));

test("a watched item goes through to the selected destination: sub-folder, favorite, and the main-folder default", T, async () => {
  const cases = [
    ["main folder (default: nothing saved)", undefined, (h) => h.music],
    ["main folder (chosen explicitly)", "", (h) => h.music],
    ["sub-folder Techno", "f:Techno", (h) => path.join(h.music, "Techno")],
    ["favorite folder", "FAV", (h, L) => L.fav],
  ];
  for (const [name, dest, where] of cases) {
    await withHarness({}, async (h) => {
      const L = await setup(h);
      if (dest !== undefined) await (await openSettings(h)).choose(dest === "FAV" ? "p:" + L.fav : dest);
      await startWatch(h, L);   // starts the (stubbed) watcher; it ingests the inbox line and queues an item
      const items = await queued(h);
      assert.equal(items.length, 1, name);
      assert.equal(items[0].destId, dest === undefined ? "" : (dest === "FAV" ? "p:" + L.fav : dest), name + ": destId on the queued item");
      await runQueueLikeRenderer(h);
      const final = (await queued(h))[0];
      assert.equal(final.status, "done", name);
      const dir = where(h, L);
      assert.deepEqual(filesIn(dir), ["stub.mp4"], name + ": the file is in the selected destination");
      for (const other of [h.music, path.join(h.music, "Techno"), L.fav].filter(d => d !== dir)) assert.deepEqual(filesIn(other), [], name + ": and nowhere else (" + path.basename(other) + ")");
    });
  }
});

// ---- unavailable / invalid destinations: shown as such and failed visibly, never silently another folder --------
test("a saved favorite that was removed afterwards: shown as unavailable (not as the main folder), and its watched item FAILS instead of going elsewhere", T, () =>
  withHarness({}, async (h) => {
    const L = await setup(h);
    await h.invoke("watch-set", { destid: "p:" + L.fav });
    h.setConfig({ favorite_folders: [] });   // the user removed the favorite (what remove-favorite stores)
    const s = await openSettings(h, "en");
    assert.equal(s.sel.value, "p:" + L.fav, "the stale value stays selected");
    assert.equal(s.sel.shownLabel, "⚠ Folder unavailable: Fav — choose another");
    assert.notEqual(s.sel.shownLabel, I18N.en.main_folder);
    assert.equal(s.sel.options.find(o => o.selected).disabled, true);
    assert.equal((await openSettings(h, "es")).sel.shownLabel, "⚠ Carpeta no disponible: Fav — elige otra");

    await startWatch(h, L);
    assert.equal((await queued(h))[0].destId, "p:" + L.fav, "queued with the stored destination, not replaced by the main folder");
    const before = h.snapshot();
    await runQueueLikeRenderer(h);
    const item = (await queued(h))[0];
    assert.equal(item.status, "error");
    assert.match(item.error, /favorite/i);
    assert.deepEqual(h.ytdlpCalls(), [], "nothing was started");
    assert.deepEqual(filesIn(h.music), []);
    assert.deepEqual(filesIn(path.join(h.music, "Techno")), []);
    assert.deepEqual(h.snapshot().filter(x => /stub\.mp4/.test(x)), [], "no file written anywhere");
    void before;
  }));

test("a stored value that is malformed is shown as unavailable and its watched item fails (never the main folder)", T, async () => {
  for (const bad of ["garbage", "p:", "f:", 5, false, 0, {}]) {
    await withHarness({}, async (h) => {
      const L = await setup(h);
      h.setConfig({ watch_destid: bad });
      const s = await openSettings(h, "en");
      assert.notEqual(s.sel.shownLabel, I18N.en.main_folder, JSON.stringify(bad));
      assert.match(s.sel.shownLabel, /^⚠ Folder unavailable/, JSON.stringify(bad));
      await startWatch(h, L);
      const items = await queued(h);
      assert.deepEqual(items.map(i => i.destId), [bad], JSON.stringify(bad) + ": passed through, not defaulted");
      await runQueueLikeRenderer(h);
      assert.equal((await queued(h))[0].status, "error", JSON.stringify(bad));
      assert.deepEqual(filesIn(h.music), [], JSON.stringify(bad));
      assert.deepEqual(h.ytdlpCalls(), []);
    });
  }
});

test("a saved sub-folder that no longer exists is shown as unavailable; running it recreates that SAME sub-folder (existing behavior, same as the Download tab), never the main folder", T, () =>
  withHarness({}, async (h) => {
    const L = await setup(h);
    await h.invoke("watch-set", { destid: "f:Techno" });
    fs.rmSync(path.join(h.music, "Techno"), { recursive: true });   // deleted outside the app
    const s = await openSettings(h, "en");
    assert.equal(s.sel.shownLabel, "⚠ Folder unavailable: Techno — choose another");
    await startWatch(h, L);
    await runQueueLikeRenderer(h);
    assert.equal((await queued(h))[0].status, "done");
    assert.deepEqual(filesIn(path.join(h.music, "Techno")), ["stub.mp4"]);
    assert.deepEqual(filesIn(h.music), []);
  }));

test("a registered favorite whose folder is missing is recreated at the same path (existing behavior), never redirected", T, () =>
  withHarness({}, async (h) => {
    const L = await setup(h);
    await h.invoke("watch-set", { destid: "p:" + L.fav });
    fs.rmSync(L.fav, { recursive: true });   // e.g. the folder was deleted; the favorite is still registered
    await startWatch(h, L);
    await runQueueLikeRenderer(h);
    assert.equal((await queued(h))[0].status, "done");
    assert.deepEqual(filesIn(L.fav), ["stub.mp4"], "same path, recreated");
    assert.deepEqual(filesIn(h.music), []);
  }));

// ---- contract guards ---------------------------------------------------------------------------------------------
test("contract: the renderer uses `destid` for the watch destination (the old `folder` field is gone) and main.js reads watch_destid", T, () => {
  assert.doesNotMatch(WATCH_SRC, /watchSet\(\{\s*folder:/);
  assert.doesNotMatch(WATCH_SRC, /watchSettings\.folder/);
  assert.match(RENDERER, /data-field="destId" \$\{locked \? "disabled" : ""\}>\$\{destOptionsHtml\(item\.destId\)\}<\/select>/, "Queue rows show a stale destination as unavailable too");
  assert.doesNotMatch(RENDERER, /destOptionsHtml\(item\.destId \|\|/, "a falsy stored value must not be turned into the main folder before display");
  assert.match(WATCH_SRC, /api\.watchSet\(\{ destid: value \}\)/);
  assert.match(WATCH_SRC, /watchSettings\.destid/);
  const MAIN = fs.readFileSync(path.join(APP, "main.js"), "utf8");
  assert.match(MAIN, /if \(vals\.destid !== undefined\) cfg\.watch_destid = vals\.destid;/);
  assert.match(MAIN, /destid: \(cfg\.watch_destid === undefined/);
  assert.doesNotMatch(MAIN, /cfg\.watch_destid \|\| ""/, "a falsy stored value must not silently become the main folder");
});

test("every Settings text added for this is in both languages", T, () => {
  for (const k of ["watch_dest_missing"]) {
    assert.ok(I18N.es[k] && I18N.en[k], k);
    assert.notEqual(I18N.es[k], I18N.en[k], k);
  }
  assert.match(I18N.es.watch_dest_missing, /\{name\}/);
  assert.match(I18N.en.watch_dest_missing, /\{name\}/);
});
