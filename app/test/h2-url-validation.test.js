"use strict";
// H2 checks: URL validation + "--" terminator for every path that reaches yt-dlp.
// Run from the repo root with:  node --test app/test/h2-url-validation.test.js
// No dependencies, no network, no real yt-dlp/Electron: main.js is loaded with
// stubs for electron, child_process, https and the npm binaries it requires,
// and every IPC handler is called directly. User data lives in a temp folder.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { EventEmitter } = require("events");

const MAIN = path.join(__dirname, "..", "main.js");
const WIN = process.platform === "win32";

function makeHarness({ config = {}, seedBinaries = true, script } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "selekt-h2-"));
  const music = path.join(userData, "Music");
  const binDir = path.join(userData, "bin");
  fs.writeFileSync(path.join(userData, "config.json"),
    JSON.stringify({ main_folder: music, auto_tag: false, prevent_duplicates: false, loudnorm: false, ...config }));
  if (seedBinaries) {
    // Makes ensureBinaries() a no-op: binaries "present", variant current, update check fresh.
    fs.mkdirSync(binDir, { recursive: true });
    for (const n of ["yt-dlp", "ffmpeg", "ffprobe"]) fs.writeFileSync(path.join(binDir, n + (WIN ? ".exe" : "")), "");
    fs.writeFileSync(path.join(binDir, ".ytdlp_variant"), "standalone-1");
    fs.writeFileSync(path.join(binDir, ".ytdlp_checked"), String(Date.now()));
  }

  const handlers = new Map();
  const spawns = [];
  const net = [];
  const state = { script: script || null };

  const defaultScript = (cmd, args) => {
    if (args.includes("-J")) {
      return { code: 0, stdout: JSON.stringify({
        id: "vid1", title: "T", uploader: "U", duration: 10, formats: [],
        entries: [{ id: "a", title: "A", duration: 5, uploader: "U" }],
      }) };
    }
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

  function fakeChild(res) {
    const c = new EventEmitter();
    c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
    setImmediate(() => {
      if (res.stdout) c.stdout.emit("data", Buffer.from(res.stdout));
      if (res.stderr) c.stderr.emit("data", Buffer.from(res.stderr));
      c.emit("close", res.code === undefined ? 0 : res.code);
    });
    return c;
  }

  const blocked = (name) => () => { net.push(name); throw new Error("network blocked in test"); };
  const stubs = {
    electron: {
      app: { setName() {}, getPath: () => userData, whenReady: () => ({ then() {} }), on() {}, dock: null },
      BrowserWindow: class { static getAllWindows() { return []; } },
      ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
      dialog: {}, shell: {}, nativeImage: {}, clipboard: {},
    },
    child_process: {
      spawn: (cmd, args, opts) => {
        spawns.push({ cmd, args: [...args], opts });
        return fakeChild((state.script || defaultScript)(cmd, args, spawns.length));
      },
    },
    https: { get: blocked("get"), request: blocked("request") },
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
  delete require.cache[MAIN];
  require(MAIN);

  return {
    userData, music, binDir, spawns, net, handlers,
    setScript: (fn) => { state.script = fn; },
    invoke: (ch, ...a) => handlers.get(ch)({}, ...a),
    ytdlpCalls: () => spawns.filter(s => s.cmd.includes("yt-dlp") && !s.args.includes("--version")),
    close() {
      Module._load = origLoad;
      delete require.cache[MAIN];
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

async function withHarness(opts, fn) {
  const h = makeHarness(opts);
  try { return await fn(h); } finally { h.close(); }
}

function assertNoSideEffects(h, extra = []) {
  assert.equal(h.spawns.length, 0, "no process launched");
  assert.equal(h.net.length, 0, "no network attempted");
  assert.equal(fs.existsSync(h.binDir), false, "binary setup (ensureBinaries) did not run");
  assert.equal(fs.existsSync(h.music), false, "main/output folder not created");
  for (const f of ["queue.json", "download_history.jsonl", "downloaded_index.jsonl"]) {
    assert.equal(fs.existsSync(path.join(h.userData, f)), false, f + " not written");
  }
  for (const p of extra) assert.equal(fs.existsSync(p), false, p + " not created");
}

// --- inputs -----------------------------------------------------------------
const VALID = [
  "https://www.youtube.com/watch?v=abc123&list=PLx#t=30",
  "http://example.com",
  "HTTP://Example.COM/Path?Q=Mixed#Frag",
  "HtTpS://example.com/a%20b?x=1&y=%E2%9C%93",
  "https://bücher.example/straße?name=ä#frag",
  "https://user:pw@example.com:8443/p;q?r#s",
  "https://[2001:db8::1]/x",
];
const NO_LINK = [undefined, null, "", "   ", "\t\n "];
const INVALID = [
  0, 1, true, false, {}, [], ["https://example.com"], { url: "https://example.com" }, () => "https://example.com",
  "--exec=touch /tmp/x", "--exec touch x", "--version", "-U", "--update", "-", "--", "--config-locations=/tmp/x",
  "--batch-file=/tmp/urls.txt", " --exec=x", "-o x",
  "ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ytsearch:lofi", "ytsearch5:lofi",
  "example.com/watch", "www.example.com", "//example.com/x", "https:example.com", "https:/example.com", "https:", "https://", "http://", "https:///path", "https://\\example.com", "https:\\\\example.com",
  "https://exa mple.com", "https://example.com/\u0000x", "https://example.com/\nsecond", "https://exa\tmple.com", "https://example.com/\u007f",
  "\u0000https://example.com", "x https://example.com", "see https://example.com",
];
const label = (v) => typeof v === "string" ? JSON.stringify(v) : Object.prototype.toString.call(v) + ":" + (typeof v);

// --- validation boundary ----------------------------------------------------
test("valid http(s) URLs reach yt-dlp unchanged, after '--' (get-info, fetch-playlist, download)", async () => {
  for (const url of VALID) {
    await withHarness({}, async (h) => {
      const info = await h.invoke("get-info", url);
      assert.equal(info.ok, true, "get-info " + url);
      const pl = await h.invoke("fetch-playlist", url);
      assert.equal(pl.ok, true, "fetch-playlist " + url);
      const dl = await h.invoke("download", { url, type: "video", quality: "best", autoTag: false });
      assert.equal(dl.ok, true, "download " + url);
      const calls = h.ytdlpCalls();
      assert.equal(calls.length, 3);
      for (const c of calls) {
        assert.deepEqual(c.args.slice(-2), ["--", url], "exact URL after '--'");
        assert.equal(c.args.filter(a => a === "--").length, 1);
      }
    });
  }
});

test("surrounding whitespace is the only thing trimmed", async () => {
  await withHarness({}, async (h) => {
    await h.invoke("get-info", "  \thttps://example.com/x?y=1#z \n");
    assert.deepEqual(h.ytdlpCalls()[0].args.slice(-2), ["--", "https://example.com/x?y=1#z"]);
  });
});

test("missing/empty links keep the existing 'No link provided.' error", async () => {
  for (const v of NO_LINK) {
    await withHarness({ seedBinaries: false }, async (h) => {
      for (const ch of ["get-info", "fetch-playlist"]) {
        assert.deepEqual(await h.invoke(ch, v), { ok: false, error: "No link provided." }, ch + " " + label(v));
      }
      assert.deepEqual(await h.invoke("download", { url: v }), { ok: false, error: "No link provided." });
      assertNoSideEffects(h);
    });
  }
  await withHarness({ seedBinaries: false }, async (h) => {
    for (const o of [undefined, null, "https://example.com", 42]) {
      assert.deepEqual(await h.invoke("download", o), { ok: false, error: "No link provided." });
    }
    assertNoSideEffects(h);
  });
});

test("invalid schemes, leading-option strings and non-strings are rejected before any side effect", async () => {
  for (const v of INVALID) {
    await withHarness({ seedBinaries: false }, async (h) => {
      const evil = path.join(h.userData, "evil-target");
      const rs = [
        await h.invoke("get-info", v),
        await h.invoke("fetch-playlist", v),
        await h.invoke("download", { url: v, targetPath: evil, folder: "sub", type: "video" }),
      ];
      for (const r of rs) {
        assert.equal(r.ok, false, label(v));
        assert.equal(typeof r.error, "string");
        assert.match(r.error, /^Invalid link/, label(v));
        assert.deepEqual(Object.keys(r).sort(), ["error", "ok"], "same {ok:false,error} shape");
      }
      assertNoSideEffects(h, [evil]);
    });
  }
});

// --- argument builders ------------------------------------------------------
test("all three builders keep their options, and cookie args stay before '--'", async () => {
  const url = "https://example.com/v?x=1";
  for (const cookies of [undefined, "firefox"]) {
    await withHarness({ config: cookies ? { cookies_browser: cookies } : {} }, async (h) => {
      await h.invoke("get-info", url);
      await h.invoke("fetch-playlist", url);
      await h.invoke("download", { url, type: "video", quality: "720", autoTag: false });
      const [info, plist, dl] = h.ytdlpCalls().map(c => c.args);
      assert.deepEqual(info.slice(0, 2), ["-J", "--no-playlist"]);
      assert.deepEqual(plist.slice(0, 3), ["-J", "--flat-playlist", "--no-warnings"]);
      assert.deepEqual(dl.slice(0, 2).map((a, i) => i ? a : "-o"), ["-o", dl[1]]);
      for (const a of [dl]) {
        for (const must of ["--newline", "--ffmpeg-location", "--no-simulate", "--print", "after_move:filepath", "--no-playlist", "-f", "--merge-output-format"]) {
          assert.ok(a.includes(must), "download keeps " + must);
        }
        assert.ok(a.includes("bestvideo[height<=720]+bestaudio/best[height<=720]"));
      }
      for (const a of [info, plist, dl]) {
        assert.deepEqual(a.slice(-2), ["--", url]);
        const ci = a.indexOf("--cookies-from-browser");
        if (cookies) { assert.ok(ci >= 0 && ci < a.indexOf("--")); assert.equal(a[ci + 1], cookies); }
        else assert.equal(ci, -1);
      }
    });
  }
});

test("playlist download keeps playlist options and ends with '--', URL", async () => {
  await withHarness({}, async (h) => {
    const url = "https://example.com/playlist?list=PL1";
    const r = await h.invoke("download", { url, type: "playlist", playlistItems: [1, 3], audioFormat: "mp3", autoTag: false });
    assert.equal(r.ok, true);
    const a = h.ytdlpCalls()[0].args;
    assert.ok(a.includes("--yes-playlist") && a.includes("--ignore-errors"));
    assert.equal(a[a.indexOf("--playlist-items") + 1], "1,3");
    assert.deepEqual(a.slice(-2), ["--", url]);
  });
});

test("download's internal info probe (no autoTag:false) also uses '--'", async () => {
  await withHarness({ config: { auto_tag: true } }, async (h) => {
    const url = "https://example.com/probe";
    await h.invoke("download", { url, type: "video", quality: "best" });
    const calls = h.ytdlpCalls();
    assert.equal(calls.length, 2);
    for (const c of calls) assert.deepEqual(c.args.slice(-2), ["--", url]);
    assert.ok(calls[0].args.includes("-J"));
  });
});

test("cookie-store retry keeps '--' and URL (info and download)", async () => {
  await withHarness({ config: { cookies_browser: "firefox" } }, async (h) => {
    const url = "https://example.com/c";
    let n = 0;
    h.setScript((cmd, args) => {
      if (n++ === 0) return { code: 1, stderr: "ERROR: could not find firefox cookies database" };
      if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "i", title: "t" }) };
      return { code: 0 };
    });
    const r = await h.invoke("get-info", url);
    assert.equal(r.ok, true);
    const [first, second] = h.ytdlpCalls().map(c => c.args);
    assert.ok(first.includes("--cookies-from-browser") && !second.includes("--cookies-from-browser"));
    assert.deepEqual(first.slice(-2), ["--", url]);
    assert.deepEqual(second.slice(-2), ["--", url]);

    h.spawns.length = 0; n = 0;
    h.setScript((cmd, args) => n++ === 0
      ? { code: 1, stderr: "ERROR: could not find firefox cookies database" }
      : { code: 0 });
    const d = await h.invoke("download", { url, type: "video", autoTag: false });
    assert.equal(d.ok, true);
    const [d1, d2] = h.ytdlpCalls().map(c => c.args);
    assert.ok(d1.includes("--cookies-from-browser") && !d2.includes("--cookies-from-browser"));
    assert.deepEqual(d1.slice(-2), ["--", url]);
    assert.deepEqual(d2.slice(-2), ["--", url]);
  });
});

// --- response contracts -----------------------------------------------------
test("existing success/failure response shapes are unchanged", async () => {
  await withHarness({}, async (h) => {
    const url = "https://example.com/contract";
    const info = await h.invoke("get-info", url);
    assert.deepEqual(Object.keys(info).sort(),
      ["artist", "duration", "id", "ok", "sourceAbr", "sourceAcodec", "sourceAsr", "thumbnail", "title", "track", "uploader"]);
    const pl = await h.invoke("fetch-playlist", url);
    assert.deepEqual(Object.keys(pl).sort(), ["count", "entries", "ok", "title"]);
    assert.deepEqual(Object.keys(pl.entries[0]).sort(), ["duration", "id", "index", "title", "unavailable", "uploader"]);
    const dl = await h.invoke("download", { url, type: "video", autoTag: false });
    assert.deepEqual(Object.keys(dl).sort(), ["count", "files", "folder", "ok"]);
    h.setScript(() => ({ code: 1, stderr: "ERROR: boom" }));
    const bad = await h.invoke("download", { url, type: "video", autoTag: false });
    assert.deepEqual(bad, { ok: false, error: "ERROR: boom", needsCookies: false });
  });
});

// --- queue / retry / watch --------------------------------------------------
// Mirrors the renderer's runQueue loop (renderer.js ~1703-1752): pick the first
// pending item, mark running, call download, map the result to done/skipped/
// canceled/error, continue. The renderer itself is not executed here.
async function runQueueLikeRenderer(h, toOpts) {
  for (let guard = 0; guard < 50; guard++) {
    const q = await h.invoke("queue-get");
    const item = q.find(i => i.status === "pending");
    if (!item) return;
    await h.invoke("queue-update-item", { id: item.id, status: "running" });
    let r;
    try { r = await h.invoke("download", toOpts(item)); } catch (e) { r = { ok: false, error: String(e) }; }
    let status = "error", error = null;
    if (r.ok) status = "done";
    else if (r.canceled) status = "canceled";
    else if (r.duplicate || r.skipped) status = "skipped";
    else error = r.error || "download failed";
    await h.invoke("queue-update-item", { id: item.id, status, error });
  }
  throw new Error("queue did not drain");
}
const toOpts = (item) => ({
  url: item.url, type: item.playlist ? "playlist" : "video", quality: "best", autoTag: false, _inQueue: true,
  ...(item.playlistItems ? { playlistItems: item.playlistItems } : {}),
});

test("invalid persisted queue items error out individually; later valid items still run", async () => {
  await withHarness({}, async (h) => {
    const good = "https://example.com/watch?v=ok#t=1";
    const stored = [
      { id: "1", url: "--exec=touch /tmp/x", status: "pending", title: null, error: null },
      { id: "2", url: 123, status: "pending" },
      { id: "3", status: "pending" },
      { id: "4", url: "ftp://example.com/x", status: "pending", format: "audio:mp3" },
      { id: "5", url: "-U", status: "pending" },
      { id: "6", url: good, status: "pending", playlist: true, playlistItems: [2], destId: "" },
      { id: "7", url: good, status: "done" },
    ];
    fs.writeFileSync(path.join(h.userData, "queue.json"), JSON.stringify(stored));
    await runQueueLikeRenderer(h, toOpts);
    const after = await h.invoke("queue-get");
    assert.deepEqual(after.map(i => i.status), ["error", "error", "error", "error", "error", "done", "done"]);
    for (const i of after.slice(0, 5)) assert.match(i.error, /^(Invalid link|No link provided)/);
    assert.equal(after.length, stored.length, "no item dropped");
    stored.forEach((s, k) => { assert.equal(after[k].id, s.id); assert.deepEqual(after[k].url, s.url, "stored url not rewritten"); });
    const calls = h.ytdlpCalls();
    assert.equal(calls.length, 1, "only the valid item launched yt-dlp");
    assert.deepEqual(calls[0].args.slice(-2), ["--", good]);
    assert.equal(calls[0].args[calls[0].args.indexOf("--playlist-items") + 1], "2");
  });
});

test("queue mutation entry points keep their contracts (validation lives at the yt-dlp boundary)", async () => {
  await withHarness({}, async (h) => {
    assert.deepEqual(await h.invoke("queue-set", [{ id: "x", url: "nope", status: "pending" }]), { ok: true });
    const r = await h.invoke("queue-add", [{ url: "--exec=x" }, { url: "https://example.com/a" }]);
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2);
    assert.ok(r.items.every(i => i.id && i.status === "pending" && i.title === null && i.error === null));
    assert.deepEqual(await h.invoke("queue-update-item", { id: "x", url: "still-not-a-url" }), { ok: true });
    assert.equal((await h.invoke("queue-get")).length, 3);
    assert.equal(h.spawns.length, 0);
  });
});

