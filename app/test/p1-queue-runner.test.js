"use strict";
// Phase 1: the sequential queue lives in main. Tests call production queue-start, not a copied renderer loop.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeHarness } = require("./h3-harness");

const T = { timeout: 20000 };
async function drain(h, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await h.invoke("queue-status");
    if (!st.running) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail("queue did not drain");
}

test("queue-start runs pending items via production download; 1.1.0 array shape still works", T, async () => {
  const h = makeHarness();
  try {
    const stored = [
      { id: "old-1", url: "https://example.com/a", status: "pending" },
      { id: "old-2", url: "https://example.com/b", status: "pending", title: null, error: null },
    ];
    h.write("queue.json", JSON.stringify(stored));
    const start = await h.invoke("queue-start");
    assert.equal(start.ok, true);
    assert.equal(start.running, true);
    await drain(h);
    const q = await h.invoke("queue-get");
    assert.deepEqual(q.map((i) => i.status), ["done", "done"]);
    assert.equal(q[0].id, "old-1");
    assert.ok(Array.isArray(q));
    assert.ok(h.ytdlpCalls().length >= 2);
    assert.ok(q[0].files && q[0].files.length);
  } finally { h.close(); }
});

test("renderer reload (did-finish-load) while running does not duplicate spawn and does not reset the active item to pending", T, async () => {
  const h = makeHarness({ withWindow: true });
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "hang.mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [{ id: "r1", url: "https://example.com/hang", status: "pending" }]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    const nBefore = h.ytdlpCalls().length;
    h.fireWebContents("did-finish-load");
    await new Promise((r) => setTimeout(r, 40));
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "running");
    assert.equal(h.ytdlpCalls().length, nBefore);
    h.releaseHang();
    await drain(h);
  } finally { h.close(); }
});

test("app-start with no runner resets stale running → pending", T, async () => {
  const h = makeHarness({
    withWindow: true,
    beforeLoad: ({ userData }) => {
      fs.writeFileSync(path.join(userData, "queue.json"), JSON.stringify([
        { id: "stale", url: "https://example.com/s", status: "running" },
      ]));
    },
  });
  try {
    h.fireWebContents("did-finish-load");
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "pending");
    const st = await h.invoke("queue-status");
    assert.equal(st.running, false);
  } finally { h.close(); }
});

test("pause: second item does not start until unpaused", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    let n = 0;
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        n++;
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "t" + n + ".mp4");
        fs.writeFileSync(f, "x");
        if (n === 1) return { hang: true, stdout: f + "\n" };
        return { code: 0, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [
      { id: "a", url: "https://example.com/a", status: "pending" },
      { id: "b", url: "https://example.com/b", status: "pending" },
    ]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    await h.invoke("queue-pause");
    h.releaseHang();
    await new Promise((r) => setTimeout(r, 600));
    const mid = await h.invoke("queue-get");
    assert.equal(mid[0].status, "done");
    assert.equal(mid[1].status, "pending");
    await h.invoke("queue-start");
    await drain(h);
    assert.deepEqual((await h.invoke("queue-get")).map((i) => i.status), ["done", "done"]);
  } finally { h.close(); }
});

test("stop-all cancels current and marks remaining pending as canceled", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "c.mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [
      { id: "a", url: "https://example.com/a", status: "pending" },
      { id: "b", url: "https://example.com/b", status: "pending" },
    ]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    await h.invoke("queue-stop-all");
    await drain(h);
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "canceled");
    assert.equal(q[1].status, "canceled");
  } finally { h.close(); }
});

test("clear while running cancels child and empties the array", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "c.mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [{ id: "a", url: "https://example.com/a", status: "pending" }]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    await h.invoke("queue-clear");
    await drain(h);
    assert.deepEqual(await h.invoke("queue-get"), []);
  } finally { h.close(); }
});

test("invalid destId fails the item with dest_bad and never calls yt-dlp", T, async () => {
  const h = makeHarness();
  try {
    await h.invoke("queue-set", [
      { id: "bad", url: "https://example.com/x", status: "pending", destId: "p:" },
      { id: "ok", url: "https://example.com/y", status: "pending", destId: "" },
    ]);
    await h.invoke("queue-start");
    await drain(h);
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "error");
    assert.equal(q[0].errorCode, "dest_bad");
    assert.match(q[0].error, /can't use that location/);
    assert.equal(q[1].status, "done");
    assert.equal(h.ytdlpCalls().filter((c) => c.args.includes("-o")).length, 1);
  } finally { h.close(); }
});

test("queue-update-item cannot reset a running item to pending", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "hang.mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [{ id: "r1", url: "https://example.com/hang", status: "pending" }]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    const nBefore = h.ytdlpCalls().length;
    const r = await h.invoke("queue-update-item", {
      id: "r1", status: "pending", error: null, note: null, force: true,
    });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.code, "running");
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "running");
    assert.equal(h.ytdlpCalls().length, nBefore);
    h.releaseHang();
    await drain(h);
  } finally { h.close(); }
});

