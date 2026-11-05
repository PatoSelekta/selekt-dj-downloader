"use strict";
// The Queue table and a malformed destination. Runs the REAL renderQueue / destOptionsHtml / buildFolderSelectOptions /
// toDownloadOpts cut out of renderer.js, plus the real row change handler, in a small fake page (it is NOT a real
// window: a separate check ran the same renderer in a real browser engine against a simulated backend), and the real
// main.js through h3-harness for the "run it" half. Isolated temp folders only.
// A destId in the queue is "" / absent / null = main folder, "f:<sub-folder>", "p:<favorite path>". Anything else
// (a malformed string, false, 0, a number, an object) is INVALID: it must show as unavailable (never as Main), keep the
// row on screen and editable, and fail when run (never download to Main).
// Run:  node --test app/test/queue-destination-display.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { withHarness } = require("./h3-harness");
const SelektDest = require("../renderer/destination.js");

const APP = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(APP, "renderer", "renderer.js"), "utf8");
const T = { timeout: 20000 };

function cutBlock(src, startMarker, open = "{", close = "}") {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `renderer.js has ${startMarker}`);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === open) depth++; else if (src[i] === close && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const I18N = vm.runInNewContext("(" + cutBlock(RENDERER, "const I18N = ").replace(/^const I18N = /, "") + ")");
const SRC = [
  RENDERER.split("\n").find(l => l.startsWith("function escapeHtml(")),
  cutBlock(RENDERER, "function buildFolderSelectOptions("),
  cutBlock(RENDERER, "function destOptionsHtml("),
  cutBlock(RENDERER, "function queueItemDest("),
  cutBlock(RENDERER, "function toDownloadOpts("),
  cutBlock(RENDERER, "async function renderQueue("),
].join("\n");

// ---- a minimal fake page: just enough for renderQueue and its row handlers ----
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const parseOptions = (html) => { const o = []; html.replace(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g, (_m, v, a, l) => { o.push({ value: unesc(v), label: unesc(l), selected: /\bselected\b/.test(a), disabled: /\bdisabled\b/.test(a) }); return ""; }); return o; };
function makeDom() {
  const els = {};
  const rows = [], cache = new Map();
  const tbody = {
    set innerHTML(v) { rows.length = 0; cache.clear(); this.emptyHtml = v; },
    get innerHTML() { return this.emptyHtml || ""; },
    appendChild(tr) { rows.push(tr); },
    querySelectorAll(sel) {
      const out = [];
      for (const tr of rows) {
        const h = tr.innerHTML;
        if (sel === ".q-retry" || sel === ".q-remove") {
          const cls = sel.slice(1); const re = new RegExp(`<button class="sec ${cls}" data-id="([^"]*)"`, "g");
          h.replace(re, (_m, id) => { const k = cls + "|" + id; if (!cache.has(k)) cache.set(k, { dataset: { id }, onclick: null }); out.push(cache.get(k)); return ""; });
        } else if (sel === "select[data-row-id]") {
          h.replace(/<select class="q-sel" data-row-id="([^"]*)" data-field="(\w+)" ?(disabled)?>([\s\S]*?)<\/select>/g, (_m, id, field, dis, inner) => {
            const k = "sel|" + id + "|" + field;
            if (!cache.has(k)) {
              let sel_ = parseOptions(inner).findIndex(x => x.selected); if (sel_ < 0) sel_ = 0;
              const e = { dataset: { rowId: id, field }, disabled: !!dis, options: parseOptions(inner), listeners: {}, addEventListener(t, f) { this.listeners[t] = f; },
                get value() { return sel_ >= 0 ? this.options[sel_].value : ""; },
                set value(v) { sel_ = this.options.findIndex(x => x.value === v); },
                get shown() { return sel_ >= 0 ? this.options[sel_] : null; } };
              cache.set(k, e);
            }
            out.push(cache.get(k));
            return "";
          });
        }
      }
      return out;
    },
  };
  const mk = (id) => ({ id, style: {}, textContent: "", innerHTML: "", disabled: false, classList: { add() {}, remove() {} } });
  const $ = (id) => id === "queueRows" ? tbody : (els[id] = els[id] || mk(id));
  const document = { createElement: () => ({ className: "", dataset: {}, innerHTML: "" }) };
  return { $, document, rows, select: (id, field = "destId") => { tbody.querySelectorAll("select[data-row-id]"); return cache.get(`sel|${id}|${field}`); } };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
