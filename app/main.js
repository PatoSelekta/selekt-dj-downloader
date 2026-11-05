// Selekt DJ Downloader — Electron main process
// Native cross-platform downloader (Mac + Windows + Linux).
// Uses prebuilt yt-dlp + ffmpeg so members need nothing else installed.

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } = require("electron");

// Set app name early so the dock label reads "Selekt DJ Downloader" not "Electron".
app.setName("Selekt DJ Downloader");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");
const YTDlpWrap = require("yt-dlp-wrap").default;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const DATA_DIR = app.getPath("userData");
const BIN_DIR = path.join(DATA_DIR, "bin");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const HISTORY_FILE = path.join(DATA_DIR, "download_history.jsonl");
// Maps a downloaded YouTube id → the file it produced, so we can detect
// duplicates without embedding "[id]" in the (VirtualDJ-visible) filename.
const DL_INDEX_FILE = path.join(DATA_DIR, "downloaded_index.jsonl");
const YTDLP_PATH = path.join(BIN_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

// Feature 1 — Queue
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");

// Feature 2 — Watch-folder
const WATCH_PROCESSED_LOG = path.join(DATA_DIR, "watch_processed.log");

// Feature 3 — Fingerprint dedup
const FINGERPRINTS_FILE = path.join(DATA_DIR, "fingerprints.jsonl");
const FPCALC_PATH = path.join(BIN_DIR, process.platform === "win32" ? "fpcalc.exe" : "fpcalc");

let mainWindow = null;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); }
  catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
// ---------------------------------------------------------------------------
// Defaults for a fresh configuration
//  - A key that is ABSENT from config.json was never saved: the default below applies.
//  - A key that is PRESENT (true or false) is an explicit choice and always wins.
//  - Defaults are never written into config.json, so they cannot override a saved choice.
// Audio format and quality are not saved between launches (the Download tab starts from these each
// time); renderer.js DEFAULT_AUDIO_BITRATE and the selected <option>s in index.html mirror them, and
// test/defaults.test.js checks that all of them agree.
// ---------------------------------------------------------------------------
const DEFAULTS = Object.freeze({
  audioFormat: "mp3",
  audioBitrate: "320",       // kbps, as a string (the <select> value)
  loudnorm: true,            // Normalize volume
  lufs: -14,                 // Normalization target
  prevent_duplicates: true,  // Avoid duplicates
  auto_tag: true,            // Auto-tag
  // "Download entire playlist" is a per-download toggle (off), not a saved setting.
});
function cfgFlag(cfg, key) {
  const v = cfg[key];
  return v === undefined || v === null ? DEFAULTS[key] : !!v;
}
function cfgLufs(cfg) { return Number(cfg.lufs) || DEFAULTS.lufs; }

function mainFolder() {
  const cfg = loadConfig();
  return cfg.main_folder || path.join(os.homedir(), "Downloads");
}

