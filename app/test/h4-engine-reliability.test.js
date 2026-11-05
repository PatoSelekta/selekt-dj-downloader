"use strict";
// H4 (desktop yt-dlp engine): the install/update transfer in app/main.js must always settle, never
// race with itself, clean up its temp files, and never replace a working binary with a bad one.
// Run from the repo root with:  node --test app/test/h4-engine-reliability.test.js
//
// What this is: the REAL app/main.js, loaded by h3-harness.js, with a FAKE `https` module injected
// (no sockets, no network, no real yt-dlp bytes: bodies are synthetic buffers) and a temp userData.
// What this is NOT: Electron, a real GitHub/CDN response, real TLS/proxy/disk-full behavior, or
// Electron's own Node (the checks run on whatever `node` runs them; main.js ships on Electron's Node).
// A real drop is simulated three ways (res.destroy(), an 'aborted' event, res.destroy(err)).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { mock } = require("node:test");
const { makeHarness } = require("./h3-harness");

const WIN = process.platform === "win32";
const EXE = "yt-dlp" + (WIN ? ".exe" : "");
const ASSET = WIN ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
const URL_LATEST = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + ASSET;
const T = { timeout: 20000 };

// Synthetic "binary": 1.3 MB (above the 1 MiB plausibility floor), no zero bytes, so a zero-filled
// hole in an installed file is detectable.
const BODY = Buffer.alloc(1300000);
for (let i = 0; i < BODY.length; i++) BODY[i] = (i % 250) + 1;
const OLD = "OLD-BINARY-STAYS-INTACT";

function makeNet() {
  const net = { calls: [], handler: null, latest: null, requests: 0 };
  net.https = {
    get(url, _opts, cb) {
      const req = new EventEmitter();
      req.destroyed = false; req.stallMs = null; req.fireTimeout = () => {};
      req.destroy = () => { req.destroyed = true; };
      req.setTimeout = (ms, fn) => { req.stallMs = ms; req.fireTimeout = fn; return req; };
      const call = { url: String(url), req, res: null };
      call.respond = (status, headers = {}) => {
        const res = new PassThrough();
        res.statusCode = status; res.headers = headers; res.complete = false;
        call.res = res;
        process.nextTick(() => cb(res));          // real https is always async
        return res;
      };
      net.calls.push(call);
      if (net.handler) setImmediate(() => net.handler(call));
      return req;
    },
    request(_opts, cb) {                            // latestYtdlpTag(): HEAD /releases/latest
      net.requests++;
      const req = new EventEmitter();
      req.setTimeout = () => req; req.destroy = () => {};
      req.end = () => process.nextTick(() => cb({ headers: net.latest ? { location: "https://github.com/yt-dlp/yt-dlp/releases/tag/" + net.latest } : {}, resume() {} }));
      return req;
    },
  };
  return net;
}
// A complete, correct 200 response.
function serve(call, body = BODY, headers = {}) {
  const res = call.respond(200, { "content-length": String(body.length), ...headers });
  for (let i = 0; i < body.length; i += 65536) res.write(body.subarray(i, i + 65536));
  res.complete = true; res.end();
}
// A response that sends the first `n` bytes and then waits: finish() sends the rest, drop(mode) kills it.
function partial(call, n = 400000, body = BODY) {
  const res = call.respond(200, { "content-length": String(body.length) });
  res.write(body.subarray(0, n));
  call.finish = () => { res.write(body.subarray(n)); res.complete = true; res.end(); };
  call.drop = (mode) => {
    if (mode === "aborted") res.emit("aborted");
    else if (mode === "error") res.destroy(new Error("read ECONNRESET"));
    else res.destroy();
  };
}
const parts = (h) => fs.readdirSync(h.binDir).filter((n) => n.endsWith(".part"));
const ytdlp = (h) => path.join(h.binDir, EXE);
const guard = (p, ms = 5000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("did not settle within " + ms + " ms")), ms))]);
const until = async (fn, n = 2000) => { for (let i = 0; i < n; i++) { if (fn()) return true; await new Promise((r) => setImmediate(r)); } return !!fn(); };
// A harness where yt-dlp is missing (first install). Seed first, then remove it.
function firstInstall(net, extra = {}) {
  const h = makeHarness({ https: net.https, ...extra });
  fs.rmSync(ytdlp(h), { force: true });
  fs.rmSync(path.join(h.binDir, ".ytdlp_variant"), { force: true });
  return h;
}
// A harness with a working "old" binary, a current variant marker, and a stale daily-check stamp.
function withOldBinary(net, extra = {}) {
  return makeHarness({
    https: net.https, ...extra,
    beforeLoad: ({ binDir }) => {                      // before main.js loads: its launch-time refresh reads these
      fs.writeFileSync(path.join(binDir, EXE), OLD);
      fs.writeFileSync(path.join(binDir, ".ytdlp_checked"), String(Date.now() - 3 * 24 * 3600 * 1000));
    },
  });
}

