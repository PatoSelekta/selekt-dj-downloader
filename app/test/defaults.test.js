"use strict";
// Default audio settings: MP3 · 320 kbps · Normalize on at -14 LUFS · Avoid duplicates on · Auto-tag on ·
// Download entire playlist off. The REAL app/main.js (via h3-harness.js: temp userData, fake yt-dlp/ffmpeg,
// no network) plus the REAL toDownloadOpts / buildQueueItemFromSelection source cut out of renderer.js and run in a
// vm with stubbed DOM reads. Run:  node --test app/test/defaults.test.js
// Rule under test: a config key that is ABSENT means "never saved" -> default; a key that is PRESENT (true/false) is
// an explicit choice and always wins. NOT covered here: Electron's real IPC or a real page (see the live check).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeHarness } = require("./h3-harness");

const APP = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(APP, "renderer", "index.html"), "utf8");
const RENDERER = fs.readFileSync(path.join(APP, "renderer", "renderer.js"), "utf8");
const T = { timeout: 20000 };

// Harness whose config.json is EXACTLY `config` (object or function(userData)), or absent (null).
function withConfig(config, fn, extra = {}) {
  const h = makeHarness({
    ...extra,
    beforeLoad: ({ userData }) => {
      const f = path.join(userData, "config.json");
      if (config === null) fs.rmSync(f, { force: true });
      else fs.writeFileSync(f, JSON.stringify(typeof config === "function" ? config(userData) : config));
    },
  });
  return Promise.resolve(fn(h)).finally(() => h.close());
}
const musicOnly = (u) => ({ main_folder: path.join(u, "Music") });   // a fresh install plus a sandboxed save folder
const SAVED_KEYS = ["prevent_duplicates", "auto_tag", "loudnorm", "lufs"];
const pick = (s) => ({ prevent_duplicates: s.prevent_duplicates, auto_tag: s.auto_tag, loudnorm: s.loudnorm, lufs: s.lufs });

// Fake yt-dlp / ffmpeg: probe answers; the download writes an .mp3 (so loudnorm/tagging apply); ffmpeg measures OK.
function audioScript() {
  return (cmd, args) => {
    if (cmd.endsWith("ffmpeg")) {
      if (args.includes("null")) return { code: 0, stderr: '{"input_i":"-20","input_tp":"-3","input_lra":"5","input_thresh":"-30","target_offset":"0"}' };
      return { code: 0 };
    }
    if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "vid1", title: "Artist - Song", uploader: "U" }) };
    const o = args.indexOf("-o");
    if (o >= 0) { const dir = path.dirname(args[o + 1]); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, "Artist - Song.mp3"); fs.writeFileSync(f, "x"); return { code: 0, stdout: f + "\n" }; }
    return { code: 0 };
  };
}
// What a download actually asked the tools to do.
function observe(h) {
  const yt = h.ytdlpCalls();
  const dl = yt.find(c => c.args.includes("-o"));
  const ff = h.spawns.filter(s => s.cmd.endsWith("ffmpeg"));
  const after = (flag) => { const i = dl.args.indexOf(flag); return i < 0 ? undefined : dl.args[i + 1]; };
  const reenc = ff.find(c => c.args.includes("libmp3lame"));
  return {
    probed: yt.some(c => c.args.includes("-J")),
    audioFormat: after("--audio-format"), audioQuality: after("--audio-quality"),
    playlist: dl.args.includes("--yes-playlist"), noPlaylist: dl.args.includes("--no-playlist"),
    loudnormI: (ff.map(c => c.args.join(" ").match(/loudnorm=I=(-?\d+)/)).find(Boolean) || [])[1],
    reencode: reenc ? reenc.args.join(" ").match(/-b:a (\d+k)/)[1] : undefined,
    tagged: ff.some(c => c.args.includes("-metadata")),
  };
}
async function download(h, opts) {
  h.setScript(audioScript());
  const r = await h.invoke("download", { url: "https://example.com/v", type: "audio", ...opts });
  assert.ok(r.ok, JSON.stringify(r));
  return observe(h);
}
const DEFAULT_DOWNLOAD = { probed: true, audioFormat: "mp3", audioQuality: "320K", playlist: false, noPlaylist: true,
  loudnormI: "-14", reencode: "320k", tagged: true };

