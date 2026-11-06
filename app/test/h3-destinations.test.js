"use strict";
// H3 checks: folder-name validation and authorized download/duplicate-check
// destinations (main folder, subfolders of it, exact favorites).
// Run from the repo root with:  node --test app/test/h3-destinations.test.js
// Stubs only (electron, child_process, https, npm binaries); temp directories;
// no real yt-dlp, network, cookies or user files. The renderer is not executed;
// its queue/destination mapping is mirrored in h3-harness.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { withHarness, runQueueLikeRenderer } = require("./h3-harness");

const NOT_ALLOWED = /can't use that location/;
function symlink(target, linkPath) {
  try { fs.mkdirSync(path.dirname(linkPath), { recursive: true }); fs.symlinkSync(target, linkPath, "dir"); return true; }
  catch (_) { return false; }   // e.g. Windows without symlink privilege: symlink cases are skipped
}
function layout(h) {
  const L = {};
  L.music = h.mkdir("Music");
  L.fav = h.mkdir("ext", "Fav");
  L.favEvil = h.mkdir("ext", "Fav-evil");
  L.musicEvil = h.mkdir("Music-evil");
  L.outside = h.mkdir("outside");
  h.write("outside/victim.txt");
  L.linkOut = symlink(L.outside, path.join(L.music, "link-out"));
  L.linkFav = symlink(L.fav, h.p("ext", "linkfav"));
  L.escape = symlink(L.outside, path.join(L.fav, "escape"));
  h.setConfig({ favorite_folders: [{ path: L.fav, name: "Fav" }] });
  return L;
}
const dl = (h, o) => h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false, ...o });
const tmplOf = (call) => call.args[call.args.indexOf("-o") + 1];

// --- folder names -----------------------------------------------------------
test("create-folder: ordinary single-level names (spaces, Unicode) work and keep their contract", async () => {
  await withHarness({}, async (h) => {
    const names = ["Techno", "Afro House 2024", "Música", "日本語", "🎧 Set", "a.b", ".hidden", "-dash", "Drum & Bass"];
    for (const name of names) {
      const r = await h.invoke("create-folder", name);
      assert.deepEqual(r, { ok: true, created: path.join(h.music, name), name }, name);
      assert.ok(fs.statSync(path.join(h.music, name)).isDirectory());
      assert.ok(h.config().created_folders.includes(path.join(h.music, name)));
    }
  });
});

test("create-folder: traversal, absolute, malformed names are rejected with no filesystem change", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const before = h.snapshot();
    const bad = ["..", "../x", "..\\x", "a/b", "a\\b", "/abs", "/", "\\", "C:\\x", "..\\..", "./x", ".", "...", " lead", "trail ", "x.", "x ",
      "a\u0000b", "a\nb", "a\tb", " ", "a".repeat(256), "\u007f", 5, true, {}, ["x"], path.join(L.outside, "made-by-test")];
    for (const name of bad) {
      assert.deepEqual(await h.invoke("create-folder", name), { ok: false, error: "invalid name" }, JSON.stringify(name));
    }
    for (const name of ["", null, undefined, 0]) assert.deepEqual(await h.invoke("create-folder", name), { ok: false }, "legacy missing-name contract");
    assert.deepEqual(h.snapshot(), before);
  });
});

test("create-folder: a name that is a symlink pointing outside the main folder is rejected", async (t) => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    if (!L.linkOut) return t.skip("symlinks unavailable");
    const before = h.snapshot();
    assert.deepEqual(await h.invoke("create-folder", "link-out"), { ok: false, error: "invalid name" });
    assert.deepEqual(h.snapshot(), before);
    assert.ok(!h.config().created_folders || !h.config().created_folders.includes(path.join(L.music, "link-out")));
  });
});

