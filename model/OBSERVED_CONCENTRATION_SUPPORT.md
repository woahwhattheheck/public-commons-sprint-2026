# Observed concentrations in the scientific delivery

The maintained `model.observed_context` collector now adds the same original
concentration coverage and mean-interval tables used by Published Studies.
The selected OBSERVED_CONTEXT source still supplies the complete original report
recipe, all source members, and the four numeric figures. Its binding edition is
`observed-context-20261013-v4`, so a new delivery retains this complete collector
edition while earlier reports keep their original identity.

## Original source and calculation

The collector reads the exact source-bound `study.json`, `stations.csv`,
`seasonal_summaries.csv`, `wqp/derived/measurements.csv`, and
`wqp/derived/selected_chlorophyll.csv`. Every member is verified by the original
collector before use. It calls the maintained Published Studies row reader,
combined-observation selector, typed seasonal/station CSV readers and observation
context producer. It then calls the original observation-support enrichment and
report-section functions.

This selects the same original study stations, grab-sampling period and surface
concentration parameters as that source. Chlorophyll uses the reconciled original
cohort. Microcystins retain all original campaign rows, with project and activity
type defining separate series. Original activity/result IDs, dates, units,
qualifiers, reporting limits and published summary counts remain attached.
The collector does not read another Workspace study, choose a replacement cohort,
or convert concentration context to an annual watershed load.

The supplied original source contains 75 selected chlorophyll results and
85 campaign microcystin results. The latter contain 64 quantified values and
21 lower-censored values. Their complete source-row identifiers and numerical
interval endpoints were retained in merged PR2978 and independently recomputed.
Printed seasonal-summary counts remain a separate publisher table.

## Report and export closure

`collect(workspace, selection, directory, state)` retains its existing return:
`sections`, `binding`, and ordinary `files` descriptors. The concentration
addition appends the original `observation_support.report_sections` exactly
once and writes a complete `observed-support/<original-body-sha256>/concentration-context.json`.
The new `files.concentration_support` descriptor includes the file's actual
path, bytes, SHA256 and original source ID. That document retains the source
binding, five input-member hashes, selected study scope and enriched original
observation context. A normal relative report link opens the complete document.

The maintained delivery integration copies every returned file descriptor into
its observed_context files, includes these paths in the archive's project_assets,
and uses the same ordered sections for PDF, HTML, Markdown and report-data JSON.
The existing typed report renderer wraps the two support tables and repeats
their headers; its figure renderer retains the original four figures.

Install the collector with the original `model/scientific_figures.py`, current
scientific renderer/delivery integration, and merged PR2978
`measurement_workspace/published_studies.py` plus `observation_support.py`.
The original 114-file source bank is F0C8JQP3LRZ, JSON SHA256
`74687a79209cb3858abd1cdf2e1adc52334a048b514352f6a7789e5c7b23e54f`.
Its repaired collector preimage is 7,661 bytes, SHA256
`21d5b3b980d84a01d642b060256503be930c73049759d12ea104183cb3715128`.
All original source members and source manifests remain unchanged.

## Existing receiving operation

Continue the existing selected delivery in the original application and Workspace
through native report receive1791855942.340849. Open the scientific report's
chlorophyll and microcystin support tables in PDF and offline HTML, follow its
complete concentration-context link, export the same delivery and reopen it.
The tables and original row selectors must remain the same across the report and
archive. Current merged atlas2969 and authenticated inspection3009 retain the
atlas-to-report and source-companion navigation.


## Retained member selectors

The collector binds each original normalized row, station row and printed seasonal summary to the selected immutable report source before invoking the maintained Published Studies comparison. `source_selector.source_collection_id` and `source_selector.source_id` identify that native report source. `member_path` and `member_sha256` identify the original retained companion within it; `source_member` also exposes the companion byte count. The collector keeps these member selectors explicit because the report source contains the normalized CSVs as companions.

For normalized observation rows, the original agency response also receives its actual retained selector and member identity. Its SHA256 must match the original response hash carried by the normalized row. A missing or different original response raises a source-integrity error at this boundary. The displayed values, activity IDs, source record indices, dates, qualifiers, units and reporting limits remain unchanged.

This binding supplies the `source_selector` required by the existing comparison producer and keeps the same original identity in the exported concentration context and series support. The `observed-context-20261013-v4` delivery binding causes the native report operation to retain this completed collector edition.

## Original study namespaces in regional reports (collector v4)

The same five original study inputs can be retained at the root of an observed
source or below the original `observations/eighteenmile_2023/` namespace in the
regional hydrology report. The collector resolves that namespace from the retained
measurement and selected-chlorophyll member names, then requires the complete
study, stations and seasonal-summary inputs in the same namespace. An incomplete
or ambiguous namespace is reported explicitly before report composition.

The maintained Published Studies reader still receives its original logical CSV
names and source-authored row paths. Each returned row's source selector and
original-response selector bind the actual retained collection, source, full
member path and SHA256. The full concentration-context artifact records those
full input-member paths in the selected source namespace. The regional
report therefore includes the same 85-record campaign microcystin support and
75-record reconciled chlorophyll cohort as the directly imported original study.
Source values, qualifiers, activity groups, dates and reporting limits remain in
the maintained reader and support calculation. The collector v4 binding enters
the existing report identity for ordinary saved-selection regeneration.
