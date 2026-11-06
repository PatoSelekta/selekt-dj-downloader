"use strict";
// Locate relink: production queue-locate-file / reveal / open-file. Isolated temp userData.
// Fixture names only. Compares paths with realpath (Mac /var vs /private/var).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { withHarness } = require("./h3-harness");

const T = { timeout: 20000 };
function sameReal(a, b) {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); }
  catch { return false; }
}

test("relink outside roots: present, Show/Play, destId kept, favorites/bytes unchanged, stale History dead", T, async () => {
  await withHarness({}, async (h) => {
    const orig = h.write("Music/Afro/Fixture Chella.mkv", "CHEELLA-BODY");
    const moved = h.write("elsewhere/Movies/Fixture Chella.mkv", "CHEELLA-BODY");
    fs.unlinkSync(orig);
    h.write("queue.json", JSON.stringify([{
      id: "c1", status: "done", url: "https://example.com/chella", title: "Fixture Chella.mkv",
      files: [orig], outputDir: path.dirname(orig), destId: "f:Afro", format: "video:original",
      encodePlan: { mode: "copy", targetFormat: "mkv" },
    }]));
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "video", url: "https://example.com/chella", title: "Fixture Chella.mkv",
      folder: path.dirname(orig), file: orig, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    fs.appendFileSync(h.p("downloaded_index.jsonl"), JSON.stringify({
      id: "yt-chella", file: orig, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    h.queueDialog(moved);
    const r = await h.invoke("queue-locate-file", "c1");
    assert.equal(r.ok, true, JSON.stringify(r));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.identityState, "present");
    assert.ok(sameReal(got.outputs[0].path, moved));
    assert.equal(got.destId, "f:Afro");
    assert.equal(got.format, "video:original");
    assert.equal(got.encodePlan.targetFormat, "mkv");
    assert.deepEqual(await h.invoke("get-favorites"), []);
    assert.equal(fs.readFileSync(moved, "utf8"), "CHEELLA-BODY");
    assert.equal(fs.existsSync(orig), false);
    assert.deepEqual(await h.invoke("reveal", moved), { ok: true });
    assert.deepEqual(await h.invoke("open-file", moved), { ok: true });
    const stale = await h.invoke("reveal", orig);
    assert.equal(stale.ok, false);
    const hist = await h.invoke("get-history", { limit: 10 });
    assert.ok(hist.some((row) => sameReal(row.file, moved)));
    assert.ok(!hist.some((row) => row.file === orig));
    const idxLine = fs.readFileSync(h.p("downloaded_index.jsonl"), "utf8").trim().split("\n").pop();
    assert.ok(sameReal(JSON.parse(idxLine).file, moved));
    const stored = JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0];
    assert.ok(sameReal(stored.files[0], moved));
    assert.equal(stored.destId, "f:Afro");
  });
});

test("relink does not authorize a sibling or an unrecorded renderer path", T, async () => {
  await withHarness({}, async (h) => {
    const orig = h.write("Music/Fixture One.mp3", "ONE");
    const moved = h.write("elsewhere/Movies/Fixture One.mp3", "ONE");
    const sibling = h.write("elsewhere/Movies/Fixture Sibling.mp3", "SIB");
    fs.unlinkSync(orig);
    h.write("queue.json", JSON.stringify([{
      id: "c2", status: "done", url: "https://example.com/one", files: [orig], destId: "",
    }]));
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/one", title: "Fixture One.mp3",
      folder: path.dirname(orig), file: orig, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    h.queueDialog(moved);
    assert.equal((await h.invoke("queue-locate-file", "c2")).ok, true);
    assert.equal((await h.invoke("reveal", sibling)).ok, false);
    assert.equal((await h.invoke("open-file", sibling)).ok, false);
    const planted = await h.invoke("queue-reveal-output", "c2", sibling);
    assert.equal(planted.ok, false);
    const hosts = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts";
    assert.equal((await h.invoke("reveal", hosts)).ok, false);
  });
});

test("locate cancel leaves missing item and History unchanged", T, async () => {
  await withHarness({}, async (h) => {
    const orig = h.write("Music/Fixture Cancel.mp3", "x");
    fs.unlinkSync(orig);
    h.write("queue.json", JSON.stringify([{
      id: "c3", status: "done", url: "https://example.com/c", files: [orig],
    }]));
    const beforeQ = fs.readFileSync(h.p("queue.json"), "utf8");
    const r = await h.invoke("queue-locate-file", "c3");
    assert.equal(r.ok, false);
    assert.equal(r.canceled, true);
    assert.equal(fs.readFileSync(h.p("queue.json"), "utf8"), beforeQ);
    assert.equal((await h.invoke("queue-get"))[0].identityState, "missing");
  });
});

test("unknown playlist Locate still refused; file not copied", T, async () => {
  await withHarness({}, async (h) => {
    const pick = h.write("Music/Fixture Playlist Track.mp3", "x");
    h.write("queue.json", JSON.stringify([{
      id: "pl", status: "done", playlist: true, url: "https://example.com/pl",
    }]));
    h.queueDialog(pick);
    const r = await h.invoke("queue-locate-file", "pl");
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(pick, "utf8"), "x");
    assert.equal((await h.invoke("queue-get"))[0].identityState, "unknown");
  });
});

