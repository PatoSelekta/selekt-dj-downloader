"use strict";
// History timestamps. history.jsonl stores `time` as a UTC ISO string (new Date().toISOString(), "...Z").
// That stored format is NOT changed; only the DISPLAY converts it to the computer's local time.
// Loaded by index.html (window.SelektTime) and by the automated checks (require), so both run the same code.
//   valid ISO date/time  -> "YYYY-MM-DD HH:MM" in the local time zone (same look as before)
//   missing / non-string / not an ISO date+time (a bare date has no time zone) / impossible date -> "" (nothing is shown, never "NaN" or a wrong time)
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelektTime = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ISO_START = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
  const pad = (n) => String(n).padStart(2, "0");
  function formatHistoryTime(value) {
    if (typeof value !== "string") return "";
    const s = value.trim();
    const m = ISO_START.exec(s);
    if (!m) return "";
    // Date() silently rolls impossible dates over (Feb 30 -> Mar 2): reject them instead of showing a wrong time.
    const [y, mo, da, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
    if (mo < 1 || mo > 12 || h > 23 || mi > 59 || da < 1 || da > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return { formatHistoryTime };
});
