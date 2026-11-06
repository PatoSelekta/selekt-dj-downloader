# Third-Party Inventory (DRAFT, desktop app)

**Draft inventory. This is an inventory of what the source references, not a compliance
statement and not legal advice.** Licence names come from `app/package-lock.json` (lockfile version 3)
or package metadata. Items marked *not verified* were not inspected.

Nothing below is redistributed *in this repository*: `node_modules`, `dist` and downloaded binaries are
excluded. Whether a built installer that includes any of them can be redistributed, and on what terms,
is **unresolved**.

---

## 1. npm dependencies (`app/package.json`)

Direct dependencies:

| Package | Range | Locked | Licence (lockfile) | Notes |
| --- | --- | --- | --- | --- |
| `chokidar` | ^3.6.0 | 3.6.0 | MIT | Watch-folder inbox |
| `ffmpeg-static` | ^5.2.0 | 5.3.0 | **GPL-3.0-or-later** | Installs a prebuilt ffmpeg binary at `npm install` time. Licence of the binary build itself *not verified*. |
| `ffprobe-static` | ^3.1.0 | 3.1.0 | MIT (package) | Ships prebuilt `ffprobe` binaries per OS/arch. Licence of those binaries *not verified*. |
| `yt-dlp-wrap` | ^2.3.12 | 2.3.12 | MIT | Imported by `main.js`. The yt-dlp binary itself is not part of this package (see section 3). |

Production dependency tree: 37 packages in `app/package-lock.json` (non-dev). By lockfile licence
field: MIT 31, ISC 3, Apache-2.0 1, GPL-3.0-or-later 1 (`ffmpeg-static`), and 1 with no licence field in
the lockfile (`parse-cache-control` 1.0.1). 259 further packages in the lockfile are dev-only (entries marked `dev` or `devOptional`).

## 2. Components added by packaging (electron-builder)

| Component | Version | Notes |
| --- | --- | --- |
| Electron | 44.10.2 (locked; a `devDependency`, but the runtime is packaged into the app) | MIT for Electron itself. A packaged app also contains Chromium and other components under their own licences. *Not verified* (no built app was inspected). |
| `ffmpeg-static`, `ffprobe-static` binaries | see section 1 | `asarUnpack` in `package.json` places both packages' files alongside the app, so **a built desktop app bundles ffmpeg**. |
| `electron-builder` and its toolchain | 24.13.3 | Build-time tool, not shipped in the app. |

## 3. Downloaded at runtime by the app

| Component | Source in code | Notes |
| --- | --- | --- |
| `yt-dlp` standalone binary (`yt-dlp_macos`, `yt-dlp.exe`, `yt-dlp_linux`, `yt-dlp_linux_aarch64`) | `https://github.com/yt-dlp/yt-dlp/releases/download/<tag>/...` (`app/main.js`) | The yt-dlp project's own licence is stated upstream as The Unlicense (not re-verified in this pass). The prebuilt standalone binaries bundle Python and other libraries under their own licences. *Not verified.* **SHA-256 is checked against that tagged release's `SHA2-256SUMS`.** That is not a signature. A failed update restores the previous binary from `.bak`. If the sums file is missing, a size-floor of the **same tag** is used; a checksum mismatch never installs. |
| `fpcalc` (Chromaprint) | **Not downloaded.** Optional; the user supplies it | Looked up in the app's `bin/` folder, then on `PATH`. Licence *not verified*. |

---

## This repository's own licence and artwork

- Source code: MIT (`LICENSE`; `"license": "MIT"` in `app/package.json`). It covers this repository's code
  only, not the third-party components above.
- Artwork: `app/build/icon.png`, `app/build/icon.icns` and `app/build/source/selektdj-k-icon.svg` are the
  SelektDJ brand mark and are **not** under the MIT licence; see `app/build/ARTWORK.md`.

## Unresolved (owner / counsel)

- Reuse terms for the SelektDJ brand artwork, if the owner ever wants to offer any. The owner has
  confirmed the right to include it in this repository; no licence for others is granted or stated.
- Obligations that attach to distributing a built desktop app containing GPL-licensed ffmpeg and the
  Electron/Chromium bundle.
- Whether to add a **signature** check for the runtime yt-dlp download (checksum against `SHA2-256SUMS` is
  now performed; that still does not prove the GitHub release is authentic). A pinned signature would be
  needed before any stronger authenticity claim.
