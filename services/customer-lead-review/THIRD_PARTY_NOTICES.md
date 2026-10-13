# Source and license notices

This directory distributes the maintained portable customer-review modules without changing their source bytes. The command-line wrapper and guide are part of this Apache-2.0 distribution; the complete license is in `LICENSE`. Explicit licenses in individual files and the bundled third-party notices remain in force.

## SHA-256

`host/connected_sha256.cjs` retains the complete unchanged js-sha256 1.0.0 source inside the marked upstream region, with its original MIT license and copyright.

- Upstream: https://github.com/emn178/js-sha256
- Commit: `9a54fb31d4594762987e1b5d175265f6bac921de`
- Upstream blob: `e3a08633357cb7ca248e14751f9270d95fbbbdf2`
- Copyright (c) 2014–2026 Chen, Yi-Cyuan.
- The surrounding strict UTF-8 wrapper is retained with the original module.

## Gzip and raw DEFLATE

`host/connected_gzip.cjs` retains pako 2.1.0's unchanged inflate-only distribution and its complete MIT and Zlib notices. The original maintained framing, bounds and compression functions remain around that distribution.

- Upstream: https://github.com/nodeca/pako
- Commit: `3c06216518c259b569a5168dee867e6dabbe5160`
- Upstream file: `dist/pako_inflate.min.js`
- Upstream blob: `587fbdd52115bb7d7215e0aeab5398280a4b1fdd`
- Upstream distribution SHA-256: `fa226c8e1e3556993260e6a5c1fe94e225da59b3418a06811fdc51d308f8bb43`
- MIT copyright: Vitaly Puzrin and Andrei Tuputcyn, 2014–2017.
- Zlib copyright: Jean-loup Gailly and Mark Adler, 1995–2013; Vitaly Puzrin and Andrey Tupitsin, 2014–2017.

The full copyright, permission and warranty texts are kept in the distributed source file.

## Inline payloads

`host/connected_inline_payload.mjs` carries its original MIT declaration. Its complete maintained source is unchanged.

## Reuse

Keep this notice, the applicable licenses and all in-source upstream notices when redistributing. The hashes in `source-manifest.json` identify the exact maintained module bytes included here. No generated customer package is part of this source distribution.
