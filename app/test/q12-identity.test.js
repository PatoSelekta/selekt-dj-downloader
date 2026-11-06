"use strict";
// Q1+Q2 identity: production queue-get / write sanitizers / reveal / locate / clear.
// Real main.js through h3-harness. Isolated temp userData only. Labeled fixture names.
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

test("done item with files[] inside main: present; queue.json not rewritten on get", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Tone 1kHz.mp3", "PRESERVED-BODY");
    const item = {
      id: "d1", status: "done", url: "https://example.com/tone", title: "Fixture Tone 1kHz.mp3",
      destId: "p:/Volumes/Gone/Old", format: "audio:mp3", bitrate: "320",
      files: [file], outputDir: path.dirname(file),
      encodePlan: { mode: "copy", sourceAbr: null, sourceAcodec: "mp3", targetFormat: "mp3", targetBitrate: 320 },
    };
    h.write("queue.json", JSON.stringify([item]));
    const before = fs.readFileSync(h.p("queue.json"), "utf8");
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "present");
    assert.equal(got.outputs[0].path, file);
    assert.match(got.outputs[0].actualFormatLabel, /source preserved/i);
    assert.equal(got.identityState, "present");
    assert.equal(fs.readFileSync(h.p("queue.json"), "utf8"), before);
  });
});

test("unlinked files[]: missing (not folder-unavailable)", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Missing.mp3", "x");
    fs.unlinkSync(file);
    h.write("queue.json", JSON.stringify([{
      id: "m1", status: "done", url: "https://example.com/g", title: "Fixture Missing.mp3", files: [file], destId: "",
    }]));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "missing");
    assert.equal(got.identityState, "missing");
  });
});

test("no files: recover from History by url", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture History.mp3", "x");
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/old", title: "Fixture History.mp3",
      folder: path.dirname(file), file, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    h.write("queue.json", JSON.stringify([{
      id: "h1", status: "done", url: "https://example.com/old", destId: "", format: "audio:mp3",
    }]));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "present");
    assert.equal(got.outputs[0].path, file);
  });
});

test("no files and no History: unknown; no path guessed from title", T, async () => {
  await withHarness({}, async (h) => {
    h.write("Music/Looks Like Title.mp3", "x");
    h.write("queue.json", JSON.stringify([{
      id: "u1", status: "done", url: "https://example.com/u", title: "Looks Like Title.mp3", destId: "",
    }]));
    const [got] = await h.invoke("queue-get");
    assert.deepEqual(got.outputs, []);
    assert.equal(got.identityState, "unknown");
  });
});

test("playlist three files: three outputs; favorite removed => outside", T, async () => {
  await withHarness({}, async (h) => {
    const fav = h.mkdir("ext", "USB");
    const a = h.write("ext/USB/Playlist/1 - Fixture A.mp3", "a");
    const b = h.write("ext/USB/Playlist/2 - Fixture B.mp3", "b");
    const c = h.write("ext/USB/Playlist/3 - Fixture C.mp3", "c");
    h.setConfig({ favorite_folders: [] });
    h.write("queue.json", JSON.stringify([{
      id: "pl", status: "done", playlist: true, url: "https://example.com/pl",
      title: "Fixture Playlist", files: [a, b, c], destId: "p:" + fav,
    }]));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs.length, 3);
    assert.ok(got.outputs.every((o) => o.state === "outside"));
    assert.equal(got.identityState, "outside");
  });
});

test("queue-update-item cannot plant files; queue-set cannot invent files on a new id", T, async () => {
  await withHarness({}, async (h) => {
    h.write("queue.json", JSON.stringify([{ id: "x", status: "done", url: "https://example.com/x", destId: "" }]));
    await h.invoke("queue-update-item", { id: "x", files: ["/etc/passwd"], outputDir: "/etc", encodePlan: { mode: "convert" } });
    const [got] = await h.invoke("queue-get");
    assert.ok(!got.files || got.files[0] !== "/etc/passwd");
    await h.invoke("queue-set", [{ id: "y", status: "done", url: "https://example.com/y", files: ["/etc/passwd"] }]);
    const y = (await h.invoke("queue-get")).find((i) => i.id === "y");
    assert.ok(!y.files);
  });
});

test("reveal present file uses shell.showItemInFolder; missing/unknown refused", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Show.mp3", "x");
    h.write("queue.json", JSON.stringify([{
      id: "s1", status: "done", url: "https://example.com/s", files: [file],
    }]));
    assert.deepEqual(await h.invoke("queue-reveal-output", "s1", file), { ok: true });
    assert.equal(h.opened.some((o) => o[0] === "reveal"), true);
    assert.equal((await h.invoke("queue-reveal-output", "s1", "/etc/passwd")).ok, false);
    h.write("queue.json", JSON.stringify([{ id: "u1", status: "done", url: "https://example.com/u" }]));
    assert.equal((await h.invoke("queue-reveal-output", "u1", file)).ok, false);
  });
});

