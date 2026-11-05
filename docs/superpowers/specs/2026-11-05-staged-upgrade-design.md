# Selekt DJ Downloader — staged upgrade design

**Status:** design approved; **Phase 1 implemented** on `cursor/staged-upgrade-design-a99c`. Phases 2–5 not started. Do not merge/release/deploy/install from this pass.

**Source verified:** git `b4b8283` = `origin/main` at design time. App version `1.1.0`, Electron `^44.10.2` (lockfile 44.10.2). Installed Mac app is **not** on this Linux VM and was **not** re-tested (user Mac offline).

**This-VM checks (2026-11-05, after Phase 1):** `uname -m` = `x86_64`; Node `v22.23.4`; `node --test --test-concurrency=1 app/test/*.test.js` → **228/228 pass**. Electron is not installed in this workspace (`app/node_modules` absent), so `app/test-browser/a11y-check.electron.js` and any `electron-builder` packaging were **not** run. ffmpeg 6.1.1 present; one generated 1 s sine measured for loudnorm JSON parseability. No copyrighted media and no user cookies.

---

## 1. Bounded / unbounded

The full request (errors, queue, codec honesty, loudnorm validation, fingerprint review, presets, engine verify/rollback, packaging, Intel, accessibility) is **unbounded as one implementation**.

**Phase 1 (this design’s first slice) is bounded:** reliability + audio safety only, additive settings/queue fields, no UI redesign, no signing, no packaging rewrite.

Later phases: UX (2), duplicate handling (3), accessibility (4), packaging/Intel (5).

---

## 2. Verified architecture (independent of prior notes)

```
renderer (index.html + renderer.js)
    ↕ preload.js contextBridge `window.api`
main.js  (single process file, 1871 lines)
    ↕ spawn
yt-dlp (userData/bin, downloaded) + ffmpeg/ffprobe (copied from npm static packages)
```

| Path | Role |
|---|---|
| `app/main.js` | Binaries, yt-dlp spawn, IPC, destinations, history, queue **storage**, watch folder, fingerprint, tagging, two-pass loudnorm, download pipeline |
| `app/preload.js` | IPC bridge (69 lines) |
| `app/renderer/index.html` | Window, CSS, Spanish default markup |
| `app/renderer/renderer.js` | UI, i18n ES/EN, **queue runner**, preview, progress |
| `app/renderer/destination.js` | `destId` → `{ folder \| targetPath \| destInvalid }` |
| `app/renderer/history-time.js` | UTC → local display |
| `app/test/*.test.js` | Node unit tests via `h3-harness.js` (stubs Electron, spawn, https) |
| `app/test-browser/` | Optional Electron a11y + fingerprint-lifecycle browser checks |

**Data (Electron `userData`):** `config.json`, `queue.json`, `download_history.jsonl`, `downloaded_index.jsonl`, `watch_processed.log`, `fingerprints.jsonl`, `bin/{yt-dlp,ffmpeg,ffprobe}`.

**Queue is persisted; the runner is not.** `runQueue()` lives in `renderer.js` (~1944). Main only `loadQueue`/`saveQueue` (`main.js` 317–347). On `did-finish-load`, `status === "running"` is reset to `"pending"` (1197–1201). Resume banner is renderer-init only.

**Every Download press goes through the queue** (`$("go").onclick` → `queueAdd` + `runQueue`, `renderer.js` 1480–1533) with `_inQueue: true`. `runDownload()` is only reachable from `dupForce`, which itself is only reachable from `runDownload` (`h1-queue-identity.test.js` reachability guard). So the fingerprint Keep-both / Delete-new dock (`#fpDupWarning`) **cannot appear in normal use**.

**Format/bitrate reset is deliberate** (`main.js` 60–62; `defaults.test.js`; HTML selected `audio:mp3` / `320`). Loudnorm / LUFS / auto-tag / avoid-duplicates **are** persisted once changed.

