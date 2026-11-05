"use strict";
// H1 offer-lifetime checks: how long a fingerprint-duplicate warning's permission to reveal / trash lives.
// Run from the repo root with:  node --test app/test/h1-offer-lifetime.test.js
// Real duplicate detection in main.js is driven with stubs (fpcalc output, yt-dlp output); electron's
// shell only RECORDS calls (trashItem can be held open or made to fail). Temp directories only: nothing
// is trashed, opened or revealed for real. The renderer controls are exercised in the browser check.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { withHarness } = require("./h3-harness");
const { real, assertFailure, emitDuplicate } = require("./h1-fixtures");

const del = (h, ev, offerId) => h.invoke("delete-file", ev.payload.newFile, offerId === undefined ? ev.payload.offerId : offerId);
const dismiss = (h, ev) => h.invoke("fingerprint-dismiss", ev.payload.offerId);
const tick = () => new Promise(r => setTimeout(r, 15));
function gate() { let release, fail; const p = new Promise((res, rej) => { release = res; fail = rej; }); return { p, release, fail }; }

test("Keep both revokes the offer: trash is refused, the offer-only reveal grant goes away, history reveal keeps working", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    assert.equal(typeof ev.payload.offerId, "string");
    assert.deepEqual(await h.invoke("reveal", ev.payload.matchFile), { ok: true }, "reveal works while the warning is live");
    assert.deepEqual(await dismiss(h, ev), { ok: true, revoked: true, trashInProgress: false });
    assertFailure(await del(h, ev), "not_allowed", "delete after Keep both");
    assertFailure(await h.invoke("reveal", ev.payload.matchFile), "not_allowed", "match file is not a history row: its reveal grant came from the offer");
    assert.deepEqual(await h.invoke("reveal", ev.payload.newFile), { ok: true }, "the new file is a history row");
    assert.deepEqual(await dismiss(h, ev), { ok: true, revoked: false, trashInProgress: false }, "dismissing twice is harmless");
    assert.deepEqual(h.trashed, []);
    assert.ok(fs.existsSync(ev.payload.newFile));
  });
});

test("only main creates offers and only the exact live id (with the matching path) authorizes trash", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    const p = ev.payload;
    // Garbage / foreign ids and paths never create or revoke anything.
    for (const id of [undefined, null, "", 5, {}, [p.offerId], "00000000-0000-4000-8000-000000000000", p.offerId + "x"]) {
      assertFailure(await h.invoke("delete-file", p.newFile, id), "not_allowed", `id ${JSON.stringify(id)}`);
      assert.deepEqual(await h.invoke("fingerprint-dismiss", id), { ok: true, revoked: false, trashInProgress: false });
    }
    assertFailure(await h.invoke("delete-file", p.matchFile, p.offerId), "not_allowed", "right id, other file");
    assertFailure(await h.invoke("delete-file", ev.L.a, p.offerId), "not_allowed", "right id, unrelated history-less file");
    assertFailure(await h.invoke("delete-file", "relative.mp3", p.offerId), "invalid", "malformed path");
    assert.deepEqual(h.trashed, []);
    assert.deepEqual(await del(h, ev), { ok: true }, "the real warning still works after all of that");
    assert.deepEqual(h.trashed, [real(p.newFile)]);
  });
});

test("a newer warning replaces the older one: the old id is dead, dismissing it cannot revoke the new one", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const A = await emitDuplicate(h, { name: "dupA.mp3" });
    const B = await emitDuplicate(h, { name: "dupB.mp3" });          // back-to-back warnings
    assert.notEqual(A.payload.offerId, B.payload.offerId);
    assertFailure(await del(h, A), "not_allowed", "superseded warning A");
    assert.deepEqual(await dismiss(h, A), { ok: true, revoked: false, trashInProgress: false }, "late dismissal of A does not touch B");
    assertFailure(await h.invoke("delete-file", B.payload.newFile, A.payload.offerId), "not_allowed", "B's file with A's id");
    assertFailure(await h.invoke("delete-file", A.payload.newFile, B.payload.offerId), "not_allowed", "A's file with B's id");
    assert.deepEqual(h.trashed, []);
    assert.deepEqual(await del(h, B), { ok: true });
    assert.deepEqual(h.trashed, [real(B.payload.newFile)]);
    assert.ok(fs.existsSync(A.payload.newFile), "A's file was never touched");
  });
});