test("rename-folder: normal rename keeps its contract; error strings unchanged; traversal rejected untouched", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    await h.invoke("create-folder", "Old");
    await h.invoke("create-folder", "Other");
    h.setConfig({ pinned: ["f:Old"], created_folders: h.config().created_folders });
    assert.deepEqual(await h.invoke("rename-folder", { oldName: "Old", newName: "Új név" }), { ok: true, name: "Új név" });
    assert.ok(fs.existsSync(path.join(L.music, "Új név")) && !fs.existsSync(path.join(L.music, "Old")));
    const cfg = h.config();
    assert.ok(cfg.created_folders.includes(path.join(L.music, "Új név")) && !cfg.created_folders.includes(path.join(L.music, "Old")));
    assert.deepEqual(cfg.pinned, ["f:Új név"]);
    assert.deepEqual(await h.invoke("rename-folder", { oldName: "nope", newName: "z" }), { ok: false, error: "not found" });
    assert.deepEqual(await h.invoke("rename-folder", { oldName: "Új név", newName: "Other" }), { ok: false, error: "exists" });
    assert.deepEqual(await h.invoke("rename-folder", { oldName: "", newName: "z" }), { ok: false, error: "missing name" });
    assert.deepEqual(await h.invoke("rename-folder"), { ok: false, error: "missing name" });

    const before = h.snapshot();
    const pairs = [["../outside", "moved"], ["Other", "../moved"], ["..", "x"], ["Other", "../../x"], ["a/b", "c"], ["Other", h.p("zz-abs")],
      ["Other", "a\\b"], ["../outside", "../moved2"], [L.outside, "m"], ["Other", " lead"], ["Other", "x."], ["Other", 5], [5, "Other2"]];
    for (const [oldName, newName] of pairs) {
      assert.deepEqual(await h.invoke("rename-folder", { oldName, newName }), { ok: false, error: "invalid name" }, JSON.stringify([oldName, newName]));
    }
    assert.deepEqual(h.snapshot(), before);
    assert.ok(fs.existsSync(path.join(L.outside, "victim.txt")));
  });
});

test("open-folder: main and valid subfolders open; traversal/symlink names open and create nothing", async (t) => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    assert.deepEqual(await h.invoke("open-folder", ""), { ok: true });
    assert.deepEqual(await h.invoke("open-folder", "Techno"), { ok: true });
    assert.ok(fs.statSync(path.join(L.music, "Techno")).isDirectory(), "valid subfolder is created as before");
    assert.deepEqual(h.opened, [["openPath", L.music], ["openPath", path.join(L.music, "Techno")]]);
    const before = h.snapshot();
    for (const name of ["../outside", "a/b", "/abs", "..", ".. ", "x\u0000y", 5, ...(L.linkOut ? ["link-out"] : [])]) {
      const r = await h.invoke("open-folder", name); assert.equal(r.ok, false, JSON.stringify(name)); assert.equal(r.code, "not_allowed", JSON.stringify(name));
    }
    assert.equal(h.opened.length, 2, "nothing else opened");
    assert.deepEqual(h.snapshot(), before);
  });
});

test("Windows-only name rules (process.platform overridden for the call; rejection happens before any fs access)", async () => {
  await withHarness({}, async (h) => {
    layout(h);
    const orig = Object.getOwnPropertyDescriptor(process, "platform");
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      const before = h.snapshot();
      for (const name of ["a:b", "CON", "nul.txt", "LPT1", "x*y", "a|b", "q?", "<x>", 'a"b']) {
        assert.deepEqual(await h.invoke("create-folder", name), { ok: false, error: "invalid name" }, name);
      }
      assert.deepEqual(h.snapshot(), before);
      assert.equal((await h.invoke("create-folder", "Console")).ok, true);
      assert.equal((await h.invoke("create-folder", "COM10")).ok, true);
    } finally { Object.defineProperty(process, "platform", orig); }
    if (process.platform !== "win32") assert.equal((await h.invoke("create-folder", "a:b")).ok, true, "':' stays legal on non-Windows");
  });
});

