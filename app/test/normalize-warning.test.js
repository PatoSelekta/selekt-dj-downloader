"use strict";
// A requested loudness normalization that does NOT happen must be visible, never reported as a plain success.
// The REAL app/main.js (via h3-harness.js: temp userData, fake yt-dlp/ffmpeg, no network, no real audio) plus the
// REAL normWarnText / I18N text cut out of renderer.js. Run:  node --test app/test/normalize-warning.test.js
// What is checked: the file on disk after each outcome, what the download returns (ok / normalizeWarning /
// canceled), and that cancel is not counted as a failure. NOT covered here: real ffmpeg (see the real-file check
// in the review notes) or a real window (the Queue row / message are covered by a separate browser check).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeHarness } = require("./h3-harness");

const APP = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(APP, "renderer", "renderer.js"), "utf8");
const T = { timeout: 20000 };
const MEASURE = '{"input_i":"-20","input_tp":"-3","input_lra":"5","input_thresh":"-30","target_offset":"0"}';

// Fake tools. yt-dlp writes each name in `names` containing "ORIGINAL". ffmpeg:
//   pass 1 (args contain "null")  -> measurement, or none / a throw
//   pass 2 (has -af ...measured_I) -> writes the temp output ("NORMALIZED"), or fails in the requested way
//   tag    (has -metadata)         -> writes input + "+TAG" to its output
// pass2 may be a string or a function(inputFile) -> string. Calls are logged in `log`.
const GATE_OK = '{"input_i":"-14.0","input_tp":"-10","input_lra":"5","input_thresh":"-30","target_offset":"0"}';
function makeScript(log, { names = ["Artist - Song.mp3"], pass1 = "ok", pass2 = "ok", onPass1, onPass2 } = {}) {
  return (cmd, args) => {
    if (cmd.endsWith("ffmpeg")) {
      const out = args[args.length - 1];
      if (args.includes("null")) {
        const input = args[args.indexOf("-i") + 1];
        if (/\.ln\./.test(String(input))) {
          log.push("gate");
          return { code: 0, stderr: GATE_OK };
        }
        log.push("pass1");
        if (onPass1) onPass1(input);
        if (pass1 === "throw") throw new Error("spawn EACCES");
        if (pass1 === "nojson") return { code: 1, stderr: "Invalid data found when processing input" };
        return { code: 0, stderr: MEASURE };
      }
      if (args.includes("-metadata")) {
        log.push("tag");
        fs.writeFileSync(out, fs.readFileSync(args[args.indexOf("-i") + 1], "utf8") + "+TAG");
        return { code: 0 };
      }
      log.push("pass2");
      const input = args[args.indexOf("-i") + 1];
      if (onPass2) onPass2(input);
      const mode = typeof pass2 === "function" ? pass2(input) : pass2;
      if (mode === "exit1") return { code: 1, stderr: "Error while filtering" };
      if (mode === "killed") { fs.writeFileSync(out, "PARTIAL"); return { code: 255 }; }
      if (mode === "nooutput") return { code: 0 };
      if (mode === "empty") { fs.writeFileSync(out, ""); return { code: 0 }; }
      fs.writeFileSync(out, "NORMALIZED");
      return { code: 0 };
    }
    if (args.includes("-J")) return { code: 0, stdout: JSON.stringify({ id: "vid1", title: "Artist - Song", uploader: "U" }) };
    const o = args.indexOf("-o");
    if (o >= 0) {
      const dir = path.dirname(args[o + 1]);
      fs.mkdirSync(dir, { recursive: true });
      const files = names.map(n => { const f = path.join(dir, n); fs.writeFileSync(f, "ORIGINAL"); return f; });
      return { code: 0, stdout: files.join("\n") + "\n" };
    }
    return { code: 0 };
  };
}

