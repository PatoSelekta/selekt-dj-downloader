# Phase 1 Reliability / Audio Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (tasks share `app/main.js`; not independent — do not parallelize with subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make downloads restart-safe and audio-safe: one main-owned queue runner, atomic persistence, actionable errors with visible cookie/engine retries, copy-when-source-matches, loudnorm I/TP gate keeping the original until validated, and SHA-256-verified yt-dlp with rollback.

**Architecture:** Keep `queue.json` a JSON array and `config.json` additive. Move the sequential runner from `renderer.js` into `main.js`. Renderer only dispatches `queue-start` / pause / stop-all and renders events. Tests must invoke the production IPC runner (`queue-start`), not a duplicated `runQueueLikeRenderer` loop.

**Tech Stack:** Electron 44 main/renderer, Node `node:test` + `h3-harness.js` stubs, ffmpeg/ffprobe/yt-dlp spawned by main (stubbed in unit tests; real ffmpeg optional for generated-tone gate check).

## Global Constraints

- Phase 1 only: no presets, filename preview, fingerprint review sheet, a11y redesign, packaging, Intel, signing, True Peak limiter, `fpcalc` bundling, `main.js` module split.
- Fingerprint stays flag-only (`offerId` null in queue mode). Do not wire Delete-new.
- `queue.json` stays a JSON array. Non-array file → treat as empty. Additive optional fields only.
- Absent `config.json` keys keep today's defaults (MP3 / 320 / Normalize on / −14). Write `audio_format` / `audio_bitrate` only after the user changes them.
- Copy when source already matches unless Normalize is on or container/codec differs. Keep −9 LUFS; report measured miss; no limiter.
- No copyrighted media, no user cookies, no real GitHub in unit tests.
- Mac packaging/runtime is untested (user Mac offline). Do not claim it.
- Preserve installed app. Do not merge/release/deploy/install.
- Existing 193 tests must still pass after each task (update tests that document replaced behavior).
- TDD: failing test first, watch it fail, then minimal production code.
- `runQueueLikeRenderer` in harnesses must become a thin `queue-start` caller of **production** main, not a copy of renderer logic.

---

## File map

| File | Role this phase |
|---|---|
| `app/main.js` | Atomic writes, `errorInfo`, retry progress, SHA-256 engine, dest_unmounted, encode plan, loudnorm gate, tag warning, queue runner IPC |
| `app/preload.js` | `queueStart`, `queuePause`, `queueStopAll`, `queueStatus`, `setAudioFormat`, `setAudioBitrate`, `onQueueIdle` |
| `app/renderer/renderer.js` | Dispatch-only runner; persist format/bitrate; show retry/errorCode/tagWarning; keep fingerprint flag path |
| `app/renderer/index.html` | No layout redesign. Optional: show `#msg` retry text via existing `aria-live` |
| `app/renderer/destination.js` | Unchanged; main `require`s it for destId parsing |
| `app/test/h3-harness.js` | `runQueueLikeRenderer` → `invoke("queue-start")` and wait for drain |
| `app/test/h2-url-validation.test.js` | Same: local helper must call production runner |
| `app/test/p1-*.test.js` | New Phase 1 tests |
| `app/test/h4-engine-reliability.test.js` | Serve SHA2-256SUMS; mismatch/rollback cases |
| `app/test/favorite-unplugged-drive.test.js` | Writable-parent case becomes dest_unmounted |
| `app/test/defaults.test.js` | Remembered format absent-key + round-trip |
| `app/test/normalize-warning.test.js` | Gate reasons; keep existing failure contract |
| `app/test/h1-queue-identity.test.js` | Reachability guard: renderer queue path no longer calls `api.download` |
| `docs/USER_GUIDE.md`, `README.md` | Accurate Phase 1 behavior; no Intel/signing claims |
| `docs/superpowers/specs/2026-11-05-staged-upgrade-design.md` | Mark approved / Phase 1 in progress |

---

### Task 1: Atomic JSON persistence

**Files:**
- Modify: `app/main.js` (`saveConfig`, `saveQueue`)
- Test: `app/test/p1-atomic-persist.test.js`

