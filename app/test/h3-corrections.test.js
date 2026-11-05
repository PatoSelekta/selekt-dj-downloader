"use strict";
// Corrections to the H3 pass: malformed destinations never fall back to the main
// folder; create-folder failures are reported; the main folder can only be set from
// the main-folder picker (not from the watch picker).
// Run from the repo root with:  node --test app/test/h3-corrections.test.js
// Stubs only; temp directories. The destId conversion under test is the real
// renderer/destination.js. The folder-creation UI itself is NOT exercised here
// (it needs a DOM); see the browser-level evidence kept outside the candidate.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { withHarness, runQueueLikeRenderer, SelektDest, INVALID_DEST_TEXT } = require("./h3-harness");

const NOT_ALLOWED = /not the main folder or one of your favorite folders/;
const dl = (h, o) => h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false, ...o });
const tmplDir = (call) => path.dirname(call.args[call.args.indexOf("-o") + 1]);

// --- shared destination conversion (the code the renderer loads) ------------
test("destId conversion: only an absent/empty id is the main folder; malformed ids are reported", () => {
  const q = (destId) => SelektDest.queueItemDest({ destId });
  for (const d of ["", undefined, null]) assert.deepEqual(q(d), { folder: "" }, "intentional main folder: " + String(d));
  assert.deepEqual(SelektDest.queueItemDest({}), { folder: "" });
  assert.deepEqual(SelektDest.queueItemDest(undefined), { folder: "" }, "no item");
  assert.deepEqual(q("f:Techno"), { folder: "Techno" });
  assert.deepEqual(q("f:Afro House 2024"), { folder: "Afro House 2024" });
  assert.deepEqual(q("f:Música"), { folder: "Música" });
  assert.deepEqual(q("p:/Volumes/DJ/Sets"), { targetPath: "/Volumes/DJ/Sets" });
  assert.deepEqual(q("p:C:\\Music\\Fav "), { targetPath: "C:\\Music\\Fav " }, "path is passed through untouched");
  assert.deepEqual(q("f:../x"), { folder: "../x" }, "traversal is main's job to reject (checked in the integration tests)");
  for (const d of ["p:", "p:   ", "f:", "f:  ", "x:foo", "main", "P:/x", "F:x", "/abs/path", "Techno", 5, 0, true, false, {}, [], ["p:/x"]]) {
    assert.deepEqual(q(d), { destInvalid: true }, "malformed: " + JSON.stringify(d));
  }
});

// --- real conversion -> main handlers ---------------------------------------
test("queue: malformed destinations error per item, never download into the main folder; valid ones still run", async () => {
  await withHarness({}, async (h) => {
    const music = h.mkdir("Music");
    const fav = h.mkdir("ext", "Fav");
    h.setConfig({ favorite_folders: [{ path: fav, name: "Fav" }] });
    const u = (n) => `https://example.com/watch?v=${n}`;
    const stored = [
      { id: "1", url: u(1), destId: "p:", status: "pending" },
      { id: "2", url: u(2), destId: "f:", status: "pending" },
      { id: "3", url: u(3), destId: "x:oops", status: "pending" },
      { id: "4", url: u(4), destId: "p:   ", status: "pending" },
      { id: "5", url: u(5), destId: 5, status: "pending" },
      { id: "6", url: u(6), destId: "f:../outside", status: "pending" },
      { id: "7", url: u(7), destId: "", status: "pending" },                       // intentional main folder
      { id: "8", url: u(8), status: "pending" },                                    // no destId: main folder (existing format)
      { id: "9", url: u(9), destId: "f:Techno", status: "pending" },
      { id: "10", url: u(10), destId: "p:" + fav, status: "pending" },
      { id: "11", url: u(11), destId: "p:" + fav, status: "pending", playlist: true, playlistItems: [1] },
    ];
    fs.writeFileSync(h.p("queue.json"), JSON.stringify(stored));
    await runQueueLikeRenderer(h);
    const after = await h.invoke("queue-get");
    const st = Object.fromEntries(after.map(i => [i.id, i.status]));
    for (const id of ["1", "2", "3", "4", "5", "6"]) assert.equal(st[id], "error", id);
    for (const id of ["7", "8", "9", "10", "11"]) assert.equal(st[id], "done", id);
    for (const id of ["1", "2", "3", "4", "5"]) assert.equal(after.find(i => i.id === id).error, INVALID_DEST_TEXT);
    assert.match(after.find(i => i.id === "6").error, /Invalid folder name/);
    assert.equal(after.length, stored.length, "queue format and length preserved");
    stored.forEach((s, k) => assert.deepEqual(after[k].destId, s.destId, "stored destId not rewritten"));
    const calls = h.ytdlpCalls().filter(c => c.args.includes("-o"));
    assert.equal(calls.length, 5, "only the five valid items launched a yt-dlp download");
    assert.deepEqual(calls.map(tmplDir), [
      music, music, path.join(music, "Techno"), fav, path.dirname(path.join(fav, "%(playlist_title)s", "x")),
    ]);
  });
});