test("locate non-playlist unknown: dialog file inside main becomes present + History", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Located.mp3", "LOCATED");
    h.write("queue.json", JSON.stringify([{
      id: "l1", status: "done", url: "https://example.com/l", title: "Fixture Located.mp3",
    }]));
    h.queueDialog(file);
    const r = await h.invoke("queue-locate-file", "l1");
    assert.equal(r.ok, true);
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "present");
    const hist = await h.invoke("get-history", { limit: 10 });
    assert.ok(hist.some((row) => sameReal(row.file, file)));
    assert.ok(sameReal(got.outputs[0].path, file));
  });
});

test("locate outside roots attaches that file; unknown playlists still refused; does not copy", T, async () => {
  await withHarness({}, async (h) => {
    const outsider = h.write("outside/steal.mp3", "x");
    h.write("queue.json", JSON.stringify([{ id: "l2", status: "done", url: "https://example.com/l2" }]));
    h.queueDialog(outsider);
    const r = await h.invoke("queue-locate-file", "l2");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await h.invoke("queue-get"))[0].identityState, "present");
    assert.equal(fs.readFileSync(outsider, "utf8"), "x");
    assert.deepEqual(await h.invoke("get-favorites"), []);
    h.write("queue.json", JSON.stringify([{
      id: "pl", status: "done", playlist: true, url: "https://example.com/pl",
    }]));
    h.queueDialog(h.write("Music/Fixture Playlist Track.mp3", "x"));
    assert.equal((await h.invoke("queue-locate-file", "pl")).ok, false);
  });
});

test("add-output-folder registers dirname; then outside becomes present", T, async () => {
  await withHarness({}, async (h) => {
    const fav = h.mkdir("ext", "USB");
    const file = h.write("ext/USB/Fixture USB Track.mp3", "x");
    h.setConfig({ favorite_folders: [] });
    h.write("queue.json", JSON.stringify([{
      id: "o1", status: "done", url: "https://example.com/o", files: [file],
    }]));
    assert.equal((await h.invoke("queue-get"))[0].identityState, "outside");
    const r = await h.invoke("queue-add-output-folder", "o1", file);
    assert.equal(r.ok, true);
    assert.ok((await h.invoke("get-favorites")).some((f) => f.path === fav));
    assert.equal((await h.invoke("queue-get"))[0].identityState, "present");
  });
});

test("clear-finished removes done rows only; files and History stay", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Keep.mp3", "KEEP");
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/k", title: "Fixture Keep.mp3",
      folder: path.dirname(file), file, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    h.write("queue.json", JSON.stringify([
      { id: "d", status: "done", url: "https://example.com/k", files: [file] },
      { id: "p", status: "pending", url: "https://example.com/p" },
      { id: "e", status: "error", url: "https://example.com/e", error: "x" },
    ]));
    const histBefore = fs.readFileSync(h.p("download_history.jsonl"), "utf8");
    const r = await h.invoke("queue-clear-finished");
    assert.equal(r.ok, true);
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map((i) => i.id).sort(), ["e", "p"]);
    assert.equal(fs.readFileSync(file, "utf8"), "KEEP");
    assert.equal(fs.readFileSync(h.p("download_history.jsonl"), "utf8"), histBefore);
  });
});

test("remove-errors drops error/skipped/canceled/flagged; keeps pending/running/done; no file delete", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Done.mp3", "D");
    h.write("queue.json", JSON.stringify([
      { id: "d", status: "done", url: "https://example.com/d", files: [file] },
      { id: "p", status: "pending", url: "https://example.com/p" },
      { id: "r", status: "running", url: "https://example.com/r" },
      { id: "e", status: "error", url: "https://example.com/e" },
      { id: "s", status: "skipped", url: "https://example.com/s" },
      { id: "c", status: "canceled", url: "https://example.com/c" },
      { id: "f", status: "flagged", url: "https://example.com/f" },
    ]));
    await h.invoke("queue-remove-errors");
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map((i) => i.id).sort(), ["d", "p", "r"]);
    assert.equal(fs.readFileSync(file, "utf8"), "D");
  });
});

test("queue-add strips planted files", T, async () => {
  await withHarness({}, async (h) => {
    await h.invoke("queue-add", [{
      url: "https://example.com/a", destId: "", format: "audio:mp3", files: ["/etc/passwd"],
    }]);
    const [got] = await h.invoke("queue-get");
    assert.ok(!got.files);
  });
});