// --- download destinations --------------------------------------------------
test("download: main folder, subfolder and exact favorite work; response contract and playlist output unchanged", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    let r = await dl(h, {});
    assert.deepEqual(Object.keys(r).sort(), ["count", "files", "folder", "ok"]);
    assert.equal(r.ok, true); assert.equal(r.folder, L.music);
    r = await dl(h, { folder: "Afro House" });
    assert.equal(r.ok, true); assert.equal(r.folder, path.join(L.music, "Afro House"));
    assert.ok(fs.statSync(r.folder).isDirectory());
    r = await dl(h, { targetPath: L.fav });
    assert.equal(r.ok, true); assert.equal(r.folder, L.fav);
    assert.ok(tmplOf(h.ytdlpCalls().at(-1)).startsWith(path.join(L.fav, "%(title)s")));
    r = await dl(h, { type: "playlist", playlistItems: [1, 2], targetPath: L.fav });
    assert.equal(r.ok, true);
    const pl = h.ytdlpCalls().at(-1);
    assert.ok(pl.args.includes("--yes-playlist"));
    assert.equal(tmplOf(pl), path.join(L.fav, "%(playlist_title)s", "%(playlist_index)s - %(title)s.%(ext)s"), "playlist subfolders still come from the output template");
  });
});

test("download: equivalent spellings of an authorized root are accepted and write to the registered root", async (t) => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const spellings = [L.fav + path.sep, path.join(L.fav, "..", "Fav"), path.join(L.fav, ".", "")];
    if (L.linkFav) spellings.push(h.p("ext", "linkfav"));
    for (const targetPath of spellings) {
      const r = await dl(h, { targetPath });
      assert.equal(r.ok, true, targetPath);
      assert.equal(r.folder, L.fav, "outDir is the registered favorite, not the caller's spelling");
    }
    const r = await dl(h, { targetPath: L.music });
    assert.equal(r.ok, true); assert.equal(r.folder, L.music);
    assert.equal(fs.existsSync(path.join(L.outside, "stub.mp4")), false);
  });
});

test("download: unauthorized destinations are rejected before setup, creation or process launch", async () => {
  await withHarness({ seedBinaries: false }, async (h) => {
    const L = layout(h);
    const before = h.snapshot();
    const bad = [
      L.outside, L.outside + path.sep, L.favEvil, L.fav + "-new", L.musicEvil, path.join(L.music, "..", "outside"),
      path.join(L.fav, "sub"), path.join(L.fav, ".."), path.join(L.fav, "deep", "er"), h.p("new-evil", "deep"),
      "relative/Fav", "Fav", "~", {}, 5, ["x"], true, L.fav + "\u0000x", path.parse(h.userData).root,
      ...(L.escape ? [path.join(L.fav, "escape")] : []), ...(L.linkOut ? [path.join(L.music, "link-out")] : []),
    ];
    for (const targetPath of bad) {
      const r = await dl(h, { targetPath });
      assert.equal(r.ok, false, JSON.stringify(targetPath));
      assert.match(r.error, NOT_ALLOWED);
      assert.equal(r.errorCode, "dest_bad");
      assert.deepEqual(Object.keys(r).sort(), ["error", "errorCode", "ok"]);
    }
    // targetPath is never silently swapped for a folder: an unauthorized one fails even with a valid folder
    const r = await dl(h, { targetPath: L.outside, folder: "Techno" });
    assert.equal(r.ok, false); assert.match(r.error, NOT_ALLOWED);
    assert.equal(h.spawns.length, 0, "no process launched");
    assert.equal(h.net.length, 0, "no network");
    assert.deepEqual(h.snapshot(), before, "no file or directory created anywhere, including bin/");
  });
});

test("download: invalid or escaping folder names are rejected the same way", async () => {
  await withHarness({ seedBinaries: false }, async (h) => {
    const L = layout(h);
    const before = h.snapshot();
    const bad = ["../outside", "a/b", "a\\b", "..", ".", "/abs", " x", "x ", "a\u0000b", 5, {}, ["x"], ...(L.linkOut ? ["link-out"] : [])];
    for (const folder of bad) {
      const r = await dl(h, { folder });
      assert.equal(r.ok, false, JSON.stringify(folder));
      assert.equal(typeof r.error, "string");
      assert.deepEqual(Object.keys(r).sort(), ["error", "ok"]);
    }
    assert.equal(h.spawns.length, 0);
    assert.deepEqual(h.snapshot(), before);
  });
});