// ---------------------------------------------------------------------------------------------
test("first install: complete body is installed executable, marker written, no temp left, error-free", T, async () => {
  const net = makeNet(); net.handler = (c) => serve(c);
  const h = firstInstall(net);
  try {
    const r = await guard(h.invoke("ensure-setup"));
    assert.deepEqual(r, { ok: true });
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].url, URL_LATEST);
    assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY), "installed bytes are exactly the body");
    if (!WIN) assert.equal(fs.statSync(ytdlp(h)).mode & 0o777, 0o755);
    assert.equal(fs.readFileSync(path.join(h.binDir, ".ytdlp_variant"), "utf8"), "standalone-1");
    assert.deepEqual(parts(h), []);
  } finally { h.close(); }
});

test("redirects: absolute and relative https redirects are followed; non-https and loops are refused", T, async () => {
  {
    const net = makeNet();
    net.handler = (c) => {
      const n = net.calls.indexOf(c);
      if (n === 0) c.respond(302, { location: "/yt-dlp/yt-dlp/releases/download/9/x" }).end();
      else if (n === 1) c.respond(302, { location: "https://objects.example.invalid/blob?sig=1" }).end();
      else serve(c);
    };
    const h = firstInstall(net);
    try {
      assert.deepEqual(await guard(h.invoke("ensure-setup")), { ok: true });
      assert.deepEqual(net.calls.map((c) => c.url), [URL_LATEST, "https://github.com/yt-dlp/yt-dlp/releases/download/9/x", "https://objects.example.invalid/blob?sig=1"]);
      assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY));
    } finally { h.close(); }
  }
  {
    const net = makeNet(); net.handler = (c) => c.respond(302, { location: "http://plain.example.invalid/x" }).end();
    const h = firstInstall(net);
    try {
      const r = await guard(h.invoke("ensure-setup"));
      assert.deepEqual(r, { ok: false, error: "Refusing non-https download" });
      assert.equal(net.calls.length, 1, "the http:// target is never requested");
      assert.equal(fs.existsSync(ytdlp(h)), false); assert.deepEqual(parts(h), []);
    } finally { h.close(); }
  }
  {
    const net = makeNet(); net.handler = (c) => c.respond(302, { location: "https://github.com/loop" }).end();
    const h = firstInstall(net);
    try {
      const r = await guard(h.invoke("ensure-setup"));
      assert.deepEqual(r, { ok: false, error: "Too many redirects" });
      assert.equal(net.calls.length, 7);
    } finally { h.close(); }
  }
});

test("bad responses are rejected and nothing is installed: HTTP error, short body, too-small body, 200 error page", T, async () => {
  const cases = [
    ["HTTP 404", (c) => c.respond(404, {}).end(), /^HTTP 404$/],
    ["short body vs Content-Length", (c) => { const res = c.respond(200, { "content-length": String(BODY.length) }); res.write(BODY.subarray(0, 500000)); res.complete = true; res.end(); }, /Incomplete download \(500000 of 1300000 bytes\)/],
    ["HTML error page, 200", (c) => serve(c, Buffer.from("<html>rate limited</html>")), /Download too small/],
    ["no Content-Length, tiny body", (c) => { const res = c.respond(200, {}); res.write("x"); res.complete = true; res.end(); }, /Download too small/],
  ];
  for (const [name, handler, rx] of cases) {
    const net = makeNet(); net.handler = handler;
    const h = firstInstall(net);
    try {
      const r = await guard(h.invoke("ensure-setup"));
      assert.equal(r.ok, false, name); assert.match(r.error, rx, name);
      assert.equal(fs.existsSync(ytdlp(h)), false, name + ": nothing installed");
      assert.deepEqual(parts(h), [], name + ": temp removed");
      assert.equal(fs.existsSync(path.join(h.binDir, ".ytdlp_variant")), false, name + ": no marker");
    } finally { h.close(); }
  }
});

