"use strict";
// Renderer-level checks for the fingerprint-duplicate lifecycle. RENDERER SIMULATION, NOT ELECTRON:
// the real renderer/index.html + destination.js + renderer.js run in headless Chromium against a fake
// window.api (api-stub.js). Nothing here is main.js, Electron, an OS trash, a real file or yt-dlp.
// Main's half of the contract (queueId echo, offers, trash state machine) is covered by the node tests.
//
// Run:  NODE_PATH=<dir containing playwright> node --test fp-dup-lifecycle.browser.js
// (playwright is NOT a dependency of this repo; nothing is installed by this file.)
// Env:  RENDERER_DIR=<renderer folder>  (default ../renderer next to this folder)
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chromium } = require("playwright");

const RENDERER = path.resolve(process.env.RENDERER_DIR || path.join(__dirname, "..", "renderer"));
const STUB = path.join(__dirname, "api-stub.js");
let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open() {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript({ path: STUB });
  await page.goto("file://" + path.join(RENDERER, "index.html"));
  await page.waitForFunction(() => window.__ctl && __ctl.histCalls >= 1);
  await tick(page, 80);
  page.errors = errors;
  return page;
}
const tick = (page, ms = 30) => page.evaluate((n) => new Promise(r => setTimeout(r, n)), ms);
const wait = (page, expr, arg) => page.waitForFunction(expr, arg, { timeout: 4000 });
// The Download button, exactly as a user presses it (value set without an input event: no preview debounce).
async function press(page, url, format) {
  await page.evaluate(([u, f]) => { document.getElementById("url").value = u; if (f) document.getElementById("format").value = f; }, [url, format || null]);
  await page.click("#go");
}
const queue = (page) => page.evaluate(() => JSON.parse(JSON.stringify(__ctl.queue)));
const stripFp = (q) => q.map(({ fpDup, ...rest }) => rest);
async function rows(page) {                                  // what the Queue tab shows
  await page.evaluate(() => renderQueue());
  return page.evaluate(() => [...document.querySelectorAll("#queueActiveRows tr.q-row, #queueCompletedRows tr.q-row")].map(tr => ({
    id: tr.dataset.id,
    st: (tr.querySelector(".q-status span") || {}).className,
    fp: (tr.querySelector(".q-fpdup") || {}).textContent || null,
    fpVisible: !!tr.querySelector(".q-fpdup") && tr.querySelector(".q-fpdup").offsetParent !== null,
  })));
}
const showQueueTab = (page) => page.click('.tab[data-tab="queue"]');
const queueUi = (page) => page.evaluate(() => ({
  summary: document.getElementById("queueSummary").textContent,
  retryBtnDisplay: document.getElementById("queueRetryBtn").style.display,
  runDisabled: document.getElementById("queueRunBtn").disabled,
  activeCard: document.getElementById("dlActive").style.display,
}));
const warn = (page) => page.evaluate(() => ({
  shown: getComputedStyle(document.getElementById("fpDupWarning")).display !== "none",
  title: $("fpDupTitle").textContent, match: $("fpDupMatch").textContent,
  delDisabled: $("fpDupDelete").disabled, offer: fpDupPending ? fpDupPending.offerId : null,
  msg: $("msg").textContent,
}));
const ctl = (page, fn, arg) => page.evaluate(fn, arg);

// ============================================================================================
// A. Reachability, from the real Download button
// ============================================================================================
test("A1 Download button (audio and video): always a queue item, always _inQueue with that item's id; the single-download path is never entered", async () => {
  const page = await open();
  await page.evaluate(() => { window.__single = 0; const r = window.runDownload; window.runDownload = (...a) => { __single++; return r(...a); }; });
  await press(page, "https://example.com/a", "audio:mp3");
  await wait(page, () => __ctl.downloads.length === 1);
  await press(page, "https://example.com/v", "video:1080");
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.downloads.length === 2);
  const [d0, d1] = await ctl(page, () => __ctl.downloads.map(d => d.opts));
  const q = await queue(page);
  assert.equal(d0._inQueue, true); assert.equal(d1._inQueue, true);
  assert.equal(d0._queueId, q[0].id); assert.equal(d1._queueId, q[1].id);
  assert.notEqual(q[0].id, q[1].id);
  assert.equal(await page.evaluate(() => __single), 0, "runDownload (the only caller of api.download without _inQueue) never ran");
  assert.deepEqual(page.errors, []);
});

