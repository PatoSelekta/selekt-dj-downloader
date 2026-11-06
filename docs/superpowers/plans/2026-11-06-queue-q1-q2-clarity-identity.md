# Queue Q1+Q2 (clarity + file-location) Implementation Plan

> **Status:** implemented on `cursor/staged-upgrade-design-a99c`. Q3 Move and Q4 Convert remain out of this plan.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). User already approved execution; do not wait for a second gate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Queue into Active vs Completed, show honest per-file locations and formats, and add Show / Locate / Remove-from-list with main-owned path checks — no Move, Convert, or file deletion.

**Architecture:** Main remains source of truth. `resolveQueueOutputs(item)` runs on `queue-get` in memory only (does not rewrite `queue.json` on read). Locate / Add-this-folder / Reveal are new IPC handlers that authorize via the existing H1 `checkManagedFile` plus a queue-output allow-set (paths main already persisted on that item). Renderer becomes two sections: pending/failed keep instruction `<select>`s; completed rows never render dest/format selects.

**Tech Stack:** Electron main/renderer (existing), Node `node:test` + `h3-harness.js`, renderer cuts via `vm` as in `queue-destination-display.test.js`. Chrome for fixture screenshots (Electron absent on this VM).

## Global Constraints

- Q1+Q2 only. No Move file, Convert a copy, or Add local files buttons or IPC.
- `queue.json` stays a JSON array. Do not wrap it. Do not migrate/erase old done rows.
- List operations never delete files or History.
- Renderer must not invent file paths. `queue-update-item` / `queue-add` / `queue-set` strip `files`, `outputs`, `outputDir`, `encodePlan`, `sourcePath` from the renderer payload (keep previous main-owned values by id).
- Locate is a native file picker (single-use grant, same pattern as `pick-main-folder`). Refuse paths outside authorized roots. Single-file Locate only for non-playlist unknown rows and for `missing` outputs.
- Unknown playlists: no Locate; point at History.
- Head-mouse / mouth-switch: new buttons and pending selects ≥ 44px; visible text names; ES+EN.
- Fixtures only. No user data, no real providers, no merge/release/install.
- Sequential tests: `node --test --test-concurrency=1 app/test/*.test.js`.
- Do not interfere with the user’s isolated Mac app on `b84089d`.

## File map

| File | Role |
|---|---|
| `app/main.js` | `resolveQueueOutputs`, sanitize queue writes, `queue-clear-finished`, `queue-remove-errors`, `queue-reveal-output`, `queue-locate-file`, `queue-add-output-folder` |
| `app/preload.js` | Bridge the new IPC names |
| `app/renderer/index.html` | Two Queue sections, paste confirm, Clear finished / Remove errors, CSS 44px |
| `app/renderer/renderer.js` | Split `renderQueue`, snapshot on add, completed reality UI, i18n |
| `app/test/q12-identity.test.js` | Production IPC identity / sanitize / locate / reveal / clear |
| `app/test/q12-queue-clarity.test.js` | Renderer layout, labels, no completed selects, no Move/Convert |
| `app/test/queue-destination-display.test.js` | Update done-row expectations (no dest select on done) |
| `app/test/defaults.test.js` | `queue-get` may attach in-memory `outputs`; disk still byte-identical |
| `docs/USER_GUIDE.md` | Queue section matches Q1+Q2 |
| `docs/superpowers/specs/2026-11-06-queue-redesign-design.md` | Status: Q1+Q2 implemented; Q3/Q4 still proposed |

---

### Task 1: Identity resolver + sanitized queue writes

**Files:**
- Create: `app/test/q12-identity.test.js`
- Modify: `app/main.js` (`loadQueue` / `queue-get` / `queue-set` / `queue-add` / `queue-update-item`)
- Modify: `app/test/defaults.test.js` (allow in-memory `outputs` on get; disk unchanged)

