# Queue Locate relink — investigation (3654c47)

**Status:** investigation + recommended correction. **Not approved for coding.** No production implementation, merge, install, release, or deploy from this document.

**Trigger:** User reproduced on the real Mac app at `3654c47`. Completed row after a Finder move showed “File not in that folder” + Locate (correct). After native Locate of the same relocated file, Queue still missing/Locate after a tab refresh. History Show said “File not found. It may have been moved or deleted.” Destination may not have been a configured favorite. Locate must not move the file. Optional Add-folder is fine, but Locate should make **that file** locatable without registering its folder.

**This VM:** Linux. Isolated Mac app on `b84089d` / the user’s 3654c47 build was not accessed. Repro used `h3-harness` + synthetic fixture files only.

---

## 1. Confirmed causes (reproduced)

These are observed on `3654c47` source and re-run through production `queue-locate-file` / `reveal` / `open-file` / `queue-get`.

### 1.1 Locate refuses any pick outside main + favorites

`queue-locate-file` (`app/main.js` 490–493) after the native picker:

```js
if (!roots.some((root) => root.real && isInside(root.real, real))) {
  return openFail("outside", "That file is outside the main folder and your favorite folders.");
}
```

Harness **B** (download in `Music/Afro`, `fs.rename` to `elsewhere/Movies`, pick the new path):

- Result: `{ ok:false, code:"outside", error:"That file is outside the main folder and your favorite folders." }`
- `queue.json` byte-identical (not patched)
- History JSONL byte-identical (no new row)
- `queue-get` still `identityState: "missing"`
- File bytes unchanged (Locate does **not** move/copy)

This matches the user’s “destination may not be a configured favorite” and “Queue still missing after Locate.”

The implemented Q2 spec §6.2 also says to refuse picks outside current roots. So this is **code matching that sentence**, not a crash. It does **not** match the user’s now-stated intent (Locate authorizes that file without adding a favorite).

### 1.2 Renderer swallows the Locate result

`renderQueue` Locate handler (`renderer.js` 2128–2133):

```js
await api.queueLocateFile(btn.dataset.id);
renderQueue();
```

No `ok` check, no `h1Message`, no status line. A refused pick looks like a successful dialog close. Tab switch + `queue-get` still shows missing/Locate. That is why a refresh “did nothing.”

History Show/Play **do** go through `runOpenAction` and show `h1_missing` / `h1_outside`.

### 1.3 History Show uses the stale original path → `missing`

History Play/Show call `open-file` / `reveal` with `r.file` from `download_history.jsonl`.

`checkManagedFile` when the recorded path is gone but still lexically inside a root: `code: "missing"` → renderer `h1_missing`: **“File not found. It may have been moved or deleted.”**

Harness **B**: `reveal(orig)` and `open-file(orig)` both `{ ok:false, code:"missing" }`. Exact user string.

Even after a **successful** inside-main Locate (harness **D**):

- Locate **appends** a new History row (`file: realpath`); it does **not** rewrite the old row.
- Show on the **old** row is still `missing`.
- Show on the **new** row works (inside main).
- `get-history` newest-first, so a successful inside-main Locate would put a working row on top. The user saw `missing`, which fits **no new row** (1.1 failed) or they clicked the old row.

### 1.4 “Known path outside roots” is `outside`, not Showable

If `files[]` already named the relocated outside path (harness after 1.1 — we wrote it by hand):

- `identityState` is `outside` (Add this folder), not `present` (Show).
- `queue-reveal-output` requires `outputs[].state === "present"` → `not_allowed`.
- Favorites stay empty.

So even a future patch that only wrote `files[]` without changing identity/Show rules would **not** give Show without Add-folder.

### 1.5 Mac unit 253/254 — alias string compare, not an unpatched queue item

`q12-identity.test.js` “locate non-playlist unknown”:

```js
assert.ok(hist.some((row) => row.file === file));
```

`file` is `h.write(...)` (`path.join` / `path.resolve`). Locate persists `fs.realpathSync.native(picked)`.

Harness **E** (symlink `MusicLink` → `Music`, pick via the alias):

- `r.ok === true`, `identityState === "present"`, `files[]` stored as the **real** path
- `realpathEqual(pick, stored) === true`
- `hist.file === pick` is **false**

On macOS, `os.tmpdir()` is `/var/folders/...` → realpath `/private/var/folders/...`. Same class of failure. Linux `/tmp` usually has `resolve === realpath`, so the test is green here (254/254 on this VM).

“Not patched” = the item **was** patched to the canonical path; the test compared two spellings of the same inode. Do not “fix” this by skipping `realpath`. Fix the assertion (below).

### 1.6 Locate does not move the file (already)

Harness **A** and **B**: after Locate, the chosen file’s bytes stay put; the old path is not recreated. No change needed for “must not move.”

### 1.7 Requested dest/format already survive a successful Locate

Harness **A**/**G**: `destId` / `format` unchanged. Dedup `downloaded_index.jsonl` is **not** updated (still names the old path). `findDuplicateFiles` requires `dirname(index.file) === outDir` **and** `existsSync`; a stale missing path simply misses, so a re-download to the original folder is allowed. Not the user’s visible bug; it is a consistency gap after relink.

---

## 2. Hypotheses that did not hold

| Hypothesis | Evidence |
|---|---|
| Locate copied/moved the file | **A**/**B**: bytes stay at the chosen path; old path not recreated |
| Tab refresh lost a successful patch | **F**: after `outside`, disk `files[]` still the old path; refresh cannot invent a grant |
| `stripMainOwned` erased `files[]` on queue-get | `queue-get` is `viewQueue()` in memory only; disk unchanged |
| Unknown-playlist Locate path | User’s Chella `.mkv` is a single file; playlist refuse is a different branch |
| History Show failed because the new path is outside | User string is `h1_missing`, not `h1_outside`. **B** reproduces `missing` on the **stale** path. An outside **new** History row would be `outside` if it existed |
| Mac 253/254 means Locate did not persist | Alias harness: persist happened; strict `===` on `/var` vs `/private/var` fails |

