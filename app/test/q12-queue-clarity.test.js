"use strict";
// Q1+Q2 Queue layout: real renderQueue / dest helpers cut from renderer.js on a fake page.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(APP, "renderer", "renderer.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "renderer", "index.html"), "utf8");
const T = { timeout: 20000 };
const SelektDest = require("../renderer/destination.js");

function cutBlock(src, startMarker, open = "{", close = "}") {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `renderer.js has ${startMarker}`);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === open) depth++; else if (src[i] === close && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const I18N = vm.runInNewContext("(" + cutBlock(RENDERER, "const I18N = ").replace(/^const I18N = /, "") + ")");
const SRC = [
  RENDERER.split("\n").find((l) => l.startsWith("function escapeHtml(")),
  RENDERER.split("\n").find((l) => l.startsWith("function lastSeg(")),
  cutBlock(RENDERER, "function pathDir("),
  cutBlock(RENDERER, "function pathBase("),
  cutBlock(RENDERER, "function buildFolderSelectOptions("),
  cutBlock(RENDERER, "function destOptionsHtml("),
  cutBlock(RENDERER, "function queueItemDest("),
  cutBlock(RENDERER, "function toDownloadOpts("),
  cutBlock(RENDERER, "function isActiveQueueStatus("),
  cutBlock(RENDERER, "function queueFormatLabel("),
  cutBlock(RENDERER, "function destLabelForId("),
  cutBlock(RENDERER, "function updateQueueAddPreview("),
  cutBlock(RENDERER, "function queueStatusLabel("),
  cutBlock(RENDERER, "function queueFormatSelectHtml("),
  cutBlock(RENDERER, "function canceledNote("),
  cutBlock(RENDERER, "function parseLinks("),
  cutBlock(RENDERER, "function buildQueueItemsFromPaste("),
  cutBlock(RENDERER, "async function applyFolderToPending("),
  cutBlock(RENDERER, "async function renderQueue("),
].filter(Boolean).join("\n");

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function makeTbody() {
  const rows = [];
  const cache = new Map();
  return {
    rows,
    emptyHtml: "",
    set innerHTML(v) { rows.length = 0; cache.clear(); this.emptyHtml = v; },
    get innerHTML() { return this.emptyHtml || rows.map((r) => r.innerHTML).join(""); },
    appendChild(tr) { rows.push(tr); },
    querySelectorAll(sel) {
      const out = [];
      for (const tr of rows) {
        const h = tr.innerHTML || "";
        if (sel === "select[data-row-id]") {
          h.replace(/<select class="q-sel" data-row-id="([^"]*)" data-field="(\w+)"([^>]*)>/g, (_m, id, field, attrs) => {
            out.push({ dataset: { rowId: id, field }, disabled: /\bdisabled\b/.test(attrs), addEventListener() {} });
            return "";
          });
        }
        if (sel.startsWith(".")) {
          const cls = sel.slice(1).split(".")[0];
          h.replace(/<button([^>]*)>([\s\S]*?)<\/button>/g, (_m, attrs, text) => {
            if (!new RegExp(`\\b${cls}\\b`).test(attrs)) return "";
            const id = (attrs.match(/data-id="([^"]*)"/) || [])[1] || "";
            const pth = unesc((attrs.match(/data-path="([^"]*)"/) || [])[1] || "");
            const k = cls + "|" + id + "|" + pth;
            if (!cache.has(k)) cache.set(k, { className: cls, dataset: { id, path: pth }, text: unesc(String(text).replace(/<[^>]+>/g, "")).trim(), onclick: null });
            out.push(cache.get(k));
            return "";
          });
        }
      }
      return out;
    },
  };
}
function makeDom() {
  const els = {};
  const active = makeTbody();
  const completed = makeTbody();
  const mk = (id) => els[id] || (els[id] = { id, style: {}, textContent: "", innerHTML: "", disabled: false, value: "", classList: { add() {}, remove() {} } });
  const $ = (id) => {
    if (id === "queueActiveRows") return active;
    if (id === "queueCompletedRows") return completed;
    if (id === "queueRows") return active;
    return mk(id);
  };
  const document = { createElement: () => ({ className: "", dataset: {}, innerHTML: "", setAttribute() {} }) };
  return { $, document, active, completed, els };
}
async function startPage({ queue, folders = ["Techno"], favs = [{ name: "USB", path: "/Volumes/USB/Tracks" }], lang = "en" }) {
  const dom = makeDom();
  const store = { queue: queue.map((x) => JSON.parse(JSON.stringify(x))), reveal: null, locate: null, addFolder: null, added: null };
  Object.assign(dom.$("format"), { value: "audio:mp3" });
  Object.assign(dom.$("bitrate"), { value: "320" });
  Object.assign(dom.$("queueAllFolder"), { value: "f:Techno" });
  Object.assign(dom.$("queueInput"), { value: "" });
  const ctx = vm.createContext({
    $: dom.$, document: dom.document, console, I18N, LANG: lang, SelektDest,
    knownFolders: folders, knownFavs: favs,
    DEFAULT_AUDIO_BITRATE: "320", autoTagEnabled: true, loudnormEnabled: false, lufsValue: -14,
    calls: { reveal: [], locate: [], addFolder: [], added: [] },
    api: {
      queueGet: async () => JSON.parse(JSON.stringify(store.queue)),
      queueUpdateItem: async (patch) => {
        const it = store.queue.find((i) => i.id === patch.id);
        if (it) Object.assign(it, patch);
        return { ok: true };
      },
      queueSet: async (q) => { store.queue = JSON.parse(JSON.stringify(q)); return { ok: true }; },
      queueAdd: async (items) => { store.added = JSON.parse(JSON.stringify(items)); return { ok: true }; },
      queueRevealOutput: async (id, p) => { store.reveal = [id, p]; return { ok: true }; },
      queueLocateFile: async (id) => { store.locate = id; return { ok: true }; },
      queueAddOutputFolder: async (id, p) => { store.addFolder = [id, p]; return { ok: true }; },
    },
    runQueue: () => {},
  });
  vm.runInContext("let queueRunning = false, queuePaused = false;\nfunction t(k) { return (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k; }\n" + SRC, ctx);
  await ctx.renderQueue();
  return { dom, ctx, store };
}
const item = (id, status, extra = {}) => ({
  id, url: "https://example.com/" + id, status, title: extra.title || ("Fixture " + id),
  format: extra.format || "audio:mp3", bitrate: extra.bitrate || "320", destId: extra.destId === undefined ? "" : extra.destId,
  ...extra,
});