// ---------------------------------------------------------------------------
// Folder names and download destinations
//  - A subfolder name is ONE path segment under the main folder: no separators,
//    no "."/".." , no control characters. Anything else is rejected.
//  - A download/duplicate-check destination is authorized only if it is exactly
//    the main folder or exactly one of the favorite folders the user added with
//    the folder picker (descendants are not accepted). Rejected destinations are
//    never created, listed or redirected.
//  - Matching is by normalized path, or by real path (symlink/case aliases of an
//    existing root). A subfolder that exists must really live directly inside the
//    main folder (a symlink pointing elsewhere is rejected).
// ---------------------------------------------------------------------------
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function checkFolderName(name) {
  const bad = { ok: false, error: "Invalid folder name." };
  if (typeof name !== "string" || !name || name.length > 255) return bad;
  if (/[\\/\u0000-\u001f\u007f]/.test(name)) return bad;          // separators, NUL, control chars
  if (name !== name.trim() || /[. ]$/.test(name)) return bad;       // edge whitespace; "." ".." "x."
  if (process.platform === "win32" && (/[<>:"|?*]/.test(name) || WIN_RESERVED_NAME.test(name))) return bad;
  return { ok: true, name };
}
function realOrNull(p) { try { return fs.realpathSync.native(p); } catch (_) { return null; } }
function entryExists(p) { try { fs.lstatSync(p); return true; } catch (_) { return false; } }
function samePath(a, b) {
  const x = path.resolve(a), y = path.resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}
function sameRealDir(a, b) {
  const x = realOrNull(a), y = realOrNull(b);
  return !!x && !!y && samePath(x, y);
}
// A subfolder of the main folder -> { ok, dir } (nothing is created here).
function resolveSubfolder(name) {
  const chk = checkFolderName(name);
  if (!chk.ok) return chk;
  const base = mainFolder();
  const dir = path.join(base, name);
  if (entryExists(dir)) {
    const real = realOrNull(dir), realBase = realOrNull(base);
    if (!real || !realBase || !samePath(path.dirname(real), realBase)) {
      return { ok: false, error: "That folder is not directly inside the main folder." };
    }
  }
  return { ok: true, dir };
}
// Where a download / duplicate check may write or look: the main folder, one of
// its subfolders (folder), or a favorite (targetPath) -> { ok, dir }.
function resolveDestination(targetPath, folder) {
  // Absent (undefined/null) means "not supplied"; a supplied value that is empty or
  // malformed is an error, never a silent fallback to the main folder. The main
  // folder is chosen explicitly: no targetPath and folder "" / absent.
  if (targetPath !== undefined && targetPath !== null) {
    const notAllowed = { ok: false, error: "That destination is not the main folder or one of your favorite folders. Choose it again from the list, or add it as a favorite." };
    if (typeof targetPath !== "string" || !targetPath.trim() || targetPath.includes("\u0000") || !path.isAbsolute(targetPath)) return notAllowed;
    const cfg = loadConfig();
    const favs = (Array.isArray(cfg.favorite_folders) ? cfg.favorite_folders : [])
      .map(f => f && f.path).filter(p => typeof p === "string" && path.isAbsolute(p));
    for (const root of [mainFolder(), ...favs]) {
      if (samePath(targetPath, root) || sameRealDir(targetPath, root)) return { ok: true, dir: root };
    }
    return notAllowed;
  }
  if (folder !== undefined && folder !== null && folder !== "") return resolveSubfolder(folder);
  return { ok: true, dir: mainFolder() };
}
function resolveOutput(folder) {
  const r = folder ? resolveSubfolder(folder) : { ok: true, dir: mainFolder() };
  if (!r.ok) throw new Error(r.error);
  fs.mkdirSync(r.dir, { recursive: true });
  return r.dir;
}

// ---------------------------------------------------------------------------
// Opening, revealing and trashing files and folders (H1)
//  A renderer-supplied path is acted on only if ALL of these hold:
//   1. it is a plain absolute string (no NUL, bounded length);
//   2. it is a file this app recorded: open-file -> a row of the download history;
//      reveal -> a history row or a file offered in a fingerprint-duplicate warning;
//      delete-file -> the NEW file of a fingerprint-duplicate warning (nothing else);
//   3. its REAL path (symlinks resolved) is a regular file inside the real path of
//      the current main folder or of a current favorite folder (descendants allowed;
//      sibling prefixes such as /a/Music-evil are not inside /a/Music);
//   4. for trash, the path itself is not a symlink.
//  The action then uses the resolved real path, not the caller's spelling.
//  Folders: open-favorite only opens a folder that is a registered favorite
//  (exact match); open-folder reuses the H3 subfolder rules.
//  Rejections return { ok:false, code, error } and perform no shell action.
//  Not covered: the config/history/fingerprint files themselves are trusted local
//  data; a swap between the check and the shell call (TOCTOU) is not prevented; the
//  OS then opens an authorized file with its default handler (no file-type filter).
//  Files whose folder is no longer the main folder or a favorite are rejected
//  ("outside"), never redirected; adding that folder as a favorite again restores them.
// ---------------------------------------------------------------------------
function isInside(root, p, pm = path) {
  const rel = pm.relative(root, p);
  return !!rel && rel !== ".." && !rel.startsWith(".." + pm.sep) && !pm.isAbsolute(rel);
}
function pathKey(p) {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}
function validPathArg(p) {
  return typeof p === "string" && p.length > 0 && p.length <= 4096 && !p.includes("\u0000") && path.isAbsolute(p);
}
function authorizedRoots() {
  const cfg = loadConfig();
  const favs = (Array.isArray(cfg.favorite_folders) ? cfg.favorite_folders : [])
    .map(f => f && f.path).filter(p => typeof p === "string" && path.isAbsolute(p));
  return [mainFolder(), ...favs].map(r => ({ root: path.resolve(r), real: realOrNull(r) }));
}
function openFail(code, error) { return { ok: false, code, error }; }
// ---- Fingerprint-duplicate offer: the permission behind the warning's Reveal / Delete ----
// Lifecycle (one live offer at most, mirroring the one warning the renderer can show):
//   created   only by main, when it detects a duplicate in a single-mode download (never from a
//             renderer-supplied path, never for queue-mode downloads, which show no warning);
//             it gets a fresh id that is sent in the "fingerprint-dup" event.
//   superseded/revoked   by a newer offer, by "fingerprint-dismiss" (Keep both), by a renderer
//             (re)load, or by a successful trash. A revoked offer grants nothing: delete-file and
//             the extra reveal grant for its files are refused. Revoking by id never touches a
//             different offer, so a late dismissal of an old warning cannot revoke a newer one.
//   state     "offered" -> "trashing" (set synchronously before the OS call: a second request for
//             the same offer is refused with code "in_progress") -> consumed on success, or back
//             to "offered" on failure (retry allowed only while the offer is still live).
//   revoked while "trashing": the already-started OS operation is NOT cancelled and still reports
//             its own result to its caller; no further request can use the offer, so a failed
//             trash cannot be retried from that (now closed) warning.
let fpLive = null;   // { id, newFile, matchFile, state: "offered" | "trashing", revoked }
function offerFingerprint(newFile, matchFile) {
  revokeFingerprintOffer(fpLive && fpLive.id);
  fpLive = { id: randomUUID(), newFile, matchFile, state: "offered", revoked: false };
  return fpLive.id;
}
// -> { revoked, trashInProgress }; only the live offer with exactly this id is affected.
function revokeFingerprintOffer(id) {
  if (!fpLive || typeof id !== "string" || fpLive.id !== id) return { revoked: false, trashInProgress: false };
  const trashInProgress = fpLive.state === "trashing";
  fpLive.revoked = true;
  fpLive = null;
  return { revoked: true, trashInProgress };
}
function historyFileKeys() {
  const keys = new Set();
  for (const r of readHistory(Number.MAX_SAFE_INTEGER)) {
    if (r && typeof r.file === "string" && r.file) keys.add(pathKey(r.file));
  }
  return keys;
}
// Files the live offer lets the warning's "Open original" reveal (beyond history rows).
function offeredRevealKeys() {
  const keys = new Set();
  if (fpLive) {
    keys.add(pathKey(fpLive.newFile));
    if (typeof fpLive.matchFile === "string" && fpLive.matchFile) keys.add(pathKey(fpLive.matchFile));
  }
  return keys;
}
// -> { ok:true, real } | { ok:false, code, error }
function checkManagedFile(p, allowedKeys, { forTrash = false } = {}) {
  if (!validPathArg(p)) return openFail("invalid", "Invalid file path.");
  if (!allowedKeys.has(pathKey(p))) return openFail("not_allowed", "That file is not one this app recorded for this action.");
  const roots = authorizedRoots();
  const real = realOrNull(p);
  if (!real) {
    // Missing: only say so for paths that would be inside a root (no existence oracle elsewhere).
    const lex = path.resolve(p);
    const inside = roots.some(r => isInside(r.root, lex) || (r.real && isInside(r.real, lex)));
    return inside ? openFail("missing", "File not found.")
                  : openFail("outside", "That file is outside the main folder and your favorite folders.");
  }
  if (!roots.some(r => r.real && isInside(r.real, real))) {
    return openFail("outside", "That file is outside the main folder and your favorite folders.");
  }
  let st;
  try { st = fs.statSync(real); } catch (_) { return openFail("missing", "File not found."); }
  if (!st.isFile()) return openFail("not_file", "Not a regular file.");
  if (forTrash) {
    let l;
    try { l = fs.lstatSync(p); } catch (_) { return openFail("missing", "File not found."); }
    if (l.isSymbolicLink()) return openFail("symlink", "Refusing to trash a symbolic link.");
  }
  return { ok: true, real };
}
// A registered favorite, exactly (not the main folder, not a descendant) -> { ok, dir, ... }.
function resolveFavorite(p) {
  if (!validPathArg(p)) return openFail("invalid", "Invalid folder path.");
  const cfg = loadConfig();
  const favs = (Array.isArray(cfg.favorite_folders) ? cfg.favorite_folders : [])
    .map(f => f && f.path).filter(x => typeof x === "string" && path.isAbsolute(x));
  for (const root of favs) {
    if (samePath(p, root) || sameRealDir(p, root)) {
      let st;
      try { st = fs.statSync(root); } catch (_) { return openFail("missing", "Folder not found."); }
      if (!st.isDirectory()) return openFail("missing", "Folder not found.");
      return { ok: true, dir: root };
    }
  }
  return openFail("not_allowed", "That folder is not one of your favorite folders.");
}
async function openWithShell(target) {
  try {
    const err = await shell.openPath(target);
    if (err) return openFail("open_failed", "The system could not open it.");
    return { ok: true };
  } catch (_) { return openFail("open_failed", "The system could not open it."); }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function recordHistory(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    entry.time = new Date().toISOString();
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + "\n");
  } catch (e) { /* never break a download over logging */ }
}
function readHistory(limit = 50, contains = null) {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  let rows = fs.readFileSync(HISTORY_FILE, "utf-8")
    .split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  if (contains) {
    const c = contains.toLowerCase();
    rows = rows.filter(r =>
      ((r.title || "") + (r.folder || "") + (r.file || "")).toLowerCase().includes(c));
  }
  return rows.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Feature 1 — Queue helpers
// ---------------------------------------------------------------------------
function loadQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8")); }
  catch { return []; }
}
function saveQueue(q) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}

ipcMain.handle("queue-get", () => loadQueue());

ipcMain.handle("queue-set", (_e, q) => { saveQueue(q); return { ok: true }; });

ipcMain.handle("queue-add", (_e, items) => {
  const q = loadQueue();
  const newItems = (items || []).map(item => ({
    id: randomUUID(), status: "pending", title: null, error: null, ...item,
  }));
  q.push(...newItems);
  saveQueue(q);
  return { ok: true, items: newItems };
});

ipcMain.handle("queue-clear", () => { saveQueue([]); return { ok: true }; });

ipcMain.handle("queue-update-item", (_e, patch) => {
  const q = loadQueue();
  const i = q.findIndex(x => x.id === patch.id);
  if (i >= 0) { Object.assign(q[i], patch); saveQueue(q); }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Feature 2 — Watch-folder helpers
// ---------------------------------------------------------------------------
let watcher = null;

function defaultWatchInboxPath() {
  // Default to iCloud Drive inbox file
  return path.join(
    os.homedir(), "Library", "Mobile Documents",
    "com~apple~CloudDocs", "SelektQueue", "inbox.txt"
  );
}

// The watch destination is a queue destId (same ids as the Queue's folder selects): "" = main folder,
// "f:<subfolder>", "p:<favorite path>". Settings saves it as `destid` (config key watch_destid).
// It is NOT checked when saved: it is checked when each queued item runs (resolveDestination), so a destination that
// became invalid later (favorite removed, ...) fails visibly per item instead of being redirected.

function enqueueFromWatch(urls) {
  const q = loadQueue();
  const cfg = loadConfig();
  // Not set (absent/null) = main folder. Anything else is passed through exactly as stored: a stale or
  // malformed value then fails visibly when that item runs; it is never turned into the main folder here.
  const destId = (cfg.watch_destid === undefined || cfg.watch_destid === null) ? "" : cfg.watch_destid;
  let added = 0;
  urls.forEach(url => {
    // Skip if URL already queued and not errored
    if (q.some(i => i.url === url && i.status !== "error")) return;
    q.push({
      id: randomUUID(),
      url,
      destId,
      type: "audio",
      audioFormat: DEFAULTS.audioFormat,
      bitrate: DEFAULTS.audioBitrate,
      status: "pending",
      title: null,
      error: null,
      source: "watch",
    });
    added++;
  });
  if (added) saveQueue(q);
  return added;
}

function ingestInbox(inboxPath) {
  try {
    const done = new Set(
      fs.existsSync(WATCH_PROCESSED_LOG)
        ? fs.readFileSync(WATCH_PROCESSED_LOG, "utf-8").split("\n").filter(Boolean)
        : []
    );
    const lines = fs.readFileSync(inboxPath, "utf-8")
      .split("\n")
      .map(s => s.trim())
      .filter(s => /^https?:\/\//.test(s));
    const fresh = lines.filter(u => !done.has(u));
    if (!fresh.length) return;
    const added = enqueueFromWatch(fresh);
    fresh.forEach(u => fs.appendFileSync(WATCH_PROCESSED_LOG, u + "\n"));
    if (mainWindow) {
      mainWindow.webContents.send("queue-changed");
      const cfg2 = loadConfig();
      if (added && cfg2.watch_autorun) mainWindow.webContents.send("queue-run");
    }
  } catch (e) { /* never break on watch errors */ }
}

function startWatchFile(inboxPath) {
  stopWatch();
  if (!inboxPath) return;
  try {
    fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
    if (!fs.existsSync(inboxPath)) fs.writeFileSync(inboxPath, "");
    const chokidar = require("chokidar");
    watcher = chokidar.watch(inboxPath, {
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    watcher.on("change", () => ingestInbox(inboxPath));
    ingestInbox(inboxPath); // catch up on launch
  } catch (e) {
    status("Watch setup issue: " + e.message);
  }
}

function stopWatch() {
  if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
}

ipcMain.handle("watch-get", () => {
  const cfg = loadConfig();
  return {
    enabled: !!cfg.watch_enabled,
    inbox_path: cfg.watch_inbox_path || defaultWatchInboxPath(),
    // Returned as stored (a stale/malformed value is shown as such by Settings, not hidden as "main folder").
    destid: (cfg.watch_destid === undefined || cfg.watch_destid === null) ? "" : cfg.watch_destid,
    autorun: !!cfg.watch_autorun,
  };
});

ipcMain.handle("watch-set", (_e, vals) => {
  const cfg = loadConfig();
  if (vals.enabled !== undefined) cfg.watch_enabled = !!vals.enabled;
  if (vals.inbox_path !== undefined) cfg.watch_inbox_path = vals.inbox_path;
  if (vals.destid !== undefined) cfg.watch_destid = vals.destid;
  if (vals.autorun !== undefined) cfg.watch_autorun = !!vals.autorun;
  saveConfig(cfg);
  if (cfg.watch_enabled) startWatchFile(cfg.watch_inbox_path || defaultWatchInboxPath());
  else stopWatch();
  return { ok: true };
});

ipcMain.handle("watch-start", () => {
  const cfg = loadConfig();
  if (cfg.watch_inbox_path || true) {
    startWatchFile(cfg.watch_inbox_path || defaultWatchInboxPath());
  }
  return { ok: true };
});

ipcMain.handle("watch-stop", () => { stopWatch(); return { ok: true }; });

// ---------------------------------------------------------------------------
// Feature 3 — Audio fingerprint dedup helpers
// ---------------------------------------------------------------------------
function fingerprintFile(file) {
  return new Promise((res) => {
    if (!fs.existsSync(file)) return res(null);
    // Try BIN_DIR first, then system PATH
    const fpcalc = fs.existsSync(FPCALC_PATH) ? FPCALC_PATH : "fpcalc";
    let buf = "";
    const c = spawn(fpcalc, ["-json", file], { windowsHide: true });
    c.stdout.on("data", d => { buf += d; });
    c.on("error", () => res(null)); // fpcalc not found
    c.on("close", code => {
      if (code !== 0) return res(null);
      try { res(JSON.parse(buf)); } catch { res(null); }
    });
  });
}

function loadFingerprintLib() {
  if (!fs.existsSync(FINGERPRINTS_FILE)) return [];
  return fs.readFileSync(FINGERPRINTS_FILE, "utf-8")
    .split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function appendFingerprint(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(FINGERPRINTS_FILE, JSON.stringify(entry) + "\n");
  } catch (_) {}
}

// Decode Chromaprint base64 fingerprint → array of uint32 (little-endian)
function decodeChromaprintFP(fp) {
  try {
    const buf = Buffer.from(fp, "base64");
    const arr = [];
    for (let i = 0; i + 3 < buf.length; i += 4) {
      arr.push(buf.readUInt32LE(i));
    }
    return arr;
  } catch { return null; }
}

// Chromaprint bit-error-rate similarity (1 = identical, 0 = no match)
function fpSimilarity(fp1, fp2) {
  const a1 = decodeChromaprintFP(fp1);
  const a2 = decodeChromaprintFP(fp2);
  if (!a1 || !a2 || !a1.length || !a2.length) return 0;
  const len = Math.min(a1.length, a2.length);
  let matchingBits = 0;
  for (let i = 0; i < len; i++) {
    // Bit-count the matching bits (32 - popcount(xor))
    let xor = (a1[i] ^ a2[i]) >>> 0;
    // Brian Kernighan popcount
    let diff = 0;
    while (xor) { xor &= xor - 1; diff++; }
    matchingBits += (32 - diff);
  }
  return matchingBits / (len * 32);
}

// Returns matched library entry or null. Also stores new fingerprint.
async function checkFingerprintDuplicate(file, videoId, threshold) {
  const info = await fingerprintFile(file);
  if (!info || !info.fingerprint || !info.duration || info.duration < 60) return null;

  const lib = loadFingerprintLib();
  const DUR_DELTA = 3; // seconds
  const match = lib.find(e => {
    if (!e.fp || !e.file || e.file === file) return false;
    if (Math.abs((e.duration || 0) - info.duration) > DUR_DELTA) return false;
    return fpSimilarity(e.fp, info.fingerprint) >= threshold;
  });

  // Append AFTER match check so we don't match ourselves on re-run
  appendFingerprint({
    file, id: videoId || "", duration: info.duration, fp: info.fingerprint,
    time: new Date().toISOString(),
  });

  return match || null;
}

ipcMain.handle("fingerprint-get-settings", () => {
  const cfg = loadConfig();
  // Check if fpcalc is findable
  const fpcalcInBin = fs.existsSync(FPCALC_PATH);
  return {
    enabled: !!cfg.fingerprint_enabled,
    threshold: cfg.fingerprint_threshold || 0.90,
    fpcalc_available: fpcalcInBin,
    fpcalc_path: fpcalcInBin ? FPCALC_PATH : "(system PATH or not found)",
  };
});

ipcMain.handle("fingerprint-set-enabled", (_e, v) => {
  const cfg = loadConfig(); cfg.fingerprint_enabled = !!v; saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle("fingerprint-set-threshold", (_e, v) => {
  const cfg = loadConfig(); cfg.fingerprint_threshold = Number(v) || 0.90; saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle("fingerprint-rebuild", async () => {
  try { fs.writeFileSync(FINGERPRINTS_FILE, ""); } catch (_) {}
  const rows = readHistory(2000);
  let count = 0;
  for (const r of rows) {
    if (!r.file || !fs.existsSync(r.file)) continue;
    const ext = path.extname(r.file).toLowerCase();
    if (![".mp3", ".m4a", ".flac", ".wav"].includes(ext)) continue;
    const info = await fingerprintFile(r.file);
    if (!info || !info.fingerprint) continue;
    appendFingerprint({
      file: r.file, id: r.url || "", duration: info.duration || 0,
      fp: info.fingerprint, time: r.time || new Date().toISOString(),
    });
    count++;
  }
  return { ok: true, count };
});

// Move the NEW file of the live fingerprint-duplicate offer to the OS trash (recoverable).
// Arguments: (filePath, offerId). Both must match the live offer main created; the path alone
// is never an authority. The trash call is awaited: { ok:true } means it completed; a failure is
// { ok:false, code:"trash_failed" } and leaves the offer retryable. While one request is in
// progress a second one is refused ({ code:"in_progress" }) without a second OS call.
ipcMain.handle("delete-file", async (_e, filePath, offerId) => {
  if (!validPathArg(filePath)) return openFail("invalid", "Invalid file path.");
  const offer = fpLive;
  if (!offer || typeof offerId !== "string" || offer.id !== offerId) {
    return openFail("not_allowed", "That file is not one this app recorded for this action.");
  }
  if (offer.state === "trashing") return openFail("in_progress", "That file is already being moved to the trash.");
  const chk = checkManagedFile(filePath, new Set([pathKey(offer.newFile)]), { forTrash: true });
  if (!chk.ok) return chk;
  offer.state = "trashing";                      // synchronous: no await between the check above and this line
  try {
    await shell.trashItem(chk.real);
  } catch (_) {
    if (!offer.revoked) offer.state = "offered"; // still the live warning: the user may retry
    return openFail("trash_failed", "Could not move the file to the trash. It was not deleted.");
  }
  revokeFingerprintOffer(offer.id);              // consumed (no-op if it was already revoked meanwhile)
  return { ok: true };
});

// "Keep both" / warning closed or replaced in the renderer: revoke that offer. This does not
// cancel a trash operation that is already running; the reply says whether one was.
ipcMain.handle("fingerprint-dismiss", (_e, offerId) => ({ ok: true, ...revokeFingerprintOffer(offerId) }));

// ---------------------------------------------------------------------------
// Binary setup: copy ffmpeg/ffprobe into one dir, ensure yt-dlp is present
// ---------------------------------------------------------------------------
// The renderer only subscribes once its page has loaded, but setup can finish (or fail) before that.
// So the latest message is remembered and replayed on did-finish-load (see app.whenReady below).
let setupMsg = "";
// A non-fatal setup problem (e.g. ffmpeg could not be copied). A later "Ready." must not hide it.
let setupIssue = null;
function status(msg) {
  setupMsg = msg;
  if (mainWindow) mainWindow.webContents.send("setup-status", msg);
}
function statusReady() { status(setupIssue || "Ready."); }

function copyBinary(src, destName) {
  const dest = path.join(BIN_DIR, destName);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  }
  return dest;
}

// yt-dlp is shipped by the project as per-OS standalone builds. The macOS/Linux
// standalones BUNDLE their own Python, so they don't depend on the user's system
// Python (which recent yt-dlp requires to be >= 3.10). Using the plain zipapp is
// what triggers "unsupported version of Python".
const YTDLP_VARIANT_FILE = path.join(BIN_DIR, ".ytdlp_variant");
const YTDLP_VARIANT = "standalone-1";   // bump to force a one-time re-download
function ytdlpAssetName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";   // universal, bundles Python
  return "yt-dlp_linux";                                       // bundles Python
}

// Download limits. The stall limit is a socket-idle timeout (no bytes for this long = dead
// connection); the total limit bounds the whole attempt, redirects included.
const DL_STALL_MS = 30 * 1000;
const DL_TOTAL_MS = 10 * 60 * 1000;
// Sanity floor for a yt-dlp build (real ones are ~10-40 MB). Catches an HTML/JSON error page
// served with HTTP 200. This is a plausibility check only, NOT an integrity or authenticity check.
const YTDLP_MIN_BYTES = 1024 * 1024;

// Stream a URL to a UNIQUE temp file next to `dest`, following https redirects, then move it into
// place with one rename. The returned promise ALWAYS settles (resolve, or reject with an Error):
// connection drop / premature close, stalled socket, overall timeout, bad status, wrong length and
// disk errors all end in one place, which removes the temp file. `dest` is only ever replaced by a
// complete, size-checked file, so an existing file survives any failure.
//   opts.minBytes  reject bodies smaller than this
//   opts.mode      chmod the temp file BEFORE the rename (so no non-executable replacement is exposed)
function downloadTo(url, dest, opts = {}) {
  const minBytes = opts.minBytes || 0;
  const stallMs = opts.stallMs || DL_STALL_MS;
  const totalMs = opts.totalMs || DL_TOTAL_MS;
  const tmp = `${dest}.${randomUUID()}.part`;
  return new Promise((resolve, reject) => {
    let done = false, req = null, file = null, deadline = null;

    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      try { if (req) req.destroy(); } catch (_) {}
      const e = err instanceof Error ? err : new Error(String(err));
      const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) {} reject(e); };
      if (file && !file.closed) { file.once("close", cleanup); file.destroy(); }   // unlink after the handle is released (Windows)
      else cleanup();
    };

    const get = (target, hops) => {
      if (done) return;
      if (hops > 6) return fail(new Error("Too many redirects"));
      let u;
      try { u = new URL(target); } catch (_) { return fail(new Error("Invalid download URL")); }
      if (u.protocol !== "https:") return fail(new Error("Refusing non-https download"));
      const mine = https.get(u.href, { headers: { "User-Agent": "Selekt-DJ-Downloader" } }, (res) => {
        if (done || req !== mine) { res.resume(); return; }
        const sc = res.statusCode;
        if (sc >= 300 && sc < 400 && res.headers.location) {
          res.resume();
          let next;
          try { next = new URL(res.headers.location, u).href; } catch (_) { return fail(new Error("Invalid redirect")); }
          return get(next, hops + 1);
        }
        if (sc !== 200) { res.resume(); return fail(new Error("HTTP " + sc)); }
        const lenHdr = String(res.headers["content-length"] || "");
        const expected = /^\d+$/.test(lenHdr) ? Number(lenHdr) : null;
        let received = 0;
        file = fs.createWriteStream(tmp, { flags: "wx" });
        file.on("error", fail);
        res.on("data", (c) => { received += c.length; });
        res.on("error", fail);
        res.on("aborted", () => fail(new Error("Connection lost during download")));
        res.on("close", () => { if (!res.complete) fail(new Error("Connection lost during download")); });
        file.on("finish", () => file.close(() => {
          if (done) return;
          if (expected !== null && received !== expected) return fail(new Error(`Incomplete download (${received} of ${expected} bytes)`));
          if (received < minBytes) return fail(new Error(`Download too small (${received} bytes)`));
          try {
            if (opts.mode != null) fs.chmodSync(tmp, opts.mode);
            fs.renameSync(tmp, dest);
          } catch (e) { return fail(e); }
          done = true;
          clearTimeout(deadline);
          resolve();
        }));
        res.pipe(file);
      });
      req = mine;
      mine.on("error", (e) => { if (req === mine) fail(e); });
      mine.setTimeout(stallMs, () => { if (req === mine) fail(new Error("Download stalled")); });
    };

    deadline = setTimeout(() => fail(new Error("Download timed out")), totalMs);
    if (deadline.unref) deadline.unref();
    get(url, 0);
  });
}

// Leftovers of a crashed/killed earlier run (temp names are unique per attempt, so nothing else
// ever reuses them). Only files older than an hour are touched, in case another instance is mid-download.
function sweepStaleYtdlpParts() {
  try {
    const base = path.basename(YTDLP_PATH) + ".";
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const n of fs.readdirSync(BIN_DIR)) {
      if (!n.startsWith(base) || !n.endsWith(".part")) continue;
      const f = path.join(BIN_DIR, n);
      try { if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f); } catch (_) {}
    }
  } catch (_) {}
}

// ONE install/update at a time. Launch setup, the daily refresh, the forced stale-engine update and
// the per-download ensureBinaries() all funnel through here, so they share a single transfer instead
// of racing on the same file; every concurrent caller gets the same result (or the same error).
let ytdlpInstall = null;
function downloadYtdlp() {
  if (!ytdlpInstall) {
    ytdlpInstall = (async () => {
      sweepStaleYtdlpParts();
      const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAssetName()}`;
      await downloadTo(url, YTDLP_PATH, { minBytes: YTDLP_MIN_BYTES, mode: process.platform === "win32" ? null : 0o755 });
      try { fs.writeFileSync(YTDLP_VARIANT_FILE, YTDLP_VARIANT); } catch (_) {}
    })().finally(() => { ytdlpInstall = null; });
  }
  return ytdlpInstall;
}

async function ensureBinaries() {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // ffmpeg + ffprobe shipped via npm packages — copy into one folder.
  const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  setupIssue = null;
  try {
    copyBinary(ffmpegStatic, ffmpegName);
    copyBinary(ffprobeStatic.path, ffprobeName);
  } catch (e) {
    setupIssue = "ffmpeg setup issue: " + e.message;
    status(setupIssue);
  }

  // Re-download yt-dlp if it's missing OR if it's an older variant (e.g. the
  // Python-dependent build) — this replaces a broken binary exactly once.
  let variantOk = false;
  try { variantOk = fs.readFileSync(YTDLP_VARIANT_FILE, "utf-8").trim() === YTDLP_VARIANT; } catch (_) {}

  if (!fs.existsSync(YTDLP_PATH) || !variantOk) {
    status("Setting up the download engine…");
    try {
      await downloadYtdlp();
    } catch (e) {
      status("Could not download yt-dlp: " + e.message);
      throw e;
    }
  } else {
    // Keep yt-dlp fresh (stale binary → "HTTP Error 403" once YouTube changes
    // things). Refresh in the background if older than 7 days, once per launch.
    maybeRefreshYtdlp();
  }
  statusReady();
}

// Ask GitHub what the newest yt-dlp release is (redirect target of /releases/latest).
// Uses the redirect rather than the JSON API so there is no rate limit to hit.
function latestYtdlpTag() {
  return new Promise((resolve) => {
    const req = https.request(
      { host: "github.com", path: "/yt-dlp/yt-dlp/releases/latest", method: "HEAD",
        headers: { "User-Agent": "Selekt-DJ-Downloader" } },
      (res) => {
        res.resume();
        const m = String(res.headers.location || "").match(/\/tag\/([^/?#]+)/);
        resolve(m ? decodeURIComponent(m[1]) : null);
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { try { req.destroy(); } catch (_) {} resolve(null); });
    req.end();
  });
}

// Version string of the binary we currently ship (null if it can't be run).
function localYtdlpVersion() {
  return new Promise((resolve) => {
    try {
      const c = spawn(YTDLP_PATH, ["--version"], { windowsHide: true });
      let out = "";
      c.stdout.on("data", (d) => { out += d; });
      c.on("error", () => resolve(null));
      c.on("close", () => resolve(out.trim() || null));
    } catch (_) { resolve(null); }
  });
}

// Force an update NOW (used when a download fails in a way that smells like a
// stale engine). Runs at most once per app run. Resolves true only if a newer
// build was actually installed — false means "already newest, look elsewhere".
let ytdlpForcedUpdate = null;
function forceUpdateYtdlp() {
  if (!ytdlpForcedUpdate) {
    ytdlpForcedUpdate = (async () => {
      const [local, latest] = await Promise.all([localYtdlpVersion(), latestYtdlpTag()]);
      if (!latest) return false;              // offline / GitHub unreachable
      if (local && local === latest) return false;  // already newest
      await downloadYtdlp();
      try { fs.writeFileSync(YTDLP_CHECK_FILE, String(Date.now())); } catch (_) {}
      return true;
    })().catch(() => false);
  }
  return ytdlpForcedUpdate;
}

// Background freshness check on launch. YouTube changes break older yt-dlp builds
// within days, so check DAILY (not weekly) and compare the actual version string
// — the old mtime check re-armed itself on every download and could sit weeks behind.
const YTDLP_CHECK_FILE = path.join(BIN_DIR, ".ytdlp_checked");
let ytdlpRefreshTried = false;
async function maybeRefreshYtdlp() {
  if (ytdlpRefreshTried) return;
  ytdlpRefreshTried = true;
  try {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let lastCheck = 0;
    try { lastCheck = Number(fs.readFileSync(YTDLP_CHECK_FILE, "utf-8").trim()) || 0; } catch (_) {}
    if (Date.now() - lastCheck < ONE_DAY) return;
    const [local, latest] = await Promise.all([localYtdlpVersion(), latestYtdlpTag()]);
    try { fs.writeFileSync(YTDLP_CHECK_FILE, String(Date.now())); } catch (_) {}
    if (!latest || (local && local === latest)) return;
    status("Updating the download engine…");
    await downloadYtdlp();
    statusReady();
  } catch (e) {
    // Non-fatal: keep using the existing binary if the refresh fails (offline, etc.).
    statusReady();
  }
}

// Failures that mean "YouTube moved, our engine is behind" rather than a real
// problem with the link. Worth one automatic update + retry.
function isStaleEngineError(msg) {
  return /HTTP Error 403|HTTP Error 409|unable to download video data|requested format is not available|only images are available|nsig extraction failed|unable to extract (?:yt initial|player|nsig|signature)|failed to extract any player response|the page needs to be reloaded|player response/i
    .test(msg || "");
}

// ---------------------------------------------------------------------------
// Run yt-dlp, streaming progress; collect final file paths
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Cancel support
// Downloads run strictly one at a time (the queue is sequential), so a single
// handle to the in-flight child process is enough. `cancelRequested` survives
// the kill so the close handler can tell "user cancelled" from "yt-dlp failed".
// ---------------------------------------------------------------------------
let activeChild = null;
let cancelRequested = false;

function trackChild(c) { activeChild = c; return c; }
function untrackChild(c) { if (activeChild === c) activeChild = null; }

function killActiveChild() {
  const c = activeChild;
  if (!c) return false;
  try { c.kill("SIGTERM"); } catch (_) {}
  // yt-dlp/ffmpeg normally exit on SIGTERM; escalate if one hangs.
  setTimeout(() => { try { if (c.exitCode === null && !c.killed) c.kill("SIGKILL"); } catch (_) {} }, 2000);
  return true;
}

// Remove yt-dlp's half-written files so a cancelled download leaves nothing
// behind. Only touches known temp extensions — finished files are never deleted.
const PARTIAL_RE = /\.(part|ytdl|temp)$|\.part-Frag\d+$/i;
function cleanPartials(dir, depth = 1) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) cleanPartials(p, depth - 1); continue; }
    if (PARTIAL_RE.test(e.name)) { try { fs.unlinkSync(p); } catch (_) {} }
  }
}

function canceledError() {
  const e = new Error("Download cancelled.");
  e.canceled = true;
  return e;
}

ipcMain.handle("cancel-download", () => {
  cancelRequested = true;
  const killed = killActiveChild();
  return { ok: true, killed };
});

function runYtdlp(args, onProgress, plTotal = 0, noCookieRetry = false, noUpdateRetry = false) {
  return new Promise((resolve, reject) => {
    const files = [];
    let stderr = "";
    // Playlist item tracking (0 = not a playlist / not started yet). itemTotal is
    // seeded from the known selection count so it's correct from the first tick.
    let itemPos = 0, itemTotal = plTotal || 0, itemTitle = "", lastItemKey = "";
    // Cancel arrived between the queue picking this item and the spawn.
    if (cancelRequested) return reject(canceledError());
    const child = trackChild(spawn(YTDLP_PATH, args, { windowsHide: true }));

    const emit = (extra) => { if (onProgress) onProgress({ itemPos, itemTotal, itemTitle, ...extra }); };

    // yt-dlp may emit the progress line on either stream depending on platform
    // and whether output is a TTY — parse both so the bar always moves.
    const reportProgress = (text) => {
      // yt-dlp progress line: [download]  68.4% of 5.82MiB at 1.23MiB/s ETA 00:04
      const pct = text.match(/\[download\]\s+([\d.]+)%/);
      if (!pct) return;
      const speed = (text.match(/at\s+([\d.]+\s*[KMGkTmg]i?B\/s)/) || [])[1] || "";
      const eta   = (text.match(/ETA\s+(\d+:\d+(?::\d+)?)/) || [])[1] || "";
      const size  = (text.match(/of\s+([\d.]+\s*[KMGkTmg]i?B)/) || [])[1] || "";
      emit({ percent: parseFloat(pct[1]), speed, eta, size });
    };
    const handleLine = (line, fromStdout) => {
      line = line.trim();
      if (!line) return;
      // Per-item title marker printed by --print before_dl (playlists only).
      // This is the reliable per-track signal. before_dl can fire more than once
      // per track (e.g. separate video+audio formats), so only advance the counter
      // when the title actually changes.
      if (line.startsWith("###SELEKT_ITEM###")) {
        const title = line.slice("###SELEKT_ITEM###".length);
        if (title && title !== lastItemKey) {
          lastItemKey = title;
          itemTitle = title;
          itemPos++;
          emit({ percent: 0, newItem: true });
        }
        return;
      }
      // yt-dlp's own counter — used only as a fallback for the TOTAL when we
      // weren't handed a selection count. Position comes from the marker above.
      const m = line.match(/Downloading (?:item|video) \d+ of (\d+)/);
      if (m) { if (!itemTotal) itemTotal = parseInt(m[1], 10); return; }
      // Lines from --print after_move:filepath are absolute paths.
      if (fromStdout && path.isAbsolute(line) && fs.existsSync(line)) files.push(line);
    };
    const handleData = (d, fromStdout) => {
      const text = d.toString();
      if (!fromStdout) stderr += text;
      text.split("\n").forEach(line => handleLine(line, fromStdout));
      reportProgress(text);
    };
    child.stdout.on("data", (d) => handleData(d, true));
    child.stderr.on("data", (d) => handleData(d, false));
    child.on("error", (e) => { untrackChild(child); reject(e); });
    child.on("close", (code) => {
      untrackChild(child);
      // User pressed Cancel — report that, not the SIGTERM exit code, and don't
      // fall through to the cookie retry (which would start a new download).
      if (cancelRequested) return reject(canceledError());
      if (code === 0) return resolve(files);
      // With --ignore-errors on a playlist, yt-dlp can exit non-zero yet still have
      // downloaded some entries — keep those instead of throwing them all away.
      if (files.length) return resolve(files);
      // Build a fuller error: prefer the actual ERROR/unavailable lines (there may
      // be many on a playlist) over a blind 3-line tail, and keep newlines so the
      // UI shows the complete cause rather than a clipped fragment.
      const lines = stderr.split("\n").map(s => s.trim()).filter(Boolean);
      const errLines = lines.filter(l => /error|unable|unavailable|forbidden|not available|private|blocked|sign in|removed|copyright/i.test(l));
      const picked = (errLines.length ? errLines : lines).slice(-8);
      const full = picked.join("\n").slice(0, 1000) || ("yt-dlp exited " + code);
      // The chosen browser's cookies couldn't be read (missing/locked DB). Retry
      // once WITHOUT cookies so public downloads still work; login-required ones
      // will then fail with a clear "needs cookies" hint instead of this.
      if (!noCookieRetry && args.includes("--cookies-from-browser") && isCookieStoreError(stderr)) {
        return resolve(runYtdlp(stripCookieArgs(args), onProgress, plTotal, true, noUpdateRetry));
      }
      // "403 Forbidden" / "format not available" on a link that plays fine in a
      // browser almost always means YouTube changed something our bundled yt-dlp
      // doesn't know about yet. Update the engine and retry the download ONCE
      // before showing the user an error they can't act on.
      if (!noUpdateRetry && isStaleEngineError(stderr)) {
        status("Updating the download engine…");
        return resolve(
          forceUpdateYtdlp().then((updated) => {
            statusReady();
            if (!updated) throw new Error(full);   // already newest — real failure
            return runYtdlp(args, onProgress, plTotal, noCookieRetry, true);
          })
        );
      }
      reject(new Error(full));
    });
  });
}

function ffmpegArgs() { return ["--ffmpeg-location", BIN_DIR]; }

// Cookies — pass browser cookies to yt-dlp for age-restricted / sign-in-required
// videos. Reads the browser the user picked in Settings (empty = no cookies).
// Allowed values map to yt-dlp's --cookies-from-browser targets.
const COOKIE_BROWSERS = ["safari", "chrome", "brave", "firefox", "edge", "chromium", "opera", "vivaldi"];
function cookieArgs() {
  const b = (loadConfig().cookies_browser || "").trim();
  return COOKIE_BROWSERS.includes(b) ? ["--cookies-from-browser", b] : [];
}
// Remove the "--cookies-from-browser <b>" pair from an arg list (for retry).
function stripCookieArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cookies-from-browser") { i++; continue; }  // skip flag AND its value
    out.push(args[i]);
  }
  return out;
}
// A failure that means "the chosen browser's cookies couldn't be read" (missing
// DB, locked, undecryptable) — NOT a real download problem. Retry without cookies.
function isCookieStoreError(msg) {
  return /could not find .*cookies? database|could not copy .*cookie|unable to (?:open|read|decrypt) .*cookie|failed to decrypt .*cookie|no such (?:file|table).*cookie|permission denied.*cookie/i.test(msg || "");
}
// Spawn yt-dlp to collect stdout JSON (info/playlist). Retries once without
// cookies if the cookie store can't be read, so a bad "Browser cookies" setting
// doesn't break the picker or dup/tag probe on public content.
function ytdlpJson(args, noCookieRetry = false) {
  return new Promise((resolve, reject) => {
    let buf = "", err = "";
    const c = spawn(YTDLP_PATH, args, { windowsHide: true });
    c.stdout.on("data", d => buf += d);
    c.stderr.on("data", d => err += d);
    c.on("error", reject);
    c.on("close", (code) => {
      if (buf.trim()) return resolve(buf);
      if (!noCookieRetry && args.includes("--cookies-from-browser") && isCookieStoreError(err)) {
        return resolve(ytdlpJson(stripCookieArgs(args), true));
      }
      reject(new Error(err.trim() || ("yt-dlp exited " + code)));
    });
  });
}

// Turn yt-dlp's raw failure into a flag the UI can act on (offer the cookie fix).
function isCookieError(msg) {
  return /sign in to confirm your age|confirm you'?re not a bot|--cookies|cookies-from-browser|age-restricted|inappropriate for some users/i.test(msg || "");
}

// Every URL that reaches yt-dlp (info, playlist fetch, download) goes through
// this check first. A link must be a string that starts with http:// or https://
// (scheme case-insensitive), have a host right after the "//", parse as a URL,
// and contain no control characters. The string is returned exactly as given
// (only surrounding whitespace trimmed) -- URL parsing is a validity check,
// never a rewrite -- so queries, fragments and Unicode hosts reach yt-dlp
// unchanged. Callers also put "--" before the URL so it can never be read as
// an option.
const BAD_LINK = "Invalid link: only http:// or https:// links are supported.";
function checkYtdlpUrl(value) {
  if (value === undefined || value === null) return { ok: false, error: "No link provided." };
  if (typeof value !== "string") return { ok: false, error: BAD_LINK };
  const url = value.trim();
  if (!url) return { ok: false, error: "No link provided." };
  // After "//" a host must follow: no extra slash/backslash (the URL parser would
  // silently collapse "https:///x" or "https://\x" into a different authority).
  if (!/^https?:\/\/(?![\/\\])/i.test(url) || /[\u0000-\u001f\u007f]/.test(url)) return { ok: false, error: BAD_LINK };
  let parsed;
  try { parsed = new URL(url); } catch (_) { return { ok: false, error: BAD_LINK }; }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    return { ok: false, error: BAD_LINK };
  }
  return { ok: true, url };
}

const PRINT = ["--no-simulate", "--print", "after_move:filepath"];

// ---------------------------------------------------------------------------
// Duplicate detection — EXTENSION-AWARE. A file is only a duplicate if the same
// YouTube id AND the same output extension already exist. So an MP3 and the MP4
// of the same link are NOT duplicates (different files you may want both of).
// ---------------------------------------------------------------------------
function expectedExtsFor({ type, audioFormat, noConvert }) {
  if (type === "audio") return [String(audioFormat || "mp3").toLowerCase()];
  // video: original/no-convert keeps the source container (varies); merged is mp4
  if (noConvert) return ["mp4", "webm", "mkv", "m4v", "mov"];
  return ["mp4"];
}
// Remember that a given YouTube id produced a given file (for dup detection).
function recordDownloadedId(id, file) {
  if (!id || !file) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(DL_INDEX_FILE, JSON.stringify({ id, file, time: new Date().toISOString() }) + "\n");
  } catch (_) { /* dedup index is best-effort */ }
}
function indexedFilesForId(id) {
  if (!fs.existsSync(DL_INDEX_FILE)) return [];
  try {
    return fs.readFileSync(DL_INDEX_FILE, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(r => r && r.id === id)
      .map(r => r.file);
  } catch { return []; }
}

function findDuplicateFiles(outDir, id, exts) {
  if (!id) return [];
  const wanted = new Set(exts.map(e => "." + e.toLowerCase()));
  const hits = new Set();
  // Primary: files we recorded for this id (filenames are now clean, no "[id]").
  for (const f of indexedFilesForId(id)) {
    if (path.dirname(f) === outDir && wanted.has(path.extname(f).toLowerCase()) && fs.existsSync(f)) hits.add(f);
  }
  // Back-compat: older downloads that still carry "[id]" in the filename.
  try {
    fs.readdirSync(outDir)
      .filter(f => !f.startsWith(".") && f.includes(`[${id}]`) && wanted.has(path.extname(f).toLowerCase()))
      .forEach(f => hits.add(path.join(outDir, f)));
  } catch (_) { /* folder may not exist yet */ }
  return [...hits];
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const ICON_PNG = path.join(__dirname, "build", "icon.png");

function createWindow() {
  // Dock icon while running (dev) on macOS, so it matches the launcher.
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(ICON_PNG)); } catch (_) {}
  }
  mainWindow = new BrowserWindow({
    width: 980, height: 760, minWidth: 720, minHeight: 560,
    backgroundColor: "#0a0a0e",
    icon: ICON_PNG, // window/taskbar icon on Windows/Linux
    // Integrated dark title bar on macOS; normal frame on Windows/Linux.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  ensureBinaries().catch(() => {});
  // Start watch-folder after renderer is ready so events are not lost
  mainWindow.webContents.on("did-finish-load", () => {
    // Setup may have finished/failed before this page subscribed: hand it the current state (no new work).
    if (setupMsg) mainWindow.webContents.send("setup-status", setupMsg);
    if (fpLive) revokeFingerprintOffer(fpLive.id);   // the renderer (re)loaded: any warning it showed is gone
    const cfg = loadConfig();
    if (cfg.watch_enabled) {
      startWatchFile(cfg.watch_inbox_path || defaultWatchInboxPath());
    }
    // Reset any stale "running" queue items to "pending" (app was killed mid-run)
    const q = loadQueue();
    let changed = false;
    q.forEach(item => { if (item.status === "running") { item.status = "pending"; changed = true; } });
    if (changed) saveQueue(q);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  stopWatch();
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
// Generic folder picker (used for the watch inbox). It authorizes nothing.
ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// Main-folder picker. Only the folder returned by THIS dialog (most recent
// result, single use) can be set as the main folder by set-main-folder, so a
// folder picked for another purpose (watch inbox) never authorizes it.
let mainFolderPick = null;
ipcMain.handle("pick-main-folder", async () => {
  mainFolderPick = null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the main folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  mainFolderPick = r.filePaths[0];
  return mainFolderPick;
});

ipcMain.handle("get-settings", () => {
  const cfg = loadConfig();
  // One-time migration: when pins don't exist yet, seed them from existing
  // favorites so they keep their "front of the list" prominence after the
  // created/favorites merge. Created subfolders start unpinned.
  if (!Array.isArray(cfg.pinned)) {
    cfg.pinned = (cfg.favorite_folders || []).map(f => "p:" + f.path);
    saveConfig(cfg);
  }
  return {
    main_folder: mainFolder(),
    data_dir: DATA_DIR,
    history_file: HISTORY_FILE,
    lang: cfg.lang || "es",
    prevent_duplicates: cfgFlag(cfg, "prevent_duplicates"),
    pinned: cfg.pinned,
    // DJ features
    auto_tag: cfgFlag(cfg, "auto_tag"),        // default on (see DEFAULTS)
    loudnorm: cfgFlag(cfg, "loudnorm"),        // default on
    lufs: cfgLufs(cfg),                        // default -14
    suggest_folder: cfg.suggest_folder !== false, // default true
    cookies_browser: cfg.cookies_browser || "",   // "" = no cookies
    folder_view: cfg.folder_view === "list" ? "list" : "chips", // Download-tab folder layout
    folder_density: cfg.folder_density === "comfortable" ? "comfortable" : "compact", // default compact
  };
});

// Pin a destination to the front of the unified list. id is "f:<name>" for a
// created subfolder or "p:<absolutePath>" for a favorite. Toggles on/off.
ipcMain.handle("toggle-pin", (_e, id) => {
  if (!id) return { ok: false };
  const cfg = loadConfig();
  cfg.pinned = Array.isArray(cfg.pinned) ? cfg.pinned : [];
  const i = cfg.pinned.indexOf(id);
  if (i >= 0) cfg.pinned.splice(i, 1); else cfg.pinned.push(id);
  saveConfig(cfg);
  return { ok: true, pinned: cfg.pinned };
});

ipcMain.handle("set-prevent-duplicates", (_e, val) => {
  const cfg = loadConfig(); cfg.prevent_duplicates = !!val; saveConfig(cfg);
  return { ok: true, prevent_duplicates: cfg.prevent_duplicates };
});

ipcMain.handle("set-auto-tag",       (_e, v) => { const c = loadConfig(); c.auto_tag = !!v; saveConfig(c); return { ok: true }; });
ipcMain.handle("set-loudnorm",       (_e, v) => { const c = loadConfig(); c.loudnorm = !!v; saveConfig(c); return { ok: true }; });
ipcMain.handle("set-lufs",           (_e, v) => { const c = loadConfig(); c.lufs = Number(v) || DEFAULTS.lufs; saveConfig(c); return { ok: true }; });
ipcMain.handle("set-suggest-folder", (_e, v) => { const c = loadConfig(); c.suggest_folder = !!v; saveConfig(c); return { ok: true }; });
ipcMain.handle("set-cookies-browser", (_e, b) => {
  const c = loadConfig();
  c.cookies_browser = COOKIE_BROWSERS.includes((b || "").trim()) ? b.trim() : "";
  saveConfig(c);
  return { ok: true, cookies_browser: c.cookies_browser };
});
ipcMain.handle("set-folder-view", (_e, v) => {
  const c = loadConfig(); c.folder_view = v === "list" ? "list" : "chips"; saveConfig(c);
  return { ok: true, folder_view: c.folder_view };
});
ipcMain.handle("set-folder-density", (_e, v) => {
  const c = loadConfig(); c.folder_density = v === "comfortable" ? "comfortable" : "compact"; saveConfig(c);
  return { ok: true, folder_density: c.folder_density };
});

ipcMain.handle("set-lang", (_e, lang) => {
  const cfg = loadConfig();
  cfg.lang = lang === "en" ? "en" : "es";
  saveConfig(cfg);
  return { ok: true, lang: cfg.lang };
});

ipcMain.handle("set-main-folder", (_e, p) => {
  if (!p) return { ok: false };
  if (typeof p !== "string" || !((mainFolderPick !== null && p === mainFolderPick) || samePath(p, mainFolder()))) {
    return { ok: false, error: "Choose the main folder with the folder picker." };
  }
  mainFolderPick = null;
  fs.mkdirSync(p, { recursive: true });
  const cfg = loadConfig(); cfg.main_folder = p; saveConfig(cfg);
  return { ok: true, main_folder: p };
});

// Only folders the user created *inside the app* are shown — not every
// subfolder that happens to exist on disk. Stored as absolute paths in config,
// naturally scoped per main folder (parent must equal the current main folder).
ipcMain.handle("list-folders", () => {
  const base = mainFolder();
  const cfg = loadConfig();
  const created = Array.isArray(cfg.created_folders) ? cfg.created_folders : [];
  const folders = created
    .filter(p => path.dirname(p) === base && fs.existsSync(p))
    .map(p => path.basename(p))
    .sort((a, b) => a.localeCompare(b));
  return { main_folder: base, folders };
});

// Count visible (non-hidden) files directly inside a folder — for the list view.
function countFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && !e.name.startsWith(".")).length;
  } catch { return null; }
}

// File counts keyed like destIds: "main", "f:<name>" (subfolder), "p:<path>" (fav).
ipcMain.handle("folder-counts", () => {
  const base = mainFolder();
  const cfg = loadConfig();
  const out = { main: countFiles(base) };
  (cfg.created_folders || [])
    .filter(p => path.dirname(p) === base && fs.existsSync(p))
    .forEach(p => { out["f:" + path.basename(p)] = countFiles(p); });
  (cfg.favorite_folders || [])
    .forEach(f => { if (fs.existsSync(f.path)) out["p:" + f.path] = countFiles(f.path); });
  return out;
});

ipcMain.handle("create-folder", (_e, name) => {
  if (!name) return { ok: false };
  const dest = resolveSubfolder(name);
  if (!dest.ok) return { ok: false, error: "invalid name" };
  const target = dest.dir;
  try {
    fs.mkdirSync(target, { recursive: true });
    const cfg = loadConfig();
    cfg.created_folders = Array.isArray(cfg.created_folders) ? cfg.created_folders : [];
    if (!cfg.created_folders.includes(target)) cfg.created_folders.push(target);
    saveConfig(cfg);
  } catch (e) {
    return { ok: false, error: "create failed", code: e && e.code };   // invalid filename, permissions, ...
  }
  return { ok: true, created: target, name };
});

// Rename a folder on disk (fixes typos) and keep tracking it under its new name.
ipcMain.handle("rename-folder", (_e, { oldName, newName } = {}) => {
  if (!oldName || !newName) return { ok: false, error: "missing name" };
  if (!checkFolderName(oldName).ok || !checkFolderName(newName).ok) return { ok: false, error: "invalid name" };
  const base = mainFolder();
  const from = path.join(base, oldName);
  const to = path.join(base, newName);
  if (!fs.existsSync(from)) return { ok: false, error: "not found" };
  if (fs.existsSync(to)) return { ok: false, error: "exists" };
  try { fs.renameSync(from, to); } catch (e) { return { ok: false, error: e.message }; }
  const cfg = loadConfig();
  cfg.created_folders = (cfg.created_folders || []).map(p => (p === from ? to : p));
  if (!cfg.created_folders.includes(to)) cfg.created_folders.push(to);
  // keep any pin attached to the renamed folder
  cfg.pinned = (cfg.pinned || []).map(id => (id === "f:" + oldName ? "f:" + newName : id));
  saveConfig(cfg);
  return { ok: true, name: newName };
});

// Remove a folder from the app's list only — files on disk are NOT touched.
ipcMain.handle("remove-folder", (_e, name) => {
  if (!name) return { ok: false };
  const target = path.join(mainFolder(), name);
  const cfg = loadConfig();
  cfg.created_folders = (cfg.created_folders || []).filter(p => p !== target);
  cfg.pinned = (cfg.pinned || []).filter(id => id !== "f:" + name);
  saveConfig(cfg);
  return { ok: true };
});

// Reveal: a history row, or a file offered in a fingerprint-duplicate warning (H1 rules above).
ipcMain.handle("reveal", (_e, p) => {
  const chk = checkManagedFile(p, new Set([...historyFileKeys(), ...offeredRevealKeys()]));
  if (!chk.ok) return chk;
  try { shell.showItemInFolder(chk.real); } catch (_) { return openFail("open_failed", "The system could not show it."); }
  return { ok: true };
});
// Open a folder chip: "" / absent = main folder, otherwise ONE subfolder name (H3 rules).
ipcMain.handle("open-folder", async (_e, name) => {
  const sub = (name === undefined || name === null || name === "") ? { ok: true, dir: mainFolder() } : resolveSubfolder(name);
  if (!sub.ok) return openFail("not_allowed", sub.error);   // invalid/escaping name: nothing created or opened
  try { fs.mkdirSync(sub.dir, { recursive: true }); } catch (_) { return openFail("open_failed", "The folder could not be opened."); }
  return openWithShell(sub.dir);
});
// Open a downloaded file: a history row only (H1 rules above).
ipcMain.handle("open-file", async (_e, p) => {
  const chk = checkManagedFile(p, historyFileKeys());
  if (!chk.ok) return chk;
  return openWithShell(chk.real);
});
ipcMain.handle("open-main-folder", () => { const b = mainFolder(); if (fs.existsSync(b)) shell.openPath(b); return true; });
ipcMain.handle("get-history", (_e, { limit, contains } = {}) => readHistory(limit || 50, contains || null));
ipcMain.handle("clear-history", () => { try { fs.writeFileSync(HISTORY_FILE, ""); } catch (_) {} return { ok: true }; });
ipcMain.handle("ensure-setup", async () => { try { await ensureBinaries(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });

// Fetch a playlist's track list (flat = fast, no per-video resolution) so the UI
// can show a picker. Returns 1-based indices for --playlist-items on download.
ipcMain.handle("fetch-playlist", async (_e, rawUrl) => {
  const urlCheck = checkYtdlpUrl(rawUrl);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };
  const url = urlCheck.url;
  try {
    await ensureBinaries();
    const out = await ytdlpJson(["-J", "--flat-playlist", "--no-warnings", ...cookieArgs(), "--", url]);
    const j = JSON.parse(out);
    const raw = Array.isArray(j.entries) ? j.entries : [j];   // single video → 1-entry list
    const entries = raw.filter(Boolean).map((e, i) => {
      const title = (e.title || "").trim();
      const unavailable = !title
        || /^\[(private|deleted|unavailable|removed)/i.test(title)
        || ["private", "needs_auth", "premium_only", "subscriber_only"].includes(e.availability);
      return {
        index: i + 1,
        id: e.id || "",
        title: title || "[Unavailable]",
        duration: (typeof e.duration === "number") ? e.duration : null,
        uploader: e.uploader || e.channel || "",
        unavailable,
      };
    });
    return { ok: true, title: j.title || "", count: entries.length, entries };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

async function probeInfo(rawUrl) {
  const urlCheck = checkYtdlpUrl(rawUrl);
  if (!urlCheck.ok) throw new Error(urlCheck.error);
  const out = await ytdlpJson(["-J", "--no-playlist", ...cookieArgs(), "--", urlCheck.url]);
  const j = JSON.parse(out);
  const fmts = Array.isArray(j.formats) ? j.formats : [];
  const audio = fmts.filter(f => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"));
  const best = audio.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || {};
  return {
    ok: true,
    id: j.id, title: j.title, uploader: j.uploader,
    duration: j.duration, thumbnail: j.thumbnail || "",
    artist: j.artist || j.creator || null,
    track: j.track || null,
    sourceAbr: best.abr || null,
    sourceAcodec: best.acodec || null,
    sourceAsr: best.asr || null,
  };
}

ipcMain.handle("get-info", async (_e, url) => {
  try { return await probeInfo(url); }
  catch (e) { return { ok: false, error: e.message }; }
});

// Pre-queue duplicate check — extension-aware, no network, no folder creation.
// Caller passes the already-known id + the intended format/folder.
ipcMain.handle("check-duplicate", (_e, opts = {}) => {
  const { id, folder, targetPath, type, audioFormat, noConvert } = opts;
  if (!id) return { exists: false, files: [] };
  const dest = resolveDestination(targetPath, folder);
  if (!dest.ok) return { exists: false, files: [], error: dest.error };
  const outDir = dest.dir;
  const exts = expectedExtsFor({ type, audioFormat, noConvert });
  const files = findDuplicateFiles(outDir, id, exts);
  return { exists: files.length > 0, files };
});

// ---------------------------------------------------------------------------
// Clipboard (handled in main process — avoids macOS sandbox restrictions)
// ---------------------------------------------------------------------------
// Electron 44: clipboard.readText()/writeText() return Promises. Await them so a failed write is
// reported as `false` (not a silent success) and a failed read yields "" (the UI shows "paste empty").
// Error text only is logged, never clipboard contents.
ipcMain.handle("clipboard-read", async () => {
  try { return await clipboard.readText(); }
  catch (err) { console.error("clipboard-read failed:", err && err.message); return ""; }
});
ipcMain.handle("clipboard-write", async (_e, t) => {
  try { await clipboard.writeText(t); return true; }
  catch (err) { console.error("clipboard-write failed:", err && err.message); return false; }
});

// ---------------------------------------------------------------------------
// Favorite Folders
// ---------------------------------------------------------------------------
ipcMain.handle("get-favorites", () => {
  const cfg = loadConfig();
  const favs = Array.isArray(cfg.favorite_folders) ? cfg.favorite_folders : [];
  return favs.map(f => ({ ...f, available: fs.existsSync(f.path) }));
});

ipcMain.handle("add-favorite", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a Favorite Folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const folderPath = r.filePaths[0];
  const name = path.basename(folderPath);
  const cfg = loadConfig();
  cfg.favorite_folders = Array.isArray(cfg.favorite_folders) ? cfg.favorite_folders : [];
  if (cfg.favorite_folders.some(f => f.path === folderPath))
    return { ok: false, duplicate: true, name };
  cfg.favorite_folders.push({ path: folderPath, name, added: new Date().toISOString() });
  saveConfig(cfg);
  return { ok: true, path: folderPath, name };
});

ipcMain.handle("remove-favorite", (_e, folderPath) => {
  const cfg = loadConfig();
  cfg.favorite_folders = (cfg.favorite_folders || []).filter(f => f.path !== folderPath);
  cfg.pinned = (cfg.pinned || []).filter(id => id !== "p:" + folderPath);
  saveConfig(cfg);
  return { ok: true };
});

// Open a registered favorite folder (exact match; opens the registered path).
ipcMain.handle("open-favorite", async (_e, folderPath) => {
  const fav = resolveFavorite(folderPath);
  if (!fav.ok) return fav;
  return openWithShell(fav.dir);
});

// ---------------------------------------------------------------------------
// Feature 1 — Auto-tag helpers
// ---------------------------------------------------------------------------
function splitArtistTitle(rawTitle, info) {
  if (info && info.artist && info.track) return { artist: info.artist, title: info.track };
  let t = rawTitle.replace(/\s*[\(\[](official|video|audio|lyric[s]?|hd|4k|visualizer)[^\)\]]*[\)\]]/gi, "").trim();
  const m = t.match(/^(.*?)\s+-\s+(.*)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: (info && info.uploader) || "", title: t };
}

function tagAudioFile(file, { url, genre, info }) {
  return new Promise((resolve) => {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".wav") return resolve({ skipped: "wav" });
    const rawTitle = path.basename(file, ext).replace(/\s*\[[^\]]+\]$/, "");
    const { artist, title } = splitArtistTitle(rawTitle, info);
    const tmp = file + ".tag" + ext;
    const ffmpeg = path.join(BIN_DIR, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const args = ["-y", "-i", file, "-map", "0", "-c", "copy",
      "-metadata", `title=${title}`,
      "-metadata", `artist=${artist}`,
      "-metadata", `genre=${genre}`,
      "-metadata", `comment=${url}`,
      tmp];
    const c = spawn(ffmpeg, args, { windowsHide: true });
    c.on("error", () => resolve({ error: true }));
    c.on("close", (code) => {
      if (code === 0) { try { fs.renameSync(tmp, file); } catch (_) {} }
      else { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {} }
      resolve({ ok: code === 0 });
    });
  });
}

// ---------------------------------------------------------------------------
// Feature 2 — Loudnorm two-pass helper (lossless files)
// ---------------------------------------------------------------------------
// bitrate (kbps, string or number) is only used for lossy targets (mp3/m4a/opus).
// Lossless targets (wav/flac) ignore it and use ffmpeg's default encoder.
//
// Result contract: resolves { ok: true } ONLY when the normalized audio has replaced the file.
// Otherwise { ok: false, reason } and the ORIGINAL file is left exactly as it was (the temporary
// ".ln" file is removed). reason is one of:
//   "canceled" — the user pressed Cancel (not a failure);
//   "measure"  — pass 1 could not measure the loudness;
//   "apply"    — pass 2 failed, or produced no audio;
//   "replace"  — pass 2 worked but the normalized file could not replace the original.
async function loudnormTwoPass(file, I = -14, bitrate = null) {
  if (cancelRequested) return { ok: false, reason: "canceled" };
  const ffmpeg = path.join(BIN_DIR, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  // Pass 1: measure
  const meas = await new Promise((res) => {
    let err = "";
    const c = trackChild(spawn(ffmpeg, ["-i", file, "-af",
      `loudnorm=I=${I}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"],
      { windowsHide: true }));
    c.stderr.on("data", d => err += d);
    c.on("error", () => { untrackChild(c); res(null); });
    c.on("close", () => {
      untrackChild(c);
      const m = err.match(/\{[\s\S]*\}/);
      try { res(m ? JSON.parse(m[0]) : null); } catch (_) { res(null); }
    });
  });
  if (cancelRequested) return { ok: false, reason: "canceled" };
  if (!meas) return { ok: false, reason: "measure" };
  // Pass 2: apply
  const tmp = file + ".ln" + path.extname(file);
  const af = `loudnorm=I=${I}:TP=-1.5:LRA=11:` +
    `measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:` +
    `measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:` +
    `offset=${meas.target_offset}:linear=true`;
  // Explicit encoder for lossy targets: loudnorm is a filter, so the audio MUST be
  // re-encoded. Never let ffmpeg fall back to stream-copy here.
  const ext = path.extname(file).toLowerCase();
  const kbps = parseInt(bitrate, 10) || 0;
  const enc = [];
  if (ext === ".mp3")       enc.push("-c:a", "libmp3lame", "-b:a", `${kbps || 320}k`);
  else if (ext === ".m4a")  enc.push("-c:a", "aac",        "-b:a", `${kbps || 256}k`);
  else if (ext === ".opus") enc.push("-c:a", "libopus",    "-b:a", `${kbps || 192}k`);
  return new Promise((res) => {
    const c = trackChild(spawn(ffmpeg, ["-y", "-i", file, "-map", "0:a", "-map_metadata", "0",
      "-af", af, ...enc, tmp], { windowsHide: true }));
    const dropTmp = () => { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {} };
    c.on("error", () => { untrackChild(c); dropTmp(); res({ ok: false, reason: cancelRequested ? "canceled" : "apply" }); });
    c.on("close", (code) => {
      untrackChild(c);
      if (code !== 0) {
        dropTmp();
        return res({ ok: false, reason: cancelRequested ? "canceled" : "apply" });
      }
      // Cancel arrived but ffmpeg still exited 0 (it finished, or the signal came too late): the user asked to
      // stop, so the finished temp file is DISCARDED and the original stays. The result ("canceled") and the
      // file on disk then agree: this file is not normalized. (The swap below is synchronous, so a Cancel that
      // arrives later cannot land in the middle of it: it is either seen here, or after the file is done.)
      if (cancelRequested) { dropTmp(); return res({ ok: false, reason: "canceled" }); }
      // ffmpeg said success: only count it if there is real output, and only after the swap works.
      let size = 0;
      try { size = fs.statSync(tmp).size; } catch (_) {}
      if (!(size > 0)) { dropTmp(); return res({ ok: false, reason: "apply" }); }
      try { fs.renameSync(tmp, file); }
      catch (e) { dropTmp(); return res({ ok: false, reason: "replace", error: (e && (e.code || e.message)) || "rename failed" }); }
      res({ ok: true });
    });
  });
}

ipcMain.handle("download", async (_e, opts) => {
  // Validate the link first: nothing below (binary setup, folder creation,
  // probe, process launch) runs for an invalid one.
  const urlCheck = checkYtdlpUrl(opts && opts.url);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };
  const url = urlCheck.url;
  // Authorize the destination before anything is set up or created.
  const dest = resolveDestination(opts && opts.targetPath, opts && opts.folder);
  if (!dest.ok) return { ok: false, error: dest.error };
  await ensureBinaries();
  const { type = "audio", audioFormat = DEFAULTS.audioFormat, bitrate = DEFAULTS.audioBitrate,
          quality = "best", noConvert = false, folder = "", force = false,
          autoTag, loudnorm: wantLoudnorm, lufs: targetLufs,
          _info, _inQueue = false, _queueId } = opts || {};

  // Fresh start: a cancel from the previous item must not kill this one.
  cancelRequested = false;

  const isPlaylist = type === "playlist";
  const outDir = dest.dir;
  fs.mkdirSync(outDir, { recursive: true });

  // Fetch info once; reuse for dup-check and tagging (skip for playlists / forced re-downloads).
  let probeResult = _info || null;
  if (!isPlaylist && !force) {
    const cfg = loadConfig();
    const preventDup = cfgFlag(cfg, "prevent_duplicates");
    if (preventDup || autoTag !== false) {
      if (!probeResult) {
        try { probeResult = await probeInfo(url); } catch (_) {}
      }
    }

    // Duplicate detection (extension-aware): only flags when the SAME id AND the
    // SAME output extension already exist — so mp3 vs mp4 of one link don't clash.
    if (preventDup) {
      const j = probeResult;
      if (j && j.id) {
        const exts = expectedExtsFor({ type, audioFormat, noConvert });
        const existing = findDuplicateFiles(outDir, j.id, exts);
        if (existing.length > 0) {
          // In queue/unattended mode: treat as skipped (no blocking dialog)
          if (_inQueue) return { ok: false, duplicate: true, skipped: true, title: j.title || "", id: j.id };
          return { ok: false, duplicate: true, title: j.title || "", id: j.id, existing };
        }
      }
    }
  }

  const single = path.join(outDir, "%(title)s.%(ext)s");
  const plist = path.join(outDir, "%(playlist_title)s", "%(playlist_index)s - %(title)s.%(ext)s");
  const tmpl = isPlaylist ? plist : single;

  let args = ["-o", tmpl, "--newline", ...ffmpegArgs(), ...cookieArgs(), ...PRINT];
  args.push(isPlaylist ? "--yes-playlist" : "--no-playlist");
  if (isPlaylist) {
    args.push("--ignore-errors");
    // Only the tracks the user kept in the picker (1-based playlist positions).
    if (Array.isArray(opts.playlistItems) && opts.playlistItems.length) {
      args.push("--playlist-items", opts.playlistItems.join(","));
    }
    // Emit a per-item marker just before each track downloads, so the UI can show
    // "Track N of M — <title>". Parsed in runYtdlp; harmless for the file list.
    args.push("--print", "before_dl:###SELEKT_ITEM###%(title)s");
  }

  const wantAudio = type === "audio" || (isPlaylist && opts.audioOnly);
  if (wantAudio) {
    args.push("-x", "--audio-format", audioFormat, "--audio-quality", `${bitrate}K`);
    // Feature 2: loudnorm is NOT passed to yt-dlp as `--postprocessor-args ffmpeg:-af …`.
    // That flag hits every ffmpeg postprocessor, and when the source stream already
    // matches the target format (SoundCloud MP3 sources, most notably) yt-dlp's
    // ExtractAudio step stream-copies — ffmpeg then aborts with
    // "Filtering and streamcopy cannot be used together".
    // Normalization now always runs as a separate two-pass step after the download
    // (see below), which is also more accurate than the old single-pass filter.
  } else if (noConvert) {
    // "Original" = keep the source streams, no re-encode, no quality cap.
    // This used to be `-f best`, i.e. "best pre-merged (progressive) file".
    // YouTube no longer serves a progressive video+audio format to the player
    // clients yt-dlp uses (visionos etc.), so `-f best` now finds nothing and
    // dies with "Requested format is not available" — and on the links where it
    // still worked it silently capped the download at 360p (format 18).
    // Take best video + best audio and let yt-dlp REMUX them (container swap,
    // no transcode): mp4 when the codecs fit, mkv otherwise (vp9/opus/av1).
    args.push("-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4/mkv");
  } else if (quality === "best") {
    args.push("-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4");
  } else {
    const h = parseInt(quality, 10) || 1080;
    args.push("-f", `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`, "--merge-output-format", "mp4");
  }
  args.push("--", url);

  const onProgress = (p) => { if (mainWindow) mainWindow.webContents.send("download-progress", p); };
  const plTotal = isPlaylist && Array.isArray(opts.playlistItems) ? opts.playlistItems.length : 0;
  try {
    const files = await runYtdlp(args, onProgress, plTotal);

    // Feature 2: two-pass loudnorm for ALL audio formats — must run before tagging.
    // Lossy targets are re-encoded at the user's chosen bitrate inside the helper.
    // A normalization that was asked for but did not happen is REPORTED (normalizeWarning below), never
    // silent: the downloaded file is always kept, and a failed step leaves its AUDIO as downloaded (Auto-tag,
    // which runs after this step, may still change its metadata).
    let normalizeWarning = null;
    if (wantAudio && files.length) {
      const cfgLn2 = loadConfig();
      const doLoudnorm2 = wantLoudnorm !== undefined ? wantLoudnorm : cfgFlag(cfgLn2, "loudnorm");
      const lufsTarget2 = targetLufs !== undefined ? targetLufs : cfgLufs(cfgLn2);
      if (doLoudnorm2) {
        const NORMALIZABLE = [".mp3", ".m4a", ".opus", ".wav", ".flac"];
        const targets = files.filter(f => NORMALIZABLE.includes(path.extname(f).toLowerCase()));
        if (targets.length) {
          if (mainWindow) mainWindow.webContents.send("download-progress", { phase: "normalizing" });
          const failed = [];
          const normalizedOk = [];   // files whose normalized audio really replaced the original
          for (const f of targets) {
            let r;
            try { r = await loudnormTwoPass(f, lufsTarget2, bitrate); }
            catch (_) { r = { ok: false, reason: "error" }; }
            if (r && r.ok === true) { normalizedOk.push(f); continue; }
            const reason = (r && r.reason) || "apply";
            // Cancel pressed while normalizing: stop here, don't count it as a failure.
            if (reason === "canceled" || cancelRequested) {
              // Same result as a cancelled download. Finished files are NOT deleted (cleanPartials never touches
              // them) and the per-file state is reported as it really is: files normalized BEFORE the cancel stay
              // normalized (normalizedFiles); the rest are exactly as downloaded audio-wise (notNormalizedFiles).
              // None of them is tagged, and none gets a History row (unchanged behavior for cancelled items).
              cleanPartials(outDir);
              return {
                ok: false, canceled: true, keptFiles: files.slice(),
                normalizedFiles: normalizedOk.slice(),
                notNormalizedFiles: files.filter(x => !normalizedOk.includes(x)),
              };
            }
            failed.push({ file: f, reason });
          }
          if (failed.length) normalizeWarning = { total: targets.length, failed };
        }
      }
    }

    // Feature 1: auto-tag (after loudnorm to preserve tags)
    if (wantAudio && files.length) {
      const cfgTag = loadConfig();
      const doTag = autoTag !== undefined ? autoTag : cfgFlag(cfgTag, "auto_tag");
      if (doTag) {
        const genre = folder || path.basename(outDir);
        for (const f of files) {
          try { await tagAudioFile(f, { url, genre, info: probeResult }); } catch (_) {}
        }
      }
    }

    files.forEach(f => recordHistory({
      action: type, url, title: path.basename(f), folder: path.dirname(f), file: f,
      details: wantAudio ? `${audioFormat} ${bitrate}kbps` : (noConvert ? "original" : `quality=${quality}`),
    }));

    // Record id→file for dedup (single downloads only — playlists skip dup-check).
    if (!isPlaylist && probeResult && probeResult.id) {
      files.forEach(f => recordDownloadedId(probeResult.id, f));
    }

    // Feature 3: audio fingerprint dedup — off the critical path (non-blocking)
    if (wantAudio && files.length && !isPlaylist) {
      const cfgFp = loadConfig();
      if (cfgFp.fingerprint_enabled) {
        const threshold = cfgFp.fingerprint_threshold || 0.90;
        const inQueue = _inQueue;
        // The queue item this download belongs to, captured NOW from the request (a const of this call):
        // the event below can arrive after the queue has moved on, so the renderer must not guess the row.
        const queueId = (_inQueue && typeof _queueId === "string" && _queueId.length > 0 && _queueId.length <= 200) ? _queueId : null;
        // Fire async so we return {ok:true} immediately; fingerprint event arrives later
        setImmediate(async () => {
          for (const f of files) {
            const ext = path.extname(f).toLowerCase();
            if (![".mp3", ".m4a", ".flac", ".wav"].includes(ext)) continue;
            try {
              const dup = await checkFingerprintDuplicate(f, probeResult && probeResult.id, threshold);
              if (dup && mainWindow) {
                // Queue-mode downloads show no warning, so they get no offer (and don't supersede a live one).
                const offerId = inQueue ? null : offerFingerprint(f, dup.file);
                mainWindow.webContents.send("fingerprint-dup", {
                  offerId,
                  url,
                  newFile: f,
                  newTitle: (probeResult && probeResult.title) || path.basename(f),
                  matchFile: dup.file,
                  matchTitle: path.basename(dup.file),
                  inQueue,
                  queueId,
                });
              }
            } catch (_) {}
          }
        });
      }
    }

    return { ok: true, count: files.length, files, folder: outDir, ...(normalizeWarning ? { normalizeWarning } : {}) };
  } catch (e) {
    if (e && e.canceled) {
      cleanPartials(outDir);
      return { ok: false, canceled: true };
    }
    return { ok: false, error: e.message, needsCookies: isCookieError(e.message) };
  } finally {
    cancelRequested = false;
  }
});