// One harness per test: Normalize + Auto-tag requested (the app defaults), everything else off.
async function run(opts, fn) {
  const h = makeHarness({ config: { loudnorm: true, auto_tag: true } });
  const log = [];
  try {
    h.setScript(makeScript(log, opts));
    const download = (extra = {}) => h.invoke("download", { url: "https://example.com/v", type: "audio", audioFormat: "mp3",
      bitrate: "320", loudnorm: true, lufs: -14, autoTag: true, _inQueue: true, ...extra });
    const file = (n = "Artist - Song.mp3") => path.join(h.music, n);
    const read = (n) => fs.readFileSync(file(n), "utf8");
    const leftovers = () => fs.readdirSync(h.music).filter(n => /\.ln\.|\.tag\./.test(n));
    const lines = (name) => { try { return fs.readFileSync(h.p(name), "utf8").split("\n").filter(Boolean); } catch (_) { return []; } };
    return await fn({ h, log, download, file, read, leftovers, lines });
  } finally { h.close(); }
}

test("success: the normalized audio replaces the file, then it is tagged; no warning is returned", T, () => run({}, async ({ log, download, read, leftovers, lines }) => {
  const r = await download();
  assert.equal(r.ok, true);
  assert.equal("normalizeWarning" in r, false, "a clean success carries no warning");
  assert.deepEqual(log, ["pass1", "pass2", "gate", "tag"], "measure, apply, gate, then tag");
  assert.equal(read(), "NORMALIZED+TAG");
  assert.deepEqual(leftovers(), []);
  assert.equal(lines("download_history.jsonl").length, 1);
}));

test("reported failure, unsuccessful return values: the file is kept as downloaded, still tagged and in History, and the result says what failed", T, async () => {
  const cases = [
    ["measure", { pass1: "nojson" }, ["pass1", "tag"]],
    ["apply", { pass2: "exit1" }, ["pass1", "pass2", "tag"]],
    ["apply", { pass2: "nooutput" }, ["pass1", "pass2", "tag"]],   // ffmpeg said 0 but wrote nothing: must not count as normalized
    ["apply", { pass2: "empty" }, ["pass1", "pass2", "tag"]],      // an empty output must never replace a good file
  ];
  for (const [reason, opts, calls] of cases) {
    await run(opts, async ({ log, download, read, leftovers, lines }) => {
      const r = await download();
      const label = JSON.stringify(opts);
      assert.equal(r.ok, true, `${label}: the download itself succeeded`);
      assert.deepEqual(r.normalizeWarning, { total: 1, failed: [{ file: r.files[0], reason }] }, label);
      assert.deepEqual(log, calls, label);
      assert.equal(read(), "ORIGINAL+TAG", `${label}: original audio kept (and tagged), never the failed output`);
      assert.deepEqual(leftovers(), [], `${label}: no temporary file left behind`);
      assert.equal(lines("download_history.jsonl").length, 1, `${label}: History row recorded`);
      assert.equal(lines("downloaded_index.jsonl").length, 1, `${label}: duplicate record written`);
    });
  }
});

test("reported failure, rejected error: a thrown error from the helper becomes a warning with reason 'error'", T, () => run({ pass1: "throw" }, async ({ log, download, read }) => {
  const r = await download();
  assert.equal(r.ok, true);
  assert.deepEqual(r.normalizeWarning, { total: 1, failed: [{ file: r.files[0], reason: "error" }] });
  assert.equal(read(), "ORIGINAL+TAG");
  assert.ok(log.includes("tag"), "tagging still runs after the failed normalization");
}));

test("file replacement fails: not reported as normalized, original left exactly as it was, temp file removed", T, () => run({}, async ({ log, download, read, leftovers }) => {
  const realRename = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (/\.ln\.mp3$/.test(from)) { const e = new Error("EPERM: operation not permitted, rename"); e.code = "EPERM"; throw e; }
    return realRename.apply(this, arguments);
  };
  let r;
  try { r = await download({ autoTag: false }); } finally { fs.renameSync = realRename; }
  assert.equal(r.ok, true, "the download itself succeeded");
  assert.deepEqual(r.normalizeWarning, { total: 1, failed: [{ file: r.files[0], reason: "replace" }] });
  assert.equal(read(), "ORIGINAL", "the original audio was not touched");
  assert.deepEqual(leftovers(), [], "the normalized temp file was removed");
  assert.deepEqual(log, ["pass1", "pass2", "gate"]);
}));