test("removed favorites are rejected; a registered favorite whose folder is missing is recreated (existing behavior)", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    assert.equal((await dl(h, { targetPath: L.fav })).ok, true);
    assert.deepEqual(await h.invoke("remove-favorite", L.fav), { ok: true });
    const before = h.snapshot();
    const r = await dl(h, { targetPath: L.fav });
    assert.equal(r.ok, false); assert.match(r.error, NOT_ALLOWED);
    assert.deepEqual(h.snapshot(), before);

    const gone = h.p("ext", "Gone");
    h.setConfig({ favorite_folders: [{ path: gone, name: "Gone" }] });
    assert.equal(fs.existsSync(gone), false);
    assert.deepEqual(await h.invoke("check-duplicate", { id: "vid1", targetPath: gone, type: "video" }), { exists: false, files: [] });
    assert.equal(fs.existsSync(gone), false, "duplicate check never creates");
    const ok = await dl(h, { targetPath: gone });
    assert.equal(ok.ok, true); assert.equal(ok.folder, gone);
    assert.ok(fs.statSync(gone).isDirectory(), "a registered, missing favorite is recreated after authorization");
  });
});

test("documented limit: a favorite that is itself a symlink resolves to wherever it points", async (t) => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const swap = h.p("ext", "Swap");
    if (!symlink(L.outside, swap)) return t.skip("symlinks unavailable");
    h.setConfig({ favorite_folders: [{ path: swap, name: "Swap" }] });
    const r = await dl(h, { targetPath: swap });
    assert.equal(r.ok, true, "the registered path is the user's own choice; this pass does not re-verify it against its target");
    assert.ok(fs.existsSync(path.join(L.outside, "stub.mp4")));
  });
});

// --- duplicate check --------------------------------------------------------
test("check-duplicate: authorized destinations behave as before; unauthorized ones leak and create nothing", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const favFile = h.write("ext/Fav/Song [vid1].mp3");
    const subFile = h.write("Music/Techno/Tune [vid1].mp3");
    h.write("outside/Leak [vid1].mp3");
    const opts = { id: "vid1", type: "audio", audioFormat: "mp3" };
    assert.deepEqual(await h.invoke("check-duplicate", { ...opts, targetPath: L.fav }), { exists: true, files: [favFile] });
    assert.deepEqual(await h.invoke("check-duplicate", { ...opts, folder: "Techno" }), { exists: true, files: [subFile] });
    assert.deepEqual(await h.invoke("check-duplicate", { type: "audio" }), { exists: false, files: [] }, "no id: unchanged");
    assert.deepEqual(await h.invoke("check-duplicate"), { exists: false, files: [] });
    const before = h.snapshot();
    const unauthorized = [{ targetPath: L.outside }, { targetPath: L.favEvil }, { targetPath: path.join(L.fav, "sub") }, { folder: "../outside" },
      { folder: "a/b" }, { targetPath: {} }, ...(L.linkOut ? [{ folder: "link-out" }] : []), ...(L.escape ? [{ targetPath: path.join(L.fav, "escape") }] : [])];
    for (const where of unauthorized) {
      const r = await h.invoke("check-duplicate", { ...opts, ...where });
      assert.equal(r.exists, false, JSON.stringify(where));
      assert.deepEqual(r.files, []);
      assert.equal(typeof r.error, "string");
    }
    assert.deepEqual(h.snapshot(), before);
  });
});

