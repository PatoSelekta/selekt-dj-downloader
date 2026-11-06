# Selekt DJ Downloader — Queue redesign

**Status:** **Q1 + Q2 implemented** on `3654c47`. **Locate-outside-roots follow-up** is investigation-only: `docs/superpowers/specs/2026-11-06-queue-locate-relink-design.md` (not approved to code). **Q3 Move** and **Q4 Convert / Add local files** remain **proposed**. No merge, install, release, or deploy from this document.

**Priority:** this redesign is the next product slice. It is **not** generic Phase 2 (presets / filename preview) from the 2026-11-05 staged-upgrade spec. Those later phases stay listed; they are not started.

**Branch:** `cursor/staged-upgrade-design-a99c`. App version `1.1.0`. Electron `^44.10.2`.

**Source verified on this VM (2026-11-06, Q1+Q2 implementation):** see the PR for the exact commit. Independent read of `app/main.js` (`resolveQueueOutputs`, sanitized queue writes, reveal/locate/add-folder/clear-finished/remove-errors), `app/preload.js`, `app/renderer/renderer.js` (`renderQueue` Active/Completed), `app/renderer/index.html`, `app/test/q12-identity.test.js`, `app/test/q12-queue-clarity.test.js`. User screenshot of the pre-Q1 Queue remains **current-state evidence of the old UI**, not a target layout. The isolated Mac app on `b84089d` was not touched.

**This-VM / Mac evidence (information, not a full-validation claim):**

| Check | Result | Claim limit |
|---|---|---|
| This Linux VM unit tests | Last recorded pass **231/231** sequential (`--test-concurrency=1`) at `b84089d` | Stubs for Electron, yt-dlp, network |
| Mac unit + renderer harness (user, prior) | 228/228 unit; 64/64 fake-API renderer | Not re-run on this VM |
| Mac real-engine of `08cee9d` | WAV→MP3 192 ~193 kbps; MP3→MP3 Normalize off requested 320 produced byte-identical 192 kbps but `encodePlan.mode` said `convert` | Reporting bug fixed in `b84089d`; that Mac run is **not** a re-validation of `b84089d` |
| User follow-up on `b84089d` | 231/231 plus 13 real-pipeline assertions; arm64 rebuilt; packaged app launched isolated with no crash | **No visual or packaged GUI E2E.** Do not claim the Queue UI or file-move/convert paths were validated |
| Packaged GUI / provider / auth | Not tested | — |

**Related:** Phase 1 design remains `docs/superpowers/specs/2026-11-05-staged-upgrade-design.md` (implemented, status intact). This file does not reopen Phase 1 decisions.

---

## 1. Why the Queue is confusing (source-backed)

### 1.1 One table, mixed lifetimes

`renderQueue()` (`app/renderer/renderer.js` 1843–1968) draws **every** `queue.json` item into one `#queueTable` (`index.html` 745–756): pending, running, error, skipped, flagged, canceled, and done. The user cannot tell “instructions for a future download” from “a file that already exists.”

### 1.2 Completed rows still look like editors

For each row the Folder and Format columns are `<select class="q-sel">` (1884–1892). `locked` is only `status === "done" || status === "running"` (1882). Locked selects get `disabled`; they still look like dropdowns (chevron, same `.q-sel` chrome, `min-height: 0` at `index.html` 428). The user’s screenshot matches this: green-check rows with destination and format controls.

Changing a **disabled** select does nothing. Changing an **unlocked** select (`queue-update-item`, `main.js` 356–360) only patches `destId` / `format` on the JSON row. It does **not** move a file and does **not** convert one. There is no move IPC and no local-file convert IPC (`preload.js` 49–61 is get/set/add/clear/update/start/pause/stop/status).

So the UI’s strongest affordance on a finished row (a folder list and a format list) implies work the app will not do.

### 1.3 Completed location is the *requested* dest, not the file

Phase 1 persists `files` (absolute paths from yt-dlp `--print after_move:filepath`) and `outputDir` on newly finished items (`main.js` 473–478, 2261). The Queue **does not show them**. The folder column always calls `destOptionsHtml(item.destId)` (1885) — the instruction captured at enqueue time.

`destOptionsHtml` (1765–1776) adds a selected “Folder unavailable: {name}” option when `destId` is not the main folder, a current subfolder, or a **currently registered** favorite. That is why completed rows in the screenshot say unavailable: the favorite or subfolder was later removed from the app’s lists, or the stored `destId` no longer matches. The file can still exist at `outputDir` / History `file`. An unplugged-but-still-registered favorite is **not** this string (it still appears by name in `buildFolderSelectOptions`); “unavailable” here means **orphaned destId**, not “file missing.”

`outputDir` is used only in the Download-tab toast (`showQueueItemOutcome`, 2010–2014), as the last path segment.

### 1.4 Requested format is not actual output