**Interfaces:**
- Consumes: existing `CONFIG_FILE`, `QUEUE_FILE`, `DATA_DIR`
- Produces: `writeJsonAtomic(file, value)` — writes UTF-8 JSON with pretty-print 2 spaces to `file.<uuid>.tmp`, `fs.renameSync` onto `file`. `loadQueue()`: if parse result is not an Array, return `[]`.

- [ ] **Step 1: Write the failing test**

Create `app/test/p1-atomic-persist.test.js`:

```javascript
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
      if (dest === qpath) { const e = new Error("simulated rename fail"); e.code = "EIO"; throw e; }
      return real.call(fs, src, dest);
    };
    try {
      await assert.rejects(() => h.invoke("queue-set", [{ id: "new", url: "https://example.com/b", status: "pending" }]));
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
      if (dest === cpath) { const e = new Error("simulated rename fail"); e.code = "EIO"; throw e; }
      return real.call(fs, src, dest);
    };
    try { await assert.rejects(() => h.invoke("set-lang", "es")); }
    finally { fs.renameSync = real; }
    assert.equal(fs.readFileSync(cpath, "utf8"), before);
  } finally { h.close(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test app/test/p1-atomic-persist.test.js`

Expected: FAIL — `queue-set` currently swallows write errors / uses in-place `writeFileSync`, so rename is never called and the reject assertion fails; non-array JSON currently throws or returns the object.

- [ ] **Step 3: Write minimal implementation**

In `app/main.js` replace `saveConfig` / `saveQueue` with:

```javascript
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}
function saveConfig(cfg) { writeJsonAtomic(CONFIG_FILE, cfg); }
function saveQueue(q) { writeJsonAtomic(QUEUE_FILE, Array.isArray(q) ? q : []); }
function loadQueue() {
  try {
    const v = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
```

`queue-set` / `queue-update-item` / `queue-clear` currently return `{ ok: true }` even on throw. Let the throw surface (harness invoke rejects). Wrap `queue-set` so a throw rejects the IPC promise (default).

- [ ] **Step 4: Run the tests and the full suite**

Run: `node --test app/test/p1-atomic-persist.test.js app/test/*.test.js`

Expected: new tests PASS; 193 existing still PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main.js app/test/p1-atomic-persist.test.js
git commit -m "fix: atomic config/queue writes; reject non-array queue.json"
```

---

### Task 2: Actionable errors and visible cookie/engine retries

**Files:**
- Modify: `app/main.js` (`runYtdlp`, `ytdlpJson`, download catch)
- Modify: `app/renderer/renderer.js` (progress handler: show `phase === "retry"` / `"engine-update"` on `#dlActivePhase` and `#msg`)
- Test: `app/test/p1-errors-retries.test.js`

**Interfaces:**
- Produces: `errorInfo(msg) → { code, needsCookies, retryKind }`
  - `cookies_store` — cookie DB unreadable
  - `cookies_needed` — `isCookieError`
  - `engine_stale` — `isStaleEngineError`
  - `unsupported_url` — `/unsupported url/i`
  - `network` — `/timed out|connection lost|econnreset|enotfound/i`
  - `unknown` — else
- Download failure return: `{ ok:false, error, errorCode, needsCookies, retryKind }`
- Before cookie-less retry, `onProgress({ phase: "retry", reason: "cookies_store" })` and `status("Retrying without browser cookies…")`.
- Before engine retry, existing status plus `onProgress({ phase: "engine-update", reason: "engine_stale" })`.
- `ytdlpJson` cookie retry also emits setup-status `Retrying without browser cookies…` (info probe has no download-progress).

- [ ] **Step 1: Write the failing test**

```javascript
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
    assert.ok(phases.some((p) => p && p.phase === "retry" && p.reason === "cookies_store"));
    assert.ok(h.sent.some((s) => s[0] === "setup-status" && /without browser cookies/i.test(s[1])));
  } finally { h.close(); }
});

test("sign-in error after cookie retry returns errorCode cookies_needed (not a silent second mystery fail)", T, async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test app/test/p1-errors-retries.test.js`

