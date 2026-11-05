# App icon artwork

**These files are not covered by the repository's MIT licence.** The MIT licence in `LICENSE`
applies to the source code. The artwork in this folder is the SelektDJ brand mark. The repository owner
has confirmed that he has the right to include it in this public repository; that is the only permission
recorded here. The artwork is excluded from the MIT licence, its reuse terms are separate and not stated,
this repository does not grant any licence to it, and it gives no permission to use the SelektDJ name or
mark for other products.

| File | What it is |
| --- | --- |
| `source/selektdj-k-icon.svg` | The existing SelektDJ light-tile icon (`selektdj-k-icon.svg`), copied unmodified |
| `icon.png` | 1024 x 1024 PNG with transparent margin, used for the Windows and Linux build targets |
| `icon.icns` | macOS icon, used for the macOS build target |

How the PNG and ICNS were made from the SVG (appearance unchanged; nothing redrawn or recoloured):

- The SVG's own tile (viewBox 1112.2 x 1024, not square) is scaled uniformly to 840 px wide and centred on a
  transparent 1024 x 1024 canvas. The tile keeps its landscape shape; nothing is stretched or cropped.
- Each size (16, 32, 64, 128, 256, 512, 1024 px) is rendered directly from the vector, not scaled down
  from the 1024 px image.
- `icon.icns` packs those PNGs (`icp4`, `icp5`, `icp6`, `ic07`-`ic14`) with a small script, not Apple's
  `iconutil`. It reads back correctly in Pillow; it has **not** been opened or built on macOS.
- At 16 px the double chevron is blurred; from 32 px up it is clear.