// ============================================================================================
// B. Queue-mode duplicate: the real renderer + a stubbed fingerprint result carrying the item's identity
// ============================================================================================
test("B1 result arrives after the NEXT item started: flags only the originating row; statuses and queue UI unchanged", async () => {
  const page = await open();
  await press(page, "https://example.com/a");
  await wait(page, () => __ctl.downloads.length === 1);
  await press(page, "https://example.com/b");
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.downloads.length === 2 && __ctl.queue[0].status === "done" && __ctl.queue[1].status === "running");
  await showQueueTab(page);
  const before = { q: await queue(page), ui: await queueUi(page), rows: await rows(page) };
  assert.deepEqual(before.q.map(i => i.status), ["done", "running"]);
  const idA = before.q[0].id, idB = before.q[1].id;

  const payload = await ctl(page, () => __ctl.fingerprintResult(0));        // A's detection finishes while B is running
  assert.equal(payload.queueId, idA, "identity came from the request the real renderer built");
  await wait(page, () => __ctl.queue[0].fpDup);
  const after = { q: await queue(page), ui: await queueUi(page), rows: await rows(page) };

  assert.deepEqual(after.q.map(i => i.status), ["done", "running"], "no status changed");
  assert.deepEqual(stripFp(after.q), stripFp(before.q), "nothing but fpDup was written");
  assert.equal(after.q[1].fpDup, undefined);
  assert.equal(after.rows[0].id, idA);
  assert.match(after.rows[0].fp, /Possible audio duplicate — old-0\.mp3/);
  assert.equal(after.rows[0].fpVisible, true, "visible in the Queue tab");
  assert.equal(after.rows[1].fp, null, "the running item (B) is not marked");
  assert.equal(after.rows[0].st, "q-st-done"); assert.equal(after.rows[1].st, "q-st-running");
  assert.deepEqual(after.ui, before.ui, "summary / Retry button / Run button / active card unchanged");
  assert.equal(after.ui.retryBtnDisplay, "none");
  assert.equal(await ctl(page, () => __ctl.downloads.length), 2, "no extra download was started");

  await ctl(page, () => __ctl.finishDownload(1));
  await wait(page, () => __ctl.queue.every(i => i.status === "done"));
  const end = await rows(page);
  assert.ok(end[0].fp, "A keeps its indication after B completes"); assert.equal(end[1].fp, null);
  await ctl(page, () => __ctl.fingerprintResult(1));                        // B's own result, later
  await wait(page, () => __ctl.queue[1].fpDup);
  const both = await rows(page);
  assert.match(both[0].fp, /old-0\.mp3/); assert.match(both[1].fp, /old-1\.mp3/);
  assert.deepEqual(page.errors, []);
});

test("B2 result arrives after the originating item completed and the queue went idle: status stays done, nothing is re-run", async () => {
  const page = await open();
  await press(page, "https://example.com/a");
  await wait(page, () => __ctl.downloads.length === 1);
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.queue[0].status === "done" && queueRunning === false);
  await showQueueTab(page);
  const before = { q: await queue(page), ui: await queueUi(page) };
  await ctl(page, () => __ctl.fingerprintResult(0));
  await wait(page, () => __ctl.queue[0].fpDup);
  await tick(page, 100);
  const after = { q: await queue(page), ui: await queueUi(page), rows: await rows(page) };
  assert.equal(after.q[0].status, "done");
  assert.deepEqual(stripFp(after.q), stripFp(before.q));
  assert.deepEqual(after.ui, before.ui);
  assert.equal(after.ui.retryBtnDisplay, "none", "a completed download is not offered for retry");
  assert.match(after.rows[0].fp, /Possible audio duplicate/); assert.equal(after.rows[0].st, "q-st-done");
  assert.equal(await ctl(page, () => __ctl.downloads.length), 1);
  assert.equal(await page.evaluate(() => queueRunning), false, "queue did not restart");
  assert.deepEqual(page.errors, []);
});