// --- main-folder trust anchor -----------------------------------------------
test("set-main-folder accepts only folders chosen in the native picker (or the current main folder)", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const newMain = h.p("Elsewhere", "NewMain");
    const before = h.snapshot();
    for (const p of [newMain, h.p("outside-2"), L.outside, 5, {}, ["x"], newMain + path.sep]) {
      const r = await h.invoke("set-main-folder", p);
      assert.equal(r.ok, false, JSON.stringify(p)); assert.equal(typeof r.error, "string");
    }
    for (const p of ["", null, undefined]) assert.deepEqual(await h.invoke("set-main-folder", p), { ok: false });
    assert.deepEqual(h.snapshot(), before, "no directory created, config untouched");
    assert.equal(h.config().main_folder, L.music);

    assert.deepEqual(await h.invoke("set-main-folder", L.music), { ok: true, main_folder: L.music }, "re-setting the current main folder is fine");
    assert.equal(await h.invoke("pick-main-folder"), null, "cancelled dialog");
    assert.equal((await h.invoke("set-main-folder", newMain)).ok, false, "a cancelled dialog grants nothing");

    h.queueDialog(newMain);
    assert.equal(await h.invoke("pick-main-folder"), newMain);
    assert.equal((await h.invoke("set-main-folder", newMain + path.sep)).ok, false, "only the exact picked string is granted");
    assert.deepEqual(await h.invoke("set-main-folder", newMain), { ok: true, main_folder: newMain });
    assert.ok(fs.statSync(newMain).isDirectory());
    assert.equal((await h.invoke("get-settings")).main_folder, newMain);

    const r = await dl(h, { folder: "Techno" });
    assert.equal(r.folder, path.join(newMain, "Techno"));
    assert.equal((await dl(h, { targetPath: L.fav })).ok, true, "favorites are independent of the main folder");
    const stale = await dl(h, { targetPath: L.music });
    assert.equal(stale.ok, false, "the old main folder is no longer an authorized destination");
    assert.match(stale.error, NOT_ALLOWED);
  });
});

// --- queue, retry, watch folder ---------------------------------------------
test("queued items: authorized destinations download, unauthorized/stale ones error individually and the queue continues", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const removed = h.mkdir("ext", "Removed");
    h.setConfig({ favorite_folders: [{ path: L.fav, name: "Fav" }, { path: removed, name: "Removed" }] });
    await h.invoke("remove-favorite", removed);
    const u = (n) => `https://example.com/watch?v=${n}`;
    const stored = [
      { id: "1", url: u(1), destId: "f:../outside", status: "pending" },
      { id: "2", url: u(2), destId: "p:" + L.outside, status: "pending" },
      { id: "3", url: u(3), destId: "p:" + removed, status: "pending" },
      ...(L.linkOut ? [{ id: "4", url: u(4), destId: "f:link-out", status: "pending" }] : []),
      { id: "5", url: u(5), destId: "p:" + L.fav, status: "pending" },
      { id: "6", url: u(6), destId: "f:Techno", status: "pending" },
      { id: "7", url: u(7), destId: "", status: "pending" },
      { id: "8", url: u(8), destId: "p:" + L.fav, status: "pending", playlist: true, playlistItems: [1] },
    ];
    fs.writeFileSync(h.p("queue.json"), JSON.stringify(stored));
    const outsideBefore = fs.readdirSync(L.outside).sort();
    await runQueueLikeRenderer(h);
    const after = await h.invoke("queue-get");
    const status = Object.fromEntries(after.map(i => [i.id, i.status]));
    const expectBad = ["1", "2", "3", ...(L.linkOut ? ["4"] : [])];
    for (const id of expectBad) {
      assert.equal(status[id], "error", id);
      assert.match(after.find(i => i.id === id).error, /can't use that location|Invalid folder name|not directly inside/);
    }
    for (const id of ["5", "6", "7", "8"]) assert.equal(status[id], "done", id);
    assert.equal(after.length, stored.length);
    stored.forEach((s, k) => { assert.equal(after[k].id, s.id); assert.equal(after[k].destId, s.destId, "stored destId not rewritten"); });
    assert.deepEqual(fs.readdirSync(L.outside).sort(), outsideBefore, "nothing written outside");
    assert.ok(fs.existsSync(path.join(L.fav, "stub.mp4")));
    assert.ok(fs.existsSync(path.join(L.music, "Techno", "stub.mp4")));
    assert.ok(fs.existsSync(path.join(L.music, "stub.mp4")));
    const dlCalls = h.ytdlpCalls().filter(c => c.args.includes("-o"));
    assert.equal(dlCalls.length, 4, "only authorized items launched a yt-dlp download");
    assert.ok(tmplOf(dlCalls[3]).startsWith(path.join(L.fav, "%(playlist_title)s")));
  });
});