Expected: FAIL — retry exists but no `download-progress` `{ phase: "retry" }`; failure has `needsCookies` but no `errorCode`.

- [ ] **Step 3: Minimal implementation**

Add `errorInfo` next to `isCookieError`. In `runYtdlp` cookie-store branch, emit progress then recurse. In download `catch`, attach `errorCode` / `retryKind`.

Renderer `api.onProgress`: if `p.phase === "retry"` set `$("dlActivePhase")` / `$("msg")` to a new i18n key `retry_no_cookies` (ES+EN). Do not redesign layout.

- [ ] **Step 4: Run tests**

`node --test app/test/p1-errors-retries.test.js app/test/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main.js app/preload.js app/renderer/renderer.js app/test/p1-errors-retries.test.js
git commit -m "feat: visible cookie/engine retries and stable error codes"
```

---

### Task 3: Verified yt-dlp download with SHA-256 and rollback

**Files:**
- Modify: `app/main.js` (`ytdlpAssetName`, `downloadYtdlp`, `forceUpdateYtdlp`)
- Modify: `app/test/h4-engine-reliability.test.js` (fake net must serve sums)
- Test: additional cases in `app/test/p1-engine-verify.test.js` or h4

**Interfaces:**
- `ytdlpAssetName()`: win `yt-dlp.exe`; darwin `yt-dlp_macos`; linux `process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux"`
- `downloadYtdlp()`: `tag = await latestYtdlpTag()`; GET `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/SHA2-256SUMS` via `downloadTo` to a temp; parse 64-hex + filename line for `ytdlpAssetName()`; GET the asset for that **same tag** (not `/latest/download/`); hash with `createHash("sha256")`; if mismatch, unlink part, throw `Checksum mismatch`; if current binary exists, `renameSync(current, current + ".bak")` then rename part into place; chmod 0755 non-win.
- Sums file missing (HTTP 404): fall back to size-floor install from `/releases/download/${tag}/${asset}` **only if tag is known**. If sums **present** and mismatch: **do not** install.
- Hash/version failure after replace: restore `.bak` if present.
- `const { randomUUID, createHash } = require("crypto");`
- Update h4 `downloadTo` caller-count guard: definition + sums + binary (3).

- [ ] **Step 1: Write failing tests**

In `app/test/p1-engine-verify.test.js`, using h4's net pattern (copy `makeNet`/`serve`/`BODY`/`firstInstall` locally or extract later — **copy the helpers into this file** so h4 stays readable; do not invent a second downloader):

1. Matching SHA-256 installs BODY and writes `.ytdlp_variant`.
2. Wrong SHA-256: `ensure-setup` `{ ok:false, error: /Checksum mismatch/ }`, no yt-dlp file, no `.bak` clobber of a previous good binary (old bytes stay).
3. Good update: previous bytes land in `yt-dlp.bak` (or `yt-dlp.exe.bak`).
4. `ytdlpAssetName` source guard: linux arm64 string present in `main.js`.

Also update `h4-engine-reliability.test.js` `net.handler` so GET of `SHA2-256SUMS` returns `createHash("sha256").update(BODY).digest("hex") + "  " + ASSET + "\n"`, and binary GET still `serve(c)`. HEAD latest already returns `net.latest` — first-install must set `net.latest = "2099.01.01"` or `latestYtdlpTag` is null.

If tag is null, first install should fail with a clear error (`Could not determine yt-dlp release`), not fetch `/latest/download/` unverified. **Update h4 tests** that assumed one GET.

- [ ] **Step 2: Run to verify fail**

`node --test app/test/p1-engine-verify.test.js app/test/h4-engine-reliability.test.js`

Expected: FAIL checksum tests; h4 first-install may still pass until downloadYtdlp changes — write p1 tests first, watch them fail, then implement, then fix h4.

- [ ] **Step 3: Implement downloadYtdlp verification**

Parse sums with:

