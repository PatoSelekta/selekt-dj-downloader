"use strict";
// What the app does when a REGISTERED FAVORITE points into a drive that is not mounted (e.g. an unplugged USB
// stick whose folder is /Volumes/<Drive>/Tracks). Missing mount chains and mkdir EACCES/EPERM are dest_unmounted.
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

test("writable mount parent: a download to a favorite whose drive folder is missing is dest_unmounted (nothing is created)", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = h.mkdir("FakeVolumes");           // /Volumes analogue exists; the drive folder itself does not
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [{ path: fav, name: "USB" }] });
    const r = await dl(h, { targetPath: fav });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "dest_unmounted");
    assert.match(r.error, /drive|connected|Reconnect/i);
    assert.equal(fs.existsSync(path.join(mountRoot, "USB")), false);
    assert.equal(h.ytdlpCalls().length, 0);
    assert.deepEqual(mainEntries(h), []);
  });
});

test("macOS-like case (root-owned mount parent): mkdir EACCES on a favorite is dest_unmounted, not a thrown EACCES; Main untouched", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = h.mkdir("Volumes-mock");          // parent exists so the missing-chain check does not fire first
    const fav = path.join(mountRoot, "USB");            // the unmounted volume itself
    h.setConfig({ favorite_folders: [{ path: fav, name: "USB" }] });
    const real = fs.mkdirSync;
    fs.mkdirSync = function (p, ...rest) {
      if (typeof p === "string" && (p === fav || p.startsWith(fav + path.sep))) {
        const e = new Error(`EACCES: permission denied, mkdir '${p}'`);
        e.code = "EACCES"; e.syscall = "mkdir"; e.path = p; throw e;
      }
      return real.call(fs, p, ...rest);
    };
    try {
      const r = await dl(h, { targetPath: fav });
      assert.equal(r.ok, false);
      assert.equal(r.errorCode, "dest_unmounted");
    } finally { fs.mkdirSync = real; }
    assert.deepEqual(h.ytdlpCalls(), [], "yt-dlp never started");
    assert.deepEqual(mainEntries(h), [], "nothing went to the main folder");
    assert.equal(fs.existsSync(fav), false);
  });
});

test("a registered favorite whose leaf is missing but whose parent exists is still created", async () => {
  await withHarness({}, async (h) => {
    const parent = h.mkdir("ext");
    const fav = path.join(parent, "Tracks");
    h.setConfig({ favorite_folders: [{ path: fav, name: "Tracks" }] });
    const r = await dl(h, { targetPath: fav });
    assert.equal(r.ok, true);
    assert.ok(fs.statSync(fav).isDirectory());
    assert.equal(h.ytdlpCalls().length, 1);
  });
});

test("a main-folder subfolder whose parent exists is still created", async () => {
  await withHarness({}, async (h) => {
    const r = await dl(h, { folder: "Techno" });
    assert.equal(r.ok, true);
    assert.ok(fs.statSync(path.join(h.music, "Techno")).isDirectory());
    assert.equal(h.ytdlpCalls().length, 1);
  });
});

test("a favorite that was unregistered is still refused (not turned into a mkdir)", async () => {
  await withHarness({}, async (h) => {
    const mountRoot = h.mkdir("FakeVolumes");
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [] });
    const r = await dl(h, { targetPath: fav });
    assert.equal(r.ok, false);
    assert.match(r.error, /can't use that location/);
    assert.equal(fs.existsSync(path.join(mountRoot, "USB")), false, "nothing was created for an unregistered path");
  });
});