test("B3 result arrives before the runner records completion: the flag is not erased by the later status write", async () => {
  const page = await open();
  await press(page, "https://example.com/a");
  await wait(page, () => __ctl.downloads.length === 1 && __ctl.queue[0].status === "running");
  await ctl(page, () => __ctl.fingerprintResult(0));
  await wait(page, () => __ctl.queue[0].fpDup);
  assert.equal((await queue(page))[0].status, "running", "still running: the event did not complete or fail it");
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.queue[0].status === "done");
  const q = await queue(page);
  assert.equal(q[0].status, "done"); assert.ok(q[0].fpDup);
  await showQueueTab(page);
  assert.match((await rows(page))[0].fp, /old-0\.mp3/);
  assert.deepEqual(page.errors, []);
});

test("B4 identical URLs/titles, results out of order: identity is the queue id, nothing else", async () => {
  const page = await open();
  await press(page, "https://example.com/same");
  await wait(page, () => __ctl.downloads.length === 1);
  await press(page, "https://example.com/same");
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.downloads.length === 2);
  await ctl(page, () => __ctl.finishDownload(1));
  await wait(page, () => __ctl.queue.every(i => i.status === "done"));
  await showQueueTab(page);
  const q = await queue(page);
  assert.equal(q[0].url, q[1].url);   // same link twice (the runner then renames each row after its file)
  await ctl(page, () => __ctl.fingerprintResult(1));                        // B first
  await wait(page, () => __ctl.queue[1].fpDup);
  let r = await rows(page);
  assert.equal(r[0].fp, null); assert.match(r[1].fp, /old-1\.mp3/);
  await ctl(page, () => __ctl.fingerprintResult(0));
  await wait(page, () => __ctl.queue[0].fpDup);
  r = await rows(page);
  assert.match(r[0].fp, /old-0\.mp3/); assert.match(r[1].fp, /old-1\.mp3/);
  assert.deepEqual(page.errors, []);
});

test("B5 no usable identity, an unknown id, or a removed item: nothing is flagged and nothing else changes", async () => {
  const page = await open();
  await press(page, "https://example.com/a");
  await wait(page, () => __ctl.downloads.length === 1);
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.queue[0].status === "done" && queueRunning === false);
  await showQueueTab(page);
  const before = await queue(page);
  for (const queueId of [null, undefined, "", "q-999", 123, ["q-1"]]) {
    await ctl(page, (id) => __ctl.fingerprintResult(0, { queueId: id }), queueId);
  }
  await tick(page, 100);
  assert.deepEqual(await queue(page), before, "queue untouched");
  assert.ok((await rows(page)).every(r => r.fp === null));
  // removed before the result arrives
  await page.click(".q-remove");
  await wait(page, () => __ctl.queue.length === 0);
  await ctl(page, () => __ctl.fingerprintResult(0));
  await tick(page, 100);
  assert.deepEqual(await queue(page), [], "no ghost row");
  assert.deepEqual(page.errors, []);
});

test("B6 an explicit Retry clears the previous run's flag", async () => {
  const page = await open();
  await page.evaluate(() => { __ctl.queue.push({ id: "q-x", url: "https://example.com/x", format: "audio:mp3", destId: "", status: "skipped", title: "x", error: null, note: "n", fpDup: { matchTitle: "old.mp3" } }); });
  await showQueueTab(page);
  assert.match((await rows(page))[0].fp, /old\.mp3/);
  await page.click(".q-retry");
  await wait(page, () => __ctl.downloads.length === 1);
  const it = (await queue(page))[0];
  assert.equal(it.fpDup, null); assert.equal(it.status, "running");
  assert.equal((await rows(page))[0].fp, null);
  assert.deepEqual(page.errors, []);
});

