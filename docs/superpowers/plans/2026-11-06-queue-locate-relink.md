# Queue Locate Relink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). User approved Locate reconciliation (`approved`, t80u). Do not wait for a second gate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native Locate relinks one exact file (including outside favorites), then Queue + History Show/Play + `downloaded_index` resolve that file after refresh/restart — without authorizing its folder, moving bytes, or trusting renderer paths.

**Architecture:** Main remains source of truth. `queue-locate-file` accepts the single-use native picker realpath (no roots check). It rewrites matching History and `downloaded_index` rows, records an exact-file grant in `located_files.json`, and patches `files[]`/`outputDir` only. `checkManagedFile` allows a path that is in the allow-set **and** either inside current roots **or** the same real file as a Locate grant. Favorite-removed downloads that were never Located stay `outside`. Renderer surfaces Locate ok / error / cancel.

**Tech Stack:** Existing Electron main/renderer, Node `node:test` + `h3-harness.js`, fake-DOM renderer cuts.

## Global Constraints

- No Q3 Move, Q4 Convert, Add local files, disk move/copy/delete, merge, release, install.
- `destId` / `format` / `encodePlan` on the done item stay the original request.
- Add this folder stays a separate IPC; Locate must not call it.
- `files[]` stay main-owned (`stripMainOwned` unchanged).
- Alias-safe identity via `realpath`; tests compare with `sameReal`, never `===` on raw `/var` vs `/private/var`.
- Sequential tests: `node --test --test-concurrency=1 app/test/*.test.js`.
- Do not touch the user’s installed Mac app or the isolated `b84089d` window.
- Fixtures only. No user data, no real providers.

## File map

| File | Role |
|---|---|
| `app/test/q12-locate-relink.test.js` | Production IPC: outside-root relink, Show/Play, grants, security negatives, cancel, persist failure, alias |
| `app/test/q12-identity.test.js` | Fix portable `sameReal`; outside-root Locate now succeeds; playlist refuse stays |
| `app/test/q12-queue-clarity.test.js` | Locate success/error/cancel strings; no swallowed result |
| `app/main.js` | Grant file, History/index rewrite, locate + `checkManagedFile` |
| `app/renderer/index.html` | `#queueMsg` live region |
| `app/renderer/renderer.js` | i18n + Locate feedback |
| `docs/superpowers/specs/2026-11-06-queue-locate-relink-design.md` | Status: implemented |

---

### Task 1: Failing production tests (relink + security + portable compare)

**Files:**
- Create: `app/test/q12-locate-relink.test.js`
- Modify: `app/test/q12-identity.test.js`

**Interfaces:**
- Consumes: `withHarness`, `queue-locate-file`, `queue-get`, `reveal`, `open-file`, `get-history`, `get-favorites`
- Produces: failing assertions that current roots-check and append-only History cannot satisfy

- [x] **Step 1: Write failing tests**

```javascript
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { withHarness } = require("./h3-harness");
const T = { timeout: 20000 };
function sameReal(a, b) {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); }
  catch { return false; }
}

test("relink outside roots: present, Show/Play, destId kept, favorites/bytes unchanged, stale History dead", T, async () => {
  await withHarness({}, async (h) => {
    const orig = h.write("Music/Afro/Fixture Chella.mkv", "CHEELLA-BODY");
    const moved = h.write("elsewhere/Movies/Fixture Chella.mkv", "CHEELLA-BODY");
    fs.unlinkSync(orig);
    h.write("queue.json", JSON.stringify([{
      id: "c1", status: "done", url: "https://example.com/chella", title: "Fixture Chella.mkv",
      files: [orig], outputDir: path.dirname(orig), destId: "f:Afro", format: "video:original",
      encodePlan: { mode: "copy", targetFormat: "mkv" },
    }]));
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "video", url: "https://example.com/chella", title: "Fixture Chella.mkv",
      folder: path.dirname(orig), file: orig, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    fs.appendFileSync(h.p("downloaded_index.jsonl"), JSON.stringify({
      id: "yt-chella", file: orig, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    h.queueDialog(moved);
    const r = await h.invoke("queue-locate-file", "c1");
    assert.equal(r.ok, true, JSON.stringify(r));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.identityState, "present");
    assert.ok(sameReal(got.outputs[0].path, moved));
    assert.equal(got.destId, "f:Afro");
    assert.equal(got.format, "video:original");
    assert.equal(got.encodePlan.targetFormat, "mkv");
    assert.deepEqual(await h.invoke("get-favorites"), []);
    assert.equal(fs.readFileSync(moved, "utf8"), "CHEELLA-BODY");
    assert.equal(fs.existsSync(orig), false);
    assert.deepEqual(await h.invoke("reveal", moved), { ok: true });
    assert.deepEqual(await h.invoke("open-file", moved), { ok: true });
    const stale = await h.invoke("reveal", orig);
    assert.equal(stale.ok, false);
    const hist = await h.invoke("get-history", { limit: 10 });
    assert.ok(hist.some((row) => sameReal(row.file, moved)));
    assert.ok(!hist.some((row) => row.file === orig));
    const idx = JSON.parse(fs.readFileSync(h.p("downloaded_index.jsonl"), "utf8").trim().split("\n").pop());
    assert.ok(sameReal(idx.file, moved));
    const q2 = JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"));
    assert.ok(sameReal(q2[0].files[0], moved));
  });
});
```

