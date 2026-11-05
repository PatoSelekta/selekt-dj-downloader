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
    h: { fp: [], progress: [], setup: [], queueChanged: [], queueRun: [] },
  });

  // ---- test controls -------------------------------------------------------------------------
  ctl.releaseHistory = () => { const w = ctl.histWaiters.splice(0); w.forEach(fn => fn()); return w.length; };
  ctl.settleDelete = (i, result) => ctl.deleteWaiters[i](result === undefined ? { ok: true } : result);
  ctl.finishDownload = (i, result) => {
    const d = ctl.downloads[i];
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
    queueClear: async () => { ctl.queue = []; return { ok: true }; },
    download: (opts) => new Promise(res => { ctl.downloads.push({ opts: clone(opts), files: [], settle: res }); }),
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
