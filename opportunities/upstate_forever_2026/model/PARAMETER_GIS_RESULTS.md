# Parameter-study GIS results

The original parameter-study report, individual result ZIP and broad Gura suite
carry the requested difference maps together. Each GeoTIFF is the original
retained comparison output, with the original comparison and model-grid records.

## Receive the complete application

Use a cumulative checkout containing `model/parameter_exports.py`,
`model/parameter_studies.py` and `source_tools/receive_gura_studies.py`.
The maintained parameter-study operator uses the same backend. Source provenance
for this integration is the complete three-file contribution
UPSTATE-PARAMETER-GIS-DELIVERY-7F24-20261013, Canvas F0C8V85UKHA, composed with
the native-stage capacity continuation in PR3239 and paired aggregation in PR3210.

## Open and download

In **Parameter studies**, select the saved study. When its saved selection has
`difference_maps: true`, use **Run all cases** or **Resume remaining cases** for unfinished native cases, or
**Refresh completed results** for the retained completed cases. The ordinary saved artifacts include the report, quantitative
CSV/JSON, original comparison and grid records, and each completed case's selected
pollutant GeoTIFF. The report's **Spatial parameter responses** table links each
GeoTIFF by case, pollutant and original units.

Download the study archive and extract it with its directories intact. Open
`report.html`; its GIS links point into
`difference-maps/<comparison-id>/`. Each GeoTIFF holds alternative minus baseline
annual mass per pixel, on the paired valid cells used by the original comparison.
A negative value means lower modeled export in that alternative. Summed reporting
area quantities and coverage remain in the quantitative CSV and JSON.

For an already completed study, **Refresh completed results** rebuilds the saved
report and GIS export from its retained native runs. A completed study reached
through the existing backend `parameter-study.run` action also upgrades an older
export edition automatically. This keeps the
original study, case, run, profile, grid and comparison identities. It does not
launch native calculations for a completed study. The existing queued summarize action powers **Refresh completed results**.

## Broad Gura receiving

Continue the existing `source_tools.receive_gura_studies` command with its original
Workspace, inputs, scopes, design, evaluation IDs and difference-map flag.
The suite's `index.html` opens each study report under `studies/<study-id>/`.
Nested GIS paths are preserved inside that report and in
`gura-parameter-suite.zip`. This remains the original GURA-NATIVE-01 operation.

## Interrupted transfer and capacity recovery

Original map copies use independently owned verified files. A matching retained
copy is reusable when packaging continues. ZIP64 members stream in 1 MiB blocks,
checking original bytes, SHA256 and the opened file identity; the prior complete
archive stays published until its complete replacement is ready. TIFFs and nested
ZIPs are stored without redundant ZIP compression.

If the filesystem fills, the original native/suite error and completed cases
remain available through the continuation implemented in
[NATIVE_STAGE_CONTINUATION.md](NATIVE_STAGE_CONTINUATION.md).
Make capacity available, then continue the same operation. An interrupted export
does not require another scientific selection or another run queue.

The original native comparison remains authoritative for signs, units, masks and
source identities. Exports add portable files and report links; they do not
resample maps or change the physical calculations.