**yt-dlp refresh is daily, not weekly** (`maybeRefreshYtdlp`, `ONE_DAY`, `main.js` 863–886). First install + stale-engine retry have size/HTTPS/stall limits. **No checksum or signature.** `copyBinary` copies ffmpeg/ffprobe **only if missing** (642–648), so they never refresh.

**Cookie-store failure already retries once without cookies** (`runYtdlp` 1020–1021, `ytdlpJson` 1078–1079) with **no UI event**. Final sign-in failures set `needsCookies` (`1867`) and show `cookies_hint`.

**Audio path always asks yt-dlp to extract/convert:** `-x --audio-format <fmt> --audio-quality <bitrate>K` (1728–1729). Preview `sourceAbr`/`sourceAcodec` come from the **best audio-only** yt-dlp format (`probeInfo` 1464–1475), not necessarily the stream that is downloaded. WAV/FLAC from `< 320 kbps` gets a confirm; MP3 320 from a ~128 kbps source does not.

**Loudnorm** (`loudnormTwoPass` 1601–1658): two-pass `I=<target>:TP=-1.5:LRA=11:linear=true`; original kept until a non-empty temp is renamed over it. Success is “ffmpeg exit 0 + size > 0”, **not** a measured I/TP check. Guide already measured a loud synthetic at −9 LUFS landing **−12.9 / −0.9 dBTP**. Auto-tag failures stay silent (`tagAudioFile` 1564–1585).

**Fingerprint:** Chromaprint `fpcalc`, duration ≥ 60 s, threshold default 0.90. Queue matches only **flag** the row (`fpDup`); they never create a trash offer (`offerId = null` when `_inQueue`, 1842–1843). Settings: main returns `fpcalc_available` (snake) + no `count`; renderer reads `fpcalcAvailable` (camel) and `count` (`renderer.js` 2252–2254). Threshold options are `"0.90"`/`"0.80"`; stored `0.9`/`0.8` do not match. `fingerprintFile` **does** fall back to PATH; the status IPC **does not**.

**Linux engine asset is `yt-dlp_linux` (x86_64).** There is no `aarch64` branch (`ytdlpAssetName` 657–661). macOS uses universal `yt-dlp_macos`.

**Packaging:** `electron-builder` dmg / nsis / AppImage; `files` includes `node_modules/**/*`; `asarUnpack` ffmpeg-static + ffprobe-static. ffmpeg-static is **GPL-3.0-or-later** (`THIRD_PARTY_INVENTORY.md`). No arch matrix, no signing config. README: no installer in this repo; Apple silicon review only.

**A11y already present:** dialog focus trap, chip buttons, many `aria-pressed`/`aria-live` on `#msg`/`#status`, Download `min-height: 54px`, chips `44px`. Gaps: several `min-height: 0` controls (header Change, tabs, Paste, queue selects); folder context menu is pointer/right-click; Cancel/Stop live only on the Download-tab dock; progress bar has no `role="progressbar"`; switches sit below the fold at 980×760; documented smoke-test: accessibility-synthesized click on Download did not queue (cause unconfirmed).

---

## 3. Requested vs actual gaps