test("malformed destinations sent straight to main are rejected, not defaulted to the main folder", async () => {
  await withHarness({ seedBinaries: false }, async (h) => {
    h.mkdir("Music");
    const before = h.snapshot();
    const badTarget = ["", "   ", 0, false, {}, [], 5, "relative"];
    const badFolder = [0, false, " ", {}, [], 5, "a/b"];
    for (const targetPath of badTarget) {
      const r = await dl(h, { targetPath });
      assert.equal(r.ok, false, JSON.stringify(targetPath)); assert.match(r.error, NOT_ALLOWED);
      const c = await h.invoke("check-duplicate", { id: "vid1", targetPath, type: "video" });
      assert.equal(c.exists, false); assert.deepEqual(c.files, []); assert.match(c.error, NOT_ALLOWED);
    }
    for (const folder of badFolder) {
      const r = await dl(h, { folder });
      assert.equal(r.ok, false, JSON.stringify(folder)); assert.equal(typeof r.error, "string");
    }
    assert.equal(h.spawns.length, 0);
    assert.deepEqual(h.snapshot(), before, "nothing created, including bin/");
  });
  await withHarness({}, async (h) => {
    for (const o of [{}, { folder: "" }, { folder: undefined }, { folder: null }, { targetPath: undefined }, { targetPath: null }, { targetPath: null, folder: "" }]) {
      const r = await dl(h, o);
      assert.equal(r.ok, true, JSON.stringify(o)); assert.equal(r.folder, h.music, "explicit/absent main-folder forms still work");
    }
    assert.deepEqual(await h.invoke("check-duplicate", { id: "vid1", type: "video" }), { exists: false, files: [] });
  });
});

// --- create-folder failures --------------------------------------------------
test("create-folder reports a filesystem failure instead of throwing, and records nothing", async () => {
  await withHarness({}, async (h) => {
    h.mkdir("Music");
    h.write("Music/Blocked", "i am a file");                       // mkdir on an existing file fails (EEXIST)
    const cfgBefore = fs.readFileSync(h.p("config.json"), "utf8");
    const r = await h.invoke("create-folder", "Blocked");
    assert.deepEqual(r, { ok: false, error: "create failed", code: "EEXIST" });
    assert.equal(fs.readFileSync(h.p("config.json"), "utf8"), cfgBefore, "config untouched");
    assert.deepEqual(await h.invoke("create-folder", "../x"), { ok: false, error: "invalid name" });
    assert.deepEqual(await h.invoke("create-folder", "Fine"), { ok: true, created: path.join(h.music, "Fine"), name: "Fine" });
  });
});

