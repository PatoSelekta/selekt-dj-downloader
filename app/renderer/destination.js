"use strict";
// Queue destination ids -> download options. Loaded by index.html (window.SelektDest)
// and by the automated checks (require), so both run the same code.
//   ""        (or absent)  main folder            -> { folder: "" }
//   "f:<name>"             subfolder of main      -> { folder: name }
//   "p:<path>"             favorite folder        -> { targetPath: path }
// Only an absent/empty id means "main folder". A malformed id ("p:" with no path,
// "f:" with no name, an unknown prefix, a non-string) is reported as
// { destInvalid: true } and is never defaulted to the main folder.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelektDest = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parseDestId(destId) {
    if (destId === undefined || destId === null || destId === "") return { kind: "main" };
    if (typeof destId !== "string") return { kind: "invalid" };
    if (destId.startsWith("p:")) {
      const p = destId.slice(2);
      return p.trim() ? { kind: "favorite", path: p } : { kind: "invalid" };
    }
    if (destId.startsWith("f:")) {
      const n = destId.slice(2);
      return n.trim() ? { kind: "folder", name: n } : { kind: "invalid" };
    }
    return { kind: "invalid" };
  }
  function queueItemDest(item) {
    const d = parseDestId(item && item.destId);
    if (d.kind === "favorite") return { targetPath: d.path };
    if (d.kind === "folder") return { folder: d.name };
    if (d.kind === "main") return { folder: "" };
    return { destInvalid: true };
  }
  return { parseDestId, queueItemDest };
});