The format `<select>` shows `item.format` (`audio:mp3`, `video:original`, …). After a copy-preserve download, History already says `mp3 source preserved` (or `~N kbps preserved`) via `encodePlan` (`main.js` 2209–2216). The Queue row still shows the requested chip (e.g. MP3, which the user reads as “this is 320”). Phase 1 made History honest; the Queue table was not updated.

### 1.5 Multi-link paste is easy to mis-aim

Queue-tab Add (`renderer.js` 2136–2159): parse `https?://` lines, assign **one** `queueAllFolder` destId and the **Download tab’s** current format/bitrate to every URL. It does **not** snapshot `loudnorm`, `autoTag`, `lufs`, or `playlist`. At run time `queueItemToDownloadOpts` / `toDownloadOpts` fall back to **live** config/globals (1805–1809, 386–388). So two batches pasted minutes apart can silently pick up a Normalize change that happened in between.

The “Folder → / Apply to all” row (`index.html` 737–742) is the only batch destination control. **Apply to all** updates `destId` on **pending** items only (2162–2168). `docs/USER_GUIDE.md` 509–511 says it “sets the chosen folder on every item” — that is **wider than the code**. It never changes format. Nothing confirms “these N links will go to folder X as format Y” before Add.

Download-tab enqueue (`buildQueueItemFromSelection`, 1825–1839) **does** snapshot loudnorm/autoTag/playlist. The two entry points are inconsistent.

### 1.6 Clear / remove / retry are list operations (good) but poorly grouped

| Control | Actual effect | File delete? |
|---|---|---|
| Row ✕ | `queue-set` filter-out (`renderer.js` 1927–1931). Disabled while `queueRunning`. | No |
| Clear | `queue-clear` (`main.js` 530–538): stop runner, kill child, `saveQueue([])`. | No. Cancels the in-flight download. |
| History Clear | Truncates `download_history.jsonl`. | No |
| Row ↻ | Sets `pending`, clears error/note, `force` if skipped, then `queue-start`. | No (re-download may write a new file) |
| Retry failed | Same for every `error` / `skipped` / `flagged`. **Canceled is omitted** (2121–2133). | No |

USER_GUIDE 531–536 already states Clear does not delete files. The problem is not the rule; it is that finished files live in the same table as jobs you are still aiming, with the same folder/format widgets.

### 1.7 What the user asked for (accepted location)

User chose: **keep completed files and their move/convert actions in a separate Completed section inside Queue.**

Accepted semantics (location only — details below are this spec’s recommendations):

- **Active** = pending / running / failed (error, skipped, flagged, canceled).
- **Completed** = `done` only.
- Pending folder/format are **instructions**.
- Completed location/format **reflect reality**.
- Explicit **Move file** / **Convert a copy** / **Show in Finder** / **Remove from list**.
- Removing list rows **never** deletes files.
- Conversion **preserves the original** by default.
- **No automatic move** by changing a dropdown.

Also requested: correct destinations in-app; convert already-downloaded or local files without redownload; clear errors / retry; better organization; head-mouse / mouth-switch / dictation / keyboard / VoiceOver; native-picker authorization; existence / unmounted / moved-file handling; collision / overwrite protection; no unasked deletion; same-volume and cross-volume move safety; consistent queue / history / dedup references; do not conflate requested vs actual format; investigate missing output paths and playlist-as-many-files honestly; conversion jobs on the existing sequential runner; local-files entry; preserve existing data/migrations and the original app.

---

## 2. Honest limits in today’s data (must not be papered over)

### 2.1 `files[]` is new and optional

Phase 1 writes `files` and `outputDir` only when an item **finishes through the current runner**. Old 1.1.0 done rows, rows finished before that persist, and any row whose `queue.json` was hand-edited or cleared, may have:

- `status: "done"`
- `title` = URL or a later basename
- `destId` only
- **no** `files`, **no** `outputDir`, **no** `encodePlan`

`queue-clear` wipes the array. Identity then exists only in History / `downloaded_index.jsonl`.

`queue-update-item` is a raw `Object.assign` (`main.js` 356–360). The renderer, or a test, can write `status: "done"` without `files` (`normalize-warning.test.js` 381). Main does not validate that a done row has paths.

### 2.2 History is the real file ledger; it is per file

`recordHistory` (`main.js` 310–316, 2209–2218) appends one JSONL row per output file: `{ action, url, title: basename, folder: dirname, file: absolute, details, time }`. `open-file` / `reveal` authorize against `historyFileKeys()` plus H1 containment (`checkManagedFile`, 258–281; tests in `h1-open-actions.test.js`).

So: **History often knows paths the Queue row forgot.** Recovery must use it. Clearing History **removes** that grant: `open-file` then returns `not_allowed` even if the file is still on disk.

### 2.3 Dedup index is incomplete

`downloaded_index.jsonl` is `{ id, file, time }` for **non-playlist** downloads with a probe id (`main.js` 2220–2223). Playlists skip it. Dup check is extension-aware and directory-scoped (`findDuplicateFiles`, 1407–1421). A move that does not update this file will make “already in folder” look at the **old** path (miss) and can allow a redownload into the old folder, or fail to see the file in the new one.

