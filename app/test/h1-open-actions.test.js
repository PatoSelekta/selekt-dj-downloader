"use strict";
// H1 checks: open-file, reveal, delete-file (trash), open-favorite and open-folder only act
// on files/folders the app is entitled to touch.
// Run from the repo root with:  node --test app/test/h1-open-actions.test.js
// Stubs only: electron's shell (openPath / showItemInFolder / trashItem just RECORD calls),
// child_process, https and the npm binaries; temp directories only. Nothing is ever opened,
// revealed or trashed for real, and no user file is touched. The renderer is not executed here
// (see the browser check kept with the review evidence).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { withHarness } = require("./h3-harness");

const MAIN_SRC = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const RENDERER_SRC = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");

const { real, symlink, addHistory, layout, assertFailure, dl, emitDuplicate } = require("./h1-fixtures");

// --- pure containment (isInside is taken from main.js so POSIX and win32 path rules can both be run) ---
function loadIsInside() {
  const m = MAIN_SRC.match(/function isInside\([^]*?\n}\n/);
  assert.ok(m, "isInside found in main.js");
  return new Function("path", m[0] + "\nreturn isInside;")(path);
}
test("isInside: separator-aware containment (POSIX and win32 path rules)", () => {
  const isInside = loadIsInside();
  assert.equal(isInside("/a/Music", "/a/Music/x.mp3"), true);
  assert.equal(isInside("/a/Music", "/a/Music/sub/deep/x.mp3"), true);
  assert.equal(isInside("/a/Music", "/a/Music/..hidden/f"), true, "a name starting with two dots is still inside");
  assert.equal(isInside("/a/Music", "/a/Music"), false, "the root itself is not a file inside it");
  assert.equal(isInside("/a/Music", "/a/Music-evil/x.mp3"), false, "sibling prefix");
  assert.equal(isInside("/a/Music", "/a/Musicx"), false);
  assert.equal(isInside("/a/Music", "/a/other/x"), false);
  assert.equal(isInside("/a/Music", "/a/Music/../x"), false, "unnormalized escape");
  assert.equal(isInside("/a/Music/", "/a/Music/x"), true, "trailing separator on the root");
  const w = path.win32;
  assert.equal(isInside("C:\\Music", "C:\\Music\\x.mp3", w), true);
  assert.equal(isInside("C:\\Music", "c:\\music\\SUB\\x.mp3", w), true, "case-insensitive");
  assert.equal(isInside("C:\\Music", "C:/Music/x.mp3", w), true, "forward slashes");
  assert.equal(isInside("C:\\Music", "C:\\Music-evil\\x.mp3", w), false, "sibling prefix");
  assert.equal(isInside("C:\\Music", "D:\\Music\\x.mp3", w), false, "other drive");
  assert.equal(isInside("C:\\Music", "C:\\Music\\..\\x.mp3", w), false);
  assert.equal(isInside("\\\\srv\\share\\Music", "\\\\srv\\share\\Music\\x.mp3", w), true, "UNC");
  assert.equal(isInside("\\\\srv\\share\\Music", "\\\\srv\\share2\\Music\\x.mp3", w), false, "other share");
});

// --- open-file / reveal: allowed ----------------------------------------------------------
test("open-file / reveal: history rows in the main folder, a subfolder, a playlist folder and an external favorite work", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    for (const f of [L.a, L.techno, L.playlist, L.d]) addHistory(h, f);
    for (const f of [L.a, L.techno, L.playlist, L.d]) {
      assert.deepEqual(await h.invoke("open-file", f), { ok: true }, f);
      assert.deepEqual(await h.invoke("reveal", f), { ok: true }, f);
    }
    assert.deepEqual(h.opened, [L.a, L.techno, L.playlist, L.d].flatMap(f => [["openPath", real(f)], ["reveal", real(f)]]),
      "the shell receives the resolved real path of exactly the requested file");
    assert.deepEqual(h.trashed, []);
  });
});

test("history rows written by a real (stubbed) download work: main folder and favorite via targetPath", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const r1 = await dl(h, {});
    const r2 = await dl(h, { targetPath: L.fav });
    assert.ok(r1.ok && r2.ok);
    assert.equal(path.dirname(r1.files[0]), L.music);
    assert.equal(path.dirname(r2.files[0]), L.fav);
    for (const f of [r1.files[0], r2.files[0]]) {
      assert.deepEqual(await h.invoke("open-file", f), { ok: true });
      assert.deepEqual(await h.invoke("reveal", f), { ok: true });
    }
    const hist = await h.invoke("get-history", { limit: 10 });
    assert.equal(hist.length, 2, "get-history is unchanged");
  });
});

