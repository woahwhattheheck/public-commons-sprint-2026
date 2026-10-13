# North Carolina assessment rating history

Complete original-source analysis of the eight IR2008–IR2022 overall-rating columns carried by 110 assessment units in NC DEQ's Final 2022 Integrated Report. Includes all 880 cells, all 110 trajectories, every adjacent-cycle matrix, all 15 label changes, fixed-current-size tables, the original publisher records, an offline unit explorer and one native scientific report source.

**Needs expert review.** Assessment-label histories within a fixed 2022 corpus do not establish a measured or causal water-quality trend. Current legal/designation alignment, parameter-specific assessment, monitoring records and geographic intersections retain their own source owners and meanings.

## Use the original product

Import the project-root nc_assessment_history.sources.json through the existing Sources workflow. It contains exactly one OBSERVED_CONTEXT report entry, complete original and generated companions, and the typed upstate.observed-report/v1 recipe. The existing Sources report viewer opens report.html, including search, subbasin/rating filters, all eight historical columns, original record inspection and offline CSV/JSON downloads.

Use the maintained scientific report renderer:

~~~sh
"$PYTHON" -B "$APPLICATION/source/observed-report-20261013/render.py" \
  --app-root "$APPLICATION" \
  --workspace "$OWNED_OUTPUT/workspace" --create-workspace \
  --manifest "$SOURCE_ROOT/nc_assessment_history.sources.json" \
  --output "$OWNED_OUTPUT/rendered" \
  --archive "$OWNED_OUTPUT/nc-assessment-history.zip" \
  --receive-directory "$OWNED_OUTPUT/received"
~~~

Use the actual current application and its interpreter. SOURCE_ROOT is the complete project-relative source root; it may be separate from APPLICATION. OWNED_OUTPUT is a separate new directory. The maintained renderer imports the source, produces native PDF/HTML/CSV/JSON/SVG, then exports and cold reopens the same Workspace. It requires no modeled baseline. Preserve current shared renderer fixes and dependencies; this package does not vendor an older application.

For an existing Workspace, omit --create-workspace. Repeated --manifest options append other original scientific reports in explicit order.

## Reproduce the source calculations

Node.js 20 or newer; standard library only:

~~~sh
node source/nc_assessment_history/20261013/replay.mjs \
  /absolute/current/application /absolute/new/nc-history-source
~~~

The replay verifies both original source hashes/bytes, runs the same pure core and renderer, and atomically writes a new complete source root. Existing output directories are rejected. All original compiler files and source bodies travel with every output and the native manifest. source.json pins the exact original query and metadata.

The complete core and report renderer were executed against those original bodies in a JavaScript runtime during authorship. Native PDF/archive receiving and rendered-product operation use the actual receiving application's interpreter/browser.

## Interpretation and exact arithmetic

- Denominator: the same 110 unique AU_ID values in all eight original columns. All 880 cells preserve literal strings or null, field aliases, original OBJECTID and original JSON pointers.
- The source is the Final 2022 edition. Prior labels on current records do not reconstruct each earlier assessment year's geography or full statewide cohort.
- Original strings such as No Data and Data Inconclusive retain agency meaning. They are not replaced by inferred pollution levels, missing monitoring, improvement or deterioration.
- AU_Length/AU_Units are fixed current-source values: 105 units in FW Miles and five in FW Acres. Decimal sums preserve original JSON numeric tokens; display rounds to three decimals. Miles and acres are never added.
- The 34 original polygon rows represent units already in the layer-2 corpus. They add no assessment units. This history performs no geometry transformation.
- BIMS_CLASS/PRIMARY_CLASS are current source attributes. Separate table-4 CYCLE records are parameter assessments, not these overall-rating columns.
- Complete transition matrices include unchanged diagonal cells and original AU IDs. Equal year-level totals can hide opposing unit-level changes.

## Source and permissions

Original publisher: North Carolina Department of Environmental Quality. Full agency responses are retained at source/nc_assessment_2022/20261013/original/. This manifest preserves the exact selected attribute body and layer metadata with their URLs, sizes and SHA256 values. The full original family remains component nc-ga-original-assessment-source. No agency endorsement is implied. Original publisher terms remain in retained metadata. Derived code/report use the repository license.

## Owner-directed rendered-product inspection

The producing/receiving worker must open the exact outgoing report, LOOK at its rendered screen or real screenshots, and operate important controls before calling it client-ready. Inspect at a normal screenshare width and 390 px: populated tables, no-match filter, original record detail, full and filtered CSV/JSON downloads, print/native PDF, source links, and reopened report. View captured screenshots, fix concrete defects, and preserve original scientific values. Code review, DOM counts or another worker's approval do not replace inspection.

Use the same existing native report/browser operation; do not create a second desk or broad test suite. Source publication and integration proceed while that receiving runs. The Ecosystem sprint ends 13 October 2026 at 14:00 UTC; preserve the integrated artifact and unfinished state at cutoff.