**Interfaces:**
- Consumes: `checkManagedFile`, `historyFileKeys`, `authorizedRoots`, `pathKey`, `validPathArg`, `readHistory`
- Produces:
  - `resolveQueueOutputs(item) -> { outputs: Output[], identityState: "present"|"missing"|"outside"|"unknown" }`
  - `Output = { path, actualExt, actualFormatLabel, bytes, state }`
  - `queue-get` returns stored items plus those two fields on **done** items only
  - `MAIN_OWNED_FIELDS = ["files","outputs","outputDir","encodePlan","sourcePath"]`

- [ ] **Step 1: Write the failing tests**

```javascript
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { withHarness } = require("./h3-harness");
const T = { timeout: 20000 };

test("done item with files[] inside main: present; queue.json not rewritten on get", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/Fixture Tone 1kHz.mp3", "PRESERVED-BODY");
    const item = { id: "d1", status: "done", url: "https://example.com/tone", title: "Fixture Tone 1kHz.mp3",
      destId: "p:/Volumes/Gone/Old", format: "audio:mp3", bitrate: "320",
      files: [file], outputDir: path.dirname(file),
      encodePlan: { mode: "copy", sourceAbr: null, sourceAcodec: "mp3", targetFormat: "mp3", targetBitrate: 320 } };
    h.write("queue.json", JSON.stringify([item]));
    const before = fs.readFileSync(h.p("queue.json"), "utf8");
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "present");
    assert.equal(got.outputs[0].path, file);
    assert.match(got.outputs[0].actualFormatLabel, /source preserved/i);
    assert.equal(got.identityState, "present");
    assert.equal(fs.readFileSync(h.p("queue.json"), "utf8"), before);
  });
});

test("unlinked files[]: missing (not folder-unavailable)", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/gone.mp3", "x");
    fs.unlinkSync(file);
    h.write("queue.json", JSON.stringify([{ id: "m1", status: "done", url: "https://example.com/g", files: [file], destId: "" }]));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "missing");
    assert.equal(got.identityState, "missing");
  });
});

test("no files: recover from History by url", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/old.mp3", "x");
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/old", title: "old.mp3", folder: path.dirname(file), file, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    h.write("queue.json", JSON.stringify([{ id: "h1", status: "done", url: "https://example.com/old", destId: "", format: "audio:mp3" }]));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "present");
    assert.equal(got.outputs[0].path, file);
  });
});

test("no files and no History: unknown; no path guessed from title", T, async () => {
  await withHarness({}, async (h) => {
    h.write("Music/Looks Like Title.mp3", "x");
    h.write("queue.json", JSON.stringify([{ id: "u1", status: "done", url: "https://example.com/u", title: "Looks Like Title.mp3", destId: "" }]));
    const [got] = await h.invoke("queue-get");
    assert.deepEqual(got.outputs, []);
    assert.equal(got.identityState, "unknown");
  });
});

test("playlist three files: three outputs; favorite removed => outside", T, async () => {
  await withHarness({}, async (h) => {
    const fav = h.mkdir("ext", "USB");
    const a = h.write("ext/USB/Playlist/1 - A.mp3", "a");
    const b = h.write("ext/USB/Playlist/2 - B.mp3", "b");
    const c = h.write("ext/USB/Playlist/3 - C.mp3", "c");
    h.setConfig({ favorite_folders: [] });
    h.write("queue.json", JSON.stringify([{
      id: "pl", status: "done", playlist: true, url: "https://example.com/pl",
      files: [a, b, c], destId: "p:" + fav,
    }]));
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs.length, 3);
    assert.ok(got.outputs.every((o) => o.state === "outside"));
    assert.equal(got.identityState, "outside");
  });
});

test("queue-update-item cannot plant files; queue-set cannot invent files on a new id", T, async () => {
  await withHarness({}, async (h) => {
    h.write("queue.json", JSON.stringify([{ id: "x", status: "done", url: "https://example.com/x", destId: "" }]));
    await h.invoke("queue-update-item", { id: "x", files: ["/etc/passwd"], outputDir: "/etc", encodePlan: { mode: "convert" } });
    const [got] = await h.invoke("queue-get");
    assert.ok(!got.files || got.files[0] !== "/etc/passwd");
    await h.invoke("queue-set", [{ id: "y", status: "done", url: "https://example.com/y", files: ["/etc/passwd"] }]);
    const q = await h.invoke("queue-get");
    const y = q.find((i) => i.id === "y");
    assert.ok(!y.files);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-concurrency=1 app/test/q12-identity.test.js`