test("new Queue keys exist in ES and EN; no Move/Convert/Add-local strings", () => {
  for (const lang of ["es", "en"]) {
    for (const k of [
      "queue_active_h", "queue_completed_h", "queue_active_hint", "queue_save_to", "queue_download_as",
      "queue_apply_pending", "queue_clear_finished", "queue_remove_errors", "queue_add_preview",
      "queue_show", "queue_locate", "queue_add_this_folder", "queue_remove_list", "queue_pl_history",
      "queue_loc_unknown", "queue_loc_missing", "queue_loc_outside",
    ]) {
      assert.equal(typeof I18N[lang][k], "string", lang + " " + k);
      assert.ok(I18N[lang][k].length > 0, lang + " " + k);
    }
    const blob = Object.values(I18N[lang]).join("\n");
    assert.doesNotMatch(blob, /Move file|Convert a copy|Add local files|Mover archivo|Convertir una copia|Añadir archivos locales/);
  }
});

test("HTML has Active and Completed sections and no Move/Convert buttons", () => {
  assert.match(HTML, /id="queue-active-h"/);
  assert.match(HTML, /id="queue-completed-h"/);
  assert.match(HTML, /id="queueActiveRows"/);
  assert.match(HTML, /id="queueCompletedRows"/);
  assert.match(HTML, /id="queueClearFinishedBtn"/);
  assert.match(HTML, /id="queueRemoveErrorsBtn"/);
  assert.match(HTML, /id="queueAddPreview"/);
  assert.doesNotMatch(HTML, /queueMove|queueConvert|Add local files|Move file|Convert a copy/);
});