```javascript
function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function parseSha256Sums(text, asset) {
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
    if (m && m[2] === asset) return m[1].toLowerCase();
  }
  return null;
}
```

- [ ] **Step 4: Run h4 + p1 + full suite**

Expected: all PASS. Do not claim GitHub authenticity beyond “bytes match published SHA2-256SUMS”.

- [ ] **Step 5: Commit**

```bash
git add app/main.js app/test/p1-engine-verify.test.js app/test/h4-engine-reliability.test.js
git commit -m "feat: verify yt-dlp SHA-256 and keep previous binary for rollback"
```

---

### Task 4: Destination unmounted safeguard

**Files:**
- Modify: `app/main.js` (`resolveDestination` or download `mkdirSync`)
- Modify: `app/test/favorite-unplugged-drive.test.js` (writable-parent case)
- Test: same file + `app/test/p1-dest-unmounted.test.js` if needed

**Interfaces:**
- `parentExists(dir)`: `fs.existsSync(path.dirname(dir))`.
- Favorite `targetPath`: if path does not exist **and** parent does not exist → `{ ok:false, error, errorCode:"dest_unmounted" }` **before** `mkdirSync`. Zero yt-dlp, zero mkdir of the missing chain.
- If parent exists, leaf mkdir remains allowed (deleted folder on a still-mounted volume / new subfolder).
- `mkdir` EACCES/EPERM on a favorite maps to `dest_unmounted` (do not throw raw).

- [ ] **Step 1: Change the existing “EXISTING BEHAVIOR” test to the new contract** (this is the failing test):

Replace the writable-parent test body so `r.ok === false`, `r.errorCode === "dest_unmounted"`, `fs.existsSync(path.join(mountRoot,"USB")) === false`, `h.ytdlpCalls().length === 0`.

Add: subfolder under main (parent exists) still creates. Registered favorite whose leaf is missing but parent exists still creates.

- [ ] **Step 2: Run `node --test app/test/favorite-unplugged-drive.test.js`**

Expected: FAIL on the old “silently re-creates” assertion until production changes.

- [ ] **Step 3: Implement check in `download` after `resolveDestination`, before `mkdirSync`:**

```javascript
function missingMountChain(dir) {
  return !entryExists(dir) && !entryExists(path.dirname(dir));
}
```

If `opts.targetPath` and `missingMountChain(dest.dir)` return `{ ok:false, error:"That folder is on a drive that is not available. Reconnect it or choose another.", errorCode:"dest_unmounted" }`.

Catch mkdir EACCES/EPERM → same code.

- [ ] **Step 4: Full suite**

- [ ] **Step 5: Commit** `fix: refuse downloads into unmounted favorite paths`

---

### Task 5: Remember format and bitrate

**Files:**
- Modify: `app/main.js` (`get-settings`, `set-audio-format`, `set-audio-bitrate`)
- Modify: `app/preload.js`
- Modify: `app/renderer/renderer.js` (`refreshSettings`, format/bitrate change handlers)
- Modify: `app/test/defaults.test.js`

**Interfaces:**
- Config keys `audio_format` (`mp3|m4a|wav|flac` or video values not stored — store the `#format` value string `audio:mp3` / `video:1080` as `audio_format` is misleading). **Store `format` as `ui_format` and `audio_bitrate`.** Spec said `audio_format, audio_bitrate`. Use those names: `audio_format` holds the full select value (`audio:mp3`, `video:original`, …) so video choices persist too. Bitrate only written for lossy audio.
- `get-settings` returns `ui_format: cfg.audio_format || null`, `audio_bitrate: cfg.audio_bitrate || null` (null = never saved). Also return resolved display defaults without writing them.
- IPC `set-audio-format(v)` validates against allowed select values; `set-audio-bitrate` against `128|192|320`.
- Renderer: on load, if `s.ui_format` (or `s.audio_format`) set `#format`; if bitrate set `#bitrate`. On change, invoke setters.
- `get-settings` must **not** insert keys into config.

Allowed format values: `audio:mp3|audio:m4a|audio:wav|audio:flac|video:original|video:1080|video:720|video:best`.

