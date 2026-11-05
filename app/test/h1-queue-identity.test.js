"use strict";
// Queue-mode fingerprint duplicates: main must echo the queue item's id (queueId) in "fingerprint-dup".
// Run from the repo root with:  node --test app/test/h1-queue-identity.test.js
// Stubs only (electron, child_process, https, npm binaries, fpcalc); temp directories; nothing is opened,
// revealed or trashed. This covers MAIN's half of the contract. The renderer's half (row lookup, delayed
// results, visible indication) is in the browser check, which is a renderer simulation, not Electron.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { withHarness } = require("./h3-harness");
const { assertFailure, emitDuplicate, setupDuplicates } = require("./h1-fixtures");

const events = (h) => h.sent.filter(c => c[0] === "fingerprint-dup").map(c => c[1]);
const audio = (h, o) => h.invoke("download", { url: "https://example.com/v", type: "audio", audioFormat: "mp3", bitrate: "192", autoTag: false, ...o });

test("a queue download's id is echoed in the event; the event arrives AFTER the download call has already returned", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    setupDuplicates(h);
    h._dupName = "q1.mp3";
    const r = await audio(h, { _inQueue: true, _queueId: "item-1" });
    assert.ok(r.ok);
    assert.equal(events(h).length, 0, "download already resolved; detection has not reported yet (the delayed-result situation)");
    assert.ok(await h.waitFor(() => events(h).length === 1));
    const [e] = events(h);
    assert.equal(e.queueId, "item-1");
    assert.equal(e.inQueue, true);
    assert.equal(e.offerId, null, "queue mode never creates an offer");
    assert.equal(e.newFile, r.files[0]);
  });
});

test("two queue items: each event carries its OWN item's id, whatever the arrival order (no shared 'current item')", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    setupDuplicates(h);
    h._dupName = "qa.mp3"; const ra = await audio(h, { _inQueue: true, _queueId: "item-A" });
    h._dupName = "qb.mp3"; const rb = await audio(h, { _inQueue: true, _queueId: "item-B" });   // B starts before A's result is in
    assert.ok(await h.waitFor(() => events(h).length === 2));
    const byFile = Object.fromEntries(events(h).map(e => [path.basename(e.newFile), e.queueId]));
    assert.deepEqual(byFile, { "qa.mp3": "item-A", "qb.mp3": "item-B" });
    assert.equal(path.basename(ra.files[0]), "qa.mp3"); assert.equal(path.basename(rb.files[0]), "qb.mp3");
  });
});

test("a missing or malformed _queueId yields queueId null (the renderer then flags nothing); single mode never carries one", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const bad = [undefined, null, "", 5, {}, ["x"], true, "x".repeat(201)];
    let i = 0;
    for (const v of bad) {
      const ev = await emitDuplicate(h, { name: `bad${i++}.mp3`, queue: true, queueId: v });
      assert.equal(ev.payload.queueId, null, `queueId ${JSON.stringify(v && String(v).slice(0, 12))}`);
      assert.equal(ev.payload.inQueue, true);
    }
    const ok = await emitDuplicate(h, { name: "ok.mp3", queue: true, queueId: "x".repeat(200) });
    assert.equal(ok.payload.queueId, "x".repeat(200));
    // Not a queue download: the id is ignored, and the single-mode warning still gets its offer.
    const single = await emitDuplicate(h, { name: "single.mp3", queueId: "item-9" });
    assert.equal(single.payload.queueId, null);
    assert.equal(single.payload.inQueue, false);
    assert.equal(typeof single.payload.offerId, "string");
  });
});

test("a queue event carrying an id changes nothing about offers: it does not supersede or revoke the live warning", async () => {
  await withHarness({ withWindow: true }, async (h) => {
    const A = await emitDuplicate(h, { name: "dupA.mp3" });
    const Q = await emitDuplicate(h, { name: "dupQ.mp3", queue: true, queueId: "item-Q" });
    assert.equal(Q.payload.queueId, "item-Q");
    assert.equal(Q.payload.offerId, null);
    assertFailure(await h.invoke("delete-file", Q.payload.newFile, null), "not_allowed", "queue file has no offer");
    assert.deepEqual(await h.invoke("delete-file", A.payload.newFile, A.payload.offerId), { ok: true }, "A is still live");
  });
});

test("source guard: the renderer sends item.id as _queueId and the queue-mode handler never uses queueActiveId or status", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  assert.match(src, /_queueId: item\.id,/);
  const i = src.indexOf("api.onFingerprintDup((d) => {");
  const block = src.slice(i, src.indexOf("// Close the warning and revoke its permission in main."));
  const queueBranch = block.slice(0, block.indexOf("// Single mode:"));
  assert.ok(queueBranch.length > 100, "queue branch found");
  assert.ok(!/queueActiveId|queueRunning/.test(queueBranch), "no mutable current-item variable");
  assert.ok(!/status\s*:/.test(queueBranch), "the handler writes no status");
  assert.match(queueBranch, /d\.queueId/);
});

test("reachability guard: the single-download path (the only source of single-mode warnings and offers) has no entry point from the controls", () => {
  // Every Download-button press, playlist-picker download, watch-folder item and Retry goes through the queue
  // runner, which always sends _inQueue. runDownload() is the only other api.download caller; it is invoked only
  // by "Download anyway" (dupForce), whose pendingDupOpts exists only after runDownload itself showed that
  // warning. So nothing can start it. If this guard fails, a new entry point exists and the single-mode warning
  // (offerId, Delete new, Keep both) must be verified end-to-end again, not only by the injected-event browser check.
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  const n = (re) => (src.match(re) || []).length;
  assert.equal(n(/await api\.download\(/g), 2, "api.download callers: runDownload + the queue runner");
  assert.equal(n(/\brunDownload\(/g), 2, "runDownload: its definition + the single call in dupForce");
  assert.match(src, /\$\("dupForce"\)\.onclick = async \(\) => \{\s*hideDupWarning\(\);\s*if \(pendingDupOpts\) await runDownload\(pendingDupOpts\);/);
  assert.equal(n(/\bshowDupWarning\(/g), 2, "showDupWarning: its definition + the single call inside runDownload");
  assert.equal(n(/pendingDupOpts = \{/g), 1, "pendingDupOpts is only ever set by showDupWarning");
  assert.equal(n(/_inQueue: true,/g), 1, "the queue runner's opts builder is the only other place that builds download opts");
});