test("several files: one failing track is named in the warning, the others stay normalized", T, () => run({
  names: ["A.mp3", "B.mp3"], pass2: (input) => (path.basename(input) === "B.mp3" ? "exit1" : "ok"),
}, async ({ download, read }) => {
  const r = await download({ autoTag: false });
  assert.equal(r.ok, true);
  assert.equal(r.normalizeWarning.total, 2);
  assert.deepEqual(r.normalizeWarning.failed.map(f => [path.basename(f.file), f.reason]), [["B.mp3", "apply"]]);
  assert.equal(read("A.mp3"), "NORMALIZED");
  assert.equal(read("B.mp3"), "ORIGINAL");
}));

test("Normalize off: ffmpeg is never asked to normalize, and no warning appears", T, () => run({ pass1: "nojson" }, async ({ log, download, read }) => {
  const r = await download({ loudnorm: false, autoTag: false });
  assert.equal(r.ok, true);
  assert.equal("normalizeWarning" in r, false);
  assert.deepEqual(log, []);
  assert.equal(read(), "ORIGINAL");
}));

test("cancel while measuring: same result as a cancelled download, finished file kept untouched, nothing recorded, no failure warning", T, () => {
  let h0;
  return run({ onPass1: () => h0.invoke("cancel-download") }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.ok, false);
    assert.equal(r.canceled, true);
    assert.equal("normalizeWarning" in r, false, "cancelling is not a normalization failure");
    assert.deepEqual(r.keptFiles, [ctx.file()], "main reports the finished file it kept");
    assert.equal(ctx.read(), "ORIGINAL", "kept exactly as downloaded: not normalized, not tagged");
    assert.deepEqual(ctx.log, ["pass1"], "pass 2 and tagging never start");
    assert.deepEqual(ctx.leftovers(), []);
    assert.equal(ctx.lines("download_history.jsonl").length, 0, "a cancelled item adds no History row");
    assert.equal(ctx.lines("downloaded_index.jsonl").length, 0, "and no duplicate record, so retrying is not skipped as a duplicate");
  });
});

test("cancel while applying: the partial output is removed, the original stays, result is 'canceled'", T, () => {
  let h0;
  return run({ pass2: "killed", onPass2: () => h0.invoke("cancel-download") }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.ok, false);
    assert.equal(r.canceled, true);
    assert.deepEqual(r.keptFiles, [ctx.file()]);
    assert.equal(ctx.read(), "ORIGINAL");
    assert.deepEqual(ctx.leftovers(), [], "no half-written .ln file");
    assert.equal(ctx.log.includes("tag"), false);
    assert.equal(ctx.lines("download_history.jsonl").length, 0);
  });
});

test("after a cancel the next download starts clean (the cancel flag does not leak)", T, () => {
  let h0, once = true;
  return run({ onPass1: () => { if (once) { once = false; return h0.invoke("cancel-download"); } } }, async (ctx) => {
    h0 = ctx.h;
    assert.equal((await ctx.download()).canceled, true);
    const r = await ctx.download();
    assert.equal(r.ok, true);
    assert.equal("normalizeWarning" in r, false);
    assert.equal(ctx.read(), "NORMALIZED+TAG");
  });
});

// ---- cancellation: the second ffmpeg pass, and several files ----------------------------------------------
// canceledNote is the REAL function cut out of renderer.js (see below); it turns the cancel result into the text of the
// Queue row note / Download-tab message. `texts(r)` = both languages, so a test can check the actual wording.
const EN_KEPT = "Cancelled while normalizing — what was downloaded was kept, not normalized. ↻ to retry";
const ES_KEPT = "Cancelada al normalizar — lo descargado se conservó, sin normalizar. ↻ para reintentar";
const EN_PARTIAL_1_OF_2 = "Cancelled while normalizing — 1 of 2 file(s) were already normalized and kept; the rest were kept, not normalized. ↻ to retry";
const ES_PARTIAL_1_OF_2 = "Cancelada al normalizar — 1 de 2 archivo(s) ya estaban normalizados y se conservaron; los demás se conservaron sin normalizar. ↻ para reintentar";
const texts = (r) => ({ en: canceledNoteIn("en")(r), es: canceledNoteIn("es")(r) });
const base = (ctx, n) => path.basename(n);