test("connection dropped mid-body: the install settles with an error, the temp is removed, and a retry works", T, async () => {
  for (const mode of ["destroy", "aborted", "error"]) {
    const net = makeNet(); net.handler = (c) => (net.calls.length === 1 ? partial(c) : serve(c));
    const h = firstInstall(net);
    try {
      const p = h.invoke("ensure-setup");
      assert.ok(await h.waitFor(() => parts(h).length === 1 && fs.statSync(path.join(h.binDir, parts(h)[0])).size > 0), mode + ": partial data on disk");
      assert.equal(fs.existsSync(ytdlp(h)), false, mode + ": destination untouched while in flight");
      net.calls[0].drop(mode);
      const r = await guard(p);
      assert.equal(r.ok, false, mode); assert.match(r.error, /Connection lost|ECONNRESET/, mode);
      assert.deepEqual(parts(h), [], mode + ": temp removed");
      assert.equal(fs.existsSync(ytdlp(h)), false, mode);
      // the failed attempt must not leave the engine wedged: the next call starts a fresh transfer
      assert.deepEqual(await guard(h.invoke("ensure-setup")), { ok: true }, mode + ": retry");
      assert.equal(net.calls.length, 2, mode);
      assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY), mode);
    } finally { h.close(); }
  }
});

test("stalled socket: the idle timeout fails the attempt, destroys the request, removes the temp", T, async () => {
  const net = makeNet(); net.handler = (c) => partial(c);
  const h = firstInstall(net);
  try {
    const p = h.invoke("ensure-setup");
    assert.ok(await h.waitFor(() => parts(h).length === 1));
    assert.equal(net.calls[0].req.stallMs, 30000, "30 s socket idle limit is armed");
    net.calls[0].req.fireTimeout();
    const r = await guard(p);
    assert.deepEqual(r, { ok: false, error: "Download stalled" });
    assert.equal(net.calls[0].req.destroyed, true);
    assert.deepEqual(parts(h), []); assert.equal(fs.existsSync(ytdlp(h)), false);
  } finally { h.close(); }
});

test("a stale socket-timeout from an earlier redirect hop cannot fail the current transfer", T, async () => {
  const net = makeNet();
  net.handler = (c) => { if (net.calls.indexOf(c) === 0) c.respond(302, { location: "https://objects.example.invalid/b" }).end(); else partial(c); };
  const h = firstInstall(net);
  try {
    const p = h.invoke("ensure-setup");
    assert.ok(await h.waitFor(() => net.calls.length === 2 && parts(h).length === 1));
    net.calls[0].req.fireTimeout();                       // the first hop's socket idles out AFTER the redirect
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(net.calls[1].req.destroyed, false, "current request untouched");
    net.calls[1].finish();
    assert.deepEqual(await guard(p), { ok: true });
    assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY));
  } finally { h.close(); }
});

test("overall deadline: a transfer that never answers is abandoned after 10 minutes", T, async () => {
  const net = makeNet(); net.handler = () => {};           // never responds
  const h = firstInstall(net);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const p = h.invoke("ensure-setup");
    assert.ok(await until(() => net.calls.length === 1));
    mock.timers.tick(10 * 60 * 1000 - 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(net.calls[0].req.destroyed, false, "not yet");
    mock.timers.tick(1);
    const r = await p;
    assert.deepEqual(r, { ok: false, error: "Download timed out" });
    assert.equal(net.calls[0].req.destroyed, true);
    assert.deepEqual(parts(h), []);
  } finally { mock.timers.reset(); h.close(); }
});