test("a symlink inside a root that points to another file inside a root is allowed (real path decides)", async (t) => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const link = path.join(L.music, "alias.mp3");
    if (!symlink(L.a, link, "file")) return t.skip("symlinks unavailable");
    addHistory(h, link);
    assert.deepEqual(await h.invoke("open-file", link), { ok: true });
    assert.deepEqual(h.opened, [["openPath", real(L.a)]]);
  });
});

// --- open-file / reveal: rejected ---------------------------------------------------------
test("open-file / reveal reject unrelated, outside, sibling-prefix, traversal and symlink-escape paths without any shell call", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const linkDir = path.join(L.music, "link-out"), linkFile = path.join(L.music, "evil.mp3");
    const haveDirLink = symlink(L.outside, linkDir, "dir");
    const haveFileLink = symlink(L.victim, linkFile, "file");
    const dotdot = L.music + path.sep + ".." + path.sep + "outside" + path.sep + "victim.txt";
    const missingOutside = path.join(L.outside, "gone.mp3");
    const missingInside = path.join(L.music, "gone.mp3");
    const dirRow = L.techno ? path.dirname(L.techno) : "";
    // recorded in history -> authorization then depends on location
    for (const f of [L.victim, L.evilFile, L.favEvilFile, dotdot, missingOutside, missingInside, dirRow]) addHistory(h, f);
    if (haveDirLink) addHistory(h, path.join(linkDir, "victim.txt"));
    if (haveFileLink) addHistory(h, linkFile);

    const cases = [
      // not recorded anywhere -> not_allowed (whatever it is)
      [L.victim + ".nope", "not_allowed"], [path.join(L.music, "unlisted.mp3"), "not_allowed"], [h.userData, "not_allowed"],
      [process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts", "not_allowed"],
      [L.music + path.sep + ".." + path.sep + "outside" + path.sep + "other.txt", "not_allowed"],
      // recorded, but not inside the main folder / a favorite
      [L.victim, "outside"], [L.evilFile, "outside"], [L.favEvilFile, "outside"], [dotdot, "outside"],
      [missingOutside, "outside"],            // missing + outside: no existence oracle
      // recorded and inside, but not a usable file
      [missingInside, "missing"], [dirRow, "not_file"],
      ...(haveDirLink ? [[path.join(linkDir, "victim.txt"), "outside"]] : []),
      ...(haveFileLink ? [[linkFile, "outside"]] : []),
    ];
    for (const [p, code] of cases) {
      for (const ch of ["open-file", "reveal"]) assertFailure(await h.invoke(ch, p), code, `${ch} ${p}`);
    }
    assert.deepEqual(h.opened, [], "no shell call for any rejected path");
    assert.deepEqual(h.trashed, []);
  });
});

test("open-file / reveal / delete-file / open-favorite: malformed arguments are rejected without throwing", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    addHistory(h, L.a);
    const bad = [undefined, null, "", 5, true, [], {}, [L.a], { path: L.a }, "relative/a.mp3", "a.mp3", "Music/a.mp3",
      L.a + "\u0000.txt", "x".repeat(5000), "/" + "x".repeat(5000)];
    for (const v of bad) {
      for (const ch of ["open-file", "reveal", "delete-file", "open-favorite"]) {
        const r = await h.invoke(ch, v);
        assert.equal(r.ok, false, `${ch} ${String(JSON.stringify(v)).slice(0, 40)}`);
        assert.equal(r.code, "invalid", `${ch} ${String(JSON.stringify(v)).slice(0, 40)}`);
      }
    }
    assert.equal((await h.invoke("open-file")).ok, false);
    assert.deepEqual(h.opened, []);
    assert.deepEqual(h.trashed, []);
  });
});

test("openPath failure is reported, not swallowed", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    addHistory(h, L.a);
    h.setOpenError("No application is associated with the file");
    assertFailure(await h.invoke("open-file", L.a), "open_failed", "open-file");
    assertFailure(await h.invoke("open-favorite", L.fav), "open_failed", "open-favorite");
    assertFailure(await h.invoke("open-folder", ""), "open_failed", "open-folder");
    h.setOpenError("");
    assert.deepEqual(await h.invoke("open-file", L.a), { ok: true });
  });
});

// --- removed favorite / changed main folder -----------------------------------------------
test("removed favorite: its history rows are rejected as 'outside' (never redirected) and work again when the favorite is re-added", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    addHistory(h, L.d);
    assert.deepEqual(await h.invoke("open-file", L.d), { ok: true });
    h.opened.length = 0;

    await h.invoke("remove-favorite", L.fav);
    for (const ch of ["open-file", "reveal"]) assertFailure(await h.invoke(ch, L.d), "outside", ch);
    assert.deepEqual(h.opened, [], "nothing opened and no fallback to another folder");
    const hist = await h.invoke("get-history", { limit: 10 });
    assert.equal(hist.length, 1, "the history row itself is kept");
    assert.equal(hist[0].file, L.d);
    assertFailure(await h.invoke("open-favorite", L.fav), "not_allowed", "open-favorite of a removed favorite");

    h.queueDialog(L.fav);
    assert.equal((await h.invoke("add-favorite")).ok, true);
    assert.deepEqual(await h.invoke("open-file", L.d), { ok: true }, "re-adding the same folder restores access");
  });
});