- [ ] **Step 1: Tests in defaults.test.js**

```javascript
test("absent audio_format/audio_bitrate: get-settings reports null saved keys; Download tab defaults stay MP3/320", ...);
test("set-audio-format + set-audio-bitrate round-trip in config.json and get-settings", ...);
test("get-settings does not write audio_format into an empty config", ...);
```

- [ ] **Step 2: Run, expect FAIL (no IPC)**

- [ ] **Step 3: Implement IPC + renderer apply/save**

- [ ] **Step 4: Suite**

- [ ] **Step 5: Commit** `feat: persist last format and bitrate after the user changes them`

---

### Task 6: Encode plan — copy when source matches

**Files:**
- Modify: `app/main.js` (`planEncode`, download args)
- Test: `app/test/p1-encode-plan.test.js`
- Modify: `app/renderer/renderer.js` — upsample confirm for MP3/M4A as well as WAV/FLAC when `lastProbe.sourceAbr < chosen bitrate` (existing confirm helper). Minimal: extend the existing lossless confirm to lossy too (same dialog text key `lossless_warn` generalized to `quality_warn`). **Keep it a `confirm()` — no UI redesign.**

**Interfaces:**
- `planEncode({ audioFormat, bitrate, loudnorm, sourceAcodec, sourceAbr })` → `{ mode: "copy"|"convert", upsampleWarn: boolean, sourceAcodec, sourceAbr, targetFormat, targetBitrate }`
- `mode === "copy"` iff: audio request, loudnorm off, codec family matches format (`mp3`/`mp3`; `m4a`/`aac`; `wav`/`pcm`; `flac`/`flac`), and `sourceAbr >= bitrate` (lossless ignore bitrate, always copy if codec matches).
- Download: if copy, do **not** pass `--audio-quality ${bitrate}K`. Still `-x --audio-format`. If convert, keep today's args.
- Result includes `encodePlan`. Queue runner will persist it on the item (Task 8).
- Normalize on → always `convert`.

- [ ] **Step 1: Tests**

```javascript
test("Normalize off + mp3 source abr 320 + target mp3/320: yt-dlp has no --audio-quality; no libmp3lame spawn");
test("Normalize on: --audio-quality present and loudnorm re-encode (libmp3lame) still runs");
test("opus source to mp3: convert even if Normalize off");
test("source abr 128 to mp3 320: convert + encodePlan.upsampleWarn true");
```

Stub probe JSON `formats: [{ acodec:"mp3", abr:320, vcodec:"none" }]`.

- [ ] **Step 2: Fail (always --audio-quality 320K)**

- [ ] **Step 3: Implement planEncode; use it in download**

- [ ] **Step 4: Suite**

- [ ] **Step 5: Commit** `feat: copy matching audio; warn when the source bitrate is lower`

---

### Task 7: Loudnorm I/TP gate and visible auto-tag failure

**Files:**
- Modify: `app/main.js` (`loudnormTwoPass`, tagging loop)
- Modify: `app/renderer/renderer.js` (`normWarnText` for new reasons; tag warning)
- Test: `app/test/p1-loudnorm-gate.test.js` plus existing `normalize-warning.test.js` (extend script to handle a third ffmpeg measure on `.ln.` tmp)

**Interfaces:**
- After pass 2 writes non-empty tmp, **before rename**: spawn ffmpeg measure on tmp (`-af loudnorm=...print_format=json -f null -`). Parse `input_i`, `input_tp`.
- Let `I = Number(measOut.input_i)`, `TP = Number(measOut.input_tp)`, `target = I_target`.
- If `TP > -1.0` → delete tmp, `{ ok:false, reason:"true_peak", outputI, outputTp }` (original bytes unchanged).
- Else rename tmp over file. If `Math.abs(I - target) > 1.0` → `{ ok:true, miss:true, reason:"target_miss", outputI, outputTp }` so caller sets `normalizeWarning` **and** the file **is** the processed audio (honest −9 miss, no limiter).
- If both within gate: `{ ok:true }` no warning.
- If measure-on-tmp fails: treat as `apply` failure, keep original (safer).
- `tagAudioFile` failure (`ok === false` / `error`) → `tagWarning: { failed: n, total }` on download result. Renderer amber text `tag_warn`. WAV skip is not a failure.