### 2.4 One queue item can be many files

Playlist download (`handleDownload` when `type === "playlist"`):

- Output template: `<dest>/%(playlist_title)s/%(playlist_index)s - %(title)s.%(ext)s` (2082–2084).
- `--yes-playlist --ignore-errors` and optional `--playlist-items` (2088–2093).
- `files` is the list of paths yt-dlp printed (1191, 1234–1235, 2140).
- **One** `encodePlan` for the whole job (playlists skip `probeInfo`, so source codec/bitrate are usually unknown → copy-when-match still applies per later per-file work, but the stored plan is job-level).
- Done `title` is `basename(files[0])` only (457).
- No `downloaded_index` rows; fingerprint skipped (2220–2226).
- History **does** get one row per file, all sharing the playlist URL.

A Completed “row” that only shows one title and one folder dropdown cannot honestly host Move/Convert. Actions must be **per file**, with the parent job as a group.

Partial playlists: `--ignore-errors` can yield `ok: true` with a subset of files (1251–1254). Some requested indices will have no path.

### 2.5 Authorization today is history-rooted, not queue-rooted

`checkManagedFile` requires the path to be in an allow-set **and** inside the real path of the current main folder or a current favorite (descendants allowed). Files whose folder was **removed from favorites** are `outside` — Show/Play die until the folder is added again (`main.js` 191–192). That is the same class of stale dest the screenshot shows.

`pick-folder` “authorizes nothing” (comment at 1479). Only `add-favorite` / `pick-main-folder` + `set-main-folder` create durable roots. Move and local-file convert **must not** write to a raw `pick-folder` path.

### 2.6 No local-file pipeline

`checkYtdlpUrl` accepts only `http:` / `https:` (`main.js` 1360–1373). `handleDownload` rejects anything else before binaries or folders. There is no “open audio files” dialog, no `jobKind`, and the runner only calls `handleDownload` (`runQueueLoop`, 422–449).

### 2.7 Accessibility debt on the current Queue

`.q-sel` is `min-height: 0`; `.q-remove` is `min-height: 30px` (`index.html` 428–429). Status is CSS `::before` content (emoji/symbols, 433–438) with no text alternative on the span. Folder context menu on the Download tab is pointer/right-click (Phase 1 spec §2). `a11y-check.electron.js` covers Settings, chips, `#queueInput` name, and `.q-remove` names — not Completed actions (they do not exist). Head-mouse / mouth-switch need **≥ 44px** named buttons, not icon-only ✕ / ↻.

---

## 3. Approaches

### A — Minimal Queue clarity (no file management)

Split the tab into **Active** and **Completed**. Pending rows keep folder/format as instruction `<select>`s. Completed rows become **read-only text** (folder name from `outputDir` or dest label; format from `encodePlan` / History `details` / file extension). Remove the disabled dropdowns. Row remove still means remove-from-list only. Keep History as the only Show/Play surface.

- **+** Smallest UI diff. Fixes the screenshot lie. No new file I/O. Lowest risk to H1 path rules and 231 tests.
- **−** User still cannot correct a destination in-app. Cannot convert without redownload. Orphan destIds still need a “location unknown” state or they stay dishonest. Does not meet the chosen product direction.

### B — Completed as a second History (show-only plus locate)

Approach A, plus **Show in Finder** and **Locate…** on Completed rows that have (or can recover) a path. No Move. No Convert. No local files.

- **+** Reuses `reveal` / `open-file` and H1 tests. Gives a recovery path for missing `files[]`.
- **−** Destination correction still happens in Finder. Convert still requires a new download. User explicitly asked for in-app move and convert.

### C — Completed file management inside Queue (recommended; user-chosen location)

Approach A’s split, plus explicit per-file **Move file**, **Convert a copy**, **Show in Finder**, **Remove from list**, and an **Add local files…** entry that enqueues convert jobs. Pending widgets stay instructions. Completed widgets are never destination/format dropdowns. File mutations run in main, one-at-a-time on the existing sequential runner (convert/move never overlap a download). Originals are not overwritten. List removal never deletes.

- **+** Matches the user’s choice and the accepted semantics. One place to aim jobs and to manage what landed. Reuses Phase 1 runner, `planEncode`, dest_unmounted, History, H1 containment.
- **−** Largest slice if built as one drop. Must specify identity recovery, playlists, and cross-volume move or the UI will lie again. More IPC and tests.

**Recommendation:** **C**, implemented in the incremental slices in §4. Do not ship C’s buttons until the identity rules in §6 work. Do not implement A as a dead-end if C is approved — A is the first slice of C, not a competing product.

---

## 4. Recommended incremental scope (after approval only)

Q1+Q2 were approved and implemented. **Do not implement Q3/Q4** until the user approves those slices. Remaining product decisions in §12 still apply to Q3/Q4.