test("concurrent setup requests (+ launch) share ONE transfer; the binary is never partly written in place", T, async () => {
  const net = makeNet(); net.handler = (c) => partial(c, 300000);
  // withWindow: the app's own launch-time ensureBinaries() starts the download synchronously.
  const h = makeHarness({ https: net.https, withWindow: true, seedBinaries: false });
  try {
    const a = h.invoke("ensure-setup");
    const b = h.invoke("fetch-playlist", "https://example.com/playlist?list=PL1");
    assert.ok(await h.waitFor(() => parts(h).length === 1 && fs.statSync(path.join(h.binDir, parts(h)[0])).size > 0));
    const late = h.invoke("ensure-setup");                // a third caller arrives mid-transfer
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(net.calls.length, 1, "one HTTP request for launch + 3 callers");
    assert.equal(parts(h).length, 1, "one temp file");
    assert.equal(fs.existsSync(ytdlp(h)), false, "nothing is installed until the transfer is complete");
    net.calls[0].finish();
    const [ra, rb, rl] = await guard(Promise.all([a, b, late]));
    assert.deepEqual(ra, { ok: true }); assert.deepEqual(rl, { ok: true }); assert.equal(rb.ok, true);
    const got = fs.readFileSync(ytdlp(h));
    assert.ok(got.equals(BODY), "complete, no zero-filled holes");
    assert.equal(got.includes(0), false);
    assert.deepEqual(parts(h), []);
    assert.equal(net.calls.length, 1);
  } finally { h.close(); }
});

test("concurrent callers all see the same failure, and the next request starts clean", T, async () => {
  const net = makeNet(); net.handler = (c) => (net.calls.length === 1 ? partial(c) : serve(c));
  const h = firstInstall(net);
  try {
    const a = h.invoke("ensure-setup"), b = h.invoke("ensure-setup");
    assert.ok(await h.waitFor(() => parts(h).length === 1));
    net.calls[0].drop("destroy");
    const [ra, rb] = await guard(Promise.all([a, b]));
    assert.equal(ra.ok, false); assert.deepEqual(ra, rb);
    assert.equal(net.calls.length, 1);
    assert.deepEqual(await guard(h.invoke("ensure-setup")), { ok: true });
  } finally { h.close(); }
});

test("a failed refresh keeps the previous binary byte-for-byte (drop, bad size, HTTP error); a good one replaces it atomically", T, async () => {
  const bad = [
    ["drop", (c) => { partial(c); setTimeout(() => c.drop("destroy"), 20); }],
    ["too small", (c) => serve(c, Buffer.from("<html>nope</html>"))],
    ["HTTP 500", (c) => c.respond(500, {}).end()],
  ];
  for (const [name, handler] of bad) {
    const net = makeNet(); net.latest = "2099.01.01"; net.handler = handler;
    const h = withOldBinary(net, { withWindow: true });        // launch -> daily refresh path (not awaited by main)
    h.setScript((cmd, args) => (args.includes("--version") ? { code: 0, stdout: "2020.01.01\n" } : { code: 0 }));
    try {
      assert.ok(await h.waitFor(() => h.sent.some((s) => s[1] === "Updating the download engine…"), 3000), name + ": refresh started");
      assert.ok(await h.waitFor(() => net.calls.length === 1 && h.sent.filter((s) => s[1] === "Ready.").length >= 2, 3000), name + ": refresh settled");
      assert.equal(fs.readFileSync(ytdlp(h), "utf8"), OLD, name + ": old binary untouched");
      assert.deepEqual(parts(h), [], name + ": temp removed");
    } finally { h.close(); }
  }
  const net = makeNet(); net.latest = "2099.01.01"; net.handler = (c) => serve(c);
  const h = withOldBinary(net, { withWindow: true });
  h.setScript((cmd, args) => (args.includes("--version") ? { code: 0, stdout: "2020.01.01\n" } : { code: 0 }));
  try {
    assert.ok(await h.waitFor(() => { try { return fs.readFileSync(ytdlp(h)).equals(BODY); } catch (_) { return false; } }, 3000), "replaced");
    if (!WIN) assert.equal(fs.statSync(ytdlp(h)).mode & 0o777, 0o755);
    assert.deepEqual(parts(h), []);
  } finally { h.close(); }
});