test("retry after a favorite is re-added works", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    await h.invoke("queue-add", [{ url: "https://example.com/r", destId: "p:" + L.fav }]);
    await h.invoke("remove-favorite", L.fav);
    await runQueueLikeRenderer(h);
    let q = await h.invoke("queue-get");
    assert.equal(q[0].status, "error"); assert.match(q[0].error, NOT_ALLOWED);
    h.setConfig({ favorite_folders: [{ path: L.fav, name: "Fav" }] });
    await h.invoke("queue-update-item", { id: q[0].id, status: "pending", error: null, note: null, force: false });
    await runQueueLikeRenderer(h);
    q = await h.invoke("queue-get");
    assert.equal(q[0].status, "done");
  });
});

test("watch folder: destinations are enforced when the queue runs; authorized destid and main folder still work", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const inbox = h.p("inbox", "inbox.txt");
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    const writeInbox = (...urls) => fs.writeFileSync(inbox, urls.join("\n"));
    const outsideBefore = fs.readdirSync(L.outside).sort();

    writeInbox("https://example.com/a1", "https://example.com/a2");
    await h.invoke("watch-set", { inbox_path: inbox, enabled: true, destid: "p:" + L.outside });
    await runQueueLikeRenderer(h);
    let q = await h.invoke("queue-get");
    assert.deepEqual(q.map(i => i.status), ["error", "error"]);
    q.forEach(i => { assert.equal(i.source, "watch"); assert.equal(i.destId, "p:" + L.outside); assert.match(i.error, NOT_ALLOWED); });
    assert.equal(h.spawns.length, 0);

    writeInbox("https://example.com/a1", "https://example.com/a2", "https://example.com/b1");
    await h.invoke("watch-set", { destid: "p:" + L.fav });
    await h.invoke("watch-start");
    await runQueueLikeRenderer(h);
    q = await h.invoke("queue-get");
    assert.deepEqual(q.map(i => i.status), ["error", "error", "done"]);
    assert.ok(fs.existsSync(path.join(L.fav, "stub.mp4")));

    await h.invoke("remove-favorite", L.fav);
    writeInbox("https://example.com/a1", "https://example.com/a2", "https://example.com/b1", "https://example.com/c1");
    await h.invoke("watch-start");
    await runQueueLikeRenderer(h);
    q = await h.invoke("queue-get");
    assert.equal(q.at(-1).status, "error", "stale destid after the favorite was removed");
    assert.match(q.at(-1).error, NOT_ALLOWED);

    await h.invoke("watch-set", { destid: "" });
    writeInbox("https://example.com/c1", "https://example.com/d1");
    await h.invoke("watch-start");
    await runQueueLikeRenderer(h);
    q = await h.invoke("queue-get");
    assert.equal(q.at(-1).status, "done");
    assert.deepEqual(fs.readdirSync(L.outside).sort(), outsideBefore);
    await h.invoke("watch-stop");
  });
});

// --- source guard -----------------------------------------------------------
test("source guard: no raw targetPath/folder sinks remain in main.js", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.equal((src.match(/fs\.mkdirSync\(targetPath/g) || []).length, 0);
  assert.equal((src.match(/resolveDestination\(/g) || []).length, 3, "definition + download + check-duplicate");
  assert.equal((src.match(/path\.join\(mainFolder\(\), name\)/g) || []).length, 1, "only remove-folder (config-only) still joins a raw name");
  assert.equal((src.match(/path\.join\(base, (oldName|newName)\)/g) || []).length, 2, "rename-folder joins are guarded by checkFolderName");
});