| Request | Already in 1.1.0 | Actual gap |
|---|---|---|
| Actionable errors / recovery | Raw yt-dlp tail (up to 1000 chars); some mapped strings; `needsCookies` | No stable `error.code`; retries not classified; no one-click recovery except cookies hint |
| Visible no-cookie retries | Silent retry exists | No progress/status line that a retry without cookies happened |
| Restart-safe queue | `queue.json` + running→pending + Resume banner | Runner is renderer-only; Clear does not cancel the child; `saveQueue` is not atomic; no output path on done rows |
| Accurate progress / destination visibility | `%` / speed / ETA from yt-dlp; dest chips; destId on rows | Dual-stream % can jump; normalize is indeterminate; done rows do not show the real folder path; unplugged favorite can mkdir on disk (`favorite-unplugged-drive.test.js`) |
| Honest source codec/bitrate | Preview line from best audio-only format | Not the downloaded stream; always re-encodes to chosen format; no MP3 upsample warning |
| Avoid unnecessary re-encode | Video “Original” remuxes | Audio always `-x`; loudnorm always re-encodes (required if on) |
| Explicit loudnorm + true peak; original until validated | Original until rename; failure warning; cancel keeps files | No post-measure of I/TP before swap; −9 can miss target and exceed TP; no limiter |
| Fingerprint = review, not certainty | Queue flag; trash only via live offer | Offer UI unreachable (all downloads `_inQueue`); status/threshold bugs; Delete-new exists but dead |
| Presets, remembered format, filename/metadata preview | Dock chips of current choice; format **reset** on launch | No persist; no presets; no output-name / tag preview |
| Verified downloader updates + rollback | HTTPS, size floor, daily version compare, one stale-engine retry, temp+rename for yt-dlp | No SHA-256; no previous-binary rollback; ffmpeg never updates |
| Smaller packaging / Intel | Configured dmg | Whole `node_modules`; static ffmpeg ships other OS/arch; Intel **untested**; universal dmg would be **larger** |
| Keyboard / VoiceOver / large targets | Partial, plus `a11y-check.electron.js` | See §2; Phase 4 |
| Signing / notarization | Ad-hoc on installed app (user); none in repo | Blocked by Apple enrollment. **Out of scope. Do not promise.** |

Corrections vs some prior wording: refresh is **daily**; cookie retry **exists but is silent**; fingerprint dock UI **exists but is unreachable**; format reset is **intentional and tested**.

---

## 4. Approaches

### A — Patch in place (keep renderer queue)

Smallest diff: error codes + visible retry events; loudnorm post-measure; atomic `queue.json`; persist format; flag cookie retries.

- **+** Lowest churn against 193 tests and `h1-queue-identity` source guards.
- **−** Restart-safe queue stays fake (UI gone ⇒ runner gone). Cancel/Stop stay Download-tab-only. Fingerprint review still cannot attach to the live path without more work.

### B — Main-owned pipeline, additive data (recommended)

Move the sequential runner into `main.js` (new IPC: start/pause/stop-all/cancel-current). Renderer becomes a view. Additive queue item fields. Encode policy + loudnorm **validate-then-swap**. Engine SHA-256 + `.bak` rollback. Fingerprint stays **flag-only** in Phase 1 (no delete).

- **+** Matches “restart-safe” and “audio safety”. Window reload does not kill the current item. Errors/retries emit from one place.
- **−** Touches `runQueue`, preload, and several tests that **mirror** the renderer loop (`h3-harness.js` `runQueueLikeRenderer`). Must keep queue.json an **array** so 1.1.0 can still read it.

### C — Split `main.js` into modules + full policy rewrite

Engine / queue / audio / fingerprint packages, new schema wrapper `{ schemaVersion, items }`.

- **+** Cleaner long-term.
- **−** Many tests regex-match `main.js` text. Wrapper object makes 1.1.0 `loadQueue` return `[]` (silent queue wipe on rollback). Too much for Phase 1.

**Recommend B** for Phase 1. Defer C-style splits to a later cleanup **after** Phase 1 tests exist for the runner. Do not wrap `queue.json`.

---

## 5. Phase 1 design (reliability / audio safety)

### 5.1 Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `errorInfo(msg)` in main | Map stderr → `{ code, retry, action, userText }` | existing regexes (`isCookieStoreError`, `isCookieError`, `isStaleEngineError`) |
| `download-progress` extras | `{ phase: "retry"\|"engine-update"\|"normalizing"\|"tagging", reason }` | `runYtdlp` / `loudnormTwoPass` |
| Queue runner in main | One item at a time; persist status; survive renderer reload | `download` handler, `saveQueueAtomic` |
| `saveQueueAtomic` / `saveConfigAtomic` | temp file + `renameSync` | same paths as today |
| Encode plan | After probe + (optional) ffprobe: `copy` vs `convert`; upsample warning flag | `probeInfo`, spawn ffprobe |
| Loudnorm gate | Measure tmp I/TP; swap only if gate passes; else keep original + warning | `loudnormTwoPass` |
| Engine verify | Fetch `SHA2-256SUMS` for the **same** release tag; hash; keep `yt-dlp.bak` | `downloadYtdlp`, `forceUpdateYtdlp` |