Existing tests: pass2 success currently returns no warning. After gate, the stub must answer a **third** ffmpeg `null` measure on the tmp. Update `makeScript` in `normalize-warning.test.js`: any `null` sink after pass2 writes MEASURE with `input_i:-14, input_tp:-10` so success tests still pass.

New tests:
- tmp measure `input_tp: 0.0` → original kept, reason `true_peak`
- tmp measure `input_i: -12.9, input_tp: -1.5` with target -9 → file is NORMALIZED, warning `target_miss`
- tag ffmpeg exit 1 → `tagWarning` present, file still kept

- [ ] **Step 1: Write p1-loudnorm-gate tests; update normalize-warning harness so existing success still has a passing tmp-measure** — if you update the harness first without gate code, extra ffmpeg calls may already happen… **Order:** add p1 tests (fail: no true_peak reason). Then implement gate. Then fix normalize-warning stub for the extra measure.

- [ ] **Step 2: Watch p1 tests fail**

- [ ] **Step 3: Implement gate + tagWarning**

- [ ] **Step 4: `node --test app/test/normalize-warning.test.js app/test/p1-loudnorm-gate.test.js app/test/*.test.js`**

- [ ] **Step 5: Commit** `feat: validate loudnorm true peak before swap; report tag failures`

Optional: if `ffmpeg` exists on PATH, add `app/test/p1-loudnorm-gate.ffmpeg.test.js` that writes a generated sine with `ffmpeg` and runs `loudnormTwoPass` via harness with **real** ffmpeg by not stubbing that spawn — only if it does not break isolation. If too invasive, skip and note “generated ffmpeg check not wired; stubs cover gate”. Prefer a small script in the test that calls system ffmpeg to produce JSON numbers documenting the gate math, skipped when ffmpeg missing (`test(..., { skip: !ffmpeg })`).

---

### Task 8: Main-owned sequential queue runner

**Files:**
- Modify: `app/main.js` (runner loop, IPC)
- Modify: `app/preload.js`
- Modify: `app/renderer/renderer.js` (`runQueue` becomes dispatch; pause/stop/clear)
- Modify: `app/test/h3-harness.js` `runQueueLikeRenderer`
- Modify: `app/test/h2-url-validation.test.js` local runner
- Modify: `app/test/h1-queue-identity.test.js` reachability guard
- Test: `app/test/p1-queue-runner.test.js`

**Interfaces:**
- `queueItemToDownloadOpts(item)` in **main**, using `require("./renderer/destination.js")`.
- IPC:
  - `queue-start` → start loop if idle; return `{ ok:true, running:true }` immediately
  - `queue-pause` → `{ paused:true }` current item continues
  - `queue-stop-all` → set flag + `cancelRequested` + kill child
  - `queue-status` → `{ running, paused, currentId }`
  - `queue-clear` → if running, cancel then `saveQueue([])`
- Loop: skip while paused (sleep 200ms); take first `pending`; mark `running`; `queue-changed`; call existing `download` handler with `_inQueue:true`, `_queueId:item.id`; patch item with status, error, errorCode, note, files, outputDir, encodePlan, normalize, progress cleared; next.
- `did-finish-load`: if `queueRunner.running` leave `running` items; else reset `running`→`pending` (app restart).
- Renderer: `runQueue` → `api.queueStart()`; `queueRunning` derived from `queue-status` / events. `onQueueChanged` re-renders. Do **not** call `api.download` from the queue path.
- `onQueueRun` watch-autorun: renderer calls `queueStart` (same as today calling `runQueue`).
- Persist additive fields on the item when done: `files`, `outputDir`, `errorCode`, `encodePlan`, `normalize`.
- Fingerprint path unchanged (`_inQueue` still true).

- [ ] **Step 1: Tests in p1-queue-runner.test.js using REAL `queue-start`:**