// ---- 1. fresh configuration ---------------------------------------------------------------------------------
test("fresh configuration: no config file at all -> Avoid duplicates, Auto-tag, Normalize on, -14 LUFS", T, async () => {
  await withConfig(null, async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: true, auto_tag: true, loudnorm: true, lufs: -14 });
  });
});
test("fresh configuration: an empty config.json gives the same defaults", T, async () => {
  await withConfig({}, async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: true, auto_tag: true, loudnorm: true, lufs: -14 });
  });
});
test("defaults are never written into config.json (so they can't masquerade as saved choices)", T, async () => {
  await withConfig({}, async (h) => {
    await h.invoke("get-settings"); await h.invoke("get-settings");
    const saved = h.config();
    for (const k of SAVED_KEYS) assert.ok(!(k in saved), `${k} must stay absent until the user sets it`);
  });
});
test("a fresh config that saves only unrelated settings (folder, language, view) still gets every default", T, async () => {
  await withConfig((u) => ({ ...musicOnly(u), lang: "en", folder_view: "list" }), async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: true, auto_tag: true, loudnorm: true, lufs: -14 });
  });
});

// ---- 2. explicitly saved preferences ------------------------------------------------------------------------
test("explicitly saved OFF is kept (Avoid duplicates, Auto-tag, Normalize off; -9 LUFS stays)", T, async () => {
  await withConfig({ prevent_duplicates: false, auto_tag: false, loudnorm: false, lufs: -9 }, async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: false, auto_tag: false, loudnorm: false, lufs: -9 });
  });
});
test("explicitly saved ON is kept (and equals the defaults)", T, async () => {
  await withConfig({ prevent_duplicates: true, auto_tag: true, loudnorm: true, lufs: -14 }, async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: true, auto_tag: true, loudnorm: true, lufs: -14 });
  });
});
test("mixed: a saved choice does not disturb the keys that were never saved", T, async () => {
  await withConfig({ loudnorm: false }, async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: true, auto_tag: true, loudnorm: false, lufs: -14 });
  });
  await withConfig({ prevent_duplicates: false, lufs: -9 }, async (h) => {
    assert.deepEqual(pick(await h.invoke("get-settings")),
      { prevent_duplicates: false, auto_tag: true, loudnorm: true, lufs: -9 });
  });
});
test("every control can still be changed, saved and read back (off and on), across a restart", T, async () => {
  await withConfig({}, async (h) => {
    await h.invoke("set-loudnorm", false); await h.invoke("set-prevent-duplicates", false);
    await h.invoke("set-auto-tag", false);  await h.invoke("set-lufs", -9);
    assert.deepEqual(pick(await h.invoke("get-settings")), { prevent_duplicates: false, auto_tag: false, loudnorm: false, lufs: -9 });
    assert.deepEqual(pick(h.config()), { prevent_duplicates: false, auto_tag: false, loudnorm: false, lufs: -9 }, "saved as explicit values");
    const saved = h.config();
    await withConfig(saved, async (h2) => {                       // "restart": a new app instance reading that file
      assert.deepEqual(pick(await h2.invoke("get-settings")), { prevent_duplicates: false, auto_tag: false, loudnorm: false, lufs: -9 });
      await h2.invoke("set-loudnorm", true); await h2.invoke("set-prevent-duplicates", true);
      await h2.invoke("set-auto-tag", true);  await h2.invoke("set-lufs", -14);
      assert.deepEqual(pick(await h2.invoke("get-settings")), { prevent_duplicates: true, auto_tag: true, loudnorm: true, lufs: -14 });
    });
  });
});

