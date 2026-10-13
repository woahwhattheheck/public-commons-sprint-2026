# FIELD12 laboratory analytical support

An offline analytical view of a selected original field/laboratory delivery. It carries the saved native plan, source-file identities, all original result/activity/station fields, reporting-limit types, exact method groups, collection-event groups and reopenable selections through one working product.

## Open or rebuild

Open `START_HERE.html` in a browser. The complete dataset and the unchanged original downloads are embedded, so no server, login or network is required. Results, method groups, collection events and source details are separate views. `Censored only` exposes the original limits immediately. `Inspect row` opens every original result field and its original activity record. CSV exports carry the selected native identifiers, source row/hash, limit semantics and every original result field.

`Save selection` creates a compact JSON file bound to this exact original dataset. `Open selection` restores those row IDs; it refuses foreign or unknown row IDs without changing the current selection. `Save this offline view` produces a complete independent HTML file with the current row selection and tab. The original native plan is unchanged.

Rebuild with Python 3.10 or later and its standard library:

```sh
python source/build_support.py --delivery original-delivery --output rebuilt-analysis
```

From an existing full delivery, the application source entry is:

```sh
python source_tools/field_lab_support/build_support.py \
  --delivery /actual/Eighteenmile_Field_and_Laboratory_Complete \
  --output /actual/new-analytical-support
```

The standalone companion preserves the original delivery and native reports. The current native report and handover producers retain their existing ownership; this component adds method-separated analytical bounds, original-event drilldowns and reopenable offline selections through ordinary scientific source import.

## Join the running scientific application

The generated `sources.json` is an ordinary `upstate.sources/v1` edition manifest. Use the current application and the existing scientific Workspace:

```sh
python /actual/application/model/cli.py --workspace /actual/workspace \
  source-import /actual/new-analytical-support/sources.json
```

This registers the complete HTML document and results table with their source/code companions through the existing immutable source importer. It does not create a second sampling plan or replace earlier scientific studies. Open the imported document from Sources in the current operator. The observed report and table share the exact retained plan revision and source binding in `analytical-support.json`.

## Scientific semantics

The publisher's `Lower Reporting Limit` is displayed under that exact type. It is not silently assigned to a native detection-limit or quantitation-limit field. The six censored rows in the delivered three-lake original retain blank numeric result cells; their original limit units are displayed separately from their blank original result-unit cells.

Only the explicit original combination `Below Reporting Limit` and `Lower Reporting Limit`, with a positive finite limit and matching units, yields `[0, limit)`, conditional on nonnegative concentration. Numeric records use the reported value as point support. Unknown, conflicting or missing semantics remain unresolved. This view provides neither threshold compliance classifications nor a change in source QA status.

Group keys include station, parameter, unit, fraction, basis, complete method authority/ID/name, activity type and original project. Different methods stay separate. The mean-support endpoints are endpoint sums divided by the complete group count. An unresolved row prevents a full-group mean interval. These are descriptive support bounds, not confidence intervals, uncertainty estimates, or substitutions for censored measurements. Sums use exact Decimal arithmetic and means retain 40 significant decimal digits; the screen rounds separately.

An event joins an identical original station/date/clock/timezone tuple. It does not equate distinct sample IDs or assume co-collected samples came from the same bottle. A one-analyte event is described as such, not declared incomplete against an invented sampling requirement. Original EST labels are preserved.

Official source terminology: EPA, *WQX Detection Limits Best Practices Guide* (https://www.epa.gov/waterdata/wqx-detection-limits-best-practices-guide); EPA TADA, *Module 1: Water Quality Portal Data Discovery and Cleaning* (https://usepa.github.io/EPATADA/articles/TADAModule1.html). Original source fields and bytes are retained in the package.

## Product maintenance

Inspect the exact generated page as a user: view desktop and narrow layouts, use the filters and record inspector, download and reopen both a selection and an offline view, and read the exported files. Fix visible or functional defects directly. Preserve the owner-directed focused-validation rule: no broad repository test suites, repeated accepted checks or added approval queue. Do not overwrite an original source, plan revision or report edition. When handing this source to another worker, carry these rendered-product instructions with it.