test("changed main folder: rows from the previous main folder are 'outside' until that folder is added as a favorite", async () => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    addHistory(h, L.a);
    const newMain = h.mkdir("NewMain");
    const fresh = h.write("NewMain/fresh.mp3");
    h.queueDialog(newMain);
    assert.equal(await h.invoke("pick-main-folder"), newMain);
    assert.equal((await h.invoke("set-main-folder", newMain)).ok, true);
    assertFailure(await h.invoke("open-file", L.a), "outside", "old main folder file");
    assertFailure(await h.invoke("open-file", fresh), "not_allowed", "file in new main folder that has no history row");
    h.queueDialog(L.music);
    assert.equal((await h.invoke("add-favorite")).ok, true);
    assert.deepEqual(await h.invoke("open-file", L.a), { ok: true });
  });
});

// --- open-favorite / open-folder ----------------------------------------------------------
test("open-favorite: only a registered favorite opens (registered path is used); everything else is rejected", async (t) => {
  await withHarness({}, async (h) => {
    const L = layout(h);
    const alias = h.p("ext", "favalias");
    const haveAlias = symlink(L.fav, alias, "dir");
    h.mkdir("ext", "Fav", "sub");
    assert.deepEqual(await h.invoke("open-favorite", L.fav), { ok: true });
    assert.deepEqual(h.opened, [["openPath", L.fav]]);
    if (haveAlias) {
      assert.deepEqual(await h.invoke("open-favorite", alias), { ok: true });
      assert.deepEqual(h.opened[1], ["openPath", L.fav], "alias resolves to the registered folder, which is what gets opened");
    }
    const n = h.opened.length;
    for (const p of [L.music, path.join(L.fav, "sub"), L.favEvil, L.musicEvil, L.outside, h.userData, L.fav + path.sep + ".." + path.sep + "Fav-evil", path.dirname(L.fav)]) {
      assertFailure(await h.invoke("open-favorite", p), "not_allowed", p);
    }
    assert.equal(h.opened.length, n, "no shell call for rejected folders");

    fs.rmSync(L.fav, { recursive: true });
    assertFailure(await h.invoke("open-favorite", L.fav), "missing", "favorite folder deleted on disk");
    fs.writeFileSync(L.fav, "not a folder");
    assertFailure(await h.invoke("open-favorite", L.fav), "missing", "favorite path is now a file");
    assert.equal(h.opened.length, n);
    if (!haveAlias) t.diagnostic("symlink alias case skipped");
  });
});

// --- fingerprint-duplicate reveal / trash -------------------------------------------------
test("fingerprint duplicate: reveal of both files works; trash only ever accepts the offered NEW file", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const { L, payload } = await emitDuplicate(h);
    assert.equal(payload.matchFile, L.d);
    assert.equal(path.dirname(payload.newFile), L.music);
    assert.deepEqual(await h.invoke("reveal", payload.matchFile), { ok: true });
    assert.deepEqual(await h.invoke("reveal", payload.newFile), { ok: true });
    assert.deepEqual(h.opened.map(o => o[0]), ["reveal", "reveal"]);

    // The match file (also revealable) and unrelated files can't be trashed.
    addHistory(h, L.a);
    for (const p of [payload.matchFile, L.a, L.victim, L.techno]) assertFailure(await h.invoke("delete-file", p, payload.offerId), "not_allowed", p);
    assert.deepEqual(h.trashed, []);
    for (const f of [payload.matchFile, L.a, L.victim]) assert.ok(fs.existsSync(f));
    // open-file does not honor an offer: it is history-only
    assertFailure(await h.invoke("open-file", payload.matchFile), "not_allowed", "open-file of an offered-but-not-recorded file");
  });
});

test("delete-file awaits the trash call: failure is reported and keeps the offer; success is reported once and uses the real path", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const { payload } = await emitDuplicate(h);
    // 1. trash rejects -> ok:false, generic message (no OS error text), file untouched
    h.setTrashError(new Error("EPERM: operation not permitted, /secret/os/detail"));
    const fail = await h.invoke("delete-file", payload.newFile, payload.offerId);
    assertFailure(fail, "trash_failed", "failed trash");
    assert.ok(!/EPERM|secret/.test(fail.error), "OS error detail is not forwarded");
    assert.equal(h.trashed.length, 1);
    assert.ok(fs.existsSync(payload.newFile));
    // 2. retry is still possible; the response waits for the trash promise
    h.setTrashError(null);
    let release; const gate = new Promise(r => { release = r; });
    h.setTrashImpl(() => gate);
    let settled = false;
    const pending = h.invoke("delete-file", payload.newFile, payload.offerId).then(r => { settled = true; return r; });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(settled, false, "ok:true is not returned before the trash operation completes");
    release();
    assert.deepEqual(await pending, { ok: true });
    assert.deepEqual(h.trashed, [real(payload.newFile), real(payload.newFile)]);
    // 3. single use: the offer is consumed by a successful trash
    h.setTrashImpl(null);
    assertFailure(await h.invoke("delete-file", payload.newFile, payload.offerId), "not_allowed", "second delete");
    assert.equal(h.trashed.length, 2);
  });
});