// ---- 3. settings passed to a new audio download --------------------------------------------------------------
test("new audio download on a fresh config (caller passes nothing): MP3 320K, duplicate probe, normalize to -14 at 320k, tag, single track", T, async () => {
  await withConfig(musicOnly, async (h) => {
    assert.deepEqual(await download(h, {}), DEFAULT_DOWNLOAD);
  });
});
test("new audio download with the options the Download/Queue views send for the default controls: identical", T, async () => {
  await withConfig(musicOnly, async (h) => {
    assert.deepEqual(await download(h, { audioFormat: "mp3", bitrate: "320", autoTag: true, loudnorm: true, lufs: -14 }), DEFAULT_DOWNLOAD);
  });
});
const seedExisting = (h) => h.write("Music/Old Song [vid1].mp3", "x");   // the same track (id vid1) already in the save folder
test("Avoid duplicates on by default: a track already in the folder is flagged and NOT downloaded again", T, async () => {
  await withConfig(musicOnly, async (h) => {
    seedExisting(h); h.setScript(audioScript());
    const r = await h.invoke("download", { url: "https://example.com/v", type: "audio" });
    assert.equal(r.duplicate, true, JSON.stringify(r));
    assert.ok(!h.ytdlpCalls().some(c => c.args.includes("-o")), "no download process was started");
  });
});
test("explicitly saved OFF (Avoid duplicates, Normalize, Auto-tag): the same track downloads anyway, without normalizing or tagging; still MP3 320K", T, async () => {
  await withConfig((u) => ({ ...musicOnly(u), prevent_duplicates: false, loudnorm: false, auto_tag: false }), async (h) => {
    seedExisting(h);
    const o = await download(h, {});        // caller passes nothing -> the saved choices decide
    assert.deepEqual({ ...o, probed: undefined }, { probed: undefined, audioFormat: "mp3", audioQuality: "320K", playlist: false, noPlaylist: true,
      loudnormI: undefined, reencode: undefined, tagged: false });
  });
});
test("explicitly saved OFF, with the options the UI sends (autoTag:false): no duplicate probe at all", T, async () => {
  await withConfig((u) => ({ ...musicOnly(u), prevent_duplicates: false, loudnorm: false, auto_tag: false }), async (h) => {
    const o = await download(h, { audioFormat: "mp3", bitrate: "320", autoTag: false, loudnorm: false, lufs: -14 });
    assert.equal(o.probed, false); assert.equal(o.loudnormI, undefined); assert.equal(o.tagged, false);
  });
});
test("explicitly saved -9 LUFS is used by a new download", T, async () => {
  await withConfig((u) => ({ ...musicOnly(u), lufs: -9 }), async (h) => {
    assert.equal((await download(h, {})).loudnormI, "-9");
  });
});
test("per-download choices override the defaults: M4A, 192 kbps, Normalize and Auto-tag off for this download", T, async () => {
  await withConfig(musicOnly, async (h) => {
    const o = await download(h, { audioFormat: "m4a", bitrate: "192", loudnorm: false, autoTag: false });
    assert.equal(o.audioFormat, "m4a"); assert.equal(o.audioQuality, "192K");
    assert.equal(o.loudnormI, undefined); assert.equal(o.tagged, false);
  });
});
test("Download entire playlist is off unless asked: a single-track download never passes --yes-playlist", T, async () => {
  await withConfig(musicOnly, async (h) => {
    const o = await download(h, {});
    assert.equal(o.playlist, false); assert.equal(o.noPlaylist, true);
  });
});