test("same file path, two warnings: ids keep them apart", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const C1 = await emitDuplicate(h, { name: "dupC.mp3" });
    const C2 = await emitDuplicate(h, { name: "dupC.mp3" });
    assert.equal(C1.payload.newFile, C2.payload.newFile);
    assert.notEqual(C1.payload.offerId, C2.payload.offerId);
    assert.deepEqual(await dismiss(h, C1), { ok: true, revoked: false, trashInProgress: false });
    assertFailure(await del(h, C1), "not_allowed", "old warning for the same path");
    assert.deepEqual(await del(h, C2), { ok: true });
    assert.equal(h.trashed.length, 1);
  });
});

test("queue-mode duplicates get no offer and do not revoke the warning that is on screen", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const A = await emitDuplicate(h, { name: "dupA.mp3" });
    const Q = await emitDuplicate(h, { name: "dupQ.mp3", queue: true });
    assert.equal(Q.payload.offerId, null);
    assert.equal(Q.payload.inQueue, true);
    assertFailure(await h.invoke("delete-file", Q.payload.newFile, null), "not_allowed", "queue file, no id");
    assertFailure(await h.invoke("delete-file", Q.payload.newFile, A.payload.offerId), "not_allowed", "queue file with A's id");
    assert.deepEqual(await del(h, A), { ok: true }, "A is still live");
    assert.deepEqual(h.trashed, [real(A.payload.newFile)]);
  });
});

test("a second request while one is in progress cannot call the OS trash again; success consumes the offer", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    const g = gate();
    h.setTrashImpl(() => g.p);
    const d1 = del(h, ev), d2 = del(h, ev), d3 = del(h, ev);
    assertFailure(await d2, "in_progress", "second concurrent request");
    assertFailure(await d3, "in_progress", "third concurrent request");
    assert.equal(h.trashed.length, 1, "exactly one OS trash call");
    // reveal of the offered files keeps working while the trash is pending
    assert.deepEqual(await h.invoke("reveal", ev.payload.matchFile), { ok: true });
    g.release();
    assert.deepEqual(await d1, { ok: true });
    assert.equal(h.trashed.length, 1);
    assertFailure(await del(h, ev), "not_allowed", "after success");
    assertFailure(await h.invoke("reveal", ev.payload.matchFile), "not_allowed", "grant consumed with the offer");
    assert.equal(h.trashed.length, 1);
  });
});

test("failed trash: the same live warning can retry (also after a concurrent attempt); the failure text carries no OS detail", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    const g = gate();
    h.setTrashImpl(() => g.p);
    const d1 = del(h, ev), d2 = del(h, ev);
    assertFailure(await d2, "in_progress", "concurrent while failing");
    g.fail(new Error("EPERM /secret/os/detail"));
    const r1 = await d1;
    assertFailure(r1, "trash_failed", "first attempt");
    assert.ok(!/EPERM|secret/.test(r1.error));
    assert.ok(fs.existsSync(ev.payload.newFile));
    h.setTrashImpl(null);
    assert.deepEqual(await del(h, ev), { ok: true }, "retry on the still-visible warning");
    assert.equal(h.trashed.length, 2, "one failed attempt + one retry; the refused concurrent request never reached the OS");
    assertFailure(await del(h, ev), "not_allowed", "no third trash after success");
  });
});

test("failure, then Keep both: no retry from the closed warning", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    h.setTrashError(new Error("EPERM"));
    assertFailure(await del(h, ev), "trash_failed", "failed");
    h.setTrashError(null);
    assert.deepEqual(await dismiss(h, ev), { ok: true, revoked: true, trashInProgress: false });
    assertFailure(await del(h, ev), "not_allowed", "retry after dismissal");
    assert.equal(h.trashed.length, 1);
    assert.ok(fs.existsSync(ev.payload.newFile));
  });
});