async function startPage({ queue, folders = ["Techno"], favs = [{ name: "USB", path: "/Volumes/USB/Tracks" }], lang = "en" }) {
  const dom = makeDom();
  const store = { queue: queue.map(clone), updates: [] };
  const ctx = vm.createContext({
    $: dom.$, document: dom.document, console, I18N, LANG: lang, SelektDest, knownFolders: folders, knownFavs: favs,
    DEFAULT_AUDIO_BITRATE: "320", autoTagEnabled: true, loudnormEnabled: true, lufsValue: -14,
    api: {
      queueGet: async () => clone(store.queue),
      queueUpdateItem: async (patch) => { store.updates.push(clone(patch)); const it = store.queue.find(i => i.id === patch.id); if (it) Object.assign(it, clone(patch)); return { ok: true }; },
      queueSet: async (q) => { store.queue = clone(q); return { ok: true }; },
    },
    runQueue: () => {},
  });
  vm.runInContext("let queueRunning = false, queuePaused = false;\nfunction t(k) { return (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k; }\n" + SRC, ctx);
  await ctx.renderQueue();
  return { dom, ctx, store };
}
const item = (id, destId, status = "pending", extra = {}) => ({ id, url: "https://example.com/" + id, status, title: "Song " + id, format: "audio:mp3", ...(destId === "<absent>" ? {} : { destId }), ...extra });

const BAD = [["a malformed string", "garbage"], ["p: with no path", "p:"], ["f: with no name", "f:"], ["false", false], ["0", 0], ["a number", 42], ["an object", { folder: "x" }], ["an empty object", {}], ["an array", ["f:Techno"]]];

for (const [name, bad] of BAD) {
  for (const status of ["pending", "error", "skipped"]) {
    test(`Queue row with destId = ${name} (${status}): shown as unavailable, never Main; row stays visible and can be re-pointed`, T, async () => {
      const page = await startPage({ queue: [item("a", ""), item("b", bad, status, status === "error" ? { error: "Invalid destination for this download. Choose the folder again." } : {}), item("c", "f:Techno")] });
      assert.equal(page.dom.rows.length, 3, "all rows rendered: one damaged destination does not break the table");
      assert.match(page.dom.rows[1].innerHTML, /Song b/, "the damaged row is visible with its title");
      const sel = page.dom.select("b");
      assert.ok(sel, "its folder select is there");
      assert.equal(sel.disabled, false, "and editable (not locked)");
      assert.match(sel.shown.label, /^⚠ Folder unavailable: /);
      assert.notEqual(sel.shown.label, I18N.en.main_folder, "NOT shown as Main");
      assert.notEqual(sel.value, "", "its selected value is not the main folder's empty id");
      assert.equal(sel.shown.disabled, true);
      // the neighbours are untouched
      assert.equal(page.dom.select("a").shown.label, I18N.en.main_folder);
      assert.equal(page.dom.select("c").shown.label, "Techno");

      // it is not turned into Main when it would run either
      const opts = page.ctx.toDownloadOpts(page.store.queue[1]);
      assert.equal(opts.destInvalid, true);
      assert.equal("folder" in opts, false, "no main-folder/sub-folder field");
      assert.equal("targetPath" in opts, false);

      // re-point it: pick a real folder in the row's select -> the stored item changes -> a fresh render shows it
      sel.value = "f:Techno";
      await sel.listeners.change();
      assert.deepEqual(page.store.updates.at(-1), { id: "b", destId: "f:Techno" });
      await page.ctx.renderQueue();
      assert.equal(page.dom.rows.length, 3);
      assert.equal(page.dom.select("b").shown.label, "Techno");
      assert.deepEqual(page.ctx.toDownloadOpts(page.store.queue[1]).folder, "Techno");
      assert.equal(page.ctx.toDownloadOpts(page.store.queue[1]).destInvalid, undefined);
    });
  }
}

test("a locked row (done / running) with a damaged destination still renders, as unavailable and disabled", T, async () => {
  const page = await startPage({ queue: [item("d", false, "done"), item("r", 0, "running")] });
  assert.equal(page.dom.rows.length, 2);
  for (const id of ["d", "r"]) { const s = page.dom.select(id); assert.equal(s.disabled, true); assert.match(s.shown.label, /^⚠ Folder unavailable/); }
});

test("the valid destination contracts are unchanged: absent / null / '' = Main, f: and p: shown as chosen, a removed favorite or sub-folder is unavailable", T, async () => {
  const page = await startPage({ queue: [item("a", "<absent>"), item("b", null), item("c", ""), item("d", "f:Techno"), item("e", "p:/Volumes/USB/Tracks"), item("f", "p:/Volumes/Gone/Old"), item("g", "f:Deleted")] });
  assert.equal(page.dom.rows.length, 7);
  for (const id of ["a", "b", "c"]) { assert.equal(page.dom.select(id).shown.label, I18N.en.main_folder, id); assert.equal(page.dom.select(id).value, "", id); }
  assert.equal(page.dom.select("d").shown.label, "Techno");
  assert.equal(page.dom.select("e").shown.label, "USB ↗");
  assert.equal(page.dom.select("f").shown.label, "⚠ Folder unavailable: Old — choose another");
  assert.equal(page.dom.select("g").shown.label, "⚠ Folder unavailable: Deleted — choose another");
  // destination.js: absent/null/"" are Main, the rest as before
  const opts = (i) => page.ctx.toDownloadOpts(i);
  assert.equal(opts(item("a", "<absent>")).folder, ""); assert.equal(opts(item("b", null)).folder, ""); assert.equal(opts(item("c", "")).folder, "");
  assert.equal(opts(item("d", "f:Techno")).folder, "Techno");
  assert.equal(opts(item("e", "p:/Volumes/USB/Tracks")).targetPath, "/Volumes/USB/Tracks");
  const es = await startPage({ queue: [item("x", false)], lang: "es" });
  assert.equal(es.dom.select("x").shown.label, "⚠ Carpeta no disponible: false — elige otra");
});