// ============================================================================================
// C. The single-mode warning. NOT reachable from the normal controls (see A1 / the node source guard):
//    these drive the renderer's DORMANT handler with an injected event. They check the warning's own
//    lifetime logic; they are not end-to-end product verification.
// ============================================================================================
const W = (n) => page_ => page_.evaluate((i) => __ctl.singleWarning(i), n);
async function startDelete(page) {                                           // click Delete new on the current warning, trash held open
  await page.evaluate(() => { __ctl.deleteManual = true; });
  await page.click("#fpDupDelete");
  await wait(page, () => __ctl.deleteCalls.length >= 1);
}
test("C1 FINDING 1: a newer warning arrives while the history refresh is pending; the old result must not close or clear it", async () => {
  const page = await open();
  await W(1)(page);
  assert.equal((await warn(page)).title, "Warn 1");
  await startDelete(page);
  await page.evaluate(() => { __ctl.histHold = true; });
  const h0 = await ctl(page, () => __ctl.histCalls);
  await ctl(page, () => __ctl.settleDelete(0, { ok: true }));                // old trash result arrives -> renderer starts refreshHistory
  await wait(page, (n) => __ctl.histCalls > n, h0);                          // ...and it is now pending
  await W(2)(page);                                                          // newer warning arrives during the await
  let w = await warn(page);
  assert.equal(w.shown, true); assert.equal(w.title, "Warn 2"); assert.equal(w.offer, "offer-2"); assert.equal(w.delDisabled, false);
  await ctl(page, () => __ctl.releaseHistory());                             // old history refresh resolves
  await tick(page, 120);
  w = await warn(page);
  assert.equal(w.shown, true, "newer warning still visible");
  assert.equal(w.title, "Warn 2"); assert.equal(w.match, "orig2.mp3");
  assert.equal(w.offer, "offer-2", "fpDupPending still the newer warning");
  assert.equal(w.delDisabled, false, "newer warning's Delete still enabled");
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), [], "nothing was dismissed/revoked");
  assert.match(w.msg, /file was moved/i, "the old result is still reported honestly");
  // ...and actionable: Delete new acts on warning 2 with warning 2's offer
  await ctl(page, () => { __ctl.histHold = false; });
  await page.click("#fpDupDelete");
  await wait(page, () => __ctl.deleteCalls.length === 2);
  assert.deepEqual(await ctl(page, () => __ctl.deleteCalls[1]), ["/Users/test/Music/w2.mp3", "offer-2"]);
  await ctl(page, () => __ctl.settleDelete(1, { ok: true }));
  await wait(page, () => getComputedStyle(document.getElementById("fpDupWarning")).display === "none");
  assert.equal((await warn(page)).offer, null);
  assert.deepEqual(page.errors, []);
});

test("C2 same race, then Keep both on the newer warning revokes ITS offer only", async () => {
  const page = await open();
  await W(1)(page); await startDelete(page);
  await page.evaluate(() => { __ctl.histHold = true; });
  const h0 = await ctl(page, () => __ctl.histCalls);
  await ctl(page, () => __ctl.settleDelete(0));
  await wait(page, (n) => __ctl.histCalls > n, h0);
  await W(2)(page);
  await ctl(page, () => __ctl.releaseHistory()); await tick(page, 120);
  await page.click("#fpDupDismiss");
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), ["offer-2"]);
  assert.equal((await warn(page)).shown, false);
});

test("C3 newer warning arrives while the TRASH is pending: old success then old refresh leave it alone", async () => {
  const page = await open();
  await W(1)(page); await startDelete(page);
  await W(2)(page);
  assert.equal((await warn(page)).delDisabled, false, "new warning starts enabled");
  await page.evaluate(() => { __ctl.histHold = true; });
  const h0 = await ctl(page, () => __ctl.histCalls);
  await ctl(page, () => __ctl.settleDelete(0));
  await wait(page, (n) => __ctl.histCalls > n, h0);
  let w = await warn(page);
  assert.equal(w.shown, true); assert.equal(w.offer, "offer-2"); assert.equal(w.delDisabled, false);
  await ctl(page, () => __ctl.releaseHistory()); await tick(page, 120);
  w = await warn(page);
  assert.equal(w.shown, true); assert.equal(w.title, "Warn 2"); assert.equal(w.delDisabled, false);
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), []);
});

test("C4 newer warning arrives while the TRASH is pending and the old trash FAILS: new warning untouched and actionable", async () => {
  const page = await open();
  await W(1)(page); await startDelete(page);
  await W(2)(page);
  await ctl(page, () => __ctl.settleDelete(0, { ok: false, code: "trash_failed", error: "x" }));
  await tick(page, 120);
  const w = await warn(page);
  assert.equal(w.shown, true); assert.equal(w.title, "Warn 2"); assert.equal(w.offer, "offer-2"); assert.equal(w.delDisabled, false);
  await page.evaluate(() => { __ctl.deleteManual = false; });
  await page.click("#fpDupDelete");
  await wait(page, () => __ctl.deleteCalls.length === 2);
  assert.deepEqual(await ctl(page, () => __ctl.deleteCalls[1]), ["/Users/test/Music/w2.mp3", "offer-2"]);
});

