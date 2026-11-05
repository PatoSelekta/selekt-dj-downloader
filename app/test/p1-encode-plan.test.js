"use strict";
// Phase 1: copy when the source already matches; convert when Normalize is on, codec differs, or bitrate is higher.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeHarness } = require("./h3-harness");

const T = { timeout: 20000 };
const dl = (h, o) => h.invoke("download", {
  url: "https://example.com/v", type: "audio", audioFormat: "mp3", bitrate: "320",
  autoTag: false, loudnorm: false, ...o,
});

function script(formats, names = ["ok.mp3"]) {
  return (cmd, args) => {
    if (cmd.endsWith("ffmpeg")) {
      if (args.includes("null")) return { code: 0, stderr: '{"input_i":"-20","input_tp":"-3","input_lra":"5","input_thresh":"-30","target_offset":"0"}' };
      return { code: 0 };
    }
    if (args.includes("-J")) {
      return { code: 0, stdout: JSON.stringify({ id: "v", title: "T", formats }) };
    }
    const o = args.indexOf("-o");
    if (o >= 0) {
      const dir = path.dirname(args[o + 1]);
      fs.mkdirSync(dir, { recursive: true });
      const files = names.map((n) => { const f = path.join(dir, n); fs.writeFileSync(f, "ORIGINAL"); return f; });
      return { code: 0, stdout: files.join("\n") + "\n" };
    }
    return { code: 0 };
  };
}
function ytAudioArgs(h) {
  const c = h.ytdlpCalls().find((s) => s.args.includes("-o"));
  assert.ok(c, "yt-dlp download ran");
  return c.args;
}

test("Normalize off + mp3 source abr 320 + target mp3/320: yt-dlp has no --audio-quality; no libmp3lame spawn", T, async () => {
  const h = makeHarness({ config: { prevent_duplicates: false, loudnorm: false, auto_tag: false } });
  try {
    h.setScript(script([{ acodec: "mp3", abr: 320, vcodec: "none" }]));
    const r = await dl(h, { loudnorm: false });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.encodePlan.mode, "copy");
    assert.equal(r.encodePlan.upsampleWarn, false);
    const args = ytAudioArgs(h);
    assert.ok(args.includes("-x"));
    assert.equal(args[args.indexOf("--audio-format") + 1], "mp3");
    assert.equal(args.includes("--audio-quality"), false);
    assert.equal(h.spawns.some((s) => s.cmd.endsWith("ffmpeg") && s.args.includes("libmp3lame")), false);
  } finally { h.close(); }
});

test("Normalize on: --audio-quality present and loudnorm re-encode (libmp3lame) still runs", T, async () => {
  const h = makeHarness({ config: { prevent_duplicates: false, auto_tag: false } });
  try {
    h.setScript(script([{ acodec: "mp3", abr: 320, vcodec: "none" }]));
    const r = await dl(h, { loudnorm: true, lufs: -14 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.encodePlan.mode, "convert");
    const args = ytAudioArgs(h);
    assert.equal(args[args.indexOf("--audio-quality") + 1], "320K");
    assert.ok(h.spawns.some((s) => s.cmd.endsWith("ffmpeg") && s.args.includes("libmp3lame")));
  } finally { h.close(); }
});

test("opus source to mp3: convert even if Normalize off", T, async () => {
  const h = makeHarness({ config: { prevent_duplicates: false, loudnorm: false, auto_tag: false } });
  try {
    h.setScript(script([{ acodec: "opus", abr: 160, vcodec: "none" }]));
    const r = await dl(h, { loudnorm: false });
    assert.equal(r.ok, true);
    assert.equal(r.encodePlan.mode, "convert");
    assert.equal(r.encodePlan.upsampleWarn, false);
    assert.equal(ytAudioArgs(h).includes("--audio-quality"), true);
  } finally { h.close(); }
});

test("source abr 128 to mp3 320: convert + encodePlan.upsampleWarn true", T, async () => {
  const h = makeHarness({ config: { prevent_duplicates: false, loudnorm: false, auto_tag: false } });
  try {
    h.setScript(script([{ acodec: "mp3", abr: 128, vcodec: "none" }]));
    const r = await dl(h, { loudnorm: false, bitrate: "320" });
    assert.equal(r.ok, true);
    assert.equal(r.encodePlan.mode, "convert");
    assert.equal(r.encodePlan.upsampleWarn, true);
    assert.equal(ytAudioArgs(h)[ytAudioArgs(h).indexOf("--audio-quality") + 1], "320K");
  } finally { h.close(); }
});

test("renderer quality confirm covers lossy as well as lossless", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  assert.match(src, /quality_warn/);
  assert.match(src, /val === "mp3" \|\| val === "m4a"/);
});