test("delete-file rejects: file replaced by a symlink, file gone, and new file whose favorite was removed", async (t) => {
  await withHarness({ withWindow: true }, async (h) => {
    const { L, payload } = await emitDuplicate(h);
    addHistory(h, L.a);
    // replaced by a symlink to another in-root file -> refuse to trash a link (and never trash its target)
    fs.rmSync(payload.newFile);
    if (symlink(L.a, payload.newFile, "file")) {
      assertFailure(await h.invoke("delete-file", payload.newFile, payload.offerId), "symlink", "symlinked new file");
      assert.ok(fs.existsSync(L.a));
      fs.rmSync(payload.newFile);
    } else t.diagnostic("symlink case skipped");
    assertFailure(await h.invoke("delete-file", payload.newFile, payload.offerId), "missing", "file gone");
    assert.deepEqual(h.trashed, []);
  });
  await withHarness({ withWindow: true }, async (h) => {
    const { L, payload } = await emitDuplicate(h, { newInFavorite: true });
    assert.equal(path.dirname(payload.newFile), L.fav);
    assert.deepEqual(await h.invoke("reveal", payload.newFile), { ok: true });
    await h.invoke("remove-favorite", L.fav);
    assertFailure(await h.invoke("delete-file", payload.newFile, payload.offerId), "outside", "favorite removed");
    assertFailure(await h.invoke("reveal", payload.matchFile), "outside", "reveal of match in removed favorite");
    assert.deepEqual(h.trashed, []);
    assert.ok(fs.existsSync(payload.newFile));
  });
});

// --- structure guards ---------------------------------------------------------------------
test("source guard (main.js): every shell sink is behind the H1 checks; trash is awaited", () => {
  const sinks = MAIN_SRC.match(/shell\.(openPath|showItemInFolder|trashItem)\(/g) || [];
  assert.equal(sinks.length, 4, "openWithShell, reveal, delete-file and the argument-free open-main-folder");
  assert.match(MAIN_SRC, /await shell\.trashItem\(chk\.real\)/);
  assert.match(MAIN_SRC, /await shell\.openPath\(target\)/);
  assert.match(MAIN_SRC, /shell\.showItemInFolder\(chk\.real\)/);
  assert.match(MAIN_SRC, /ipcMain\.handle\("open-main-folder", \(\) => \{ const b = mainFolder\(\); if \(fs\.existsSync\(b\)\) shell\.openPath\(b\); return true; \}\);/, "open-main-folder takes no renderer path and is unchanged");
  assert.ok(!/shell\.\w+\((p|filePath|folderPath)\)/.test(MAIN_SRC), "no shell call receives a raw renderer argument");
  for (const ch of ["open-file", "reveal", "delete-file", "open-favorite"]) {
    const i = MAIN_SRC.indexOf(`ipcMain.handle("${ch}"`);
    assert.ok(i > 0, ch);
    assert.match(MAIN_SRC.slice(i, i + 1200), /checkManagedFile|resolveFavorite/, `${ch} validates first`);
  }
});

test("source guard (renderer.js): open/reveal/trash callers go through runOpenAction and show the result; strings exist in es and en", () => {
  assert.equal((RENDERER_SRC.match(/api\.(openFile|reveal|deleteFile|openFavorite|openFolder)\(/g) || []).length, 6);
  assert.equal((RENDERER_SRC.match(/runOpenAction\(\(\) => api\./g) || []).length, 6, "every call site is wrapped");
  for (const key of ["h1_not_allowed", "h1_outside", "h1_missing", "h1_folder_missing", "h1_failed", "h1_trash_failed"]) {
    assert.equal((RENDERER_SRC.match(new RegExp("\\n    " + key + ":", "g")) || []).length, 2, key);
  }
  assert.match(RENDERER_SRC, /const ok = await runOpenAction\(\(\) => api\.deleteFile\(w\.newFile, w\.offerId\)[^\n]*[\s\S]*?if \(!ok\) return;/, "a failed trash keeps the warning open and carries the warning's offer id");
  const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
  assert.match(html, /<div id="histMsg" class="field-err" role="alert"><\/div>/);
});
