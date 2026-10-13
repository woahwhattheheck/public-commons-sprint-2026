# WO11 — official Lake Hartwell 2026 observations

This continuation uses the existing Measurements source collection, SQLite import, report and portable reopening APIs. It adds source acquisition and preparation; it does not create measurements, annual loads, a new analytical engine or a new dashboard.

## Source and scientific meaning

The captured station is SCDES/WQP `21SC60WQ_WQX-RL-26024`, Lake Hartwell northeast of Broyles Recreation Area. The requested period is January 1–October 13, 2026. The four official CSVs were acquired and fully read back on October 13, 2026: one station, six activities, 132 distinct result IDs and 132 matching detection-limit rows. Actual sampling dates are January 21, February 12, March 11, April 14, June 1 and July 6. The requested end date does not imply observations after July 6. Native SQLite receiving and browser use remain a separate producing-host course.

- Station: https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-26024/
- WQP services: https://www.waterqualitydata.us/webservices_documentation/
- Official USGS profile examples: https://water.code-pages.usgs.gov/dataRetrieval/reference/readWQPdata.html
- EPA August 2025 detection guidance: https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf

**Correction of an initial implementation diagnosis:** “Present Above Quantification Limit” is an over-detect/right-censored condition. It must not be automatically converted to a point measurement. The concrete fixes are recognizing below-reporting/below-detection conditions, pairing bounds with compatible original limit types, and not substituting an estimated numeric result for its laboratory threshold. Missing, contradictory or multiple applicable limits remain unresolved. Raw reported numbers, all limit rows, units and qualifiers remain retained.

The new mapping directive `_wqp_detection: wqp-detection-conditions/v2` is explicit and enters the resolved native mapping/import identity. Unpinned historical mappings use their original normalization so existing portable studies still reopen byte-for-byte. This source does not migrate or replace an accepted historical collection. A future deliberate reinterpretation of old source must create a separate reviewed import edition.

For the parent’s new USGS v1 intake, the separate explicit mapping `_usgs_daily: usgs-daily-source/v2` recognizes both published timeseries and approval field spellings. Conflicting simultaneously supplied aliases reject the source row. Unpinned historical USGS imports are unchanged.

## Explicit characteristic edition

Use both `_wqp_detection: wqp-detection-conditions/v2` and `_wqp_characteristics: wqp-characteristics/v1` for the separately prepared `characteristics-v1` collection. The additional directive pins a new mapping/import identity. Omitting it preserves the whole earlier detection-v2 preparation exactly, including all resolved mapping fields and original record objects.

The new module recognizes the 26 actual source labels without broadening model calibration eligibility. TKN and nitrate plus nitrite remain separate from total nitrogen. Chemical basis comes from the explicit source speciation or as-X unit; conflicting bases remain unmapped. No molecular-weight conversion occurs. Total phosphorus requires unfiltered/total fraction and explicit P basis. Hardness with no source chemical basis remains unspecified. Unambiguous metal names retain their elemental basis. BOD5 uses the source's explicit five-day name or APHA 5210-B context, not an arbitrary biochemical oxygen demand label.

MPN/100mL and CFU/100mL are distinct microbial quantities; NTU and FNU remain distinct turbidity scales. Micromhos/cm normalize one-to-one to microsiemens/cm without temperature correction. pH retains its own scale, and salinity in ppt is not treated as a mass concentration. Original method context/name, speciation, result/activity depth and reference, relative depth, time/temperature/weight bases are copied into the new canonical records, as well as the complete raw cells.

All 34 actual censored results remain left-censored observations with no point value; their compatible original thresholds are upper bounds. Two hardness records retain `chemical-basis-unspecified`. Every original winter clock says EDT and two salinity records say 36.79 ppt. These are source review questions: no clock, value or unit was silently corrected. Repeated observations retain their distinct result IDs and are not averaged.

Scientific source basis:

- EPA nutrient field semantics and speciation: https://www.epa.gov/sites/default/files/2017-06/documents/wqx_nutrient_best_practices_guide.pdf
- APHA 5210-B, five-day BOD: https://www.nemi.gov/methods/method_summary/5715/
- Conductivity units: https://archive.epa.gov/water/archive/web/html/vms59.html

## Capture in the existing equipped operation

Run from the maintained application root, using the already installed Python and Node >=22.16. Choose new explicit source/preparation/output directories; retain them on the actual host.

```sh
python -B -m source_tools.capture_wqp_edition --output /actual/course/hartwell2026-original --station 21SC60WQ_WQX-RL-26024 --from-date 2026-01-01 --to-date 2026-10-13
node source_tools/prepare_wqp_measurement_collection.mjs --source /actual/course/hartwell2026-original --output /actual/course/hartwell2026-prepared
```