**Out of Phase 1:** presets, filename preview, fingerprint Keep-both on queue rows, a11y pass, packaging/Intel, signing, module split, True Peak limiter, `fpcalc` bundling.

### 5.2 Data flow (Phase 1)

1. UI enqueues (unchanged `queue-add` shape).
2. UI calls `queue-start` (or auto-start as today). Main runs items.
3. Each item: validate dest (refuse unplugged/unwritable **before** `mkdir`) → probe → encode plan → yt-dlp → optional loudnorm gate → tag (report failure) → history/index.
4. Cookie-store fail → emit `phase: "retry", reason: "cookies_store"` → one retry without cookies (existing) → if still needs login, `code: "cookies_needed"` + existing hint.
5. Stale-engine fail → existing update+retry, plus keep previous binary as `.bak` and restore if the new file fails hash or `--version`.
6. Progress and queue patches go to renderer; **main is source of truth**.

### 5.3 Backwards-compatible settings and queue

**`queue.json` stays a JSON array.** Unknown fields are ignored by 1.1.0.

Additive **optional** item fields (all omitted on old rows):

```
errorCode, retryKind, files[], outputDir, progress {percent, phase, speed, eta},
encodePlan {mode: "copy"|"convert", sourceCodec, sourceAbr, targetFormat, targetBitrate},
normalize {requested, applied, inputI, inputTp, outputI, outputTp, reason}
```

On load: if file is not an array, treat as empty (do not invent a wrapper). `status: "running"` → `"pending"` still. Do not rewrite old items until they run.

**`config.json` additive keys** (absent = current defaults, same `cfgFlag` rule):

```
audio_format, audio_bitrate     // Phase 1: persist last Download-tab choice after user changes it
```

1.1.0 ignores these keys. Phase 2 may add `preset`. Do **not** persist playlist-on.

**History / downloaded_index / fingerprints:** unchanged format. Optional later history field `encodePlan` — skip in Phase 1.

**Rollback to 1.1.0:** pending items still load; extra fields ignored; remembered format ignored (tab resets). Main-owned runner gone, so user must Resume in 1.1.0. **Not** a wipe.

### 5.4 Encode policy (Phase 1 default — needs approval)

- If Normalize is **on**: convert (loudnorm cannot stream-copy).
- If Normalize is **off** and ffprobe/source container+codec already match the chosen format, and source bitrate ≥ chosen bitrate: **copy** (no second lossy generation).
- If chosen bitrate **>** detected source bitrate: still convert if the user picked a different container; **warn** (MP3/M4A as well as WAV/FLAC) that quality cannot increase.
- Video Original remux path unchanged.

### 5.5 Loudnorm gate (Phase 1)

Keep current two-pass + temp + cancel semantics.

**New:** before `renameSync(tmp, file)`, run a measure on `tmp` (ffmpeg ebur128 or loudnorm JSON). Swap only if:

- Integrated loudness is within **1.0 LU** of target, **or** the miss is explained as “peak-limited / linear mode could not reach target” (honest, especially −9), **and**
- True peak ≤ **−1.0 dBTP** (lossy encoder overshoot vs the −1.5 request).

Otherwise delete tmp, **keep original audio**, existing amber warning plus measured numbers. Do not add a limiter in Phase 1 (that is another encode).

### 5.6 Engine verify / rollback (Phase 1)

