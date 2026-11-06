"use strict";
// Shared stub harness for the H3 checks (the H2 test keeps its own copy).
// Loads app/main.js with stubs for electron, child_process, https and the npm
// binaries; IPC handlers are called directly. Everything lives in a temp folder.
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { EventEmitter } = require("events");

const MAIN = path.join(__dirname, "..", "main.js");
const WIN = process.platform === "win32";

function makeHarness({ config = {}, seedBinaries = true, withWindow = false, https = null, beforeLoad = null, clipboard = {} } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "selekt-h3-"));
  const music = path.join(userData, "Music");
  const binDir = path.join(userData, "bin");
  // These H1-H4 checks predate the new app defaults (Avoid duplicates / Normalize on). They exercise the
  // plain path, so the fixture saves those two OFF explicitly; test/defaults.test.js covers the defaults.
  const cfg = { main_folder: music, auto_tag: false, prevent_duplicates: false, loudnorm: false, ...config };
  fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify(cfg));
  if (seedBinaries) {
    fs.mkdirSync(binDir, { recursive: true });
    for (const n of ["yt-dlp", "ffmpeg", "ffprobe"]) fs.writeFileSync(path.join(binDir, n + (WIN ? ".exe" : "")), "");
    fs.writeFileSync(path.join(binDir, ".ytdlp_variant"), "standalone-1");
    fs.writeFileSync(path.join(binDir, ".ytdlp_checked"), String(Date.now()));
  }
  const handlers = new Map();
  const spawns = [], net = [], opened = [], dialogs = [], trashed = [], sent = [], wcHandlers = {};
  const state = { script: null, dialogPaths: [], trashError: null, trashImpl: null, openError: "" };

  const defaultScript = (cmd, args) => {
    if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "vid1", title: "T", entries: [{ id: "a", title: "A" }] }) };
    const o = args.indexOf("-o");
    if (o >= 0) {
      let dir = path.dirname(args[o + 1]);
      if (args[o + 1].includes("%(playlist_title)s")) dir = path.dirname(dir);
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "stub.mp4");
      fs.writeFileSync(f, "x");
      return { code: 0, stdout: f + "\n" };
    }
    return { code: 0 };
  };
  const hangers = [];
  const fakeChild = (res) => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.kill = () => { process.nextTick(() => c.emit("close", res.killedCode === undefined ? 1 : res.killedCode)); };
    const finish = () => {
      if (res.stdout) c.stdout.emit("data", Buffer.from(res.stdout));
      if (res.stderr) c.stderr.emit("data", Buffer.from(res.stderr));
      c.emit("close", res.code === undefined ? 0 : res.code);
    };
    if (res.hang) {
      hangers.push({ c, finish, res });
      if (res.stdout) process.nextTick(() => c.stdout.emit("data", Buffer.from(res.stdout)));
      if (res.stderr) process.nextTick(() => c.stderr.emit("data", Buffer.from(res.stderr)));
      return c;
    }
    setImmediate(finish);
    return c;
  };
  const blocked = (n) => () => { net.push(n); throw new Error("network blocked in test"); };
  const stubs = {
    electron: {
      app: { setName() {}, getPath: () => userData, whenReady: () => ({ then(cb) { if (withWindow) cb(); } }), on() {}, dock: null },
      BrowserWindow: class {
        static getAllWindows() { return []; }
        constructor() { this.webContents = { on: (ev, cb) => { (wcHandlers[ev] = wcHandlers[ev] || []).push(cb); }, send: (ch, payload) => sent.push([ch, payload]) }; }
        loadFile() {}
      },
      ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
      dialog: { showOpenDialog: async () => {
        dialogs.push(1);
        const p = state.dialogPaths.shift();
        return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
      } },
      // trashItem / openPath never touch the real OS: they only record, or fail on request.
      shell: { openPath: (p) => { opened.push(["openPath", p]); return Promise.resolve(state.openError); },
               showItemInFolder: (p) => opened.push(["reveal", p]),
               trashItem: (p) => { trashed.push(p); if (state.trashImpl) return state.trashImpl(p); return state.trashError ? Promise.reject(state.trashError) : Promise.resolve(); } },
      nativeImage: {}, clipboard,   // `clipboard`: a test-supplied fake (see clipboard-electron44.test.js); never the real one
    },
    child_process: { spawn: (cmd, args, o) => { spawns.push({ cmd, args: [...args] }); return fakeChild((state.script || defaultScript)(cmd, args)); } },
    https: https || { get: blocked("get"), request: blocked("request") },   // `https`: a test-supplied fake (see h4-engine-reliability.test.js)
    "ffmpeg-static": path.join(userData, "ffmpeg-fake"),
    "ffprobe-static": { path: path.join(userData, "ffprobe-fake") },
    "yt-dlp-wrap": { default: class {} },
    chokidar: { watch: () => ({ on() {}, close() {} }) },
  };
  const origLoad = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.apply(this, arguments);
  };
  if (beforeLoad) beforeLoad({ userData, binDir });   // arrange files that main.js reads at LAUNCH (e.g. an old yt-dlp)
  delete require.cache[MAIN];
  require(MAIN);

  const h = {
    userData, music, binDir, spawns, net, opened, dialogs, trashed, sent,
    p: (...a) => path.join(userData, ...a),
    mkdir: (...a) => { const d = path.join(userData, ...a); fs.mkdirSync(d, { recursive: true }); return d; },
    write: (rel, content = "x") => { const f = path.join(userData, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; },
    setConfig: (patch) => {
      const f = path.join(userData, "config.json");
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), ...patch }));
    },
    config: () => JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8")),
    setScript: (fn) => { state.script = fn; },
    setTrashError: (e) => { state.trashError = e; },
    setTrashImpl: (fn) => { state.trashImpl = fn; },
    fireWebContents: (ev) => (wcHandlers[ev] || []).forEach(fn => fn()),   // e.g. "did-finish-load" (renderer reload)
    setOpenError: (msg) => { state.openError = msg; },
    waitFor: async (fn, ms = 2000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
      return fn();
    },
    queueDialog: (...paths) => state.dialogPaths.push(...paths),
    invoke: (ch, ...a) => handlers.get(ch)({}, ...a),
    pendingHangs: () => hangers.length,
    releaseHang: (code = 0) => {
      const hng = hangers.shift();
      if (!hng) return false;
      process.nextTick(() => hng.c.emit("close", code));
      return true;
    },
    ytdlpCalls: () => spawns.filter(s => s.cmd.includes("yt-dlp") && !s.args.includes("--version")),
    // Listing of every entry (type + symlink target + file bytes) under userData, excluding the
    // app's own config/bin files, so "no filesystem mutation" is a plain deepEqual.
    snapshot: () => {
      const out = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const f = path.join(d, e.name), rel = path.relative(userData, f);
          if (e.isSymbolicLink()) out.push(rel + " -> " + fs.readlinkSync(f));
          else if (e.isDirectory()) { out.push(rel + "/"); walk(f); }
          else out.push(rel + " #" + fs.readFileSync(f, "utf8").length);
        }
      };
      walk(userData);
      return out;
    },
    close() {
      Module._load = origLoad;
      delete require.cache[MAIN];
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
  return h;
}

async function withHarness(opts, fn) {
  const h = makeHarness(opts);
  try { return await fn(h); } finally { h.close(); }
}

// The destId -> options conversion is the REAL shared module the renderer loads
// (renderer/destination.js). runQueueLikeRenderer starts the production main
// queue runner (queue-start) and waits for it to drain.
const SelektDest = require("../renderer/destination.js");
const queueItemDest = (item) => SelektDest.queueItemDest(item);
const INVALID_DEST_TEXT = "This app can't use that location. Choose the folder again.";   // = renderer t("dest_bad") (en)
const toOpts = (item) => ({
  url: item.url, type: item.playlist ? "playlist" : "video", quality: "best", autoTag: false, _inQueue: true,
  ...(item.playlistItems ? { playlistItems: item.playlistItems } : {}),
  ...queueItemDest(item),
});
async function runQueueLikeRenderer(h) {
  await h.invoke("queue-start");
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const st = await h.invoke("queue-status");
    if (!st.running) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail("queue did not drain");
}

module.exports = { makeHarness, withHarness, runQueueLikeRenderer, queueItemDest, toOpts, SelektDest, INVALID_DEST_TEXT };