| Slice | Name | User-visible outcome | File mutation |
|---|---|---|---|
| **Q1** | Clarity | **Implemented.** Active vs Completed; pending = instructions; completed = reality text; paste confirm line; Apply-to-pending copy matches pending-only; snapshot loudnorm/autoTag on Queue-tab add; Clear finished / Remove errors | None |
| **Q2** | Identity + Show + Locate + Remove | **Implemented.** Every Completed file has a resolved state: `present` / `missing` / `unknown` / `outside`; Show; Locate via native picker; Remove from list | None (Locate only records a path) |
| **Q3** | Move file | Explicit Move; native dest from authorized roots; same-volume rename; cross-volume copy+verify+delete source; no overwrite; update queue + History + index | Yes, move only |
| **Q4** | Convert a copy + local files | Convert job on sequential runner; new file; original untouched; local files via native picker | Yes, new file only |

**Q1 + Q2 are implemented.** **Q3** (destination correction / Move) and **Q4** (Convert a copy + local files) stay proposed. Do not add live-looking buttons for unimplemented Q3/Q4 actions.

Out of **this** redesign (stay on the old later-phase list unless the user pulls them in): presets, filename/tag preview on the Download tab, fingerprint review sheet, packaging/Intel, signing, splitting `main.js` into modules, wrapping `queue.json` in a schema object, True Peak limiter, deleting downloaded music.

Phase 4 a11y work that **this** redesign **does** take for **new** Queue controls: 44px targets, names, keyboard, no right-click-only. It does not redo the whole Download-tab chip strip.

---

## 5. Architecture

### 5.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| Queue view (renderer) | Two sections; pending editors; completed reality + named actions; paste summary; no path invention | `queue-get` / `queue-changed` |
| Identity resolver (main) | For each done item, produce `outputs[]` with existence and grant state | `files[]`, History, `downloaded_index`, `checkManagedFile` |
| `queue-update-item` (tightened) | Pending: dest/format/bitrate/loudnorm/force/retry fields only. Never accepts `files` / `outputDir` / `encodePlan` from the renderer | `loadQueue` |
| Sequential runner (existing) | One job at a time. Dispatch on `jobKind` | Phase 1 `runQueueLoop` |
| `handleDownload` | Unchanged URL download path | existing |
| `handleMove` (Q3) | Authorize, dest check, rename or copy-verify-unlink, rewrite references | H1 roots, dest_unmounted |
| `handleConvert` (Q4) | Read authorized source; `planEncode`; ffmpeg to a **new** path; History row for the copy | `planEncode`, loudnorm gate if Normalize on |
| Local picker (Q4) | `showOpenDialog` files; single-use grant like `pick-main-folder` | dialog |
| History / index writers | Only main updates `file` on move; append on convert | existing JSONL |

Renderer remains a view. Main remains source of truth for paths and jobs.

### 5.2 Data flow

```
Enqueue URL  → pending item (instructions snapshotted) → runner → handleDownload
                                                                 → outputs[] + History + index
Enqueue local → pending convert item (source grant) → runner → handleConvert → new file + History
Completed Move → pending move item (or exclusive IPC; see §12) → handleMove → rewrite refs
Completed Convert → pending convert item → handleConvert → new Completed file, original stays
Remove / Clear list → queue.json only
```

Convert and move **never** call yt-dlp. They wait behind the current job (same `queueRunner` lock) so ffmpeg and yt-dlp do not share a file.

### 5.3 `queue.json` stays a JSON array

Same Phase 1 rollback rule. No `{ schemaVersion, items }` wrapper. Unknown fields ignored by 1.1.0. Old 1.1.0 still loads pending URL items. New job kinds are ignored by 1.1.0 (they would sit as pending with a URL missing or invalid — Q1+ must not leave `jobKind: "convert"` items in a shape 1.1.0 would send to yt-dlp if the user rolled back mid-queue). **Mitigation:** convert/move items use `status` plus `jobKind` and **no `url`** or a non-http `sourcePath` only; 1.1.0 `handleDownload` will fail `checkYtdlpUrl` and mark error — files on disk unchanged. Acceptable.

---

## 6. File / data model

### 6.1 Additive item fields (all optional on old rows)

```
jobKind: "download" | "move" | "convert"     // absent = "download" (today’s items)
sourcePath: string                            // convert/move source; main-set only
outputs: [                                    // main-set; preferred over files[]
  {
    path,                     // absolute
    actualExt,                // ".mp3" …
    actualFormatLabel,        // from encodePlan / ffprobe-at-finish / History details
    bytes,                    // size at last check, or null
    state: "present" | "missing" | "outside" | "unknown"
  }
]
files: string[]                               // Phase 1 field; still written; outputs[] derived
outputDir, encodePlan, normalize, tagWarning  // Phase 1, unchanged meaning
requested: { destId, format, bitrate, loudnorm, lufs, autoTag }  // optional snapshot alias
```

Do **not** require a rewrite of existing items on load. Resolver fills `outputs` in memory (and may persist them after a successful Q2 locate / Q3 move / Q4 convert).