// ---- 4. entry points: Download tab, Queue tab, saved queue items, watch folder --------------------------------
// Cut the real functions out of renderer.js (balanced braces) and run them against stubbed globals.
function cutFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `renderer.js has function ${name}`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
  return src.slice(start, i + 1);
}
function rendererWorld(ui, globals = {}) {
  const SelektDest = require("../renderer/destination.js");
  const m = RENDERER.match(/const DEFAULT_AUDIO_BITRATE = "([^"]+)";/);
  assert.ok(m, "renderer.js declares DEFAULT_AUDIO_BITRATE");
  const initial = {};
  for (const [k, re] of Object.entries({
    preventDuplicates: /^let preventDuplicates = (true|false);/m, autoTagEnabled: /^let autoTagEnabled = (true|false);/m,
    loudnormEnabled: /^let loudnormEnabled = (true|false);/m, lufsValue: /^let lufsValue = (-?\d+);/m, playlistOn: /^let playlistOn = (true|false);/m,
  })) { const mm = RENDERER.match(re); assert.ok(mm, `renderer.js initial ${k}`); initial[k] = JSON.parse(mm[1]); }
  const ctx = vm.createContext({ ...initial, ...globals, lastProbe: null, currentFav: null, currentTarget: "",
    SelektDest, $: (id) => ({ value: ui[id] }) });
  vm.runInContext([
    m[0],
    "function queueItemDest(item) { return SelektDest.queueItemDest(item); }",
    cutFunction(RENDERER, "currentDestId"), cutFunction(RENDERER, "toDownloadOpts"), cutFunction(RENDERER, "buildQueueItemFromSelection"),
  ].join("\n"), ctx);
  return { ctx, initial, defaultBitrate: m[1] };
}
// The Download tab starts with these control values (what the Download button and "Add to queue" read).
function htmlSelectedValue(id) {
  const sel = HTML.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(sel, `index.html has #${id}`);
  const chosen = [...sel[1].matchAll(/<option\s+value="([^"]*)"([^>]*)>/g)].filter(o => /\sselected\b/.test(o[2])).map(o => o[1]);
  assert.equal(chosen.length, 1, `#${id} has exactly one selected option`);
  return chosen[0];
}
const buttonTag = (id) => { const m = HTML.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`)); assert.ok(m, `#${id}`); return m[0]; };

test("Download tab starts on MP3 · 320 kbps · -14 LUFS, with Normalize / Avoid duplicates / Auto-tag on and playlist off", T, () => {
  assert.equal(htmlSelectedValue("format"), "audio:mp3");
  assert.equal(htmlSelectedValue("bitrate"), "320");
  assert.equal(htmlSelectedValue("lufsSelect"), "-14");
  for (const id of ["dupToggle", "autoTagToggle", "loudnormToggle"]) {
    assert.match(buttonTag(id), /class="toggle active"/, `${id} starts active`);
    assert.match(buttonTag(id), /aria-pressed="true"/, `${id} starts pressed`);
  }
  assert.match(buttonTag("playlistToggle"), /aria-pressed="false"/);
  assert.doesNotMatch(buttonTag("playlistToggle"), /\bactive\b/);
  assert.doesNotMatch(HTML.match(/<div id="lufsWrap"[^>]*>/)[0], /display:\s*none/, "the -14 LUFS target is visible because Normalize starts on");
});
test("renderer's own initial state and fallbacks agree with the app defaults", T, () => {
  const { initial, defaultBitrate } = rendererWorld({});
  assert.deepEqual(initial, { preventDuplicates: true, autoTagEnabled: true, loudnormEnabled: true, lufsValue: -14, playlistOn: false });
  assert.equal(defaultBitrate, htmlSelectedValue("bitrate"), "renderer fallback = the selected quality option");
  assert.match(RENDERER, /preventDuplicates = s\.prevent_duplicates !== false;/, "settings load: only an explicit false turns it off");
  assert.match(RENDERER, /loudnormEnabled = s\.loudnorm !== false;/);
  assert.match(RENDERER, /autoTagEnabled = s\.auto_tag !== false;/);
});
test("Download tab -> queue item (default controls): audio:mp3, 320, auto-tag/normalize on, -14, not a playlist", T, () => {
  const { ctx } = rendererWorld({ format: "audio:mp3", bitrate: "320" });
  const item = ctx.buildQueueItemFromSelection("https://example.com/v");
  assert.deepEqual({ f: item.format, b: item.bitrate, t: item.autoTag, l: item.loudnorm, lufs: item.lufs, p: item.playlist },
    { f: "audio:mp3", b: "320", t: true, l: true, lufs: -14, p: false });
  const o = ctx.toDownloadOpts({ ...item, id: "q1" });
  assert.deepEqual({ type: o.type, audioFormat: o.audioFormat, bitrate: o.bitrate, autoTag: o.autoTag, loudnorm: o.loudnorm, lufs: o.lufs },
    { type: "audio", audioFormat: "mp3", bitrate: "320", autoTag: true, loudnorm: true, lufs: -14 });
});
test("Queue tab 'Add to queue' stores format+bitrate from the controls (mp3/320); the item resolves toggles from the live settings", T, () => {
  const { ctx } = rendererWorld({ format: "audio:mp3", bitrate: "320" });
  const stored = { id: "q2", url: "https://example.com/v", destId: "", format: "audio:mp3", bitrate: "320", status: "pending" };   // the shape queueAddBtn builds
  const o = ctx.toDownloadOpts(stored);
  assert.deepEqual({ audioFormat: o.audioFormat, bitrate: o.bitrate, autoTag: o.autoTag, loudnorm: o.loudnorm, lufs: o.lufs },
    { audioFormat: "mp3", bitrate: "320", autoTag: true, loudnorm: true, lufs: -14 });
  ctx.loudnormEnabled = false; ctx.lufsValue = -9;                       // user later turns Normalize off / picks -9
  const o2 = ctx.toDownloadOpts(stored);
  assert.deepEqual({ loudnorm: o2.loudnorm, lufs: o2.lufs }, { loudnorm: false, lufs: -9 }, "still follows the live controls");
});
test("existing queue items keep their own stored values (192 kbps, Normalize off) - defaults only fill what is missing", T, () => {
  const { ctx } = rendererWorld({});
  const old = { id: "bd471b96", url: "https://example.com/old", destId: "", format: "audio:mp3", bitrate: "192", autoTag: true, loudnorm: false, lufs: -14, playlist: false, status: "done" };
  const snapshot = JSON.stringify(old);
  const o = ctx.toDownloadOpts(old);
  assert.deepEqual({ bitrate: o.bitrate, loudnorm: o.loudnorm, autoTag: o.autoTag, lufs: o.lufs }, { bitrate: "192", loudnorm: false, autoTag: true, lufs: -14 });
  assert.equal(JSON.stringify(old), snapshot, "toDownloadOpts does not modify the stored item");
  assert.equal(ctx.toDownloadOpts({ id: "x", url: "https://e.com", format: "audio:m4a", bitrate: "128", loudnorm: false, lufs: -9 }).lufs, -9);
  assert.equal(ctx.toDownloadOpts({ id: "y", url: "https://e.com", format: "audio:mp3" }).bitrate, "320", "an item with no bitrate at all gets the default");
});
test("video items are untouched: no audio fields, quality/original handling unchanged", T, () => {
  const { ctx } = rendererWorld({});
  const v = ctx.toDownloadOpts({ id: "v1", url: "https://e.com", format: "video:1080" });
  assert.deepEqual({ type: v.type, audioFormat: v.audioFormat, quality: v.quality, noConvert: v.noConvert }, { type: "video", audioFormat: undefined, quality: "1080", noConvert: undefined });
  const vo = ctx.toDownloadOpts({ id: "v2", url: "https://e.com", format: "video:original" });
  assert.deepEqual({ quality: vo.quality, noConvert: vo.noConvert }, { quality: "original", noConvert: true });
});
test("a saved queue.json is not modified by starting the app, reading settings or reading the queue", T, async () => {
  const item = { id: "bd471b96", status: "done", title: "1000Hz.mp3", error: null, url: "https://example.com/old", destId: "",
    format: "audio:mp3", bitrate: "192", autoTag: true, loudnorm: false, lufs: -14, playlist: false, force: false, note: null };
  await withConfig({}, async (h) => {
    h.write("queue.json", JSON.stringify([item], null, 2));
    const before = fs.readFileSync(h.p("queue.json"), "utf8");
    await h.invoke("get-settings");
    assert.deepEqual(await h.invoke("queue-get"), [item]);
    assert.equal(fs.readFileSync(h.p("queue.json"), "utf8"), before, "byte-identical");
  });
});
test("watch folder: new items are MP3 at the default quality (320); Normalize/Auto-tag/LUFS follow the settings when the item runs", T, async () => {
  await withConfig(musicOnly, async (h) => {
    const inbox = path.join(h.userData, "inbox", "inbox.txt");
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.writeFileSync(inbox, "https://example.com/watched\n");
    assert.deepEqual(await h.invoke("watch-set", { inbox_path: inbox, enabled: true }), { ok: true });
    const [w] = await h.invoke("queue-get");
    assert.deepEqual({ type: w.type, audioFormat: w.audioFormat, bitrate: w.bitrate, source: w.source, status: w.status },
      { type: "audio", audioFormat: "mp3", bitrate: "320", source: "watch", status: "pending" });
    for (const k of ["autoTag", "loudnorm", "lufs", "playlist", "force"]) assert.ok(!(k in w), `watch item stores no ${k}`);
    // ...so it resolves them like any Queue-tab item (renderer falls back to the live settings):
    const { ctx } = rendererWorld({});
    const o = ctx.toDownloadOpts(w);
    assert.deepEqual({ type: o.type, audioFormat: o.audioFormat, bitrate: o.bitrate, autoTag: o.autoTag, loudnorm: o.loudnorm, lufs: o.lufs },
      { type: "audio", audioFormat: "mp3", bitrate: "320", autoTag: true, loudnorm: true, lufs: -14 });
    await h.invoke("watch-stop");
  });
});
test("watch folder: items already in the queue keep their stored 192; a new scan never rewrites them", T, async () => {
  await withConfig(musicOnly, async (h) => {
    const legacy = { id: "w-old", url: "https://example.com/older", destId: "", type: "audio", audioFormat: "mp3", bitrate: "192", status: "pending", title: null, error: null, source: "watch" };
    h.write("queue.json", JSON.stringify([legacy]));
    const inbox = path.join(h.userData, "inbox", "inbox.txt");
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.writeFileSync(inbox, "https://example.com/newer\n");
    await h.invoke("watch-set", { inbox_path: inbox, enabled: true });
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map(i => [i.url, i.bitrate]), [["https://example.com/older", "192"], ["https://example.com/newer", "320"]]);
    assert.deepEqual(q[0], legacy);
    await h.invoke("watch-stop");
  });
});