test("pending and failed stay in Active; done only in Completed", T, async () => {
  const page = await startPage({
    queue: [
      item("p", "pending"),
      item("r", "running"),
      item("e", "error", { error: "fail" }),
      item("s", "skipped"),
      item("c", "canceled"),
      item("f", "flagged"),
      item("d", "done", {
        title: "Fixture Tone 1kHz.mp3",
        outputDir: "/tmp/Music/Afro",
        destId: "p:/Volumes/Gone/Old",
        encodePlan: { mode: "copy", sourceAbr: null, targetFormat: "mp3", targetBitrate: 320 },
        outputs: [{ path: "/tmp/Music/Afro/Fixture Tone 1kHz.mp3", state: "present", actualFormatLabel: "mp3 source preserved" }],
        identityState: "present",
      }),
    ],
  });
  const activeIds = page.dom.active.rows.map((r) => r.dataset.id);
  const doneIds = page.dom.completed.rows.map((r) => r.dataset.id);
  assert.deepEqual(activeIds.sort(), ["c", "e", "f", "p", "r", "s"]);
  assert.ok(doneIds.includes("d"));
  assert.equal(page.dom.active.querySelectorAll("select[data-row-id]").some((s) => s.dataset.rowId === "d"), false);
  assert.equal(page.dom.completed.querySelectorAll("select[data-row-id]").length, 0);
});

test("completed row shows real folder and preserved format, not unavailable or 320kbps", T, async () => {
  const page = await startPage({
    queue: [item("d", "done", {
      title: "Fixture Tone 1kHz.mp3",
      destId: "p:/Volumes/Gone/Old",
      outputDir: "/Users/fixture/Music/Afro",
      encodePlan: { mode: "copy", sourceAbr: null, targetFormat: "mp3", targetBitrate: 320 },
      outputs: [{
        path: "/Users/fixture/Music/Afro/Fixture Tone 1kHz.mp3",
        state: "present",
        actualFormatLabel: "mp3 source preserved",
      }],
      identityState: "present",
    })],
  });
  const html = page.dom.completed.rows.map((r) => r.innerHTML).join("\n");
  assert.match(html, /Afro/);
  assert.match(html, /source preserved/i);
  assert.doesNotMatch(html, /Folder unavailable|Carpeta no disponible/);
  assert.doesNotMatch(html, /320kbps|320 kbps/);
  assert.match(html, /Show in Finder|Mostrar/);
  assert.match(html, /Remove from list|Quitar de la lista/);
  assert.doesNotMatch(html, /Move file|Convert a copy/);
  assert.equal(page.dom.completed.querySelectorAll("select[data-row-id]").length, 0);
});

test("unknown playlist points at History and has no Locate", T, async () => {
  const page = await startPage({
    queue: [item("pl", "done", {
      playlist: true, title: "Fixture Playlist", identityState: "unknown", outputs: [],
    })],
  });
  const html = page.dom.completed.rows.map((r) => r.innerHTML).join("\n");
  assert.match(html, /History|Historial/);
  assert.doesNotMatch(html, />Locate file<|>Locate<|>Localizar archivo</);
});

