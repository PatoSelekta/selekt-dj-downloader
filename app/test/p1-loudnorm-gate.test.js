"use strict";
// Phase 1: loudnorm I/TP gate — do not swap when true peak is unsafe; swap+warn on an honest I miss.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeHarness } = require("./h3-harness");

const T = { timeout: 20000 };

function gateScript({ gateJson, tagCode = 0, names = ["Artist - Song.mp3"] }) {
  let nulls = 0;
  return (cmd, args) => {
    if (cmd.endsWith("ffmpeg")) {
      const out = args[args.length - 1];
      if (args.includes("null")) {
        nulls++;
        if (nulls === 1) {
          return { code: 0, stderr: '{"input_i":"-20","input_tp":"-3","input_lra":"5","input_thresh":"-30","target_offset":"0"}' };
        }
        return { code: 0, stderr: gateJson };
      }
      if (args.includes("-metadata")) return { code: tagCode };
      fs.writeFileSync(out, "NORMALIZED");
      return { code: 0 };
    }
    if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "vid1", title: "Artist - Song", uploader: "U" }) };
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

test("tmp measure input_tp 0.0: original kept, reason true_peak", T, async () => {
  const h = makeHarness({ config: { loudnorm: true, auto_tag: false } });
  try {
    h.setScript(gateScript({ gateJson: '{"input_i":"-9.0","input_tp":"0.0","input_lra":"5","input_thresh":"-30","target_offset":"0"}' }));
    const r = await h.invoke("download", {
      url: "https://example.com/v", type: "audio", audioFormat: "mp3", bitrate: "320",
      loudnorm: true, lufs: -9, autoTag: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.normalizeWarning.failed[0].reason, "true_peak");
    assert.equal(fs.readFileSync(r.files[0], "utf8"), "ORIGINAL");
  } finally { h.close(); }
});

test("tmp measure I miss with safe TP: file is normalized, warning target_miss", T, async () => {
  const h = makeHarness({ config: { loudnorm: true, auto_tag: false } });
  try {
    h.setScript(gateScript({ gateJson: '{"input_i":"-12.9","input_tp":"-1.5","input_lra":"5","input_thresh":"-30","target_offset":"0"}' }));
    const r = await h.invoke("download", {
      url: "https://example.com/v", type: "audio", audioFormat: "mp3", bitrate: "320",
      loudnorm: true, lufs: -9, autoTag: false,
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(r.files[0], "utf8"), "NORMALIZED");
    assert.equal(r.normalizeWarning.failed[0].reason, "target_miss");
  } finally { h.close(); }
});

test("tag ffmpeg exit 1: tagWarning present, file still kept", T, async () => {
  const h = makeHarness({ config: { loudnorm: true, auto_tag: true } });
  try {
    h.setScript(gateScript({
      gateJson: '{"input_i":"-9.0","input_tp":"-1.5","input_lra":"5","input_thresh":"-30","target_offset":"0"}',
      tagCode: 1,
    }));
    const r = await h.invoke("download", {
      url: "https://example.com/v", type: "audio", audioFormat: "mp3", bitrate: "320",
      loudnorm: true, lufs: -9, autoTag: true,
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(r.files[0], "utf8"), "NORMALIZED");
    assert.ok(r.tagWarning);
    assert.equal(r.tagWarning.failed, 1);
    assert.equal(r.tagWarning.total, 1);
  } finally { h.close(); }
});

test("renderer shows true_peak / target_miss / tag_warn", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  assert.match(src, /norm_reason_true_peak/);
  assert.match(src, /norm_reason_target_miss/);
  assert.match(src, /tag_warn/);
});

let hasFfmpeg = false;
try {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  hasFfmpeg = r.status === 0;
} catch (_) { hasFfmpeg = false; }

test("generated sine: ffmpeg loudnorm JSON is parseable for the I/TP gate", { skip: !hasFfmpeg, timeout: 30000 }, () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "selekt-ln-"));
  const wav = path.join(dir, "sine.wav");
  const gen = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1", "-c:a", "pcm_s16le", wav], { encoding: "utf8" });
  assert.equal(gen.status, 0, gen.stderr);
  const meas = spawnSync("ffmpeg", ["-i", wav, "-af", "loudnorm=I=-9:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const blob = (meas.stderr || "").match(/\{[\s\S]*\}/);
  assert.ok(blob, meas.stderr);
  const j = JSON.parse(blob[0]);
  assert.equal(Number.isFinite(Number(j.input_i)), true);
  assert.equal(Number.isFinite(Number(j.input_tp)), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