test("running a queued item with a damaged destination: nothing is sent to main and nothing is downloaded to Main (real toDownloadOpts + real main.js)", T, async () => {
  const MAIN = fs.readFileSync(path.join(APP, "main.js"), "utf8");
  const RQ = cutBlock(RENDERER, "async function runQueue(");
  assert.match(RQ, /if \(opts\.destInvalid\) \{\s*r = \{ ok: false, error: t\("dest_bad"\) \};/, "runQueue turns an invalid destination into a per-item error before calling main");
  assert.ok(RQ.indexOf("if (opts.destInvalid)") < RQ.indexOf("api.download(opts)"));
  void MAIN;
  for (const [name, bad] of BAD) {
    await withHarness({}, async (h) => {
      const page = await startPage({ queue: [item("a", bad)] });
      const opts = page.ctx.toDownloadOpts(page.store.queue[0]);
      assert.equal(opts.destInvalid, true, name);
      // and if damaged destination fields ever DID reach main, main refuses them (defense in depth)
      // (only non-string values: a string reaching main as `folder` is by contract a sub-folder NAME, not "damaged";
      //  the renderer never sends a malformed string, it sets destInvalid instead -- asserted above)
      for (const o of typeof bad === "string" ? [] : [{ targetPath: bad }, { folder: bad }]) {
        const r = await h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false, ...o });
        assert.equal(r.ok, false, name + " " + JSON.stringify(o));
        assert.equal(typeof r.error, "string");
      }
      assert.deepEqual(h.ytdlpCalls(), [], name + ": yt-dlp never started");
      assert.deepEqual(fs.existsSync(h.music) ? fs.readdirSync(h.music).filter(n => n !== ".DS_Store") : [], [], name + ": nothing in the main folder (it was not even created)");
    });
  }
});

// The REAL runQueue loop (cut from renderer.js) driving the REAL main.js download handler through the harness:
// a damaged destination must end as an error row, must never call download, and must leave Main empty.
// A control row with a valid destination proves the same wiring does download when the destination is valid.
test("real runQueue + real main.js: damaged destinations become error rows, api.download is never called, nothing lands in Main; a valid row downloads", T, async () => {
  for (const [name, bad] of BAD) {
    await withHarness({}, async (h) => {
      const page = await startPage({ queue: [item("bad", bad), item("ok", "f:Techno")] });
      h.mkdir("Music/Techno");
      const calls = [];
      page.ctx.api.download = async (opts) => { calls.push(clone(opts)); return h.invoke("download", opts); };
      const noop = () => {};
      Object.assign(page.ctx, { stopAllRequested: false, plProgress: null, queueActiveId: null, normWarnText: () => "", tagWarnText: () => "", canceledNote: () => "", setCancelBusy: noop, updateActiveCount: noop, finishPlaylistProgress: noop, hideBar: noop, lastSeg: (x) => String(x || "").split(/[\\/]/).pop(), setTimeout });
      page.ctx.api.queueUpdateItem = async (patch) => { const it = page.store.queue.find(i => i.id === patch.id); if (it) Object.assign(it, clone(patch)); return { ok: true }; };
      vm.runInContext(cutBlock(RENDERER, "async function runQueue("), page.ctx);
      await page.ctx.runQueue();
      const bad_ = page.store.queue.find(i => i.id === "bad"), ok_ = page.store.queue.find(i => i.id === "ok");
      assert.equal(bad_.status, "error", name);
      assert.equal(bad_.error, I18N.en.dest_bad, name + ": the user-facing error is the 'invalid destination' one");
      assert.ok(!calls.some(c => c.url.endsWith("/bad")), name + ": api.download was not called for the damaged row");
      assert.equal(ok_.status, "done", name + ": the valid neighbour still ran");
      assert.deepEqual(calls.map(c => c.folder), ["Techno"], name);
      assert.deepEqual(fs.readdirSync(h.music).filter(n => n !== ".DS_Store" && n !== "Techno"), [], name + ": nothing was written to the main folder");
      // the failed row is still on screen, still editable, and re-pointing + retry makes it run
      await page.ctx.renderQueue();
      assert.equal(page.dom.rows.length, 2);
      const sel = page.dom.select("bad");
      assert.equal(sel.disabled, false);
      sel.value = "f:Techno"; await sel.listeners.change();
      assert.equal(page.store.queue.find(i => i.id === "bad").destId, "f:Techno");
    });
  }
});