test("alias pick stores realpath; identity present via sameReal after reload-equivalent get", T, async () => {
  await withHarness({}, async (h) => {
    const realFile = h.write("Music/Fixture Alias.mp3", "ALIAS");
    const aliasDir = h.p("MusicLink");
    fs.symlinkSync(h.music, aliasDir);
    const aliasFile = path.join(aliasDir, "Fixture Alias.mp3");
    h.write("queue.json", JSON.stringify([{
      id: "c5", status: "done", url: "https://example.com/alias", title: "Fixture Alias.mp3",
    }]));
    h.queueDialog(aliasFile);
    const r = await h.invoke("queue-locate-file", "c5");
    assert.equal(r.ok, true, JSON.stringify(r));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.identityState, "present");
    assert.ok(sameReal(got.outputs[0].path, realFile));
    const stored = JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].files[0];
    assert.equal(stored, fs.realpathSync.native(aliasFile));
    const hist = await h.invoke("get-history", { limit: 5 });
    assert.ok(hist.some((row) => sameReal(row.file, realFile)));
    assert.deepEqual(await h.invoke("reveal", realFile), { ok: true });
  });
});

test("never-Located favorite-removed file stays outside; Locate grant does not leak to it", T, async () => {
  await withHarness({}, async (h) => {
    const fav = h.mkdir("ext", "USB");
    const kept = h.write("ext/USB/Fixture USB Stay.mp3", "USB");
    const orig = h.write("Music/Fixture Relink.mp3", "R");
    const moved = h.write("elsewhere/Fixture Relink.mp3", "R");
    fs.unlinkSync(orig);
    h.setConfig({ favorite_folders: [] });
    h.write("queue.json", JSON.stringify([
      { id: "usb", status: "done", url: "https://example.com/usb", files: [kept], destId: "p:" + fav },
      { id: "rel", status: "done", url: "https://example.com/rel", files: [orig] },
    ]));
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/usb", title: "Fixture USB Stay.mp3",
      folder: fav, file: kept, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    assert.equal((await h.invoke("queue-get")).find((i) => i.id === "usb").identityState, "outside");
    h.queueDialog(moved);
    assert.equal((await h.invoke("queue-locate-file", "rel")).ok, true);
    assert.equal((await h.invoke("queue-get")).find((i) => i.id === "usb").identityState, "outside");
    assert.equal((await h.invoke("reveal", kept)).ok, false);
    assert.deepEqual(await h.invoke("get-favorites"), []);
  });
});

test("persist failure does not grant a sibling and does not move bytes", T, async () => {
  await withHarness({}, async (h) => {
    const orig = h.write("Music/Fixture Persist.mp3", "P");
    const moved = h.write("elsewhere/Fixture Persist.mp3", "P");
    const sibling = h.write("elsewhere/Fixture Persist Sib.mp3", "S");
    fs.unlinkSync(orig);
    h.write("queue.json", JSON.stringify([{
      id: "c6", status: "done", url: "https://example.com/p", files: [orig],
    }]));
    fs.mkdirSync(h.p("located_files.json"));
    h.queueDialog(moved);
    const r = await h.invoke("queue-locate-file", "c6");
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.code, "persist_failed");
    assert.equal(fs.readFileSync(moved, "utf8"), "P");
    assert.equal((await h.invoke("reveal", sibling)).ok, false);
    assert.equal((await h.invoke("reveal", moved)).ok, false);
    const q = JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0];
    assert.ok(sameReal(q.files[0], orig) || q.files[0] === orig);
  });
});
