// Injected BEFORE renderer.js runs (page.addInitScript). A fake "main process" behind window.api:
// everything is in memory, nothing touches a file system, the OS trash, yt-dlp or Electron.
// It is a SIMULATION of main's contract for the renderer, not main itself. Main's half (queueId echo,
// offers, trash state machine) is exercised by the node tests with the real main.js.
(() => {
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const ctl = (window.__ctl = {
    queue: [], idSeq: 0, offerSeq: 0,
    downloads: [],            // { opts, files, settle } in call order
    history: [],              // rows returned by getHistory
    histCalls: 0, histHold: false, histWaiters: [],
    deleteManual: false, deleteCalls: [], deleteWaiters: [], deleteResult: { ok: true },
    dismissals: [], reveals: [], unknown: [],
    h: { fp: [], progress: [], setup: [], queueChanged: [], queueRun: [], queueIdle: [] },
    qCtl: { running: false, paused: false, stopAll: false },
  });

  // ---- test controls -------------------------------------------------------------------------
  ctl.releaseHistory = () => { const w = ctl.histWaiters.splice(0); w.forEach(fn => fn()); return w.length; };
  ctl.settleDelete = (i, result) => ctl.deleteWaiters[i](result === undefined ? { ok: true } : result);
  ctl.finishDownload = (i, result) => {
    const d = ctl.downloads[i];
    if (d.settled) return;
    d.settled = true;
    const r = result || { ok: true, count: 1, files: ["/Users/test/Music/dl" + i + ".mp3"], folder: "/Users/test/Music" };
    d.files = r.files || [];
    d.settle(r);
  };
  ctl.emitFp = (payload) => ctl.h.fp.forEach(cb => cb(clone(payload)));   // like IPC: a fresh object each time
  // What main's setImmediate block does after download #i: same validation of _queueId as main.js, and no
  // offer for queue-mode downloads. The identity comes from the REQUEST the real renderer built.
  ctl.fingerprintResult = (i, extra = {}) => {
    const d = ctl.downloads[i], o = d.opts;
    const queueId = (o._inQueue && typeof o._queueId === "string" && o._queueId.length > 0 && o._queueId.length <= 200) ? o._queueId : null;
    const payload = {
      offerId: o._inQueue ? null : "offer-" + (++ctl.offerSeq),
      url: o.url, newFile: (d.files && d.files[0]) || "/Users/test/Music/dl" + i + ".mp3",
      newTitle: "New " + i, matchFile: "/Users/test/Music/old-" + i + ".mp3", matchTitle: "old-" + i + ".mp3",
      inQueue: !!o._inQueue, queueId, ...extra,
    };
    ctl.emitFp(payload);
    return payload;
  };
  // A single-mode warning, as main would emit it (used for the dormant single-warning handler).
  ctl.singleWarning = (n, extra = {}) => {
    const payload = {
      offerId: "offer-" + n, url: "https://example.com/s" + n, newFile: "/Users/test/Music/w" + n + ".mp3",
      newTitle: "Warn " + n, matchFile: "/Users/test/Music/orig" + n + ".mp3", matchTitle: "orig" + n + ".mp3",
      inQueue: false, queueId: null, ...extra,
    };
    ctl.emitFp(payload);
    return payload;
  };

  const emitQC = () => ctl.h.queueChanged.forEach(cb => cb());
  const emitIdle = () => ctl.h.queueIdle.forEach(cb => cb());
  const itemToOpts = (item) => {
    const [kind, val] = String(item.format || "audio:mp3").split(":");
    const isPlaylist = !!item.playlist;
    const opts = {
      url: item.url,
      type: isPlaylist ? "playlist" : (kind === "audio" ? "audio" : "video"),
      audioFormat: kind === "audio" ? val : undefined,
      bitrate: item.bitrate || "320",
      quality: kind === "video" ? val : undefined,
      noConvert: val === "original" || undefined,
      force: !!item.force,
      autoTag: item.autoTag, loudnorm: item.loudnorm, lufs: item.lufs,
      _inQueue: true, _queueId: item.id,
    };
    if (isPlaylist && kind === "audio") opts.audioOnly = true;
    if (isPlaylist && Array.isArray(item.playlistItems) && item.playlistItems.length) opts.playlistItems = item.playlistItems;
    const destId = item.destId;
    if (destId === undefined || destId === null || destId === "") opts.folder = "";
    else if (typeof destId === "string" && destId.startsWith("f:") && destId.slice(2).trim()) opts.folder = destId.slice(2);
    else if (typeof destId === "string" && destId.startsWith("p:") && destId.slice(2).trim()) opts.targetPath = destId.slice(2);
    else opts.destInvalid = true;
    return opts;
  };
  const download = (opts) => new Promise(res => { ctl.downloads.push({ opts: clone(opts), files: [], settle: res }); });
  async function runStubQueue() {
    try {
      while (ctl.qCtl.running) {
        if (ctl.qCtl.stopAll) {
          ctl.queue.forEach(it => { if (it.status === "pending") { it.status = "canceled"; it.note = "Cancelled — ↻ to retry"; } });
          emitQC();
          break;
        }
        if (ctl.qCtl.paused) { await new Promise(r => setTimeout(r, 30)); continue; }
        const item = ctl.queue.find(i => i.status === "pending");
        if (!item) break;
        item.status = "running";
        emitQC();
        const opts = itemToOpts(item);
        let r;
        if (opts.destInvalid) r = { ok: false, error: "This app can't use that location. Choose the folder again.", errorCode: "dest_bad" };
        else r = await download(opts);
        if (r && r.ok) {
          item.status = "done";
          item.error = null;
          if (r.files && r.files[0]) item.title = r.files[0].split("/").pop();
          item.files = r.files || null;
          item.outputDir = r.folder || null;
        } else if (r && r.canceled) {
          item.status = "canceled";
          item.note = "Cancelled — ↻ to retry";
        } else if (r && (r.duplicate || r.skipped)) {
          item.status = "skipped";
          item.note = "Already in folder (duplicate) — ↻ to download anyway";
        } else {
          item.status = "error";
          item.error = (r && r.error) || "download failed";
          item.errorCode = (r && r.errorCode) || null;
        }
        emitQC();
        if (ctl.qCtl.stopAll) {
          ctl.queue.forEach(it => { if (it.status === "pending") { it.status = "canceled"; it.note = "Cancelled — ↻ to retry"; } });
          emitQC();
          break;
        }
      }
    } finally {
      ctl.qCtl.running = false;
      ctl.qCtl.paused = false;
      ctl.qCtl.stopAll = false;
      emitQC();
      emitIdle();
    }
  }

  // ---- window.api ---------------------------------------------------------------------------
  const impl = {
    getSettings: async () => ({ lang: "en", main_folder: "/Users/test/Music", prevent_duplicates: false, auto_tag: false,
      loudnorm: false, lufs: -14, pinned: [], cookies_browser: "", folder_view: "chips", folder_density: "compact" }),
    listFolders: async () => ({ folders: [] }),
    getFavorites: async () => [],
    getFolderCounts: async () => ({}),
    getHistory: (q) => {
      ctl.histCalls++;
      const rows = clone(ctl.history);
      return ctl.histHold ? new Promise(res => ctl.histWaiters.push(() => res(rows))) : Promise.resolve(rows);
    },
    queueGet: async () => clone(ctl.queue),
    queueAdd: async (items) => {
      const fresh = (items || []).map(it => ({ id: "q-" + (++ctl.idSeq), status: "pending", title: null, error: null, ...clone(it) }));
      ctl.queue.push(...fresh);
      return { ok: true, items: clone(fresh) };
    },
    queueUpdateItem: async (patch) => {                      // same semantics as main: unknown id = no-op
      const i = ctl.queue.findIndex(x => x.id === patch.id);
      if (i >= 0) Object.assign(ctl.queue[i], clone(patch));
      return { ok: true };
    },
    queueSet: async (q) => { ctl.queue = clone(q); return { ok: true }; },
    queueClear: async () => {
      ctl.qCtl.stopAll = true;
      ctl.qCtl.running = false;
      ctl.qCtl.paused = false;
      ctl.queue = [];
      emitQC();
      return { ok: true };
    },
    queueClearFinished: async () => {
      ctl.queue = ctl.queue.filter((i) => i.status !== "done");
      emitQC();
      return { ok: true, removed: true };
    },
    queueRemoveErrors: async () => {
      const drop = new Set(["error", "skipped", "canceled", "flagged"]);
      ctl.queue = ctl.queue.filter((i) => !drop.has(i.status));
      emitQC();
      return { ok: true, removed: true };
    },
    queueRevealOutput: async (id, p) => { ctl.reveals.push([id, p]); return { ok: true }; },
    queueLocateFile: async () => ({ ok: false, canceled: true }),
    queueAddOutputFolder: async () => ({ ok: true }),
    queueStart: async () => {
      if (ctl.qCtl.running) { ctl.qCtl.paused = false; emitQC(); return { ok: true, running: true }; }
      ctl.qCtl.running = true;
      ctl.qCtl.paused = false;
      ctl.qCtl.stopAll = false;
      setTimeout(() => { runStubQueue(); }, 0);
      return { ok: true, running: true };
    },
    queuePause: async () => { ctl.qCtl.paused = true; emitQC(); return { paused: true }; },
    queueCancel: async () => {
      const d = [...ctl.downloads].reverse().find((x) => x.opts && x.opts._inQueue && !x.settled);
      if (!d) return { ok: true, killed: false };
      d.settled = true;
      d.settle({ ok: false, canceled: true });
      return { ok: true, killed: true };
    },
    queueStopAll: async () => { ctl.qCtl.stopAll = true; return { ok: true }; },
    queueStatus: async () => ({ running: ctl.qCtl.running, paused: ctl.qCtl.paused, currentId: (ctl.queue.find(i => i.status === "running") || {}).id || null }),
    download,
    deleteFile: (p, offerId) => {
      ctl.deleteCalls.push([p, offerId]);
      if (!ctl.deleteManual) return Promise.resolve(clone(ctl.deleteResult));
      return new Promise(res => ctl.deleteWaiters.push(res));
    },
    fingerprintDismiss: async (offerId) => { ctl.dismissals.push(offerId); return { ok: true }; },
    reveal: async (p) => { ctl.reveals.push(p); return { ok: true }; },
    fingerprintGetSettings: async () => ({ available: true, enabled: true, threshold: 0.9, count: 0 }),
    onFingerprintDup: (cb) => ctl.h.fp.push(cb),
    onProgress: (cb) => ctl.h.progress.push(cb),
    onSetupStatus: (cb) => ctl.h.setup.push(cb),
    onQueueChanged: (cb) => ctl.h.queueChanged.push(cb),
    onQueueRun: (cb) => ctl.h.queueRun.push(cb),
    onQueueIdle: (cb) => ctl.h.queueIdle.push(cb),
    watchGet: async () => ({}),
  };
  window.api = new Proxy(impl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      return (...a) => { ctl.unknown.push(k); return Promise.resolve({}); };
    },
  });
})();
