"use strict";
// Shared fixtures for the H1 checks (open / reveal / trash). Temp directories only; the harness
// stubs electron's shell, so nothing is opened, revealed or trashed for real.
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const real = (p) => fs.realpathSync.native(p);
function symlink(target, linkPath, type) {
  try { fs.mkdirSync(path.dirname(linkPath), { recursive: true }); fs.symlinkSync(target, linkPath, type); return true; }
  catch (_) { return false; }   // e.g. Windows without symlink privilege: symlink cases are skipped
}
function addHistory(h, file, extra = {}) {
  fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
    action: "video", url: "https://example.com/v", title: path.basename(file), folder: path.dirname(file),
    file, time: "2026-01-01T00:00:00.000Z", ...extra,
  }) + "\n");
}
function layout(h) {
  const L = {};
  L.music = h.mkdir("Music");
  L.fav = h.mkdir("ext", "Fav");
  L.favEvil = h.mkdir("ext", "Fav-evil");
  L.musicEvil = h.mkdir("Music-evil");
  L.outside = h.mkdir("outside");
  L.victim = h.write("outside/victim.txt");
  L.a = h.write("Music/a.mp3");
  L.techno = h.write("Music/Techno/b.mp3");
  L.playlist = h.write("Music/Playlist X/c.mp3");
  L.d = h.write("ext/Fav/d.mp3");
  L.evilFile = h.write("Music-evil/x.mp3");
  L.favEvilFile = h.write("ext/Fav-evil/y.mp3");
  h.setConfig({ favorite_folders: [{ path: L.fav, name: "Fav" }] });
  return L;
}
const FAIL_CODES = new Set(["invalid", "not_allowed", "outside", "missing", "not_file", "symlink", "trash_failed", "open_failed", "in_progress"]);
function assertFailure(r, code, label) {
  assert.equal(r.ok, false, label);
  assert.equal(r.code, code, `${label}: code`);
  assert.equal(typeof r.error, "string", `${label}: error text`);
  assert.ok(r.error.length > 0, label);
  assert.ok(FAIL_CODES.has(r.code), label);
  assert.deepEqual(Object.keys(r).sort(), ["code", "error", "ok"], `${label}: response shape`);
}
const dl = (h, o) => h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false, ...o });

// Drives the REAL duplicate-detection path in main: a stubbed fpcalc reports the same fingerprint for
// the new file and for a library entry (L.d in the external favorite), so main itself emits the
// "fingerprint-dup" event (with its offerId). Call repeatedly on one harness for several warnings.
//   name: file name of the new download (same name twice = same path, different warning)
//   newInFavorite: download into the favorite; queue: mark the download as a queue-mode one;
//   queueId: the renderer's queue-item id (_queueId), which main must echo back in the event
function setupDuplicates(h) {
  if (!h._dupLayout) {
    const L = layout(h);
    h.setConfig({ fingerprint_enabled: true, fingerprint_threshold: 0.9 });
    fs.writeFileSync(h.p("fingerprints.jsonl"), JSON.stringify({ file: L.d, id: "old", duration: 120, fp: "AAAAAAAAAAAA", time: "2026-01-01T00:00:00Z" }) + "\n");
    h.setScript((cmd, args) => {
      if (args[0] === "-json") return { code: 0, stdout: JSON.stringify({ duration: 120, fingerprint: "AAAAAAAAAAAA" }) };
      if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "vid9", title: "New Song" }) };
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, h._dupName || "new.mp3");
        fs.writeFileSync(f, "x");
        return { code: 0, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    h._dupLayout = L;
  }
  return h._dupLayout;
}
async function emitDuplicate(h, { newInFavorite = false, name = "new.mp3", queue = false, queueId } = {}) {
  const L = setupDuplicates(h);
  h._dupName = name;
  const count = () => h.sent.filter(c => c[0] === "fingerprint-dup").length;
  const before = count();
  const r = await h.invoke("download", { url: "https://example.com/v", type: "audio", audioFormat: "mp3", bitrate: "192", autoTag: false,
    ...(newInFavorite ? { targetPath: L.fav } : {}), ...(queue ? { _inQueue: true } : {}), ...(queueId !== undefined ? { _queueId: queueId } : {}) });
  assert.ok(r.ok, JSON.stringify(r));
  const got = await h.waitFor(() => count() > before);
  assert.ok(got, "fingerprint-dup was emitted by main");
  const evts = h.sent.filter(c => c[0] === "fingerprint-dup");
  return { L, payload: evts[before][1], newFile: r.files[0] };
}

module.exports = { real, symlink, addHistory, layout, FAIL_CODES, assertFailure, dl, emitDuplicate, setupDuplicates };