test("cancel racing a SUCCESSFUL ffmpeg exit: the finished temp output is discarded, the original stays, and it is reported as cancelled (never a clean success)", T, () => {
  let h0;
  // ffmpeg writes a complete normalized file and exits 0, but Cancel was pressed before that exit was seen.
  return run({ pass2: "ok", onPass2: () => h0.invoke("cancel-download") }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.ok, false, "not a success");
    assert.equal(r.canceled, true);
    assert.equal("normalizeWarning" in r, false, "and not a normalization failure either");
    assert.deepEqual(r.keptFiles, [ctx.file()]);
    assert.deepEqual(r.normalizedFiles, [], "the file was NOT normalized");
    assert.deepEqual(r.notNormalizedFiles, [ctx.file()]);
    assert.equal(ctx.read(), "ORIGINAL", "result and disk agree: the finished NORMALIZED output was not swapped in");
    assert.deepEqual(ctx.leftovers(), [], "temp file removed");
    assert.deepEqual(ctx.log, ["pass1", "pass2"], "no tagging after a cancel");
    assert.equal(ctx.lines("download_history.jsonl").length, 0);
    assert.equal(ctx.lines("downloaded_index.jsonl").length, 0);
    assert.deepEqual(texts(r), { en: EN_KEPT, es: ES_KEPT });
  });
});

test("cancel after file 1 of 2 was normalized, while file 2 is being applied: file 1 stays normalized, file 2 stays original, and the message says exactly that", T, () => {
  let h0;
  return run({ names: ["A.mp3", "B.mp3"], pass2: (i) => (base(0, i) === "B.mp3" ? "killed" : "ok"),
    onPass2: (i) => { if (base(0, i) === "B.mp3") h0.invoke("cancel-download"); } }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.ok, false);
    assert.equal(r.canceled, true);
    assert.deepEqual(r.keptFiles.map(f => path.basename(f)), ["A.mp3", "B.mp3"], "both finished files are preserved");
    assert.deepEqual(r.normalizedFiles.map(f => path.basename(f)), ["A.mp3"]);
    assert.deepEqual(r.notNormalizedFiles.map(f => path.basename(f)), ["B.mp3"]);
    assert.equal(ctx.read("A.mp3"), "NORMALIZED", "file 1 really is the normalized audio (not tagged: a cancelled item is not tagged)");
    assert.equal(ctx.read("B.mp3"), "ORIGINAL", "file 2 is untouched");
    assert.deepEqual(ctx.leftovers(), []);
    assert.deepEqual(ctx.log, ["pass1", "pass2", "gate", "pass1", "pass2"], "no tagging");
    assert.equal(ctx.lines("download_history.jsonl").length, 0, "cancelled items add no History row (unchanged behavior)");
    assert.equal(ctx.lines("downloaded_index.jsonl").length, 0, "and no duplicate record");
    const tx = texts(r);
    assert.deepEqual(tx, { en: EN_PARTIAL_1_OF_2, es: ES_PARTIAL_1_OF_2 });
    for (const s of Object.values(tx)) assert.doesNotMatch(s, /downloaded file was kept, not normalized|el archivo descargado se conservó, sin normalizar/, "the old all-unnormalized claim is gone");
  });
});

test("cancel after file 1 of 2 was normalized, while file 2 is still being measured: file 2 is never touched", T, () => {
  let h0;
  return run({ names: ["A.mp3", "B.mp3"], onPass1: (i) => { if (base(0, i) === "B.mp3") h0.invoke("cancel-download"); } }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.canceled, true);
    assert.deepEqual(r.normalizedFiles.map(f => path.basename(f)), ["A.mp3"]);
    assert.deepEqual(r.notNormalizedFiles.map(f => path.basename(f)), ["B.mp3"]);
    assert.equal(ctx.read("A.mp3"), "NORMALIZED");
    assert.equal(ctx.read("B.mp3"), "ORIGINAL");
    assert.deepEqual(ctx.log, ["pass1", "pass2", "gate", "pass1"], "file 2's pass 2 never starts");
    assert.deepEqual(texts(r), { en: EN_PARTIAL_1_OF_2, es: ES_PARTIAL_1_OF_2 });
  });
});

