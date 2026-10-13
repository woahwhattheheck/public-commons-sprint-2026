# Eighteenmile SV-233: 2026 measurements and regional flow context

This is the complete calculation from 58 official results at station 21SC60WQ_WQX-SV-233 and the existing original 285-day USGS02186702 discharge edition. It preserves four sampling dates, six left-censored results and 13 original quantity series. All four sampling-day discharges are provisional.

The original NLDI evidence places the station downstream on the same reach. Its catchment differs from the gauge's catchment. Therefore the result contains 13 context-only series, zero quantified mass days and zero eligible annual mass rows. No missing day or unobserved annual quantity is filled. The actual June10 TSS34mg/L remains distinct from SSC, with original APHA2540-D and unspecified chemical basis/fraction.

The complete17-file product includes the maintained13-file calculation family and the original discharge report, daily/period tables and sampling-day joins. All eight original prepared collection members, its collection manifest and all three original NLDI evidence files are embedded in the full study. The original USGS response and its source URI remain unchanged.

## Open the complete files

Use Node22.16 or later in the existing receiving operation. Retain this source directory and run:

```sh
node materialize-output.mjs --output /actual/course/sv2332026-flow-output
```

Choose a separate new directory. Identical partial receiving can resume; divergent existing files or an unrelated nonempty directory stop. The three ordered compressed parts and every generated member are bound by output-bank.json hashes.

Open report.html for concentration/discharge support and flow-report.html for discharge and original sample-date context. Keep all sibling files together. These are source-native calculations, not a claim that this seat executed SQLite, a browser, or a new native model.

## Same original Measurements receiving

From the maintained application root with PR4758 (v2 recognition), PR4755 (canonical load context) and PR4762 (explicit v2 source admission), use the existing Measurements workspace:

```sh
node measurement_workspace/engine/cli.mjs flow-receive --workspace /actual/measurements --file /actual/course/sv2332026-flow-output/flow-study.json
node measurement_workspace/engine/cli.mjs flow-load-preview --workspace /actual/measurements --file /actual/course/sv2332026-flow-output/load-selection.json
node measurement_workspace/engine/cli.mjs flow-load-save --workspace /actual/measurements --file /actual/course/sv2332026-flow-output/load-selection.json
```

Study: db7910de786d25d147d283257ab4903101d1f90a9a7287ca71275786bd656f80.
Result: 25b44686ec32e1820f77b9f308d0c6fd41c200954b8cef7a4767a4688a514f38.
The original pure modules rebuilt both complete study and result exactly from the retained input/contract. A later scientific implementation is a distinct calculation and must preserve this original result.

The ordinary chemistry collection remains ../characteristics-v2/collection.json. Import that collection for per-result inspection and the native Monitoring context handoff; the flow study does not silently create a chemistry import.

## Required recipient use

Before calling the outgoing study ready, its producing peer must open/run/render the exact outgoing version, look at the actual screen or real screenshots, and operate the important controls. Inspect ordinary laptop/screenshare width and narrow/mobile width, populated and empty views, loading and error states, original-source downloads and cold reopening. Code inspection, DOM checks, HTTP success, screenshots captured without looking, unit checks or another peer’s approval are not substitutes.

Literally open/view/play/use every final attachment in the recipient’s manner: HTML, PDF/report, spreadsheet/CSV, map/image, recording/audio, archive and editable project. Extract archives and open their deliverables and original project. Repair visible clipping, unreadable labels, broken controls and scientific meaning in the maintained product, using plain industrial typography, spacing and restrained controls. If a video is included, use available quality media/natural speech and watch/listen to the final pronunciation, pacing, timing and audio alignment. Preserve controls, histories and vendor policies. Keep this review within the original operation; do not create a separate verification product or revive stopped work.


