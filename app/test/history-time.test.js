"use strict";
// History timestamps: stored UTC ISO strings are DISPLAYED in the computer's local time zone.
// Run:  node --test app/test/history-time.test.js
// The real renderer/history-time.js (the file index.html loads) runs in a child `node` per time zone,
// because a process reads TZ once at start. NOT covered: Electron's own tz handling or the History tab's DOM
// (see the live-window check in the review notes).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOD = path.join(__dirname, "..", "renderer", "history-time.js");
const T = { timeout: 20000 };

function fmtIn(tz, values) {
  const code = `const { formatHistoryTime } = require(${JSON.stringify(MOD)});
    const vals = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(vals.map(v => formatHistoryTime(v === "__undef__" ? undefined : v))));`;
  const r = spawnSync(process.execPath, ["-e", code, JSON.stringify(values)], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("the same stored UTC timestamp shows as each computer's local time", T, () => {
  const stored = "2026-11-04T01:00:41.497Z";          // the real entry written by the review download
  const expected = {
    "UTC": "2026-11-04 01:00",
    "America/Bogota": "2026-11-03 20:00",             // -05:00, no DST: the review Mac
    "Asia/Kolkata": "2026-11-04 06:30",               // +05:30 (half-hour offset)
    "Pacific/Auckland": "2026-11-04 14:00",           // +13:00 (NZ summer time), next calendar day
    "America/Los_Angeles": "2026-11-03 17:00",        // -08:00 after the US DST change
  };
  for (const [tz, want] of Object.entries(expected)) assert.deepEqual(fmtIn(tz, [stored]), [want], tz);
});

test("daylight saving time is honoured for the date in question", T, () => {
  assert.deepEqual(fmtIn("America/New_York", ["2026-07-01T12:00:00Z", "2026-12-01T12:00:00Z"]), ["2026-07-01 08:00", "2026-12-01 07:00"]);
});

test("missing, non-string and malformed dates show nothing (never NaN or a wrong time)", T, () => {
  const bad = ["__undef__", null, "", "   ", 0, 1793754041497, {}, [], "garbage", "yesterday", "2026-13-45T99:99:99Z", "2026-02-30T10:00:00Z", "NaN", "T01:00", "2026-11-04"];
  assert.deepEqual(fmtIn("America/Bogota", bad), bad.map(() => ""));
});

test("seconds and milliseconds are not shown", T, () => {
  const [a, b] = fmtIn("America/Bogota", ["2026-11-04T01:00:59.999Z", "2026-11-04T01:00:41Z"]);
  assert.equal(a, "2026-11-03 20:00"); assert.equal(b, "2026-11-03 20:00");
});

test("stored history format is unchanged and the History tab uses the converter", T, () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /time: new Date\(\)\.toISOString\(\)/, "history is still written as UTC ISO");
  const r = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  assert.match(r, /SelektTime\.formatHistoryTime\(r\.time\)/);
  assert.ok(!/\(r\.time \|\| ""\)\.replace\("T"/.test(r), "the raw-UTC slice is gone");
  const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
  assert.ok(html.indexOf("history-time.js") > 0 && html.indexOf("history-time.js") < html.indexOf('src="renderer.js"'), "loaded before renderer.js");
});