- Resolve release tag (already `latestYtdlpTag`).
- Download `SHA2-256SUMS` over HTTPS from that tag (not a third-party mirror).
- Download the platform asset to `.part`; `sha256` must match the **filename line**.
- On success: `rename` current → `yt-dlp.bak`, then part → `yt-dlp`; chmod.
- On hash/size/`--version` failure: delete part; leave current in place; if current was already replaced, restore `.bak`.
- **This proves “bytes match GitHub’s published sum”, not that GitHub is uncompromised.** Do not claim more.
- Pick Linux asset by arch: `yt-dlp_linux` vs `yt-dlp_linux_aarch64`. macOS stays `yt-dlp_macos`.
- ffmpeg/ffprobe refresh is **not** Phase 1 (copy-if-missing stays), noted as a follow-up.

No Apple signing keys, no notarization, no credentials.

### 5.7 Destination safety (Phase 1)

Before `mkdirSync` for a favorite path: if the favorite is marked unavailable / parent not writable (e.g. missing `/Volumes/…`), **fail the item** with `code: "dest_unmounted"` — do not create a look-alike folder on the system disk. Matches the documented unplugged-drive hole.

### 5.8 Fingerprint in Phase 1

Do **not** wire Delete-new. Keep queue ⚑ flag. Optionally persist `fpDup` as today. Fixing camelCase / threshold / PATH status is **Phase 3** (small but UX, not audio-safety). Phase 1 must not make fingerprint **more** destructive.

---

## 6. Later phases (not this slice)

**Phase 2 — UX:** remembered format (if not already enabled in P1), 2–3 named presets (e.g. DJ-MP3-320-norm, Archive-copy, Club-9), filename + tag preview from probe + dest folder, show `outputDir` on running/done rows, Cancel/Stop on Queue tab (easy once runner is in main).

**Phase 3 — duplicates:** fix `fpcalc_available` vs `fpcalcAvailable`, `count`, option `"0.90"` vs `0.9`, PATH in status; **review sheet on the flagged row** (Keep both default, Reveal original, optional trash of **new** file using the existing offer machinery). Never auto-delete. Playlists still skipped unless explicitly designed later.

**Phase 4 — accessibility (head mouse + mouth switch + dictation):** 44px minimum on **all** actionable controls; keyboard map (Download, Cancel, tabs, Resume); progress `role="progressbar"` + polite live percent; folder actions without right-click; focus-visible on dock Download (investigate smoke-test miss); VoiceOver labels on queue status icons; keep switches above the fold or move them into the dock. Re-run `a11y-check.electron.js`.

**Phase 5 — packaging:** shrink `build.files` (do not ship entire `node_modules`); prune foreign ffmpeg-static binaries; optional **Intel x64 dmg as a separate untested extra**, not a universal fat binary by default (fat would fight “smaller”). GPL ffmpeg redistribution still **unresolved**. Signing/notarization **out of scope** until Apple enrollment exists.

---

## 7. Tests and acceptance

### 7.1 What exists (confirmed this VM)

| Command | Result |
|---|---|
| `node --test app/test/*.test.js` | 193/193 pass (Linux x86_64, Node 22.23.4) |
| `app/test-browser/a11y-check.electron.js` | Needs Electron; **not run** here |
| `app/test-browser/fp-dup-lifecycle.browser.js` | Needs a browser runner; **not run** here |
| Real yt-dlp / packaged app / Intel / signed build | **Not in this environment** |

Harness: `app/test/h3-harness.js` loads **real** `main.js` with stubbed `electron`, `child_process`, `https`, static binaries. `normalize-warning.test.js` (22) and `h4-engine-reliability.test.js` (16) are the closest bases for Phase 1.

**Fixtures (no copyrighted media):** keep stubs; for measured ffmpeg, generate tones/noise with ffmpeg (as the guide already did). Optional public-domain Wikimedia tone only if a live smoke is requested later — not required for Phase 1 unit tests.

### 7.2 Phase 1 acceptance (must all be unit-tested with stubs)

