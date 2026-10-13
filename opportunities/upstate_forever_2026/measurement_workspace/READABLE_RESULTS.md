# Measurements: readable results and saved reopening

The existing Measurements desk now shows saved reviewed-input and concentration/discharge reports as readable, independently downloadable results. This is the WO47 continuation of Bryce's actual October 13 instruction to let Tim run his data through the existing system. Original claim: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791910950201729?thread_ts=1791724121.853269. Current 52-work-order bank: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R2SQ0NP.

## User journey

Create an input package or paired-load report in Exports & handover. The same operation saves the original result in the existing SQLite exports table and opens its readable view. Saved results lists those original snapshots, twenty at a time. Opening a result is read-only and does not run a model, repeat the pairing, change a review or create another saved export.

Each result has its original creation time and workspace revision. Later review/source changes produce a visible historical-result notice. The two result populations stay separate: paired and unpaired observations, or accepted and excluded observations. Every reason is explained alongside its original code. Table paging changes the visible rows only; each CSV and standalone HTML contains its complete selected population. Original JSON preserves all stored fields. A saved format that this renderer does not know remains downloadable as original JSON.

The paired-load view retains both observation IDs, stations, source calendar date, constituent, chemical basis, fraction, concentration and censoring, daily mean discharge, point/bound rates and the original rationale and assumptions. The kg/day quantity is a daily-equivalent rate from a discrete concentration; it is not a measured daily mass or annual load. This release does not alter calibration.mjs, normalization, eligibility, matching, factor 86.4 or any scientific result.

The source archive and pre-import inspection also show readable mapping, provenance, quality flags and rejected-row reasons with the original source values. The original file and complete rejected-row downloads remain available. The first 100 rejected rows are visible in an archive inspection; its complete download retains all rejections.

## Format and source preservation

- web/results.mjs is a pure, dependency-free renderer for the original version-1 report formats. It is copied unchanged to operator/web/measured_results.mjs.
- workspace.js and the existing operator mirror select the matching relative module path. The native extension descriptor lists the new asset.
- GET /api/measurement-workspace/exports?offset=0&limit=20 reads existing export metadata in one read transaction; limit is 1–100. The existing GET /exports/:id and stored content remain unchanged.
- Standalone and native operator routes serve the same module. The original authenticated bridge, process ownership and database schema remain unchanged.
- Complete workspace export/receive already includes the exports table. Results reopened after receiving use those same retained snapshots and require no new scientific execution.
- CSV follows the maintained parser's formula protection: textual fields beginning with spreadsheet formula characters receive a leading apostrophe. Numeric values, including zero, remain numeric text. Complete original JSON retains exact textual identities without this spreadsheet protection. CSV is a readable result export, not the WO46 source-workbook roundtrip.

The HTML renderer escapes all source text and has explicit neutral root/table colors and narrow-screen scrolling. Original null values are shown as “Not supplied”; zero is preserved. Original assumptions and full provenance remain available. No new scientific observations are authored by the view.

## Source execution completed

The five original public WQP CSVs from source bank 061f6a9507313931a0d0cb4cf2c5c06a981466fd were executed through the unchanged current normalizer and this source inspector: 533 complete rows. That cohort contains no discharge measurement and was used for source inspection, not a positive pairing claim. Focused authored display checks covered zero versus null, markup escaping, formula-safe text, immutable input, and historical-revision labeling. These checks do not replace native application operation or rendered inspection.

## Continue the one existing native Measurements course

Use the actual currently accepted Measurements application/Workspace and the existing DD6B/CB54/675D five-source snapshot pickup. Preserve all current scientific selections and existing source/review IDs. Install with the maintained operator/install_measurements.py and current integration/measurements/INSTALLATION.json; the inventory binds both native and standalone assets. Do not start a second application or allocate a second receiving queue.

1. Open the original populated source and a rejected-row/source-provenance inspection. Compare original field names, station IDs, dates, fractions, units and censoring against the retained original.
2. Open Saved results. Reopen an already-saved calibration result and paired-load result when they exist. If the original operator creates a new result, use its actual selected reaches/reviews/stations and record the genuine result; do not substitute a display fixture or invent positive pairs.
3. Inspect accepted/excluded and paired/unpaired groups, including empty populations and missing numeric values. Page through groups and history. Confirm reopening leaves the export count, workspace revision and original export content unchanged.
4. Download the actual full HTML, each population CSV and original JSON. Open the outgoing HTML and CSV. Compare complete row counts and representative original IDs, censoring bounds, rationale and scientific support. Retain the exact bytes and screenshots.
5. Operate at the actual presentation width and 390px. LOOK at the actual screen or screenshots: headings, table contrast, sideways scroll, buttons, historical notices and rejection detail. Repair visible defects in this same source.
6. Through the existing portable course, receive the complete original workspace in its designated fresh receiver and reopen the same original export IDs. Preserve original bytes and source/review history.
7. Return actual source/host/workspace/result IDs and full outgoing files to the original Sales parent. Keep the ongoing WO46 original workbook return, intake mapping, calibration return and load-science owners composed.

Read the complete project AGENTS.md and CURRENT_OWNER_DIRECTION.md plus the current original Slack instruction. Producing workers must actually open, operate and LOOK at every outgoing client-facing attachment. Current owner directions continue the Eco build beyond the former 14:00 UTC checkpoint; Bryce's local-browser reservation ended when he announced the meeting over and explicitly released it. Existing browser owners and original tabs remain authoritative.