The completed original capture is retained under `observations/hartwell_2026/wqp_20261013/capture`; reuse those exact bodies for this edition. The following capture command is for a deliberately new dated source edition, not a request to refetch the completed one.

The capture requests Station, Activity (`activityAll`), Result (`resultPhysChem`) and the complete ResultDetectionQuantitationLimit profile. Explicit result metadata is required because the older default physical/chemical CSV can omit ResultIdentifier. Successful original bytes and HTTP metadata are immutable; endpoint errors are recorded and never become a completed capture. Same-query restart reuses verified retained responses. A changed query requires another directory.

Preparation validates all source hashes, station/activity/date joins and organization/result limit joins. It keeps the four original CSVs and capture/query metadata unchanged. A derived result CSV adds one JSON column containing all matching original limit-profile rows and explicitly mapped columns from the exact original activity for site/date/clock/timezone/media/type. These source joins accommodate narrow result profiles while preserving every original result cell; absent original clocks or zones remain absent. It never aligns limits by row position, station proximity or analyte name. Missing result identifiers, mismatched collection clocks or unjoinable limit rows stop preparation. Counts/conditions/issues are written in SOURCE_COVERAGE.json.

To prepare the explicit characteristic edition from those same originals:

```sh
node source_tools/prepare_wqp_measurement_collection.mjs --source observations/hartwell_2026/wqp_20261013/capture --output /actual/course/hartwell2026-characteristics-v1 --characteristics wqp-characteristics/v1
```

The already prepared source tree includes both editions. Use `characteristics-v1/collection.json` for the new native course and preserve `detection-v2/` as original history. If both are imported into one workspace, their shared original result identities are explicit source variants; use the maintained version-selection workflow instead of counting both as separate measurements.

## Original native preview, receive, publish and reopen

```sh
node measurement_workspace/engine/cli.mjs collection-preview --workspace /actual/measurements --manifest /actual/course/hartwell2026-characteristics-v1/collection.json --source-root /actual/course/hartwell2026-characteristics-v1 --output /actual/course/hartwell2026-preview.json
node measurement_workspace/engine/cli.mjs collection-receive --workspace /actual/measurements --manifest /actual/course/hartwell2026-characteristics-v1/collection.json --source-root /actual/course/hartwell2026-characteristics-v1 --output /actual/course/hartwell2026-received.json
node measurement_workspace/engine/cli.mjs collection-publish --workspace /actual/measurements --id ACTUAL_RETURNED_COLLECTION_SHA --output /actual/course/hartwell2026-published.json
```

Use the actual returned collection ID and edition directory. The published edition contains report.html, project.json, records.csv, calibration outputs and original sources. Follow its RECEIVING.md into a new empty measured workspace, then reopen the collection. Station-to-reach and gauge/catchment assignments require the actual source-bound rationale supplied by the current flow/catchment owner. Lake samples and an upstream gauge do not automatically share hydrologic support. No sample is multiplied into an annual load. Seasonal/trend analysis remains with the existing DE49 owner.

## Source-level validation already exercised

The complete original 88-row 2023 CSV was parsed by old and new unpinned source and returned identical complete records/mapping/rejection output. Focused scientific cases cover lower reporting limits with estimated numbers, upper quantitation limits, contradictory directions, incompatible limit types/units, plain numeric values, explicit comparators, and full multi-limit joins. The actual 132-row characteristic preparation also completed in the maintained pure source, with zero rejected/unmapped rows; whole old detection-v2 preparation and the 88-row unpinned parsing remain exactly equal. Focused basis-conflict, absent-basis, MPN/CFU and NTU/FNU checks preserve distinctions. The source capture and pure preparation ran; these checks do not claim SQLite import or browser execution.

## Required recipient use

Before calling the outgoing study ready, its producing peer must open/run/render the exact outgoing version, look at the actual screen or real screenshots, and operate the important controls. Inspect ordinary laptop/screenshare width and narrow/mobile width, populated and empty views, loading and error states, original-source downloads and cold reopening. Code inspection, DOM checks, HTTP success, screenshots captured without looking, unit checks or another peer’s approval are not substitutes.

Literally open/view/play/use every final attachment in the recipient’s manner: HTML, PDF/report, spreadsheet/CSV, map/image, recording/audio, archive and editable project. Extract archives and open their deliverables and original project. Repair visible clipping, unreadable labels, broken controls and scientific meaning in the maintained product, using plain industrial typography, spacing and restrained controls. If a video is included, use available quality media/natural speech and watch/listen to the final pronunciation, pacing, timing and audio alignment. Preserve controls, histories and vendor policies. Keep this review within the original operation; do not create a separate verification product or revive stopped work.