test("cancel racing a successful exit on file 2 of 2: file 2's finished output is discarded; file 1 stays normalized; result and disk agree", T, () => {
  let h0;
  return run({ names: ["A.mp3", "B.mp3"], pass2: "ok", onPass2: (i) => { if (base(0, i) === "B.mp3") h0.invoke("cancel-download"); } }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.ok, false);
    assert.equal(r.canceled, true);
    assert.deepEqual(r.normalizedFiles.map(f => path.basename(f)), ["A.mp3"]);
    assert.deepEqual(r.notNormalizedFiles.map(f => path.basename(f)), ["B.mp3"]);
    assert.equal(ctx.read("A.mp3"), "NORMALIZED");
    assert.equal(ctx.read("B.mp3"), "ORIGINAL", "B's complete NORMALIZED output was thrown away because the user cancelled");
    assert.deepEqual(ctx.leftovers(), []);
    assert.deepEqual(texts(r), { en: EN_PARTIAL_1_OF_2, es: ES_PARTIAL_1_OF_2 });
  });
});

test("an earlier file that FAILED to normalize is not counted as normalized when a later file is cancelled", T, () => {
  let h0;
  return run({ names: ["A.mp3", "B.mp3"], pass2: (i) => (base(0, i) === "A.mp3" ? "exit1" : "killed"),
    onPass2: (i) => { if (base(0, i) === "B.mp3") h0.invoke("cancel-download"); } }, async (ctx) => {
    h0 = ctx.h;
    const r = await ctx.download();
    assert.equal(r.canceled, true);
    assert.deepEqual(r.normalizedFiles, []);
    assert.deepEqual(r.notNormalizedFiles.map(f => path.basename(f)), ["A.mp3", "B.mp3"]);
    assert.equal(ctx.read("A.mp3"), "ORIGINAL");
    assert.equal(ctx.read("B.mp3"), "ORIGINAL");
    assert.deepEqual(texts(r), { en: EN_KEPT, es: ES_KEPT });
  });
});

test("cleanup itself fails: the original is still untouched and the result is still 'canceled', but the temp file may remain (the limitation is real, not hidden)", T, () => {
  let h0;
  return run({ pass2: "killed", onPass2: () => h0.invoke("cancel-download") }, async (ctx) => {
    h0 = ctx.h;
    const realUnlink = fs.unlinkSync;
    fs.unlinkSync = function (p) { if (/\.ln\.mp3$/.test(String(p))) { const e = new Error("EPERM: operation not permitted, unlink"); e.code = "EPERM"; throw e; } return realUnlink.apply(this, arguments); };
    let r;
    try { r = await ctx.download(); } finally { fs.unlinkSync = realUnlink; }
    assert.equal(r.canceled, true);
    assert.equal(ctx.read(), "ORIGINAL", "the original file is never replaced by the leftover");
    assert.deepEqual(ctx.leftovers().map(n => n.replace(/^.*\.ln\./, ".ln.")), [".ln.mp3"], "the half-made temp file could not be removed and is still there");
    assert.equal(ctx.read("Artist - Song.mp3.ln.mp3"), "PARTIAL");
    assert.equal(ctx.lines("download_history.jsonl").length, 0);
  });
});