`format` / `destId` on a **pending download** remain the instructions. On a **done** item they are historical request, never shown as live dropdowns. UI reads `outputs[]` for reality.

### 6.2 Identity resolution (Q2, must be unit-tested)

For a `status === "done"` item, build `outputs` in this order. Stop adding a path if it is already in the list (`pathKey`).

1. **`item.files[]`** if it is an array of absolute strings. Each path: `exists` + `checkManagedFile` against History keys **or** a new queue-output allow-set (paths main persisted on this item). Map to `present` / `missing` / `outside`.
2. Else **History rows** with the same `url` (and, if `outputDir` is set, prefer those whose `folder` equals `outputDir` or is inside it — playlist subfolder). This recovers pre-Phase-1 done rows and playlist members.
3. Else **`downloaded_index.jsonl`** paths for a stored probe id if we add/keep `sourceId` later; today most queue items **do not store the YouTube id**. Do not invent one. If `item.sourceId` is absent, skip this step.
4. Else **zero outputs**, item-level `state: "unknown"`.

UI:

| State | Location column | Actions |
|---|---|---|
| `present` | Real parent folder name + full path in `title` / accessible description | Show, Move (Q3), Convert (Q4), Remove from list |
| `missing` | “File not in that folder” (not “Folder unavailable”) | Locate…, Remove from list. Show/Move/Convert disabled |
| `outside` | “Folder is not in this app’s list — add it as a favorite to use this file” | **Add this folder** registers `dirname(path)` via the same favorite rules as `add-favorite` (confirm, no second guess). Remove from list |
| `unknown` | “Location not recorded for this older item” | Locate…, Remove from list |

**Locate…** is a native **file** picker (not `pick-folder`). Single-use grant, same pattern as `pick-main-folder` (1492–1501): the chosen path is accepted only if it is the dialog result **and** `checkManagedFile` would pass after we treat the pick as a history-equivalent grant **or** it sits inside an authorized root. If the user picks a file **outside** current roots: refuse with the existing “add it as a favorite” error; do not silently copy. After a valid Locate, main writes `files` / `outputs` and, if no History row exists, **appends** a History row (`action` stays a download if we know the URL; else `action: "located"`). That restores Show.

Never guess a path from title + destId (playlist templates and `%(title)s` sanitizing make that unsafe).

### 6.3 Playlist Completed shape

Keep **one** queue item (one URL, one `playlistItems` list). In Completed, render a **group**:

- Group header: playlist title or URL, count `present/missing/unknown`, requested format as secondary text (“Requested: Video original”).
- One **child row per `outputs[]` entry** (filename, actual location, actual format).
- Actions on the child, not the header, except **Remove from list** (removes the whole job from `queue.json`, not the files) and optional **Show folder** on `outputDir` if present.

If `outputs` is empty: one unknown group, Locate disabled at group level (cannot know how many files). Offer “Locate files…” only as repeated file picks? **No** — too easy to attach the wrong set. For unknown playlists: text + Remove from list + “These files may still appear in History.” User works from History Show, or we add later “Attach files…” as an explicit remaining decision (§12).

Partial success: children that exist are `present`; requested indices without a path are not invented.

### 6.4 History and index after mutations

**Move (Q3), success:**

- `outputs[].path` / `files[]` / `outputDir` updated on the queue item.
- Every History row whose `file` matches the old path: rewrite `file` and `folder` (same JSONL file; rewrite-all-lines is OK — file is small). Do not leave the old path as a grant to a now-empty location.
- `downloaded_index.jsonl`: rewrite `file` where it equals the old path.
- `fingerprints.jsonl`: **leave unchanged in Q3.** Phase 1 fingerprint is flag-only and path-rewrite is not specified here. A stale path may miss a later match; that is an existing Phase 3 problem, not a silent delete.
- `destId` on the done item stays the **original request**. Display uses `outputs`.

**Convert (Q4), success:**

- Original queue item / History / index **unchanged**.
- New History row for the new file (`action: "convert"`, `details` from the new `encodePlan`, honest copy/preserve wording).
- New Completed row (`jobKind: "convert"`, `sourcePath` = original, `files` = `[new]`).
- If the source had a YouTube id in the index, **do not** record the copy as the same id+ext in the **same** folder (that would skip a future download of that format). Record the copy as a new file without replacing the original index row. If the copy is a different extension, `findDuplicateFiles` already treats it as a different artifact.

**Remove from list / Clear:** no History, index, or disk change.

### 6.5 Config / migrations

No new `config.json` keys required for Q1–Q2. Q4 may add nothing if local grants are session-scoped.

1.1.0 / Phase 1 files remain valid. Do not migrate `queue.json` into a wrapper. Do not drop `files[]`.

---

## 7. Move file (Q3)

### 7.1 Trigger

Named button **Move file** on a `present` output. Opens a **destination chooser** of authorized roots only (main, its subfolders, registered favorites that `existsSync`). Plus **Add folder…** which is the existing `add-favorite` dialog (authorizes a new root). No free-typed path. No completed-row dropdown.

