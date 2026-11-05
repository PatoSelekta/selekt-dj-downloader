"use strict";
// Setup status ("Iniciando…" / "Starting…" stuck bug). The REAL app/main.js, loaded by h3-harness.js with a temp
// userData, no sockets and a fake `https`. Run:  node --test app/test/setup-status.test.js
//
// Model of the bug: main.js sends "setup-status" from ensureBinaries() right after createWindow(), but the
// renderer only subscribes once its page has loaded (did-finish-load). Everything sent BEFORE that is lost.
// The harness records every send, so "what a renderer that subscribed at did-finish-load receives" is:
// the messages sent after fireWebContents("did-finish-load"). `lost` is how many were sent before it.
// NOT covered here: Electron's real IPC, a real page load, or the real renderer (see the browser check).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { makeHarness } = require("./h3-harness");

const WIN = process.platform === "win32";
const EXE = (n) => n + (WIN ? ".exe" : "");
const T = { timeout: 20000 };

// Fake https: every GET is answered by `onGet(call)`; counts requests so "no extra network" is checkable.
function fakeNet(onGet) {
  const net = { gets: 0, heads: 0 };
  net.https = {
    get(url, _opts, cb) {
      net.gets++;
      const req = new EventEmitter();
      req.destroy = () => {}; req.setTimeout = () => req;
      setImmediate(() => onGet && onGet({ respond: (status, headers = {}) => {
        const res = new PassThrough(); res.statusCode = status; res.headers = headers; res.complete = false;
        process.nextTick(() => cb(res)); return res; } }));
      return req;
    },
    request(_opts, cb) {
      net.heads++;
      const req = new EventEmitter();
      req.setTimeout = () => req; req.destroy = () => {};
      req.end = () => process.nextTick(() => cb({
        headers: { location: "https://github.com/yt-dlp/yt-dlp/releases/tag/2099.01.01" },
        resume() {},
      }));
      return req;
    },
  };
  return net;
}

const statuses = (h, from = 0) => h.sent.slice(from).filter(([ch]) => ch === "setup-status").map(([, m]) => m);
// Simulate the renderer finishing its load; returns what it then receives.
function rendererLoads(h) {
  const lost = h.sent.length;
  h.fireWebContents("did-finish-load");
  return statuses(h, lost);
}
const dropFfmpeg = ({ binDir }) => {
  for (const n of ["ffmpeg", "ffprobe"]) fs.rmSync(path.join(binDir, EXE(n)), { force: true });
};

test("success that happens BEFORE the renderer subscribes is delivered once it loads", T, () => {
  const h = makeHarness({ withWindow: true });                     // engine + ffmpeg already installed
  try {
    assert.deepEqual(statuses(h), ["Ready."], "main finished setup synchronously, before any page load");
    const seen = rendererLoads(h);
    assert.deepEqual(seen, ["Ready."], "the late renderer gets the current state");
    assert.deepEqual(rendererLoads(h), ["Ready."], "a renderer reload gets it again");
    assert.deepEqual(h.net, [], "replay makes no network request");
    assert.equal(h.spawns.length, 0, "replay starts no process");
  } finally { h.close(); }
});

test("normal success: nothing extra is sent or fetched at startup", T, () => {
  const net = fakeNet();
  const h = makeHarness({ withWindow: true, https: net.https });
  try {
    rendererLoads(h);
    assert.equal(net.gets, 0, "engine present -> no engine download");
    assert.equal(net.heads, 0, "checked < 24 h ago -> no GitHub version check");
    assert.deepEqual(h.net, []);
    assert.deepEqual(statuses(h), ["Ready.", "Ready."], "one original send + one replay, nothing else");
  } finally { h.close(); }
});

test("setup FAILURE before the renderer loads is delivered as the error, never as Ready", T, async () => {
  const net = fakeNet((c) => c.respond(404, {}).end());            // engine missing + GitHub says 404
  const h = makeHarness({
    withWindow: true, seedBinaries: false, https: net.https,
    beforeLoad: ({ binDir }) => { fs.mkdirSync(binDir, { recursive: true }); for (const n of ["ffmpeg", "ffprobe"]) fs.writeFileSync(path.join(binDir, EXE(n)), ""); },
  });
  try {
    const failed = await h.waitFor(() => statuses(h).some((m) => m.startsWith("Could not download yt-dlp")));
    assert.ok(failed, "setup reported the failure");
    const seen = rendererLoads(h);                                  // the page loaded AFTER the failure
    assert.equal(seen.length, 1);
    assert.equal(seen[0], "Could not download yt-dlp: HTTP 404");
    assert.ok(!statuses(h).includes("Ready."), "Ready. was never sent");
    assert.equal(net.gets, 2, "sums 404 then tagged binary 404; replay did not retry");
  } finally { h.close(); }
});

test("setup still IN PROGRESS when the renderer loads: it sees the progress text", T, async () => {
  const net = fakeNet(() => {});                                   // GitHub never answers
  const h = makeHarness({
    withWindow: true, seedBinaries: false, https: net.https,
    beforeLoad: ({ binDir }) => { fs.mkdirSync(binDir, { recursive: true }); for (const n of ["ffmpeg", "ffprobe"]) fs.writeFileSync(path.join(binDir, EXE(n)), ""); },
  });
  try {
    assert.deepEqual(rendererLoads(h), ["Setting up the download engine…"]);
    await h.waitFor(() => net.gets === 1);
    assert.equal(net.gets, 1, "single download, not duplicated by the replay");
  } finally { h.close(); }
});

test("an ffmpeg setup problem is not hidden by a later Ready.", T, async () => {
  const h = makeHarness({ withWindow: true, beforeLoad: dropFfmpeg });   // yt-dlp present, ffmpeg copy source missing
  try {
    const seen = rendererLoads(h);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^ffmpeg setup issue: /);
    assert.ok(!statuses(h).includes("Ready."), "Ready. was never claimed while ffmpeg is unavailable");
    // The problem goes away (source exists now): the next setup run reports Ready.
    h.write("ffmpeg-fake"); h.write("ffprobe-fake");
    assert.deepEqual(await h.invoke("ensure-setup"), { ok: true });
    assert.equal(statuses(h).at(-1), "Ready.");
    assert.deepEqual(rendererLoads(h), ["Ready."]);
  } finally { h.close(); }
});
