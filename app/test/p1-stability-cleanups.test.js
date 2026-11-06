"use strict";
// Leftover stability: dest language family, independent queue vs leftover-download
// children, Cancel aborting probes and tagging. Real main.js via h3-harness.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeHarness } = require("./h3-harness");

const T = { timeout: 20000 };
const APP = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(APP, "main.js"), "utf8");
const RENDERER = fs.readFileSync(path.join(APP, "renderer", "renderer.js"), "utf8");
const PRELOAD = fs.readFileSync(path.join(APP, "preload.js"), "utf8");
const STEM_EN = "This app can't use that location.";

async function drain(h, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await h.invoke("queue-status");
    if (!st.running) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail("queue did not drain");
}

test("main dest_bad / dest_unmounted / outside English errors share the location stem", () => {
  assert.match(MAIN, new RegExp(STEM_EN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const destBad = (MAIN.match(/DEST_BAD_TEXT = "([^"]+)"/) || [])[1];
  const unmounted = (MAIN.match(/DEST_UNMOUNTED = \{[\s\S]*?error: "([^"]+)"/) || [])[1];
  const outside = (MAIN.match(/DEST_OUTSIDE_TEXT = "([^"]+)"/) || [])[1];
  assert.ok(destBad && destBad.startsWith(STEM_EN), destBad);
  assert.ok(unmounted && unmounted.startsWith(STEM_EN), unmounted);
  assert.ok(outside && outside.startsWith(STEM_EN), outside);
  assert.notEqual(destBad, unmounted);
  assert.notEqual(unmounted, outside);
});

test("unmounted favorite download uses dest_unmounted language from the same family", T, async () => {
  const h = makeHarness();
  try {
    const mountRoot = h.mkdir("FakeVolumes");
    const fav = path.join(mountRoot, "USB", "Tracks");
    h.setConfig({ favorite_folders: [{ path: fav, name: "USB" }] });
    const r = await h.invoke("download", { url: "https://example.com/v", type: "video", quality: "best", autoTag: false, targetPath: fav });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "dest_unmounted");
    assert.ok(r.error.startsWith(STEM_EN), r.error);
    assert.match(r.error, /drive|connected|Reconnect/i);
    assert.doesNotMatch(r.error, /Invalid destination for this download/);
  } finally { h.close(); }
});

test("History Show outside error text is the same family as dest_bad, not a third unrelated wording", T, async () => {
  const h = makeHarness();
  try {
    const outsider = h.write("outside/steal.mp3", "x");
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/o", title: "steal.mp3",
      folder: path.dirname(outsider), file: outsider, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    const r = await h.invoke("reveal", outsider);
    assert.equal(r.ok, false);
    assert.equal(r.code, "outside");
    assert.ok(r.error.startsWith(STEM_EN), r.error);
  } finally { h.close(); }
});

test("queue-stop-all does not cancel a leftover download IPC; cancel-download does not cancel the queue child", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      if (args.includes("-J") || args.includes("--version")) return { code: 0, stdout: args.includes("-J") ? JSON.stringify({ id: "v", title: "T" }) : "1\n" };
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const url = args[args.length - 1] || "";
        const f = path.join(dir, (url.includes("/single") ? "single" : "queue") + ".mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [{ id: "q1", url: "https://example.com/queue", status: "pending" }]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    let singleResult = null;
    const singleP = h.invoke("download", {
      url: "https://example.com/single", type: "video", quality: "best", autoTag: false,
    }).then((r) => { singleResult = r; return r; });
    assert.ok(await h.waitFor(() => h.pendingHangs() >= 2));
    await h.invoke("queue-stop-all");
    await drain(h);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(singleResult, null, "leftover download IPC must still be running after Stop all");
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "canceled");
    await h.invoke("cancel-download");
    const sr = await singleP;
    assert.equal(sr.canceled, true);
  } finally { h.close(); }
});

test("Download-tab Cancel during a queue run uses queue-cancel, not leftover cancel-download", () => {
  const cancelBlock = RENDERER.slice(RENDERER.indexOf('if ($("dlCancelBtn"))'));
  assert.match(PRELOAD, /queueCancel:/);
  assert.match(RENDERER, /api\.queueCancel\(/);
  assert.match(cancelBlock, /api\.queueCancel\(/);
  assert.doesNotMatch(cancelBlock.slice(0, 400), /api\.cancelDownload\(/);
});

test("queue-cancel kills the current queue child and leaves remaining pending", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    let n = 0;
    h.setScript((cmd, args) => {
      if (args.includes("-J") || args.includes("--version")) return { code: 0, stdout: args.includes("-J") ? JSON.stringify({ id: "v", title: "T" }) : "1\n" };
      const o = args.indexOf("-o");
      if (o >= 0) {
        n++;
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "c" + n + ".mp4");
        fs.writeFileSync(f, "x");
        if (n === 1) return { hang: true, stdout: f + "\n" };
        return { code: 0, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [
      { id: "a", url: "https://example.com/a", status: "pending" },
      { id: "b", url: "https://example.com/b", status: "pending" },
    ]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    const r = await h.invoke("queue-cancel");
    assert.equal(r.ok, true);
    await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "canceled"; }
      catch { return false; }
    });
    await drain(h);
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "canceled");
    assert.equal(q[1].status, "done");
  } finally { h.close(); }
});

test("Cancel during an untracked ytdlpJson probe aborts it and returns canceled", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      if (args.includes("-J")) return { hang: true, stdout: "" };
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "late.mp4");
        fs.writeFileSync(f, "x");
        return { code: 0, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    const p = h.invoke("download", {
      url: "https://example.com/probe", type: "audio", audioFormat: "mp3", bitrate: "320",
      autoTag: true, loudnorm: false,
    });
    assert.ok(await h.waitFor(() => h.pendingHangs() >= 1));
    const nOut = h.ytdlpCalls().filter((c) => c.args.includes("-o")).length;
    const cr = await h.invoke("cancel-download");
    assert.equal(cr.ok, true);
    const r = await p;
    assert.equal(r.canceled, true, JSON.stringify(r));
    assert.equal(h.ytdlpCalls().filter((c) => c.args.includes("-o")).length, nOut, "probe cancel must not start the download");
  } finally { h.close(); }
});

test("Cancel during tagging aborts the ffmpeg tag child and does not replace the file", T, async () => {
  const h = makeHarness({ config: { auto_tag: true, loudnorm: false } });
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      if (cmd.endsWith("ffmpeg") && args.includes("-metadata")) {
        return { hang: true };
      }
      if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "vid1", title: "Artist - Song", uploader: "U" }) };
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "Artist - Song.mp3");
        fs.writeFileSync(f, "ORIGINAL");
        return { code: 0, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    const p = h.invoke("download", {
      url: "https://example.com/tag", type: "audio", audioFormat: "mp3", bitrate: "320",
      autoTag: true, loudnorm: false,
    });
    assert.ok(await h.waitFor(() => h.pendingHangs() >= 1));
    await h.invoke("cancel-download");
    const r = await p;
    assert.equal(r.canceled, true, JSON.stringify(r));
    const file = path.join(h.music, "Artist - Song.mp3");
    assert.equal(fs.readFileSync(file, "utf8"), "ORIGINAL");
    assert.equal(fs.readdirSync(h.music).some((n) => /\.tag\./.test(n)), false);
  } finally { h.close(); }
});