Changing any pending dropdown still does not move anything.

### 7.2 Safety

1. Source: `validPathArg` + current `outputs` path + `checkManagedFile` (History or queue-output allow-set). Symlink source: follow for identity (`realpath`) but refuse if the path itself is a symlink when we would delete it (same spirit as trash, `main.js` 276–279).
2. Dest dir: `resolveDestination`; if favorite and `missingMountChain`, return `dest_unmounted` and **do not** `mkdir` on the system disk (Phase 1 rule, 2036).
3. Dest file name: keep basename. If `join(dest, basename)` exists: **fail** `code: "collision"`. Do not overwrite. Do not trash the occupant. UI: “A file with that name is already there.” Remaining decision: offer “Keep both (rename)” (§12); default of this spec is **fail closed**.
4. Same volume: `fs.renameSync` (or `rename` async). If `EXDEV`:
   - copy to `dest/.*.selekt-move-partial` (or `name.part`)
   - `fsync` where available
   - compare size (and `mtime` or a content hash if cheap)
   - `rename` partial → final
   - only then `unlink` source
   - if copy or verify fails: delete partial, **source remains**
5. Cross-device delete of source happens only after the dest file is a regular file with the expected size.
6. Never `rm` a directory. Never move a playlist **folder** as a unit unless every child is `present` and the user confirmed **Move all N files** (remaining decision; default is per-file only).
7. If source is the runner’s current output: refuse `code: "busy"`.

### 7.3 Runner

Move is short but must not race convert/download on the same path. **Recommendation:** the same queue item is set to `jobKind: "move"`, `status: "pending"`, and `moveDestId`. It therefore appears in **Active** as “Moving {filename} → {folder}”. The sequential loop calls `handleMove`. On success: `jobKind` back to `download` or `convert` (whatever it was), `status: "done"`, new `outputs`. On failure: `status: "error"` in Active with the move error; files still at the old path; Retry retries the move, not a redownload (`jobKind` stays `move`).

Alternative (if the user prefers the file to stay visible under Completed): exclusive IPC that waits until `queueRunner.currentId` is null or is not this file, then runs `handleMove`. More code paths. Default is the runner.

---

## 8. Convert a copy and local files (Q4)

### 8.1 Convert a copy

Named button on a `present` audio/video file. UI asks for **target format / bitrate / Normalize** (same chips as Download, 44px). Confirm line: “Create a new file next to the original. The original will not be changed.”

Main:

1. Authorize source as in Move.
2. Probe the **file** with ffprobe (not yt-dlp). Feed `planEncode`. Honest warnings (upsample, unknown bitrate → copy if family matches and Normalize off).
3. Output path: same directory, new name. **Recommendation:** `{stem} ({format}{bitrate-or-preserved}).{ext}` with spaces, collision → fail closed or increment ` 2`. Never `name.mp3` over `name.mp3`.
4. If `planEncode.mode === "copy"` and container already matches: `ffmpeg -c copy` to the new name (still a new file — user asked for a copy).
5. If Normalize on: existing two-pass + I/TP gate; swap only the **temp of the copy**; original never in the swap.
6. Enqueue as `jobKind: "convert"`; runner calls `handleConvert` instead of `handleDownload`.
7. Progress: existing `download-progress` `phase: "normalizing"` / a new `phase: "converting"` on the Active section (the convert job is Active until done, then it appears in Completed; the original Completed row stays).

Video convert (transcode) is **out of Q4** unless the source is already an audio extract. Q4 audio formats: mp3 / m4a / wav / flac. A video original in Completed can still **Move** / **Show**; Convert offers audio extract only (same as Download’s audio path) or is hidden for video — **recommendation:** allow “Convert a copy to MP3/M4A/WAV/FLAC” from a video file (ffmpeg extract), never overwrite the video.

### 8.2 Local files entry

On the Queue tab, next to paste: **Add local files…**. Native multi-select of audio (and optionally video) files. Each file becomes a `jobKind: "convert"` pending item with `sourcePath` from the dialog grant, destId = current `queueAllFolder`, format from the confirmed instruction line.

This is **not** a download. No URL. No yt-dlp. If the user only wants the files listed in Completed without converting, they can pick format = same as source and Normalize off → copy-to-dest (new file in the dest folder). That is still a copy, not a move, unless they then Move. **Do not** silently ingest into Completed without creating or referencing a managed path.

If dest is the file’s current folder and format matches: copy would collide with itself → refuse and tell the user to Move or pick another folder/format.

### 8.3 Original overwrite

Forbidden for convert. The only delete of a user music file in this redesign is the **source file after a successful verified cross-volume move** (the dest is the same music). No trash. No “replace original.” Fingerprint Delete-new stays Phase 3 and dead on the queue path.

---

## 9. Active section (pending / running / failed)

### 9.1 Instructions

Pending (and unlocked failed, so retry can retarget): folder + format `<select>`s, labeled **Save to** and **Download as** (not “Folder” / “Format” alone). Helper text: “These settings apply when this item runs. They do not move or convert a file that is already downloaded.”

