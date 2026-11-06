"use strict";
// Phase 1: yt-dlp install must pin a release tag, verify SHA2-256SUMS, and keep a .bak for rollback.
// Real app/main.js via h3-harness; fake https; synthetic body (no GitHub, no real yt-dlp).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { createHash } = require("crypto");
const { makeHarness } = require("./h3-harness");

const WIN = process.platform === "win32";
const EXE = "yt-dlp" + (WIN ? ".exe" : "");
const ASSET = WIN ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : (process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux");
const TAG = "2099.01.01";
const T = { timeout: 20000 };

const BODY = Buffer.alloc(1300000);
for (let i = 0; i < BODY.length; i++) BODY[i] = (i % 250) + 1;
const OLD = "OLD-BINARY-STAYS-INTACT";
const HEX = createHash("sha256").update(BODY).digest("hex");
const SUMS_OK = Buffer.from(HEX + "  " + ASSET + "\n");
const SUMS_BAD = Buffer.from("0".repeat(64) + "  " + ASSET + "\n");

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
        process.nextTick(() => cb(res));
        return res;
      };
      net.calls.push(call);
      if (net.handler) setImmediate(() => net.handler(call));
      return req;
    },
    request(_opts, cb) {
      net.requests++;
      const req = new EventEmitter();
      req.setTimeout = () => req; req.destroy = () => {};
      req.end = () => process.nextTick(() => cb({ headers: net.latest ? { location: "https://github.com/yt-dlp/yt-dlp/releases/tag/" + net.latest } : {}, resume() {} }));
      return req;
    },
  };
  return net;
}
function serve(call, body, headers = {}) {
  const res = call.respond(200, { "content-length": String(body.length), ...headers });
  for (let i = 0; i < body.length; i += 65536) res.write(body.subarray(i, i + 65536));
  res.complete = true; res.end();
}
function ytdlp(h) { return path.join(h.binDir, EXE); }
function firstInstall(net) {
  net.latest = net.latest || TAG;
  const h = makeHarness({ https: net.https });
  fs.rmSync(ytdlp(h), { force: true });
  fs.rmSync(path.join(h.binDir, ".ytdlp_variant"), { force: true });
  return h;
}
function route(sumsBuf, binBuf) {
  return (c) => {
    if (String(c.url).includes("SHA2-256SUMS")) serve(c, sumsBuf);
    else serve(c, binBuf);
  };
}

test("matching SHA-256 installs the body and writes .ytdlp_variant from the tagged release", T, async () => {
  const net = makeNet();
  net.handler = route(SUMS_OK, BODY);
  const h = firstInstall(net);
  try {
    assert.deepEqual(await h.invoke("ensure-setup"), { ok: true });
    assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY));
    assert.equal(fs.readFileSync(path.join(h.binDir, ".ytdlp_variant"), "utf8"), "standalone-1");
    assert.ok(net.calls.some((c) => c.url === `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/SHA2-256SUMS`));
    assert.ok(net.calls.some((c) => c.url === `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/${ASSET}`));
    assert.equal(net.calls.some((c) => c.url.includes("/latest/download/")), false);
  } finally { h.close(); }
});

test("wrong SHA-256 does not install; a previous good binary is left in place (no .bak clobber)", T, async () => {
  {
    const net = makeNet();
    net.handler = route(SUMS_BAD, BODY);
    const h = firstInstall(net);
    try {
      const r = await h.invoke("ensure-setup");
      assert.equal(r.ok, false);
      assert.match(r.error, /Checksum mismatch/);
      assert.equal(fs.existsSync(ytdlp(h)), false);
      assert.equal(fs.existsSync(ytdlp(h) + ".bak"), false);
    } finally { h.close(); }
  }
  {
    const net = makeNet();
    net.latest = TAG;
    net.handler = route(SUMS_BAD, BODY);
    const h = makeHarness({
      https: net.https,
      beforeLoad: ({ binDir }) => {
        fs.writeFileSync(path.join(binDir, EXE), OLD);
        fs.writeFileSync(path.join(binDir, EXE + ".bak"), "PREV-BAK");
        fs.writeFileSync(path.join(binDir, ".ytdlp_variant"), "standalone-1");
        fs.writeFileSync(path.join(binDir, ".ytdlp_checked"), String(Date.now()));
      },
    });
    try {
      fs.rmSync(ytdlp(h), { force: true });
      fs.rmSync(path.join(h.binDir, ".ytdlp_variant"), { force: true });
      fs.writeFileSync(ytdlp(h), OLD);
      const r = await h.invoke("ensure-setup");
      assert.equal(r.ok, false);
      assert.match(r.error, /Checksum mismatch/);
      assert.equal(fs.readFileSync(ytdlp(h), "utf8"), OLD);
      assert.equal(fs.readFileSync(ytdlp(h) + ".bak", "utf8"), "PREV-BAK");
    } finally { h.close(); }
  }
});

test("a good update keeps the previous bytes in yt-dlp.bak", T, async () => {
  const net = makeNet();
  net.latest = TAG;
  net.handler = route(SUMS_OK, BODY);
  const h = makeHarness({
    https: net.https,
    beforeLoad: ({ binDir }) => {
      fs.writeFileSync(path.join(binDir, EXE), OLD);
      fs.writeFileSync(path.join(binDir, ".ytdlp_checked"), String(Date.now()));
    },
  });
  try {
    fs.rmSync(path.join(h.binDir, ".ytdlp_variant"), { force: true });
    assert.deepEqual(await h.invoke("ensure-setup"), { ok: true });
    assert.ok(fs.readFileSync(ytdlp(h)).equals(BODY));
    assert.equal(fs.readFileSync(ytdlp(h) + ".bak", "utf8"), OLD);
  } finally { h.close(); }
});

test("unknown release tag fails before any unverified /latest/download fetch", T, async () => {
  const net = makeNet();
  net.latest = null;
  net.handler = (c) => serve(c, BODY);
  const h = firstInstall(net);
  net.latest = null;
  try {
    fs.rmSync(ytdlp(h), { force: true });
    fs.rmSync(path.join(h.binDir, ".ytdlp_variant"), { force: true });
    const r = await h.invoke("ensure-setup");
    assert.equal(r.ok, false);
    assert.match(r.error, /Could not determine yt-dlp release/);
    assert.equal(net.calls.length, 0);
    assert.equal(fs.existsSync(ytdlp(h)), false);
  } finally { h.close(); }
});

test("ytdlpAssetName source guard: linux aarch64 asset is present in main.js", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(src, /yt-dlp_linux_aarch64/);
  assert.match(src, /process\.arch === ["']arm64["']/);
});
