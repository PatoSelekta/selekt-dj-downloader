"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeHarness } = require("./h3-harness");
const T = { timeout: 20000 };

test("cookie-store error emits retry progress then succeeds without --cookies-from-browser", T, async () => {
  const h = makeHarness({ withWindow: true, config: { cookies_browser: "chrome" } });
  try {
    let n = 0;
    h.setScript((cmd, args) => {
      if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "v", title: "T", formats: [] }) };
      if (args.includes("-o")) {
        n++;
        if (n === 1) {
          assert.ok(args.includes("--cookies-from-browser"));
          return { code: 1, stderr: "ERROR: could not find chrome cookies database\n" };
        }
        assert.equal(args.includes("--cookies-from-browser"), false);
        const dir = path.dirname(args[args.indexOf("-o") + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "ok.mp4"); fs.writeFileSync(f, "x");
        return { code: 0, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    const r = await h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false });
    assert.equal(r.ok, true);
    assert.equal(n, 2);
    const phases = h.sent.filter((s) => s[0] === "download-progress").map((s) => s[1]);
    assert.ok(phases.some((p) => p && p.phase === "retry" && p.reason === "cookies_store"), JSON.stringify(phases));
    assert.ok(h.sent.some((s) => s[0] === "setup-status" && /without browser cookies/i.test(s[1])));
  } finally { h.close(); }
});

test("sign-in error after cookie retry returns errorCode cookies_needed", T, async () => {
  const h = makeHarness({ withWindow: true, config: { cookies_browser: "chrome" } });
  try {
    h.setScript((cmd, args) => {
      if (args.includes("-o")) {
        if (args.includes("--cookies-from-browser"))
          return { code: 1, stderr: "ERROR: could not find chrome cookies database\n" };
        return { code: 1, stderr: "ERROR: Sign in to confirm your age\n" };
      }
      return { code: 0 };
    });
    const r = await h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "cookies_needed");
    assert.equal(r.needsCookies, true);
    assert.equal(r.retryKind, "cookies_store");
  } finally { h.close(); }
});