```javascript
test("queue-start runs pending items via production download; 1.1.0 array shape still works");
test("renderer reload (did-finish-load) while running does not duplicate spawn and does not reset the active item to pending");
test("app-start with no runner resets stale running → pending");
test("pause: second item does not start until unpaused");
test("stop-all cancels current and marks remaining pending as canceled");
test("clear while running cancels child and empties the array");
test("invalid destId fails the item with dest_bad and never calls yt-dlp");
test("watch-queued MP3/320 item runs through production runner");
```

For reload: `withWindow:true`, start a download that waits (child not closed until test allows). Fire `did-finish-load`. Assert one `-o` spawn, item still `running`.

Harness `fakeChild` currently closes immediately. **Extend h3-harness** with `setScript` returning `{ hang: true }` that does not emit `close` until `h.releaseHang()`. This is required to test reload-during-run. Implement hang support in the **test harness only**.

- [ ] **Step 2: Run p1-queue-runner — FAIL (no queue-start)**

- [ ] **Step 3: Implement runner + harness hang + replace `runQueueLikeRenderer`:**

```javascript
async function runQueueLikeRenderer(h) {
  await h.invoke("queue-start");
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const st = await h.invoke("queue-status");
    if (!st.running) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail("queue did not drain");
}
```

Update h1 reachability: `await api.download` count is **1** (runDownload only). `_inQueue: true` appears in **main.js**. Keep `runDownload`/`dupForce` cycle as dead path.

- [ ] **Step 4: Full suite including h2, h3-destinations, watch-destination, h3-corrections**

- [ ] **Step 5: Commit** `feat: run the download queue in the main process`

---

### Task 9: Docs, guide, spec status, remaining evidence

**Files:**
- Modify: `docs/USER_GUIDE.md` (engine checksum; dest unmounted; remembered format; visible cookie retry; loudnorm gate; queue survives window reload)
- Modify: `README.md` (Phase 1 note; test count; checksum now exists — do not claim authenticity beyond SHA2-256SUMS)
- Modify: `docs/superpowers/specs/2026-11-05-staged-upgrade-design.md` status: approved, Phase 1 implemented
- Modify: `THIRD_PARTY_INVENTORY.md` (checksum now performed; still not a signature)
- Test: run full `node --test app/test/*.test.js`; if Electron present, `a11y-check.electron.js`; if ffmpeg present, optional generated-tone measure

- [ ] **Step 1: Update docs to match implemented behavior only**

- [ ] **Step 2: Run full tests; record counts**

- [ ] **Step 3: Commit** `docs: record Phase 1 reliability and audio-safety behavior`

- [ ] **Step 4: Push branch and update PR body with evidence and limitations**

Do not merge.

---

## Self-review (plan vs spec)

| Spec § | Task |
|---|---|
| 5.1 errorInfo + progress extras | Task 2 |
| 5.1 queue runner + atomic save | Tasks 8, 1 |
| 5.1 encode plan | Task 6 |
| 5.1 loudnorm gate | Task 7 |
| 5.1 engine verify | Task 3 |
| 5.3 queue array / additive fields | Tasks 1, 8 |
| 5.3 remembered format | Task 5 |
| 5.4 copy/convert | Task 6 |
| 5.5 I/TP gate, no limiter | Task 7 |
| 5.6 SHA-256 + bak + linux arch | Task 3 |
| 5.7 dest_unmounted | Task 4 |
| 5.8 fingerprint flag-only | Task 8 (do not change offers) |
| 7.2 acceptance 1–14 | Tasks 2,3,1,8,4,7,6,5,9 |
| Production runner not a mock loop | Task 8 harness change |
| Out of scope phases 2–5 | No tasks |

Placeholders: none. Signatures: `errorCode`, `dest_unmounted`, `planEncode`, `queue-start` used consistently.

Deviation vs spec 5.5: I-miss with safe TP **swaps and warns** (`target_miss`) so −9 is honest rather than always retaining the original. TP > −1.0 never swaps. Matches approved “honest measured miss”.
