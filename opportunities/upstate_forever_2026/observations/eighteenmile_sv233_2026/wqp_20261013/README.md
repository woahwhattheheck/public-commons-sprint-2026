# Eighteenmile SV-233 — official 2026 source edition

Original WQP station 21SC60WQ_WQX-SV-233; January 1–October 13, 2026 query. Four official CSV profiles were fetched through the existing Notion integration and attached to the original source page. Full bodies, CSV counts and hashes were checked at 2026-10-13T18:20:43Z. Origin fetch timestamps and response headers are unavailable; the capture does not invent them.

The source contains 58 result identifiers from four activities (January 7, April 13, June 10 and July 8), with 58 exactly joined limit rows. Six results are explicitly Present Below Quantification Limit. All four source CSVs parse without rejected rows. The published wqp-characteristics/v1 and detection/v2 interpretation recognizes 57 results; one literal Total suspended solids result remains unmapped under that pinned edition. A later explicitly selected characteristics edition can interpret it without changing this collection.

Station: EIGHTEENMILE CK AT 2-04-279, River/Stream, WGS84 34.63478373, -82.80447251, HUC8 03060101. No drainage area is supplied by this source. Existing USGS02186702 relation is downstream_same_reach regional context, not matched catchment discharge. No native annual mass or loading inference is made here.

All original result IDs, chemical names, fractions, speciation, methods, clocks, source units, flags and paired limit profiles are retained. Canonical preparation used the original maintained JavaScript functions in V8; no SQLite import, native receiving or browser acceptance is claimed.

Use the existing Measurements collection importer with characteristics-v1/collection.json and its relative source members. The receiving producer must open the actual resulting study, inspect all parameter groups and flags, save, export and reopen it on the same Workspace. Preserve original source identity and any review history.

## Current explicit solids edition

Use characteristics-v2/collection.json for the current native course. It recognizes all 58 results while retaining the complete earlier v1 collection unchanged. The June 10 TSS result remains 34 mg/L, APHA2540-D, original unspecified fraction/speciation. TSS and SSC are distinct; no automatic sediment-export comparison is admitted. See source_tools/WQP_OFFICIAL_EDITION.md for the full mapping and receiving contract.