test("queue-update-item cannot mark a pending item running; runner owns that transition", T, async () => {
  const h = makeHarness();
  try {
    await h.invoke("queue-set", [{ id: "p1", url: "https://example.com/p", status: "pending" }]);
    const r = await h.invoke("queue-update-item", { id: "p1", status: "running" });
    assert.equal(r.ok, false);
    assert.equal((await h.invoke("queue-get"))[0].status, "pending");
    const st = await h.invoke("queue-status");
    assert.equal(st.state, "idle");
    assert.equal(st.running, false);
  } finally { h.close(); }
});

test("runner state is exclusive: idle → running → paused → running → stopping → idle", T, async () => {
  const h = makeHarness();
  try {
    h.mkdir("Music");
    let n = 0;
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        n++;
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "t" + n + ".mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    assert.equal((await h.invoke("queue-status")).state, "idle");
    await h.invoke("queue-pause");
    const idlePause = await h.invoke("queue-status");
    assert.equal(idlePause.state, "idle");
    assert.equal(idlePause.paused, false);
    await h.invoke("queue-set", [
      { id: "a", url: "https://example.com/a", status: "pending" },
      { id: "b", url: "https://example.com/b", status: "pending" },
    ]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    let st = await h.invoke("queue-status");
    assert.equal(st.state, "running");
    assert.equal(st.running, true);
    assert.equal(st.paused, false);
    await h.invoke("queue-pause");
    st = await h.invoke("queue-status");
    assert.equal(st.state, "paused");
    assert.equal(st.running, true, "loop is still alive while paused");
    assert.equal(st.paused, true);
    assert.equal((await h.invoke("queue-get"))[0].status, "running", "current download keeps going");
    h.releaseHang();
    assert.ok(await h.waitFor(() => {
      try {
        const q = JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"));
        return q[0].status === "done" && q[1].status === "pending";
      } catch { return false; }
    }));
    st = await h.invoke("queue-status");
    assert.equal(st.state, "paused");
    assert.equal((await h.invoke("queue-get"))[1].status, "pending");
    await h.invoke("queue-start");
    st = await h.invoke("queue-status");
    assert.equal(st.state, "running");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[1].status === "running"; }
      catch { return false; }
    }));
    await h.invoke("queue-stop-all");
    await drain(h);
    st = await h.invoke("queue-status");
    assert.equal(st.state, "idle");
    assert.equal(st.running, false);
    const q = await h.invoke("queue-get");
    assert.equal(q[0].status, "done");
    assert.equal(q[1].status, "canceled");
  } finally { h.close(); }
});

test("reload while live does not reset running; restart (idle) does", T, async () => {
  const h = makeHarness({ withWindow: true });
  try {
    h.mkdir("Music");
    h.setScript((cmd, args) => {
      const o = args.indexOf("-o");
      if (o >= 0) {
        const dir = path.dirname(args[o + 1]);
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, "hang.mp4");
        fs.writeFileSync(f, "x");
        return { hang: true, stdout: f + "\n" };
      }
      return { code: 0 };
    });
    await h.invoke("queue-set", [{ id: "r1", url: "https://example.com/hang", status: "pending" }]);
    await h.invoke("queue-start");
    assert.ok(await h.waitFor(() => {
      try { return JSON.parse(fs.readFileSync(h.p("queue.json"), "utf8"))[0].status === "running"; }
      catch { return false; }
    }));
    assert.equal((await h.invoke("queue-status")).state, "running");
    h.fireWebContents("did-finish-load");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await h.invoke("queue-get"))[0].status, "running");
    h.releaseHang();
    await drain(h);
    assert.equal((await h.invoke("queue-status")).state, "idle");
    h.write("queue.json", JSON.stringify([{ id: "stale", url: "https://example.com/stale", status: "running" }]));
    h.fireWebContents("did-finish-load");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await h.invoke("queue-get"))[0].status, "pending");
    assert.equal((await h.invoke("queue-status")).state, "idle");
  } finally { h.close(); }
});

test("watch-queued MP3/320 item runs through production runner", T, async () => {
  const h = makeHarness();
  try {
    const inbox = path.join(h.userData, "inbox", "inbox.txt");
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.writeFileSync(inbox, "https://example.com/watched\n");
    await h.invoke("watch-set", { inbox_path: inbox, enabled: true });
    const [w] = await h.invoke("queue-get");
    assert.equal(w.audioFormat, "mp3");
    assert.equal(w.bitrate, "320");
    await h.invoke("queue-start");
    await drain(h);
    const [done] = await h.invoke("queue-get");
    assert.equal(done.status, "done");
    await h.invoke("watch-stop");
  } finally { h.close(); }
});