test("C5 Keep both pressed during the history refresh: the warning stays closed and only that offer is revoked", async () => {
  const page = await open();
  await W(1)(page); await startDelete(page);
  await page.evaluate(() => { __ctl.histHold = true; });
  const h0 = await ctl(page, () => __ctl.histCalls);
  await ctl(page, () => __ctl.settleDelete(0));
  await wait(page, (n) => __ctl.histCalls > n, h0);
  await page.click("#fpDupDismiss");
  await ctl(page, () => __ctl.releaseHistory()); await tick(page, 120);
  const w = await warn(page);
  assert.equal(w.shown, false); assert.equal(w.offer, null);
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), ["offer-1"]);
  assert.match(w.msg, /file was moved/i, "closed-then-trashed is reported");
});

// --- retained coverage: dismissal, retry, concurrent trash, dismissal while pending, queue event vs warning ---
test("R1 dismissal: Keep both closes the warning and revokes exactly its offer", async () => {
  const page = await open();
  await W(1)(page); await page.click("#fpDupDismiss");
  assert.equal((await warn(page)).shown, false);
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), ["offer-1"]);
});

test("R2 retry: a failed trash keeps the warning open and re-enabled; the retry uses the same offer and then closes it", async () => {
  const page = await open();
  await W(1)(page);
  await page.evaluate(() => { __ctl.deleteResult = { ok: false, code: "trash_failed", error: "x" }; });
  await page.click("#fpDupDelete");
  await wait(page, () => __ctl.deleteCalls.length === 1);
  await tick(page, 60);
  let w = await warn(page);
  assert.equal(w.shown, true); assert.equal(w.delDisabled, false); assert.match(w.msg, /not deleted/i);
  await page.evaluate(() => { __ctl.deleteResult = { ok: true }; });
  await page.click("#fpDupDelete");
  await wait(page, () => getComputedStyle(document.getElementById("fpDupWarning")).display === "none");
  assert.deepEqual(await ctl(page, () => __ctl.deleteCalls), [["/Users/test/Music/w1.mp3", "offer-1"], ["/Users/test/Music/w1.mp3", "offer-1"]]);
});

test("R3 concurrent trash: a second request while one is pending never reaches the API; the button is disabled meanwhile", async () => {
  const page = await open();
  await W(1)(page); await startDelete(page);
  assert.equal((await warn(page)).delDisabled, true);
  await page.evaluate(() => { $("fpDupDelete").onclick(); $("fpDupDelete").onclick(); });   // bypasses the disabled attribute
  await tick(page, 60);
  assert.equal(await ctl(page, () => __ctl.deleteCalls.length), 1);
  await ctl(page, () => __ctl.settleDelete(0));
  await wait(page, () => getComputedStyle(document.getElementById("fpDupWarning")).display === "none");
  assert.equal(await ctl(page, () => __ctl.deleteCalls.length), 1);
});

test("R4 dismissal while a trash is pending: closed at once, not cancelled, reported when it finishes; no second trash", async () => {
  const page = await open();
  await W(1)(page); await startDelete(page);
  await page.click("#fpDupDismiss");
  assert.equal((await warn(page)).shown, false);
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), ["offer-1"]);
  await ctl(page, () => __ctl.settleDelete(0)); await tick(page, 120);
  const w = await warn(page);
  assert.equal(w.shown, false); assert.match(w.msg, /file was moved/i);
  assert.equal(await ctl(page, () => __ctl.deleteCalls.length), 1);
});

test("R5 a queue-mode result neither replaces nor alters the single warning on screen", async () => {
  const page = await open();
  await press(page, "https://example.com/a");
  await wait(page, () => __ctl.downloads.length === 1);
  await ctl(page, () => __ctl.finishDownload(0));
  await wait(page, () => __ctl.queue[0].status === "done");
  await W(1)(page);
  const before = await warn(page);
  await ctl(page, () => __ctl.fingerprintResult(0));
  await wait(page, () => __ctl.queue[0].fpDup);
  const after = await warn(page);
  assert.deepEqual({ ...after, msg: "" }, { ...before, msg: "" });
  assert.equal(after.shown, true); assert.equal(after.offer, "offer-1");
  assert.deepEqual(await ctl(page, () => __ctl.dismissals), []);
});