1. Cookie-store error emits a visible retry phase, then succeeds without cookies **or** ends with `cookies_needed` + hint — never a silent second spawn.
2. Engine download with **wrong SHA-256** does not replace the binary; `.bak` restore works when the new file is bad.
3. `queue.json` write is atomic (crash between write and rename leaves the previous array).
4. Old 1.1.0 queue array (no new fields) loads and runs.
5. Renderer reload while `running`: item continues or returns to `pending` **without** duplicating the spawn; no half-applied loudnorm swap.
6. Unplugged favorite: error `dest_unmounted`, **zero** `mkdir` on the fake volume parent.
7. Loudnorm tmp with TP above gate: original bytes unchanged, `normalizeWarning` present.
8. Loudnorm tmp within gate: swap happens, warning absent.
9. Normalize off + source already MP3 at ≥ target bitrate: no `libmp3lame` re-encode in the stub script.
10. Normalize on: re-encode still happens.
11. Auto-tag ffmpeg failure surfaces a warning (not silent).
12. `config.json` without `audio_format` still opens as MP3/320; after `set-audio-format` the key is present and round-trips.
13. Existing 193 tests still pass.
14. No network to real media hosts in CI.

Manual (later, isolated `--user-data-dir`, generated audio only): one cookie-retry status visible; one dest-unmounted; one normalize reject.

---

## 8. Effort, risks, regressions

**Phase 1 invasiveness:** `main.js` (runner, errors, loudnorm gate, engine hash, dest check), `preload.js` (few IPC methods), `renderer.js` (stop owning the loop; show retry/error codes; persist format), tests. Not a visual redesign.

**Risks**

- Tests that **count** `api.download` callers / mirror `runQueue` will fail until updated (`h1-queue-identity.test.js`, `h3-harness.js`).
- Dual runners (old renderer loop left in place) would double-start items — must **delete** renderer `runQueue` body or make it `queue-start` only.
- SHA-256SUMS format/name drift on GitHub → first-run setup fail; keep size-floor as fallback **only if** sums file missing, and **do not** install unverified when sums **are** present but mismatch.
- Copy-mode vs yt-dlp `-x` interaction: implement encode plan in **our** ffmpeg step after yt-dlp writes a file, or pass precise `-f` + `--audio-format` `best`; stubs must assert args. Prefer “download then decide” for testability.
- Remembered format changes the tested default **on the second launch** — defaults tests must still cover absent keys.
- Do not claim faster downloads, smaller memory, or a signed Intel build.

**Signing:** out of scope. Ad-hoc arm64 remains the installed reality until enrollment.

---

## 9. Decisions that need the user

Everything else in Phase 1 can follow the recommendations above. These change behavior enough to confirm:

1. **Encode default (P1):** copy when source already matches, vs always convert to the chosen format (today). Recommendation: **copy when match, convert when Normalize is on or container/codec differs.**
2. **Remember format/bitrate across launches (P1 vs P2):** Recommendation: **yes in P1**, same “write only after the user changes it” rule as loudnorm.
3. **Club −9 LUFS:** keep with honest miss + no-swap on TP fail, vs hide −9 until a limiter exists. Recommendation: **keep −9, never lie that it hit −9.**
4. **Intel:** skip until Phase 5 as a **separate untested x64 dmg**, vs not at all. Recommendation: **Phase 5 extra, no universal fat, no “Intel supported” claim.**
5. **Phase 1 fingerprint:** leave dead Keep-both UI alone, vs a minimal “review on Queue row” without Delete. Recommendation: **flag only in P1; review UI in P3.**

---

## 10. Approval gate

**Approved** (user 2026-11-05): Approach B; copy when source matches; remember format/bitrate; keep −9 LUFS with honest miss; fingerprint flag-only; Intel deferred to Phase 5.

**Phase 1 implemented.** Remaining: phases 2–5. Not in this slice: presets, filename preview, fingerprint review sheet, VoiceOver pass, packaging, Intel, signing.