test("unknown non-playlist exposes Locate; missing exposes Locate; outside exposes Add this folder", T, async () => {
  const page = await startPage({
    queue: [
      item("u", "done", { title: "Fixture Unknown.mp3", identityState: "unknown", outputs: [] }),
      item("m", "done", {
        title: "Fixture Missing.mp3", identityState: "missing",
        outputs: [{ path: "/tmp/Music/Fixture Missing.mp3", state: "missing", actualFormatLabel: "mp3" }],
      }),
      item("o", "done", {
        title: "Fixture USB Track.mp3", identityState: "outside",
        outputs: [{ path: "/Volumes/USB/Fixture USB Track.mp3", state: "outside", actualFormatLabel: "mp3" }],
      }),
    ],
  });
  const html = page.dom.completed.rows.map((r) => r.innerHTML).join("\n");
  assert.match(html, /Locate file|Localizar archivo/);
  assert.match(html, /Add this folder|Añadir esta carpeta/);
  assert.match(html, /not recorded|no quedó registrada|File not in that folder|no está en esa carpeta|not in this app/i);
});

test("pending damaged destId still shows unavailable select in Active", T, async () => {
  const page = await startPage({ queue: [item("b", "pending", { destId: "garbage", title: "Fixture Bad Dest" })] });
  assert.equal(page.dom.active.rows.length, 1);
  const sels = page.dom.active.querySelectorAll("select[data-row-id]");
  assert.ok(sels.some((s) => s.dataset.field === "destId" && !s.disabled));
  assert.match(page.dom.active.rows[0].innerHTML, /Folder unavailable|Carpeta no disponible/);
});

test("queue-tab paste snapshots loudnorm/autoTag/lufs and playlist:false", T, async () => {
  const page = await startPage({ queue: [] });
  page.ctx.loudnormEnabled = true;
  page.ctx.autoTagEnabled = false;
  page.ctx.lufsValue = -9;
  const [it] = page.ctx.buildQueueItemsFromPaste(["https://example.com/a", "https://example.com/b"]);
  assert.equal(it.loudnorm, true);
  assert.equal(it.autoTag, false);
  assert.equal(it.lufs, -9);
  assert.equal(it.playlist, false);
  assert.equal(it.destId, "f:Techno");
  assert.equal(it.format, "audio:mp3");
  page.ctx.$("queueInput").value = "https://example.com/one\nhttps://example.com/two";
  page.ctx.updateQueueAddPreview();
  assert.match(page.ctx.$("queueAddPreview").textContent, /2|Techno|MP3/i);
});

test("apply-to-pending does not change a done destId", T, async () => {
  const page = await startPage({
    queue: [
      item("p", "pending", { destId: "" }),
      item("d", "done", { destId: "p:/Volumes/Gone/Old", identityState: "unknown", outputs: [] }),
    ],
  });
  await page.ctx.applyFolderToPending("f:Techno");
  assert.equal(page.store.queue.find((i) => i.id === "p").destId, "f:Techno");
  assert.equal(page.store.queue.find((i) => i.id === "d").destId, "p:/Volumes/Gone/Old");
});

test("Show / Locate / Remove from list call the matching APIs; no file delete", T, async () => {
  const page = await startPage({
    queue: [
      item("d", "done", {
        title: "Fixture Tone 1kHz.mp3",
        outputs: [{ path: "/tmp/Music/Afro/Fixture Tone 1kHz.mp3", state: "present", actualFormatLabel: "mp3 source preserved" }],
        identityState: "present",
      }),
      item("u", "done", { title: "Fixture Unknown.mp3", identityState: "unknown", outputs: [] }),
    ],
  });
  const show = page.dom.completed.querySelectorAll(".q-show")[0];
  assert.ok(show && show.onclick);
  await show.onclick();
  assert.deepEqual(page.store.reveal, ["d", "/tmp/Music/Afro/Fixture Tone 1kHz.mp3"]);
  const loc = page.dom.completed.querySelectorAll(".q-locate")[0];
  await loc.onclick();
  assert.equal(page.store.locate, "u");
  const rem = page.dom.completed.querySelectorAll(".q-remove").find((b) => b.dataset.id === "d");
  await rem.onclick();
  assert.deepEqual(page.store.queue.map((i) => i.id), ["u"]);
});