test("dismissal while a trash is pending: the offer is revoked at once, the running OS call is not cancelled and reports its own result", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    const g = gate();
    h.setTrashImpl(() => g.p);
    const d1 = del(h, ev);
    assert.deepEqual(await dismiss(h, ev), { ok: true, revoked: true, trashInProgress: true });
    assertFailure(await del(h, ev), "not_allowed", "new request after dismissal (not 'in_progress': the offer is gone)");
    assert.equal(h.trashed.length, 1, "no second OS call");
    g.release();
    assert.deepEqual(await d1, { ok: true }, "the operation that was already running still completes and says so");
    assert.deepEqual(await dismiss(h, ev), { ok: true, revoked: false, trashInProgress: false });
  });
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    const g = gate();
    h.setTrashImpl(() => g.p);
    const d1 = del(h, ev);
    await dismiss(h, ev);
    g.fail(new Error("EPERM"));
    assertFailure(await d1, "trash_failed", "failure after dismissal is still reported");
    h.setTrashImpl(null);
    assertFailure(await del(h, ev), "not_allowed", "a dismissed warning cannot retry");
    assert.equal(h.trashed.length, 1);
    assert.ok(fs.existsSync(ev.payload.newFile));
  });
});

test("replacement while a trash is pending: the pending one finishes on its own; the new warning has its own, independent permission", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const A = await emitDuplicate(h, { name: "dupA.mp3" });
    const g = gate();
    h.setTrashImpl(() => g.p);
    const dA = del(h, A);
    const B = await emitDuplicate(h, { name: "dupB.mp3" });
    assertFailure(await del(h, A), "not_allowed", "A was superseded (offer gone, so not 'in_progress')");
    assert.deepEqual(await dismiss(h, A), { ok: true, revoked: false, trashInProgress: false }, "A's id can no longer revoke anything");
    const dB = del(h, B);                                   // B is live and independent of A's pending call
    await tick();
    assert.deepEqual(h.trashed, [real(A.payload.newFile), real(B.payload.newFile)]);
    g.release();
    assert.deepEqual(await dA, { ok: true });
    assert.deepEqual(await dB, { ok: true });
  });
  await withHarness({ withWindow: true }, async (h) => {
    const A = await emitDuplicate(h, { name: "dupA.mp3" });
    const g = gate();
    h.setTrashImpl(() => g.p);
    const dA = del(h, A);
    const B = await emitDuplicate(h, { name: "dupB.mp3" });
    g.fail(new Error("EPERM"));
    assertFailure(await dA, "trash_failed", "A fails after being superseded");
    h.setTrashImpl(null);
    assertFailure(await del(h, A), "not_allowed", "A cannot retry");
    assert.deepEqual(await del(h, B), { ok: true }, "B is unaffected");
  });
});

test("a renderer (re)load revokes the live offer; an operation already running is not cancelled", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    h.fireWebContents("did-finish-load");
    assertFailure(await del(h, ev), "not_allowed", "after reload");
    assertFailure(await h.invoke("reveal", ev.payload.matchFile), "not_allowed", "offer-only reveal grant revoked");
    assert.deepEqual(h.trashed, []);
  });
  await withHarness({ withWindow: true }, async (h) => {
    const ev = await emitDuplicate(h);
    const g = gate();
    h.setTrashImpl(() => g.p);
    const d1 = del(h, ev);
    h.fireWebContents("did-finish-load");
    g.release();
    assert.deepEqual(await d1, { ok: true });
    assert.equal(h.trashed.length, 1);
  });
});

test("source guard (main.js / preload.js): offers are created only by the duplicate-detection path; the state flip precedes the awaited OS call", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.equal((main.match(/offerFingerprint\(/g) || []).length, 2, "definition + the single call in the duplicate-detection path");
  assert.match(main, /const offerId = inQueue \? null : offerFingerprint\(f, dup\.file\);/);
  assert.ok(!/ipcMain\.handle\("[^"]*(offer|create-warning)[^"]*"/.test(main), "no IPC channel creates an offer");
  assert.match(preload, /deleteFile: \(p, offerId\) => ipcRenderer\.invoke\("delete-file", p, offerId\)/);
  assert.match(preload, /fingerprintDismiss: \(offerId\) => ipcRenderer\.invoke\("fingerprint-dismiss", offerId\)/);
  const i = main.indexOf('ipcMain.handle("delete-file"');
  const body = main.slice(i, main.indexOf('ipcMain.handle("fingerprint-dismiss"'));
  const flip = body.indexOf('offer.state = "trashing"'), call = body.indexOf("await shell.trashItem");
  assert.ok(flip > 0 && call > flip, "state flip happens before the await");
  assert.ok(!/\bawait\b/.test(body.slice(0, flip)), "no await between the checks and the state flip");
});