test("retry of a failed valid item still works", async () => {
  await withHarness({}, async (h) => {
    const url = "https://example.com/retry";
    await h.invoke("queue-add", [{ url, type: "audio" }]);
    h.setScript(() => ({ code: 1, stderr: "ERROR: network down" }));
    await runQueueLikeRenderer(h, toOpts);
    let q = await h.invoke("queue-get");
    assert.equal(q[0].status, "error");
    h.setScript(null);
    await h.invoke("queue-update-item", { id: q[0].id, status: "pending", error: null, note: null, force: false });
    await runQueueLikeRenderer(h, toOpts);
    q = await h.invoke("queue-get");
    assert.equal(q[0].status, "done");
    assert.ok(h.ytdlpCalls().every(c => c.args.slice(-2).join("|") === "--|" + url));
  });
});

test("watch-folder: filtered lines enqueue as before; one that slips through the prefix filter errors alone", async () => {
  await withHarness({}, async (h) => {
    const inbox = path.join(h.userData, "inbox", "inbox.txt");
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.writeFileSync(inbox, [
      "https://example.com/a?x=1", "--exec=touch /tmp/x", "-U", "  https://example.com/b  ", "ftp://example.com/c",
      "https://", "https://example.com/d#frag",
    ].join("\n"));
    assert.deepEqual(await h.invoke("watch-set", { inbox_path: inbox, enabled: true }), { ok: true });
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map(i => i.url), ["https://example.com/a?x=1", "https://example.com/b", "https://", "https://example.com/d#frag"]);
    assert.ok(q.every(i => i.source === "watch" && i.status === "pending"));
    await runQueueLikeRenderer(h, toOpts);
    const after = await h.invoke("queue-get");
    assert.deepEqual(after.map(i => i.status), ["done", "done", "error", "done"]);
    assert.match(after[2].error, /^Invalid link/);
    assert.deepEqual(h.ytdlpCalls().map(c => c.args.at(-1)),
      ["https://example.com/a?x=1", "https://example.com/b", "https://example.com/d#frag"]);
    await h.invoke("watch-stop");
  });
});

// --- source guard -----------------------------------------------------------
test("source guard: yt-dlp is spawned in exactly the known places and each URL arg follows '--'", () => {
  const src = fs.readFileSync(MAIN, "utf8");
  assert.equal((src.match(/spawn\(YTDLP_PATH/g) || []).length, 3, "version probe, runYtdlp, ytdlpJson");
  assert.equal((src.match(/ytdlpJson\(\[/g) || []).length, 2);
  assert.equal((src.match(/"--", url\b|"--", urlCheck\.url/g) || []).length, 3);
  assert.equal((src.match(/args\.push\(url\)/g) || []).length, 0);
});