// --- picker trust boundary ---------------------------------------------------
test("a folder picked for the watch inbox never authorizes a main-folder change", async () => {
  await withHarness({}, async (h) => {
    h.mkdir("Music");
    const picked = h.p("Elsewhere", "WatchPick");
    h.queueDialog(picked);
    assert.equal(await h.invoke("pick-folder"), picked, "the generic/watch picker still returns the folder");
    const before = h.snapshot();
    const r = await h.invoke("set-main-folder", picked);
    assert.equal(r.ok, false); assert.equal(typeof r.error, "string");
    assert.deepEqual(h.snapshot(), before, "nothing created; config untouched");
    assert.equal(h.config().main_folder, h.music);
    // the watch flow itself is unchanged by this
    const inbox = path.join(picked, "inbox.txt");
    assert.deepEqual(await h.invoke("watch-set", { inbox_path: inbox, enabled: true }), { ok: true });
    assert.ok(fs.existsSync(inbox));
    await h.invoke("watch-stop");
  });
});

test("main-folder grant: only the latest main-picker result, single use, cancel clears it", async () => {
  await withHarness({}, async (h) => {
    h.mkdir("Music");
    const [a, b, c, d] = ["A", "B", "C", "D"].map(n => h.p("picks", n));
    h.queueDialog(a); h.queueDialog(b);
    assert.equal(await h.invoke("pick-main-folder"), a);
    assert.equal(await h.invoke("pick-main-folder"), b);
    assert.equal((await h.invoke("set-main-folder", a)).ok, false, "an earlier pick no longer counts");
    assert.deepEqual(await h.invoke("set-main-folder", b), { ok: true, main_folder: b });
    assert.equal((await h.invoke("set-main-folder", a)).ok, false);
    assert.deepEqual(await h.invoke("set-main-folder", b), { ok: true, main_folder: b }, "re-setting the current main folder is fine");

    h.queueDialog(c);
    assert.equal(await h.invoke("pick-main-folder"), c);
    assert.equal(await h.invoke("pick-main-folder"), null, "cancelled dialog");
    assert.equal((await h.invoke("set-main-folder", c)).ok, false, "a cancelled pick clears the previous grant");

    h.queueDialog(d);
    await h.invoke("pick-main-folder");
    assert.equal((await h.invoke("set-main-folder", d + path.sep)).ok, false, "exact picked string only");
    assert.equal((await h.invoke("set-main-folder", d)).ok, true);
    assert.equal(h.config().main_folder, d);
    assert.equal((await h.invoke("set-main-folder", c)).ok, false, "grant was consumed");
  });
});

// --- source guard ------------------------------------------------------------
test("source guard: renderer wiring for the corrections", () => {
  const dir = path.join(__dirname, "..");
  const r = fs.readFileSync(path.join(dir, "renderer", "renderer.js"), "utf8");
  const html = fs.readFileSync(path.join(dir, "renderer", "index.html"), "utf8");
  const pre = fs.readFileSync(path.join(dir, "preload.js"), "utf8");
  assert.ok(html.indexOf('src="destination.js"') > 0 && html.indexOf('src="destination.js"') < html.indexOf('src="renderer.js"'), "destination.js loads before renderer.js");
  const main = fs.readFileSync(path.join(dir, "main.js"), "utf8");
  assert.match(r, /return SelektDest\.queueItemDest\(item\)/);
  assert.match(main, /if \(dest\.destInvalid\)/);
  assert.match(r, /errorCode === "dest_bad"/);
  assert.equal((r.match(/await tryCreateFolder\(name\)/g) || []).length, 2, "both creation flows go through tryCreateFolder");
  assert.equal((r.match(/await api\.createFolder\(/g) || []).length, 1, "createFolder is only called inside tryCreateFolder");
  assert.match(r, /api\.pickMainFolder\(\)/);
  assert.match(pre, /pickMainFolder: \(\) => ipcRenderer\.invoke\("pick-main-folder"\)/);
  assert.match(html, /id="folderNameErr"[^>]*role="alert"/);
  for (const k of ["folder_name_bad", "folder_create_failed", "dest_bad"]) assert.equal((r.match(new RegExp(k + ":", "g")) || []).length, 2, k + " in es and en");
});
