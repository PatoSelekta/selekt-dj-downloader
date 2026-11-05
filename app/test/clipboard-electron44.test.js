"use strict";
// Electron 44 makes clipboard.readText()/writeText() return Promises. These checks load the real
// app/main.js with a FAKE clipboard (an in-memory string; the real OS clipboard is never touched)
// and call the "clipboard-read" / "clipboard-write" IPC handlers directly.
const test = require("node:test");
const assert = require("node:assert/strict");
const { withHarness } = require("./h3-harness");

const SENTINEL = "selekt-test-sentinel-not-a-real-clipboard";
const quiet = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };

function noUnhandled() {
  const seen = [];
  const on = (r) => seen.push(r);
  process.on("unhandledRejection", on);
  return { seen, stop: () => process.off("unhandledRejection", on) };
}

test("write: async success resolves true only after the clipboard promise settles", async () => {
  let release, wrote = null;
  const clipboard = { writeText: (t) => new Promise((res) => { release = () => { wrote = t; res(); }; }) };
  await withHarness({ clipboard }, async (h) => {
    let settled = false;
    const p = h.invoke("clipboard-write", SENTINEL).then((v) => { settled = true; return v; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false, "handler must wait for the Promise returned by writeText");
    release();
    assert.equal(await p, true);
    assert.equal(wrote, SENTINEL);
  });
});

test("write: a rejected Promise returns false and leaves no unhandled rejection", async () => {
  const clipboard = { writeText: () => Promise.reject(new Error("clipboard unavailable")) };
  const guard = noUnhandled(), restore = quiet();
  try {
    await withHarness({ clipboard }, async (h) => {
      assert.equal(await h.invoke("clipboard-write", SENTINEL), false);
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(guard.seen, []);
  } finally { restore(); guard.stop(); }
});

test("write: a synchronous throw also returns false", async () => {
  const clipboard = { writeText: () => { throw new Error("boom"); } };
  const restore = quiet();
  try { await withHarness({ clipboard }, async (h) => assert.equal(await h.invoke("clipboard-write", SENTINEL), false)); }
  finally { restore(); }
});

test("write: a synchronous (pre-44 style) fake still works", async () => {
  let wrote = null;
  const clipboard = { writeText: (t) => { wrote = t; } };
  await withHarness({ clipboard }, async (h) => { assert.equal(await h.invoke("clipboard-write", SENTINEL), true); });
  assert.equal(wrote, SENTINEL);
});

test("read: async success returns the string", async () => {
  const clipboard = { readText: async () => SENTINEL };
  await withHarness({ clipboard }, async (h) => { assert.equal(await h.invoke("clipboard-read"), SENTINEL); });
});

test("read: a rejected Promise returns an empty string (UI shows 'paste empty')", async () => {
  const clipboard = { readText: () => Promise.reject(new Error("denied")) };
  const guard = noUnhandled(), restore = quiet();
  try {
    await withHarness({ clipboard }, async (h) => { assert.equal(await h.invoke("clipboard-read"), ""); });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(guard.seen, []);
  } finally { restore(); guard.stop(); }
});

test("read: a synchronous throw returns an empty string", async () => {
  const clipboard = { readText: () => { throw new Error("boom"); } };
  const restore = quiet();
  try { await withHarness({ clipboard }, async (h) => assert.equal(await h.invoke("clipboard-read"), "")); }
  finally { restore(); }
});

test("logs never include the clipboard text", async () => {
  const lines = [];
  const o = console.error; console.error = (...a) => lines.push(a.join(" "));
  try {
    const clipboard = { writeText: () => Promise.reject(new Error("clipboard unavailable")) };
    await withHarness({ clipboard }, async (h) => { await h.invoke("clipboard-write", SENTINEL); });
  } finally { console.error = o; }
  assert.ok(lines.length >= 1);
  assert.ok(lines.every((l) => !l.includes(SENTINEL)));
});