---

## 3. End-to-end trace (3654c47)

```
[Locate click]
  renderer: api.queueLocateFile(id) → ignore result → renderQueue()
       ↓
[Native picker]  dialog.showOpenDialog({ openFile })
       ↓
[IPC queue-locate-file]
  refuse unknown playlists
  cancel → { ok:false, canceled:true }  (no toast)
  realpath(pick)
  MUST be inside authorizedRoots() = mainFolder + favorite_folders
       else { ok:false, code:outside }  ← user Mac case if dest ≠ favorite
  else patchQueueItem({ files:[real], outputDir:dirname(real) })
       append History only if pathKey(real) not already in historyFileKeys
       (pathKey = resolve, not realpath → alias can duplicate rows)
       emit queue-changed
       return { ok, outputs, identityState }
       ↓
[queue-get / resolveQueueOutputs]
  files[] → classify via checkManagedFile(History keys ∪ files[])
  exists + in allow-set + in roots → present
  exists + in allow-set + not in roots → outside  (Add this folder, no Show)
  recorded path gone, lexically in a root → missing
       ↓
[History Show / Play]
  reveal/open-file(r.file) → checkManagedFile(historyFileKeys only)
  stale path, gone, still under a root → missing → h1_missing
  recorded + exists + not in roots → outside → h1_outside
```

`locatePick` is set and cleared immediately; it is **not** a lasting grant the way `mainFolderPick` is for `set-main-folder`. Authorization after a successful Locate is only “this path is now in `files[]` / History,” and Show still requires a current root.

---

## 4. Recommended correction (minimal, not implemented)

Reconcile with the user. **Do not code until they approve this model.**

### 4.1 Authorization

- A native **file** picker result authorizes **that exact real file** (`realpath`), once, same single-use compare as `pick-main-folder` (`picked === locatePick` or `sameReal`).
- It does **not** authorize the parent folder, any sibling, or a renderer-supplied path.
- `files[]` / `outputDir` stay main-owned (`stripMainOwned` unchanged).
- **Add this folder** stays a separate, explicit favorite registration. Locate must not call it.
- Locate must not `rename`, copy, or delete.

`checkManagedFile` today = allow-set **and** current roots. After Locate of an outside file, Show/Play need a **recorded-file** clause, not a new tree root:

- Allow Show/Play/reveal when the path is in the allow-set (History keys and/or this item’s `files[]`) **and** `realpath` exists as a regular file **and** `pathKey`/`realpath` matches that recorded entry (alias-safe).
- Still refuse renderer paths that are not in the allow-set (`/etc/passwd`).
- Removing a favorite still revokes **tree** access for files that were only authorized by that favorite and were **never** re-granted by Locate. A Locate grant is independent and survives without a favorite.

Identity: a recorded path that exists is **`present`** (Show + Remove), even if the parent is not a favorite. `outside` remains for “we know a path, it exists, but it is **not** in `files[]`/History as a grant and not in roots” — or drop `outside` on Completed if every known path is a grant. Do not show Add-folder as the only way to use a just-located file.

### 4.2 Persistence / consistency

On successful Locate (replace the single `files[]` entry that was missing, or set `[real]` for unknown non-playlist):

| Record | After relink |
|---|---|
| `files[]` / `outputDir` | Canonical real path / dirname |
| `destId` / `format` / `encodePlan` | **Unchanged** (original request) |
| History rows whose `file` matches the **previous** recorded path (resolve + realpath) | **Rewrite** `file` + `folder` (same rule Q3 already specified for Move). Do not leave a dead Show target as the only row for that download |
| `downloaded_index.jsonl` rows with that old `file` | Rewrite `file` so dup check is honest |
| Favorites | Unchanged unless the user clicks Add this folder |
| Bytes on disk | Unchanged |

UI: Completed location = actual parent name; keep a secondary “Requested: {dest} / {format}” so the original instruction stays visible.

### 4.3 Feedback

- Success: re-render; row becomes present + Show.
- Cancel: no error.
- Refuse (not a file, playlist unknown): existing `h1_*` / Locate-specific string in the Queue status area (`runOpenAction`-style). Never fail silently.

### 4.4 Portable regression tests (when coding is approved)

Do **not** assert `row.file === file` or `outputs[0].path === file`.

```js
function sameReal(a, b) {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); }
  catch { return false; }
}
assert.equal(r.ok, true);
assert.equal(got.identityState, "present");
assert.ok(sameReal(got.outputs[0].path, file));
assert.ok(hist.some((row) => sameReal(row.file, file)));
```

Add (not on this pass):

- Relink **outside** roots → `present`, Show/Play ok, destId unchanged, favorites unchanged, file bytes unchanged, old History path no longer the live Show target.
- Renderer cannot plant `files[]`.
- Cancel / unknown playlist unchanged.
- Alias pick (symlink or `/var` vs `/private/var`) stores realpath; identity present via `sameReal`.
- Sequential `node --test --test-concurrency=1 app/test/*.test.js`.

Native picker still cannot be driven in the fake-API renderer harness (68/68 does not cover the dialog).

---

## 5. Out of scope

Q3 Move, Q4 Convert / Add local files, merge/release/install, touching the isolated Mac app, real provider downloads, rewriting H1 for arbitrary folders.

---

## 6. Ask the user

Approve §4 (picker grants the exact file; Add-folder optional and separate; History/index rewrite on relink; no silent Locate errors) before any implementation plan or production edit.