test("stale-engine retry: forced update joins an in-flight refresh (one transfer) and the download is retried", T, async () => {
  const net = makeNet(); net.latest = "2099.01.01"; net.handler = (c) => partial(c, 300000);
  const h = withOldBinary(net, { withWindow: true });
  h.mkdir("Music");
  let downloads = 0;
  h.setScript((cmd, args) => {
    if (args.includes("--version")) return { code: 0, stdout: "2020.01.01\n" };
    if (args.includes("-o")) {
      downloads++;
      if (downloads === 1) return { code: 1, stderr: "ERROR: HTTP Error 403: Forbidden\n" };
      const o = args.indexOf("-o"); const dir = path.dirname(args[o + 1]); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "ok.mp4"); fs.writeFileSync(f, "x"); return { code: 0, stdout: f + "\n" };
    }
    return { code: 0 };
  });
  try {
    assert.ok(await h.waitFor(() => net.calls.length === 1 && parts(h).length === 1), "launch refresh is mid-transfer");
    const p = h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false });
    assert.ok(await h.waitFor(() => downloads === 1), "first attempt failed with a stale-engine error");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(net.calls.length, 1, "forced update did not start a second transfer");
    net.calls[0].finish();
    const r = await guard(p);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(downloads, 2, "download retried once with the new engine");
    assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY));
    assert.deepEqual(parts(h), []);
  } finally { h.close(); }
});

test("stale-engine retry whose update FAILS: the user still gets the original yt-dlp error, old binary intact", T, async () => {
  const net = makeNet(); net.latest = "2099.01.01";
  net.handler = (c) => c.respond(503, {}).end();
  const h = makeHarness({ https: net.https });             // fresh .ytdlp_checked: no launch refresh
  fs.writeFileSync(ytdlp(h), OLD);
  h.mkdir("Music");
  h.setScript((cmd, args) => (args.includes("--version") ? { code: 0, stdout: "2020.01.01\n" } : args.includes("-o") ? { code: 1, stderr: "ERROR: HTTP Error 403: Forbidden\n" } : { code: 0 }));
  try {
    const r = await guard(h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false }));
    assert.equal(r.ok, false); assert.match(r.error, /HTTP Error 403/);
    assert.equal(fs.readFileSync(ytdlp(h), "utf8"), OLD);
    assert.deepEqual(parts(h), []);
    assert.equal(net.calls.length, 1);
  } finally { h.close(); }
});

test("first-install failure keeps its user-facing behavior: setup-status text, ensure-setup error, download rejects", T, async () => {
  const net = makeNet(); net.handler = (c) => c.respond(404, {}).end();
  const h = makeHarness({ https: net.https, withWindow: true, seedBinaries: false });
  try {
    assert.deepEqual(await guard(h.invoke("ensure-setup")), { ok: false, error: "HTTP 404" });
    const msgs = h.sent.filter((s) => s[0] === "setup-status").map((s) => s[1]);
    assert.ok(msgs.includes("Setting up the download engine…"));
    assert.ok(msgs.includes("Could not download yt-dlp: HTTP 404"));
    assert.equal(msgs.includes("Ready."), false, "never claims Ready after a failed first install");
    h.mkdir("Music");
    await assert.rejects(guard(h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false })), /HTTP 404/);
  } finally { h.close(); }
});

test("leftover temp files: stale ones (> 1 h, incl. the legacy name) are swept, a recent one is left alone", T, async () => {
  const net = makeNet(); net.handler = (c) => serve(c);
  const h = firstInstall(net);
  try {
    const old = [EXE + ".deadbeef.part", EXE + ".part"].map((n) => path.join(h.binDir, n));
    const fresh = path.join(h.binDir, EXE + ".cafe.part");
    const other = path.join(h.binDir, "ffmpeg.leftover.part");
    for (const f of [...old, fresh, other]) fs.writeFileSync(f, "x");
    const twoHours = new Date(Date.now() - 2 * 3600 * 1000);
    for (const f of [...old, other]) fs.utimesSync(f, twoHours, twoHours);
    assert.deepEqual(await guard(h.invoke("ensure-setup")), { ok: true });
    for (const f of old) assert.equal(fs.existsSync(f), false, path.basename(f));
    assert.equal(fs.existsSync(fresh), true, "a possibly-live temp from another instance is kept");
    assert.equal(fs.existsSync(other), true, "only yt-dlp temp files are ever touched");
  } finally { h.close(); }
});

test("source guard: the install path has no fixed shared temp name and no unsettled branch", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const a = src.indexOf("function downloadTo("), b = src.indexOf("async function ensureBinaries()");
  const block = src.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.equal(/dest \+ "\.part"/.test(block), false, "no fixed `dest + .part` temp name");
  assert.match(block, /randomUUID\(\)/);
  assert.match(block, /ytdlpInstall/);
  assert.equal((src.match(/downloadTo\(/g) || []).length, 2, "downloadTo has exactly one definition and one caller (downloadYtdlp)");
});