Failed rows stay in Active with the error/note and **Retry** / **Remove from list**. Folder/format remain editable (today’s `locked` rule minus `done`).

Running: read-only instructions + progress (already persisted `progress` in Phase 1). Cancel / Stop all: add the existing Download-tab actions to the Queue Active header (Phase 1 runner already supports them). 44px.

### 9.2 Paste

After parse, show: “Add **N** links to **{folder name}** as **{format label}**.” Add stays a separate explicit button. Empty parse: no enqueue.

Snapshot on Queue-tab add (same as Download-tab): `destId`, `format`, `bitrate`, `autoTag`, `loudnorm`, `lufs`. `playlist: false` (multi-link paste stays one-URL-per-row; whole-list remains the Download-tab picker).

**Apply to pending** (rename from “Apply to all”): only `status === "pending"`. Visible label and USER_GUIDE must match the code.

### 9.3 Clear / retry

Replace the single **Clear** with two named actions (nuclear Clear is what wipes Completed and Active together and feels like delete):

| Button | Effect |
|---|---|
| **Clear finished from list** | Remove `done` items from `queue.json` only |
| **Remove errors from list** | Remove `error` / `skipped` / `canceled` / `flagged` from the list only |
| **Retry failed** | Unchanged: re-pending error/skipped/flagged; canceled still row-only ↻ |

If a one-button Clear is kept for muscle memory: it must confirm “This clears the list, including finished items. Downloaded files stay on disk.” Default recommendation is the split; see §12.

While a job runs, list-removal of **other** rows may stay enabled (today ✕ is disabled for **all** rows when `queueRunning` — 1901). **Recommendation:** allow Remove on non-running rows while the queue runs; keep the running row’s Remove disabled.

---

## 10. Accessibility (new Queue controls)

Design for head mouse, mouth switch, dictation, keyboard, VoiceOver. Apply to **this tab’s new chrome**; do not wait for old Phase 4.

- Every action is a **`<button>`** with a visible text name: “Move file”, “Convert a copy”, “Show in Finder”, “Remove from list”, “Locate file”, “Retry”, “Add local files”. No icon-only ✕ / ↻ as the only name (icon + text is fine).
- Minimum hit target **44×44 CSS px** on those buttons and on pending selects.
- Sections: `<section aria-labelledby="queue-active-h">` / `queue-completed-h"` with visible headings “Waiting and failed” / “Completed files”.
- Status: not emoji-only. `aria-label` on the row: “Completed, Major Lazer – remix, MP3 source preserved, folder Afro.” Pending: “Waiting, {title}, will save to {folder} as {format}.”
- Tab order: paste → folder → format snapshot → Add → Active rows (selects then actions) → Completed row actions. No right-click-only.
- Confirm dialogs (Move dest already picked; Convert confirm; Clear-finished) are the existing modal pattern (focus trap, Escape, inert background) from Settings (`renderer.js` 1020–1061).
- Dictation: unique names; do not reuse “Clear” for two different things.
- Existing `a11y-check.electron.js` must gain Queue-tab cases for the two headings, completed **absence** of enabled dest/format selects, and action names. That file needs real Electron; this VM may not run it — tests must still be written.

Spanish default strings stay in `I18N.es` with `I18N.en` pairs, same as today.

---

## 11. Exact acceptance tests (stubs; no copyrighted media)

All new tests run with `node --test --test-concurrency=1`. Harness: `h3-harness.js` (real `main.js`, stubbed Electron/dialog/spawn). Renderer cuts as in `queue-destination-display.test.js` where the assertion is HTML.

**Q1 — Clarity**

1. `renderQueue` places `pending|running|error|skipped|flagged|canceled` only under Active, `done` only under Completed.
2. A `done` row has **no** enabled `select[data-field=destId]` or `select[data-field=format]`.
3. A `done` row with `encodePlan.mode === "copy"` and `sourceAbr == null` shows a preserved/actual label, not `320kbps`.
4. A `done` row with `outputDir` shows that folder’s last segment, not `destOptionsHtml` “Folder unavailable”, even if `destId` is an orphan `p:` path.
5. Queue-tab add of two URLs stores `loudnorm` / `autoTag` / `lufs` from current config, not only dest/format.
6. Apply-to-pending does not change `destId` on `done` items.
7. Remove from list / Clear-finished leave History bytes and the actual file bytes unchanged (temp fixture).

**Q2 — Identity**

8. Done item with `files: [abs]` that exists inside main → `outputs[0].state === "present"`; `reveal` IPC succeeds.
9. Same path after `unlink` → `missing`; Show/Move/Convert refused; Locate accept of the same basename in an authorized folder via **stubbed** dialog grant → `present` + History row if none.
10. Done item with **no** `files` / `outputDir` but History row for same URL → recovered `present`.
11. Done item with no files and no History → `unknown`; Show refused (`not_allowed` or a dedicated `unknown` code); no path guess from title.
12. Playlist done with three `files` → three child outputs; group Remove deletes one queue item; three History rows remain; three files remain.
13. Renderer-supplied `queue-update-item` `{ files: ["/etc/passwd"] }` on a done id is ignored (files unchanged).
14. Favorite removed: path still on disk, History intact → `outside`; Show fails `outside` until `add-favorite` of that path; then `present`.