// ---- the renderer half: texts and the queue-row contract ---------------------------------------------------
function cutBlock(src, startMarker, open = "{", close = "}") {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `renderer.js has ${startMarker}`);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === open) depth++; else if (src[i] === close && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const I18N = vm.runInNewContext("(" + cutBlock(RENDERER, "const I18N = ").replace(/^const I18N = /, "") + ")");
function normWarnTextIn(lang) {
  const ctx = vm.createContext({ I18N, LANG: lang });
  vm.runInContext("function t(k) { return (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k; }\n" + cutBlock(RENDERER, "function normWarnText("), ctx);
  return ctx.normWarnText;
}
function canceledNoteIn(lang) {
  const ctx = vm.createContext({ I18N, LANG: lang });
  vm.runInContext("function t(k) { return (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k; }\n" + cutBlock(RENDERER, "function canceledNote("), ctx);
  return ctx.canceledNote;
}

test("renderer texts: every warning string exists in Spanish and English, and the sentence names count, total and reason", T, () => {
  for (const k of ["norm_warn", "norm_warn_in", "norm_reason_measure", "norm_reason_apply", "norm_reason_replace", "norm_reason_error", "norm_reason_true_peak", "norm_reason_target_miss", "norm_miss", "tag_warn", "q_canceled_kept", "q_canceled_partial", "q_canceled_all"]) {
    for (const lang of ["es", "en"]) assert.ok(I18N[lang][k] && I18N[lang][k].length > 10, `${lang}.${k}`);
  }
  const en = normWarnTextIn("en"), es = normWarnTextIn("es");
  const w = { total: 3, failed: [{ file: "/m/a.mp3", reason: "apply" }, { file: "/m/b.mp3", reason: "replace" }, { file: "/m/c.mp3", reason: "apply" }] };
  assert.equal(en(w), "⚠ Downloaded, but NOT normalized: 3 of 3 file(s) kept at their original loudness (ffmpeg couldn't apply the correction; couldn't replace the file).");
  assert.match(es(w), /SIN normalizar: 3 de 3 archivo\(s\)/);
  assert.match(en({ total: 1, failed: [{ file: "x", reason: "something-new" }] }), /unexpected error/, "an unknown reason falls back to the generic text");
  for (const bad of [null, undefined, {}, { failed: [] }, { failed: "x" }]) assert.equal(en(bad), "", "no warning text without failures");
});

test("renderer canceledNote: none / some / all normalized, no kept file, and an older result without per-file data", T, () => {
  const en = canceledNoteIn("en"), es = canceledNoteIn("es");
  assert.equal(en({ canceled: true }), "", "nothing kept: the plain 'cancelled' text applies");
  assert.equal(en({ keptFiles: [] }), "");
  assert.equal(en({ keptFiles: ["a"] }), EN_KEPT, "no per-file data: only the safe claim is made");
  assert.equal(en({ keptFiles: ["a", "b", "c"], normalizedFiles: ["a", "b"] }),
    "Cancelled while normalizing — 2 of 3 file(s) were already normalized and kept; the rest were kept, not normalized. ↻ to retry");
  assert.equal(es({ keptFiles: ["a", "b", "c"], normalizedFiles: ["a", "b"] }),
    "Cancelada al normalizar — 2 de 3 archivo(s) ya estaban normalizados y se conservaron; los demás se conservaron sin normalizar. ↻ para reintentar");
  assert.equal(en({ keptFiles: ["a", "b"], normalizedFiles: ["a", "b"] }), "Cancelled — all 2 file(s) were already normalized and kept. ↻ to retry");
  assert.equal(es({ keptFiles: ["a", "b"], normalizedFiles: ["a", "b"] }), "Cancelada — los 2 archivo(s) ya estaban normalizados y se conservaron. ↻ para reintentar");
});

test("renderer contract (source guard): a warning keeps the row 'done' with the warning as its note; cancel with kept files has its own note; the message uses the warn style", T, () => {
  const html = fs.readFileSync(path.join(APP, "renderer", "index.html"), "utf8");
  assert.match(html, /#msg\.warn\{color:#f5a623\}/);
  assert.match(RENDERER, /const normWarn = r\.ok \? \[normWarnText\(r\.normalizeWarning\), tagWarnText\(r\.tagWarning\)\]/);
  assert.match(RENDERER, /status = "done";[^\n]*\n[^\n]*\n\s*if \(normWarn\) note = normWarn;/);
  assert.match(RENDERER, /note = canceledNote\(r\) \|\| t\("q_canceled"\);/);
  assert.match(RENDERER, /msg\.textContent = canceledNote\(r\) \|\| t\("canceled_msg"\);/);
  assert.match(RENDERER, /status === "done" && normWarn\) \{\s*msg\.className = "warn";/);
  assert.match(RENDERER, /msg\.className = "warn";\s*msg\.textContent = warn \+ " "/);   // the single-download path (runDownload)
});

test("queue persistence: a 'done' row keeps its warning note after a reload, so it is still visible in the Queue tab", T, async () => {
  const h = makeHarness();
  try {
    const { items } = await h.invoke("queue-add", [{ url: "https://example.com/v", format: "audio:mp3" }]);
    await h.invoke("queue-update-item", { id: items[0].id, status: "done", title: "Artist - Song.mp3", error: null, note: "⚠ Downloaded, but NOT normalized" });
    const row = (await h.invoke("queue-get")).find(i => i.id === items[0].id);
    assert.equal(row.status, "done");
    assert.equal(row.error, null);
    assert.equal(row.note, "⚠ Downloaded, but NOT normalized");
  } finally { h.close(); }
});