Also: sibling in same new folder is `not_allowed`; `/etc/passwd` (or a second unrecorded file) refuse; cancel unchanged; unknown playlist refuse; alias pick stores realpath and `sameReal`; persist failure (queue.json made a directory after arrange) does not leave a grant that opens an unrecorded sibling; existing identity test uses `sameReal` instead of `===`; the old “locate refuses outside roots” case is replaced (outside pick now succeeds; playlist refuse remains).

- [x] **Step 2: Run to verify RED**

Run: `node --test --test-concurrency=1 app/test/q12-locate-relink.test.js app/test/q12-identity.test.js`

Expected: outside-root relink FAIL (`ok: false`, `code: "outside"`).

- [x] **Step 3: Implement main relink + grants + checkManagedFile**

In `app/main.js`:

- `LOCATED_FILE = path.join(DATA_DIR, "located_files.json")` — JSON array of realpaths, `writeJsonAtomic`.
- `loadLocatedFiles()` / `addLocatedGrant(real)` — store unique `pathKey` of the real path.
- `isLocatedGrant(p)` — `sameReal`/`pathKey` against stored reals (also `pathKey(p)` and `pathKey(realOrNull(p))`).
- `allowSetHas(allowedKeys, p)` — `pathKey(p)` or `pathKey(real)` or any allowed key `sameReal` to `p`.
- `checkManagedFile`: keep invalid/allow-set/missing/roots. After roots fail, if `isLocatedGrant(p)` and allow-set has `p` and real exists as a file → `{ ok:true, real }`. Trash still requires roots (do not trash via Locate grant).
- `rewriteJsonlAtomic(file, mapRow)` — temp + rename; `mapRow` returns the new object or the same.
- `rewriteRecordedPaths(oldPaths, real)` — History rows whose `file` matches any old path (resolve + realpath) get `file: real`, `folder: dirname(real)`. Index rows with matching `file` get `file: real`.
- `queue-locate-file`: keep playlist-unknown refuse and cancel. Set `locatePick` from dialog; accept only `picked === locatePick` (then clear). `realpath`; must be a regular file. **No roots check.** `oldPaths = files[] ∪ collectCandidatePaths`. `rewriteRecordedPaths`; `addLocatedGrant(real)`; `patchQueueItem({ files:[real], outputDir: dirname(real) })` only. On persist throw → `{ ok:false, code:"persist_failed" }` and do not add a grant for a sibling. Do not `rename`/`copy`/`unlink` the media file. Do not touch `favorite_folders`.

- [x] **Step 4: GREEN those tests**

Run: `node --test --test-concurrency=1 app/test/q12-locate-relink.test.js app/test/q12-identity.test.js app/test/h1-open-actions.test.js`

Expected: PASS. Removed-favorite History rows that were never Located stay `outside`.

- [x] **Step 5: Commit**

```bash
git commit -m "feat: relink Locate to an exact file without adding a favorite"
```

---

### Task 2: Renderer feedback (ES/EN) + requested dest remains visible

**Files:**
- Modify: `app/renderer/index.html`, `app/renderer/renderer.js`
- Modify: `app/test/q12-queue-clarity.test.js`

**Interfaces:**
- Consumes: `api.queueLocateFile` → `{ ok, canceled, code, error }`
- Produces: `#queueMsg` `aria-live="polite"` text; keys `queue_located`, `queue_locate_failed`

- [x] **Step 1: Failing renderer tests** — I18N both langs have `queue_located` / `queue_locate_failed`; Locate handler source contains `queueMsg` or `h1Message` and checks `r.ok` / `r.canceled`; no silent `queueLocateFile` without using the result.

- [x] **Step 2: RED, then implement**

`#queueMsg` under the Queue card. Handler:

```javascript
async function handleQueueLocate(id) {
  const el = $("queueMsg");
  if (el) el.textContent = "";
  const r = await api.queueLocateFile(id);
  if (r && r.canceled) return;
  if (el) {
    if (r && r.ok) el.textContent = t("queue_located");
    else el.textContent = h1Message(r, "file") || t("queue_locate_failed");
  }
  await renderQueue();
}
```

Completed present rows: keep destId/format as a “Requested:” note when they differ from reality (already have `queue_requested`).

- [x] **Step 3: PASS + commit**

```bash
git commit -m "feat: surface Queue Locate success and errors"
```

---

### Task 3: Docs, canvas, full sequential suite

**Files:** spec status, USER_GUIDE Locate paragraph, review canvas, PR.

- [x] Run `node --test --test-concurrency=1 app/test/*.test.js`
- [x] Update spec status to implemented; Q3/Q4 still proposed
- [x] Canvas: Locate relink implemented; Mac UI still not claimed
- [ ] Commit, push, update PR

---

## Self-review (plan vs approved spec §4)

| Spec | Task |
|---|---|
| Picker grants exact real file, not folder | 1 (`located_files.json` + no add-favorite) |
| No renderer path trust | 1 (allow-set + grant; stripMainOwned) |
| History Show/Play + index consistent | 1 rewrite |
| destId/format/encodePlan kept | 1 asserts |
| Add folder optional/separate | 1 does not call it |
| No disk move | 1 asserts |
| Feedback not swallowed | 2 |
| Alias-safe tests | 1 `sameReal` |
| Favorite-removed never-Located stays outside | 1 + existing H1 |
| persist failure | 1 |
| Q3/Q4 out | all |
