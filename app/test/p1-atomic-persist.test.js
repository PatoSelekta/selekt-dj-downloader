"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeHarness } = require("./h3-harness");
const T = { timeout: 20000 };

test("queue-set replaces queue.json via rename; a failed rename leaves the previous array", T, async () => {
  const h = makeHarness();
  try {
    const prev = [{ id: "old", url: "https://example.com/a", status: "pending" }];
    await h.invoke("queue-set", prev);
    const qpath = h.p("queue.json");
    const before = fs.readFileSync(qpath, "utf8");
    const real = fs.renameSync;
    fs.renameSync = function (src, dest) {
      if (dest === qpath) {
        const e = new Error("simulated rename fail");
        e.code = "EIO";
        throw e;
      }
      return real.call(fs, src, dest);
    };
    try {
      // Harness invoke is synchronous (real IPC would reject). Either way the write must not land.
      assert.throws(
        () => h.invoke("queue-set", [{ id: "new", url: "https://example.com/b", status: "pending" }]),
        (e) => e && e.code === "EIO"
      );
    } finally { fs.renameSync = real; }
    assert.equal(fs.readFileSync(qpath, "utf8"), before);
    assert.deepEqual(JSON.parse(before), prev);
    const leftovers = fs.readdirSync(h.userData).filter((n) => n.startsWith("queue.json.") && n.endsWith(".tmp"));
    for (const n of leftovers) fs.unlinkSync(path.join(h.userData, n));
  } finally { h.close(); }
});

test("a non-array queue.json loads as empty and is not treated as items", T, async () => {
  const h = makeHarness();
  try {
    h.write("queue.json", JSON.stringify({ schemaVersion: 1, items: [{ id: "x" }] }));
    assert.deepEqual(await h.invoke("queue-get"), []);
  } finally { h.close(); }
});

test("config.json is written atomically (failed rename keeps previous bytes)", T, async () => {
  const h = makeHarness();
  try {
    await h.invoke("set-lang", "en");
    const cpath = h.p("config.json");
    const before = fs.readFileSync(cpath, "utf8");
    const real = fs.renameSync;
    fs.renameSync = function (src, dest) {
      if (dest === cpath) {
        const e = new Error("simulated rename fail");
        e.code = "EIO";
        throw e;
      }
      return real.call(fs, src, dest);
    };
    try {
      assert.throws(() => h.invoke("set-lang", "es"), (e) => e && e.code === "EIO");
    } finally { fs.renameSync = real; }
    assert.equal(fs.readFileSync(cpath, "utf8"), before);
  } finally { h.close(); }
});