**Q3 — Move**

15. Same-volume move: source gone, dest exists with same size, History `file` is dest, index `file` is dest, queue `files` is dest.
16. Dest already has that basename → `collision`, source bytes unchanged.
17. Unmounted favorite dest → `dest_unmounted`, **zero** `mkdir` on the fake parent (reuse Phase 1 assertion).
18. Simulated `EXDEV`: stub `renameSync` throw; copy+verify+unlink path: source removed only after dest size matches; if copy throws, source remains and no dest final.
19. Move of a path not in History/outputs → `not_allowed`, no rename.
20. Move while that path is the running download output → `busy`.
21. Remove from list after move does not delete the dest file.

**Q4 — Convert / local**

22. Convert MP3→WAV: new file exists; original bytes identical to pre-image; new History `action === "convert"`; `encodePlan` on the **new** item; runner did not spawn yt-dlp.
23. Convert with Normalize on: original bytes unchanged; copy follows existing I/TP gate (reuse loudnorm tests).
24. Convert when `planEncode` would copy: ffmpeg `-c copy` (or equivalent) to a **new** path; original untouched.
25. Collision on the computed new name → fail; original untouched; no overwrite.
26. Local picker: stub dialog returns a fixture WAV; dest MP3; yt-dlp spawn count 0; new file in dest; `checkYtdlpUrl` never called with the file path.
27. Local file outside authorized roots → refuse; no copy into dest.
28. Convert job waits: if a download is `running`, convert stays `pending` until the download item is no longer running (one `runQueueLoop`).
29. Old 1.1.0-shaped pending download (no `jobKind`) still runs as today.
30. Entire previous suite still passes sequentially.

Fixtures: generated tones (existing loudnorm sine), tiny byte-distinct MP3/WAV buffers already used in `p1-encode-plan.test.js`. No real media hosts.

Manual later (not claimed by unit tests): VoiceOver on Completed; packaged GUI; real cross-volume USB; head-mouse dwell on 44px buttons.

---

## 12. Remaining decisions (need the user)

Recommendations in **bold**. Please confirm or change before any coding plan.

1. **First coding slice after approval:** Q1+Q2 only, vs Q1–Q3, vs Q1–Q4 in one plan. **Recommend Q1+Q2 first.**
2. **Unknown playlists:** group + “see History” only, vs an explicit multi-file Attach. **Recommend History pointer only.**
3. **Move destination set:** authorized list + Add favorite, vs also “pick any folder and auto-favorite.” **Recommend authorized list + existing Add favorite.**
4. **Collision:** fail closed vs “Keep both (name 2).” **Recommend fail closed in Q3/Q4;** Keep both can be a fast follow.
5. **Move execution:** queued job vs immediate exclusive IPC. **Recommend queued job.**
6. **Convert output folder:** always beside the original vs user picks dest (same chooser as Move). **Recommend beside original for Convert; user already has Move.**
7. **Convert from video:** audio extract allowed vs hidden. **Recommend audio extract.**
8. **Clear control:** split Clear-finished / Remove-errors vs one confirmed Clear. **Recommend split.**
9. **History tab:** stay Play / Show / Copy only, vs grow Move/Convert there too. **Recommend Queue Completed is the management surface; History stays a log.**
10. **Completed retention:** stay until the user removes, vs auto-age after N days. **Recommend stay until Remove / Clear-finished.**
11. **Attach files to an unknown old row:** allowed in Q2 Locate (single file), vs never. **Recommend single-file Locate for non-playlist unknown rows only.**

---

## 13. Risks and non-claims

- Tightening `queue-update-item` will fail any test that writes `files` / `status: "done"` through that IPC (`normalize-warning.test.js` 381). Update those tests to write via a test-only save or a main helper, not by weakening the guard.
- `queue-set` can still replace the whole array (renderer Remove uses it). Guard: main strips renderer-supplied `files`/`outputs` that it did not previously persist for that id.
- Cross-volume move is easy to get wrong (delete source too soon). Tests 18 are mandatory before claiming Q3.
- 1.1.0 rollback: convert items without a URL become errors if the user hits Resume there; disk safe.
- Do not claim Finder-quality file management, batch library cleanup, or cloud-drive conflict resolution.
- Do not claim packaged GUI E2E or VoiceOver until those runs exist.
- Signing / notarization still out of scope.

---

## 14. Approval gate

**Not approved.** This document is the design to review.

Please read this file and say whether to:

- approve C + the §12 recommendations as written, or
- change specific §12 items, or
- stop at A or B.

Only after that approval should an implementation plan be written (`docs/superpowers/plans/`). No production edits until then.