Expected: FAIL — `outputs` undefined / planted `files` still stored.

- [ ] **Step 3: Implement resolver + sanitize**

In `app/main.js` next to queue helpers:

```javascript
function actualFormatLabel(item, filePath) {
  const ext = path.extname(filePath || "").replace(".", "").toLowerCase();
  const plan = item && item.encodePlan;
  if (plan && plan.mode === "copy") {
    const fmt = plan.targetFormat || ext || "audio";
    if (plan.sourceAbr != null) return `${fmt} source ~${Math.round(Number(plan.sourceAbr))} kbps preserved`;
    return `${fmt} source preserved`;
  }
  if (plan && plan.targetFormat) {
    return plan.targetBitrate ? `${plan.targetFormat} ${plan.targetBitrate}kbps` : String(plan.targetFormat);
  }
  if (item && item.format === "video:original") return "original";
  if (ext) return ext;
  return "";
}

function queueOutputAllowKeys(item) {
  const keys = new Set();
  if (item && Array.isArray(item.files)) {
    for (const f of item.files) {
      if (typeof f === "string" && f) keys.add(pathKey(f));
    }
  }
  return keys;
}

function classifyOutputPath(p, item) {
  if (!validPathArg(p)) return { path: p, actualExt: "", actualFormatLabel: "", bytes: null, state: "unknown" };
  const allow = new Set([...historyFileKeys(), ...queueOutputAllowKeys(item)]);
  const ext = path.extname(p);
  const label = actualFormatLabel(item, p);
  let bytes = null;
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) bytes = fs.statSync(p).size; } catch (_) {}
  const chk = checkManagedFile(p, allow);
  let state = "missing";
  if (chk.ok) state = "present";
  else if (chk.code === "outside") state = "outside";
  else if (chk.code === "missing") state = "missing";
  else if (!fs.existsSync(p)) state = "missing";
  else state = chk.code === "not_allowed" && !allow.has(pathKey(p)) ? (fs.existsSync(p) ? "outside" : "missing") : "missing";
  return { path: p, actualExt: ext, actualFormatLabel: label, bytes, state };
}

function collectCandidatePaths(item) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (typeof p !== "string" || !p || !path.isAbsolute(p)) return;
    const k = pathKey(p);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  if (Array.isArray(item.files)) item.files.forEach(add);
  if (!out.length && item.url) {
    const rows = readHistory(Number.MAX_SAFE_INTEGER).filter((r) => r && r.url === item.url && r.file);
    const prefer = item.outputDir;
    const ranked = prefer
      ? [...rows.filter((r) => r.folder === prefer || (r.folder && r.folder.startsWith(prefer + path.sep))), ...rows]
      : rows;
    ranked.forEach((r) => add(r.file));
  }
  return out;
}

function resolveQueueOutputs(item) {
  if (!item || item.status !== "done") return { outputs: [], identityState: null };
  const outputs = collectCandidatePaths(item).map((p) => classifyOutputPath(p, item));
  let identityState = "unknown";
  if (!outputs.length) identityState = "unknown";
  else if (outputs.some((o) => o.state === "present")) identityState = "present";
  else if (outputs.every((o) => o.state === "outside")) identityState = "outside";
  else if (outputs.some((o) => o.state === "missing")) identityState = "missing";
  return { outputs, identityState };
}

const MAIN_OWNED_FIELDS = ["files", "outputs", "outputDir", "encodePlan", "sourcePath"];

function stripMainOwned(item, previous) {
  const copy = { ...(item || {}) };
  for (const k of MAIN_OWNED_FIELDS) {
    if (previous && Object.prototype.hasOwnProperty.call(previous, k)) copy[k] = previous[k];
    else delete copy[k];
  }
  return copy;
}
```

Wire:

- `queue-get`: `loadQueue().map(it => it.status === "done" ? { ...it, ...resolveQueueOutputs(it) } : it)`
- `queue-set`: map incoming through `stripMainOwned(item, prevById.get(item.id))`
- `queue-add`: map through `stripMainOwned(item, null)` then assign id/status
- `queue-update-item`: `Object.assign` only after deleting MAIN_OWNED_FIELDS from the patch (never copy them from renderer)

`checkManagedFile` for a path that exists inside a root but is not in allow-keys returns `not_allowed`. Queue files[] that main persisted **are** in `queueOutputAllowKeys`, so they classify as present even without History. A History-recovered path is in `historyFileKeys`. A file sitting on disk that we never recorded and is outside roots → if we somehow had the path, `outside`; we do not guess title-based paths.

For `outside`: path is known, exists (or is lexically inside a former favorite), but current roots do not contain it. `checkManagedFile` already returns `outside` when the real path is not inside current roots. If the file exists and allow-set has it but roots do not → `outside`. If allow-set lacks it and it is inside a root → `not_allowed` from H1; treat as `outside` only when the path is not in allow-set **and** we still know it (files[]). If files[] has a path inside main, allow-set includes it → present.

Favorite-removed case: files[] listed, file exists under old fav, favs empty → `checkManagedFile` → `outside`. Good.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 app/test/q12-identity.test.js app/test/defaults.test.js`

Expected: PASS. Update defaults test: disk unchanged; get may include `outputs`/`identityState` on the done fixture (`unknown`, `[]`).

- [ ] **Step 5: Commit**

```bash
git add app/main.js app/test/q12-identity.test.js app/test/defaults.test.js
git commit -m "feat: resolve queue file identity without rewriting queue.json"
```

---

### Task 2: Reveal, Locate, Add-this-folder

**Files:**
- Modify: `app/test/q12-identity.test.js` (add cases)
- Modify: `app/main.js` (new IPC)
- Modify: `app/preload.js`

**Interfaces:**
- `queue-reveal-output(itemId, filePath) -> { ok } | { ok:false, code, error }`
- `queue-locate-file(itemId) -> { ok, outputs }` — dialog grant; refuse playlist when `identityState==="unknown"` or `item.playlist && !item.files`
- `queue-add-output-folder(itemId, filePath) -> { ok }` — registers `dirname(filePath)` as favorite if that path is the output’s dirname
- `let locatePick = null` single-use, like `mainFolderPick`

- [ ] **Step 1: Write the failing tests**

```javascript
test("reveal present file uses shell.showItemInFolder; missing/unknown refused", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/show-me.mp3", "x");
    h.write("queue.json", JSON.stringify([{ id: "s1", status: "done", url: "https://example.com/s", files: [file] }]));
    assert.deepEqual(await h.invoke("queue-reveal-output", "s1", file), { ok: true });
    assert.equal(h.opened.some((o) => o[0] === "reveal"), true);
    assert.equal((await h.invoke("queue-reveal-output", "s1", "/etc/passwd")).ok, false);
    h.write("queue.json", JSON.stringify([{ id: "u1", status: "done", url: "https://example.com/u" }]));
    assert.equal((await h.invoke("queue-reveal-output", "u1", file)).ok, false);
  });
});

test("locate non-playlist unknown: dialog file inside main becomes present + History", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/located.mp3", "LOCATED");
    h.write("queue.json", JSON.stringify([{ id: "l1", status: "done", url: "https://example.com/l", title: "located.mp3" }]));
    h.queueDialog(file);
    const r = await h.invoke("queue-locate-file", "l1");
    assert.equal(r.ok, true);
    const [got] = await h.invoke("queue-get");
    assert.equal(got.outputs[0].state, "present");
    const hist = await h.invoke("get-history", { limit: 10 });
    assert.ok(hist.some((row) => row.file === file));
  });
});

