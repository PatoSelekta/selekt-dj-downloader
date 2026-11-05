"use strict";
// What the app does today when a REGISTERED FAVORITE points into a drive that is not mounted (e.g. an unplugged USB
// stick whose folder is /Volumes/<Drive>/Tracks). It documents EXISTING behavior; it changes nothing.
// Everything is mocked and isolated: a temp folder stands in for the mount root ("/Volumes"), and for the permission
// case fs.mkdirSync is patched to fail the way it does on a root-owned parent. No real drive, /Volumes, or user file is
// touched. Run:  node --test app/test/favorite-unplugged-drive.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { withHarness } = require("./h3-harness");

const dl = (h, o) => h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false, ...o });
const mainEntries = (h) => (fs.existsSync(h.music) ? fs.readdirSync(h.music).filter(n => n !== ".DS_Store") : []);

test("get-favorites reports a favorite on an unmounted drive as available:false (it is not created or touched by listing)", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = h.p("FakeVolumes");               // stands in for /Volumes; the 'drive' folder inside it does not exist
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [{ path: fav, name: "USB" }] });
    const list = await h.invoke("get-favorites");
    assert.deepEqual(list.map(f => [f.name, f.available]), [["USB", false]]);
    assert.equal(fs.existsSync(mountRoot), false, "listing creates nothing");
  });
});

test("EXISTING BEHAVIOR (writable mount parent): a download to a favorite on an unplugged drive silently re-creates the path on the internal disk and writes there", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = h.mkdir("FakeVolumes");           // parent exists and is writable (like a Linux mount parent owned by the user)
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [{ path: fav, name: "USB" }] });
    const r = await dl(h, { targetPath: fav });
    assert.equal(r.ok, true, "no 'drive is missing' check exists on the download path");
    assert.equal(r.folder, fav);
    assert.ok(fs.statSync(fav).isDirectory(), "the mount-path directory now exists on the same disk as everything else");
    assert.equal(h.ytdlpCalls().length, 1);
    assert.deepEqual(mainEntries(h), [], "(it did NOT go to Main either)");
  });
});

test("macOS-like case (root-owned mount parent): mkdir fails with EACCES BEFORE anything is downloaded; the IPC call rejects; Main untouched", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = "/Volumes-mock";                  // never created; mkdirSync is patched, so no real path is touched
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [{ path: fav, name: "USB" }] });
    const real = fs.mkdirSync;
    fs.mkdirSync = function (p, ...rest) {
      if (typeof p === "string" && p.startsWith(mountRoot)) { const e = new Error(`EACCES: permission denied, mkdir '${p}'`); e.code = "EACCES"; e.syscall = "mkdir"; e.path = p; throw e; }
      return real.call(fs, p, ...rest);
    };
    try {
      await assert.rejects(() => dl(h, { targetPath: fav }), (e) => e && e.code === "EACCES" && /EACCES: permission denied, mkdir '\/Volumes-mock\/USB\/Tracks'/.test(e.message));
    } finally { fs.mkdirSync = real; }
    assert.deepEqual(h.ytdlpCalls(), [], "yt-dlp never started");
    assert.deepEqual(mainEntries(h), [], "nothing went to the main folder");
    // (the renderer's runQueue turns the rejection into an error row with String(e); Electron's own wrapper text around
    //  it was NOT observed here, because no Electron IPC is involved in these tests)
  });
});

test("a favorite that was unregistered is still refused (not turned into a mkdir)", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = h.mkdir("FakeVolumes");
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [] });
    const r = await dl(h, { targetPath: fav });
    assert.equal(r.ok, false);
    assert.match(r.error, /not the main folder or one of your favorite folders/);
    assert.equal(fs.existsSync(path.join(mountRoot, "USB")), false, "nothing was created for an unregistered path");
  });
});