test("locate refuses outside roots and unknown playlists; does not copy", T, async () => {
  await withHarness({}, async (h) => {
    const outsider = h.write("outside/steal.mp3", "x");
    h.write("queue.json", JSON.stringify([{ id: "l2", status: "done", url: "https://example.com/l2" }]));
    h.queueDialog(outsider);
    const r = await h.invoke("queue-locate-file", "l2");
    assert.equal(r.ok, false);
    assert.equal((await h.invoke("queue-get"))[0].identityState, "unknown");
    h.write("queue.json", JSON.stringify([{ id: "pl", status: "done", playlist: true, url: "https://example.com/pl" }]));
    h.queueDialog(h.write("Music/p.mp3", "x"));
    assert.equal((await h.invoke("queue-locate-file", "pl")).ok, false);
  });
});

test("add-output-folder registers dirname; then outside becomes present", T, async () => {
  await withHarness({}, async (h) => {
    const fav = h.mkdir("ext", "USB");
    const file = h.write("ext/USB/track.mp3", "x");
    h.setConfig({ favorite_folders: [] });
    h.write("queue.json", JSON.stringify([{ id: "o1", status: "done", url: "https://example.com/o", files: [file] }]));
    assert.equal((await h.invoke("queue-get"))[0].identityState, "outside");
    const r = await h.invoke("queue-add-output-folder", "o1", file);
    assert.equal(r.ok, true);
    assert.ok((await h.invoke("get-favorites")).some((f) => f.path === fav));
    assert.equal((await h.invoke("queue-get"))[0].identityState, "present");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test --test-concurrency=1 app/test/q12-identity.test.js`

Expected: FAIL — handlers missing.

- [ ] **Step 3: Implement IPC**

```javascript
let locatePick = null;
ipcMain.handle("queue-reveal-output", async (_e, itemId, filePath) => {
  const item = loadQueue().find((i) => i.id === itemId);
  if (!item || item.status !== "done") return openFail("not_allowed", "That file is not one this app recorded for this action.");
  const { outputs } = resolveQueueOutputs(item);
  if (!outputs.some((o) => o.state === "present" && pathKey(o.path) === pathKey(filePath))) {
    return openFail("not_allowed", "That file is not one this app recorded for this action.");
  }
  const allow = new Set([...historyFileKeys(), ...queueOutputAllowKeys(item)]);
  const chk = checkManagedFile(filePath, allow);
  if (!chk.ok) return chk;
  try { shell.showItemInFolder(chk.real); } catch (_) { return openFail("open_failed", "The system could not show it."); }
  return { ok: true };
});

ipcMain.handle("queue-locate-file", async (_e, itemId) => {
  const q = loadQueue();
  const item = q.find((i) => i.id === itemId);
  if (!item || item.status !== "done") return openFail("not_allowed", "That item cannot be located.");
  const resolved = resolveQueueOutputs(item);
  const playlistUnknown = !!(item.playlist && resolved.identityState === "unknown");
  if (playlistUnknown) return openFail("not_allowed", "Locate one file at a time is not available for this playlist. Use History.");
  locatePick = null;
  const r = await dialog.showOpenDialog(mainWindow, { title: "Locate file", properties: ["openFile"] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  locatePick = r.filePaths[0];
  const picked = locatePick;
  locatePick = null;
  if (!validPathArg(picked)) return openFail("invalid", "Invalid file path.");
  const real = realOrNull(picked);
  if (!real) return openFail("missing", "File not found.");
  const roots = authorizedRoots();
  if (!roots.some((root) => root.real && isInside(root.real, real))) {
    return openFail("outside", "That file is outside the main folder and your favorite folders.");
  }
  let st;
  try { st = fs.statSync(real); } catch (_) { return openFail("missing", "File not found."); }
  if (!st.isFile()) return openFail("not_file", "Not a regular file.");
  const files = [real];
  patchQueueItem(item.id, { files, outputDir: path.dirname(real) });
  const histHas = historyFileKeys().has(pathKey(real));
  if (!histHas) {
    recordHistory({
      action: item.url ? (String(item.format || "").startsWith("video") ? "video" : "audio") : "located",
      url: item.url || "",
      title: path.basename(real),
      folder: path.dirname(real),
      file: real,
      details: actualFormatLabel({ ...item, files }, real) || "located",
    });
  }
  return { ok: true, ...resolveQueueOutputs(loadQueue().find((i) => i.id === itemId)) };
});

ipcMain.handle("queue-add-output-folder", (_e, itemId, filePath) => {
  const item = loadQueue().find((i) => i.id === itemId);
  if (!item || item.status !== "done") return openFail("not_allowed", "That folder cannot be added.");
  const { outputs } = resolveQueueOutputs(item);
  const hit = outputs.find((o) => pathKey(o.path) === pathKey(filePath));
  if (!hit) return openFail("not_allowed", "That file is not one this app recorded for this action.");
  if (!validPathArg(filePath)) return openFail("invalid", "Invalid file path.");
  const dir = path.dirname(filePath);
  const cfg = loadConfig();
  cfg.favorite_folders = Array.isArray(cfg.favorite_folders) ? cfg.favorite_folders : [];
  if (!cfg.favorite_folders.some((f) => samePath(f.path, dir))) {
    cfg.favorite_folders.push({ path: dir, name: path.basename(dir), added: new Date().toISOString() });
    saveConfig(cfg);
  }
  return { ok: true, path: dir, name: path.basename(dir) };
});
```

preload:

```javascript
queueClearFinished: () => ipcRenderer.invoke("queue-clear-finished"),
queueRemoveErrors: () => ipcRenderer.invoke("queue-remove-errors"),
queueRevealOutput: (id, p) => ipcRenderer.invoke("queue-reveal-output", id, p),
queueLocateFile: (id) => ipcRenderer.invoke("queue-locate-file", id),
queueAddOutputFolder: (id, p) => ipcRenderer.invoke("queue-add-output-folder", id, p),
```

(Clear handlers land in Task 3; adding preload stubs together is fine.)

- [ ] **Step 4: Run tests**

Run: `node --test --test-concurrency=1 app/test/q12-identity.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/main.js app/preload.js app/test/q12-identity.test.js
git commit -m "feat: Show, Locate, and add-output-folder for completed queue files"
```

---

### Task 3: Clear finished / Remove errors (list only)

**Files:**
- Modify: `app/test/q12-identity.test.js`
- Modify: `app/main.js`

**Interfaces:**
- `queue-clear-finished() -> { ok, removed }` — drops `status==="done"` only
- `queue-remove-errors() -> { ok, removed }` — drops `error|skipped|canceled|flagged`
- Neither calls `unlink`. Neither writes History. `queue-clear` (nuclear) stays for now unused by the new buttons.

- [ ] **Step 1: Failing tests**

```javascript
test("clear-finished removes done rows only; files and History stay", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/keep.mp3", "KEEP");
    fs.appendFileSync(h.p("download_history.jsonl"), JSON.stringify({
      action: "audio", url: "https://example.com/k", title: "keep.mp3", folder: path.dirname(file), file, time: "2026-01-01T00:00:00.000Z",
    }) + "\n");
    await h.invoke("queue-set", [
      { id: "d", status: "done", url: "https://example.com/k" },
      { id: "p", status: "pending", url: "https://example.com/p" },
      { id: "e", status: "error", url: "https://example.com/e", error: "x" },
    ]);
    // re-apply files via disk so sanitize does not strip a first insert — write json
    const q0 = JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"));
    q0[0].files = [file];
    fs.writeFileSync(h.p("queue.json"), JSON.stringify(q0));
    const bytes = fs.readFileSync(file);
    const histBefore = fs.readFileSync(h.p("download_history.jsonl"), "utf8");
    const r = await h.invoke("queue-clear-finished");
    assert.equal(r.ok, true);
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map((i) => i.id).sort(), ["e", "p"]);
    assert.equal(fs.readFileSync(file, "utf8"), bytes.toString());
    assert.equal(fs.readFileSync(h.p("download_history.jsonl"), "utf8"), histBefore);
  });
});

test("remove-errors drops error/skipped/canceled/flagged; keeps pending/running/done; no file delete", T, async () => {
  await withHarness({}, async (h) => {
    const file = h.write("Music/done.mp3", "D");
    h.write("queue.json", JSON.stringify([
      { id: "d", status: "done", url: "https://example.com/d", files: [file] },
      { id: "p", status: "pending", url: "https://example.com/p" },
      { id: "r", status: "running", url: "https://example.com/r" },
      { id: "e", status: "error", url: "https://example.com/e" },
      { id: "s", status: "skipped", url: "https://example.com/s" },
      { id: "c", status: "canceled", url: "https://example.com/c" },
      { id: "f", status: "flagged", url: "https://example.com/f" },
    ]));
    await h.invoke("queue-remove-errors");
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map((i) => i.id).sort(), ["d", "p", "r"]);
    assert.equal(fs.readFileSync(file, "utf8"), "D");
  });
});
```

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement**

```javascript
ipcMain.handle("queue-clear-finished", () => {
  const q = loadQueue().filter((i) => i.status !== "done");
  saveQueue(q);
  emitQueueChanged();
  return { ok: true, removed: true };
});
ipcMain.handle("queue-remove-errors", () => {
  const drop = new Set(["error", "skipped", "canceled", "flagged"]);
  saveQueue(loadQueue().filter((i) => !drop.has(i.status)));
  emitQueueChanged();
  return { ok: true, removed: true };
});
```

Do **not** stop the runner or kill the child.

- [ ] **Step 4: Pass + commit**

```bash
git commit -m "feat: clear finished and remove errors without deleting files"
```

---

### Task 4: Renderer Active / Completed layout

**Files:**
- Create: `app/test/q12-queue-clarity.test.js` (extend the fake-DOM pattern)
- Modify: `app/renderer/index.html`, `app/renderer/renderer.js`
- Modify: `app/test/queue-destination-display.test.js` (done rows have no dest select; running is read-only text; error/pending unchanged)

**Interfaces:**
- `ACTIVE_STATUSES = pending|running|error|skipped|flagged|canceled`
- `renderQueue` fills `#queueActiveRows` and `#queueCompletedRows`
- Done rows: no `select[data-field]`
- No button text/class `Move file` / `Convert a copy` / `Add local files`

- [ ] **Step 1: Failing renderer tests** (cut `renderQueue`, `buildFolderSelectOptions`, `destOptionsHtml`, `t`, `escapeHtml`, `lastSeg`, plus new helpers from renderer.js)

Assert:

1. Mixed queue → pending/error in Active, done in Completed; `data-section` attributes.
2. Done + orphan destId + `outputDir` + copy encodePlan → location text contains last segment of `outputDir`, not `Folder unavailable`; format text matches `/source preserved/`; no `320kbps`; no enabled/disabled dest/format select.
3. Pending damaged destId still shows unavailable select (existing contract).
4. HTML/source has no Move/Convert/Add local files controls.

- [ ] **Step 2: Fail, then implement HTML + renderQueue split**

HTML (replace single table):

- Paste confirm `<p id="queueAddPreview" class="q-preview" aria-live="polite">`
- Buttons: `#queueClearFinishedBtn`, `#queueRemoveErrorsBtn` (remove or hide `#queueClearBtn`)
- Two `<section>`s with headings `queue-active-h` / `queue-completed-h`
- Helper `#queueActiveHint`
- Apply button id stays `#queueApplyAll` (label changes)

CSS: `.q-sel, .q-act { min-height: 44px; }` `.q-remove` 44px. Status spans get `aria-label`.

`renderQueue`: partition items; Active rows as today for pending/error (selects); running = read-only dest/format text + progress; Completed = per `outputs` (or unknown/playlist empty state). Buttons: Show / Locate / Add this folder / Remove from list / Retry — only those that apply.

Playlist done with outputs: group header + child rows (`data-file-path`). Playlist unknown: text “These files may still appear in History.” + Remove from list only.

- [ ] **Step 3: Update destination-display tests** so done items are queried in Completed and have no folder select; pending/error cases unchanged.

- [ ] **Step 4: Pass + commit**

```bash
git commit -m "feat: split Queue into Active and Completed with honest locations"
```

---

### Task 5: Paste snapshot, actions, i18n, a11y

**Files:**
- Modify: `app/renderer/renderer.js` (I18N + handlers)
- Modify: `app/test/q12-queue-clarity.test.js`
- Modify: `app/test-browser/a11y-check.electron.js` (Queue headings + no completed selects + named actions) — runs only if Electron exists
- Modify: `app/test/normalize-warning.test.js` if `queue-update-item` can no longer set note-only on done (it still can; files stay stripped)

**Interfaces:**
- Queue-tab add snapshots `destId, format, bitrate, autoTag, loudnorm, lufs, playlist:false`
- `#queueAddPreview` updates on input/folder/format: `Add N links to {folder} as {format}`
- Apply-to-pending: pending only (already true); label `queue_apply_pending`
- Remove enabled when `item.status !== "running"` even if `queueRunning`
- `api.queueRevealOutput` / `queueLocateFile` / `queueAddOutputFolder` / `queueClearFinished` / `queueRemoveErrors`

- [ ] **Step 1: Tests**

```javascript
test("queue-tab add snapshots loudnorm/autoTag/lufs", …);
test("apply-to-pending does not change done destId", …);
test("completed present row exposes Show and Remove from list, not Move", …);
test("completed unknown non-playlist exposes Locate; playlist unknown does not", …);
test("ES and EN have the new keys", …);
```

Also a small main-side test: `queue-add` with `files:["/etc/passwd"]` strips them.

- [ ] **Step 2–4: Implement handlers + i18n keys (es/en pairs):**

`queue_active_h`, `queue_completed_h`, `queue_active_hint`, `queue_save_to`, `queue_download_as`, `queue_apply_pending`, `queue_clear_finished`, `queue_remove_errors`, `queue_add_preview`, `queue_add_preview_one`, `queue_show`, `queue_locate`, `queue_add_this_folder`, `queue_remove_list`, `queue_loc_unknown`, `queue_loc_missing`, `queue_loc_outside`, `queue_pl_history`, `queue_requested`, `queue_file_missing` — no `queue_move` / `queue_convert`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: snapshot queue add and wire Show/Locate/Remove"
```

---

### Task 6: Docs, fixture screenshot, review page, sequential suite

**Files:**
- `docs/USER_GUIDE.md` Queue section
- `docs/superpowers/specs/2026-11-06-queue-redesign-design.md` status
- `README.md` only if it describes the Queue table
- Fixture page `app/test-browser/q12-queue-fixture.html` + script to screenshot labeled **fixture** titles (`Fixture Tone 1kHz`, `Fixture Playlist A`, never user library names)
- Review canvas: Q1+Q2 implemented; Q3/Q4 proposed
- PR update

- [ ] **Step 1: Run full sequential suite; fix breakages** (`normalize-warning` done-row via update-item is still allowed for status/note; destination-display done selects).

Run: `node --test --test-concurrency=1 app/test/*.test.js`

- [ ] **Step 2: Screenshot fixture Queue (Chrome, labeled fixture data) to `/opt/cursor/artifacts/`**

- [ ] **Step 3: Docs + canvas + commit + push + PR**

---

## Self-review (plan vs approved spec Q1+Q2)

| Spec requirement | Task |
|---|---|
| Active vs Completed inside Queue | 4 |
| Pending folder/format = instructions; labels Save to / Download as | 4, 5 |
| Completed actual per-file location + honest format; no disabled selects | 1, 4 |
| present/missing/unknown/outside | 1 |
| Show / Locate / Remove from list | 2, 5 |
| Unknown playlists → History; no Locate | 2, 4 |
| Single-file Locate non-playlist unknown (+ missing) | 2 |
| Native picker; no renderer path trust | 1, 2 |
| Clear finished vs Remove errors; no file delete | 3 |
| Snapshot loudnorm/autoTag on Queue-tab add; paste confirm | 5 |
| Apply-to-pending only | 5 |
| No Move/Convert/Add-local buttons | 4, 5 |
| Keep playlists multi-file; old rows not erased | 1, 3 |
| 44px named buttons; ES/EN | 4, 5 |
| Q3/Q4 out of this run | all |
| Tests on production handlers | 1–3 |
| Renderer fixtures | 4–5 |
| Sequential suite | 6 |

No TBD steps. Types: `outputs[]`, `identityState`, IPC names consistent across tasks.
