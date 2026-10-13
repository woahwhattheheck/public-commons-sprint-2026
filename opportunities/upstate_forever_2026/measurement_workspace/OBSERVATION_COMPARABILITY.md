# Comparable-period observation desk — retained cohorts and source editions

## Deliverable

An offline, source-preserving desk and native report source for SV-833 water-quality observations. The original station record is 610 result IDs from 56 sampling activities, spanning January 20, 2021 through June 24, 2026. The desk retains the publisher responses, their original result and activity selectors, reporting limits, full-profile reconciliation inputs, calculation source and report recipe.

The new module adds common-calendar-month comparisons across every same-series year pair. It leaves the existing annual study, microbial calendar explorer and original Workspace records intact. The native source can be included alongside those studies in the existing ordered Scientific study reports control.

## Open the delivered material

Open `source/index.html` for the interactive desk, or `native-report/report.html` and `native-report/report.pdf` for the printable 2025-to-2026 comparison. Keep the entire unpacked folder together so original source downloads remain available. The desk makes no external requests and works as a local file. Browser CSV exports include every filtered record, not only the current page.

`comparisons.csv` carries every year pair. `monthly-support.csv` exposes month-by-month support. `activity-measurements.csv` maps each single-weight analytical activity to all original result IDs. `comparability.json` includes the complete exact rational endpoints and original rows. `model-sources.json` imports the complete report and all its companions into the scientific workbench.

## Calculation

The series key consists of station, source project, characteristic, unit, sample fraction, chemical specification, analytical method, method context and result value type. Within each exact series, agreeing result IDs from the same activity and date have one analytical measurement weight. Conflicting intervals are retained without a numerical summary.

An original quantified value is a point. A below-limit result keeps its original lower and open upper endpoints. An above-limit result keeps its original open lower endpoint and unbounded upper endpoint. No fitted, zero, half-limit or reporting-limit substitution is made. Exact rational arithmetic computes each activity interval, the equal-activity mean for each month, and the equal-month mean over the common set. The reported difference is later year minus earlier year, with endpoint openness propagated.

A month joins the common set only when it is present in both selected years and every recorded measurement in that exact analytical month has supported, eligible original numerical content. A month containing an original excluded or conflicting measurement remains in the support ledger but is not labelled complete. The one original out-of-range pH result is retained unchanged and excluded using the existing index's screen. No new analytical outlier screen is added.

These are descriptive arithmetic bounds for retained grab samples. They are not confidence intervals, annual mass loads, regulatory evaluations or causal trend estimates. Equal calendar-month support removes an obvious coverage mismatch, not all sampling differences. pH arithmetic describes reported pH values, not mean hydrogen-ion concentration. Source projects and chemical specifications remain separate, including the one-year SWS-2024 sample.

## Install without replacing another contributor's source

Copy only these three new files into the maintained application's `measurement_workspace/` directory:

```
observation_comparability.py
observation_comparability.html
observation_comparability_delivery.py
```

The producer requires Python 3.10 or later and the standard library. Native delivery uses the maintained `model.workspace`, `model.observed_context`, `model.scientific_report` and `model.portable` modules, plus their existing runtime dependencies. No model or simulation is launched by these commands.

Generate a source edition from the retained original application:

```sh
python -m measurement_workspace.observation_comparability \
  --application /absolute/path/to/application \
  --output /absolute/path/to/new-source-edition \
  --year-a 2025 --year-b 2026
```

Run from the application directory or add it to `PYTHONPATH`. The output must be new or empty. Every original index-to-result selector is checked against the retained source CSV and its SHA-256 before the source is generated.

To import into an owned receiving Workspace, render native PDF/HTML/Markdown, save the selection and export the complete working project:

```sh
python -m measurement_workspace.observation_comparability_delivery \
  --workspace /absolute/path/to/owned/workspace \
  --manifest /absolute/path/to/new-source-edition/model-sources.json \
  --output /absolute/path/to/new-delivery
```

This adds one immutable native Sources collection. The recipe uses `upstate.observed-report/v1` and `metadata.report_schema`, so it is available to the existing ordered scientific-report selector. The saved selection and report are retained at `workspace/observation-comparability/<recipe-sha256>/`. The portable ZIP includes the application, original project and the new report-source companions.

To use the report with another current project, import `source/model-sources.json` through that project's existing source import action. It preserves the original station/provenance and does not replace the receiving project's identity. Then add **SV-833 comparable-period water quality** to the existing Scientific study reports selection. The generated `native-selection.json` records the IDs from this operated receiving project; a different receiving project must use its own returned collection ID.

For independent reopen, restore the archive to a new directory with `model.portable.restore`. Start a fresh Python process with only the restored application first on the module path, open its restored Workspace, read the saved report selection and call `model.observed_context.bind`. The original project ID and retained source choice travel with the archive.

## Data conventions

Machine data retain the original unit string, including the publisher's `None` unit for pH. Human-visible intervals use six significant digits; `lower_exact` and `upper_exact` preserve the full rational endpoints. Empty machine endpoints denote an unbounded endpoint, not a zero. An open parenthesis excludes an endpoint. Full observed-period means in the desk use activity weighting across actual dates and are kept separate from equal-month matched means.


## Receive another retained cohort or a later source edition

The same producer accepts another maintained original-result index with
`--index`. That input must preserve the original series, interval/screen and
CSV row-selector fields documented above. It is an indexed original-source
input; an arbitrary CSV with guessed field meanings is not admitted. The producer
checks every selected result ID, source CSV SHA and original row number before
creating the report source. Keep the selected index and its complete referenced
publisher responses under the selected application/source root.

```sh
python -m measurement_workspace.observation_comparability \
  --application /absolute/path/to/retained/source/root \
  --index observations/selected-cohort/original-result-index.csv \
  --year-a 2023 --year-b 2025 \
  --title "Selected catchment — comparable-period observations" \
  --source-prefix selected-catchment-observation-comparability \
  --output /absolute/path/to/new-source-edition
```

The title and source prefix are optional. Without them, the title follows the
actual retained station identities and the source family follows the single
station, or uses a common family for a multi-station cohort. The source prefix
uses 1–80 lowercase letters, digits or hyphens, starting with a letter. Complete
input and producer hashes still identify each individual edition. Explicit
presentation choices never replace the original station, project or analytical
fields. The original default index and 2025/2026 selection remain available.

Every title, observation-period statement, source vintage, original-index link,
source-family ID and downloaded filename now follows that selected edition.
The complete original rows retain their original dates and published URI
strings; all distinct source URIs remain in the structured presentation record.
If no publisher URI is present, the native manifest identifies the actual
retained local index rather than inventing a publisher URL.

Each report row includes its analytical-series label. The full original series
table gives the complete station, project, characteristic, unit, method/context,
sample fraction, chemical specification and value type for that label, alongside
the full stable series identity. Empty original fields are displayed as empty.
The desktop/phone desk shows the same complete fields, adds station filters, and
exports every original field in its existing CSV/JSON outputs. An identically
named characteristic from a different method or station remains distinct.

## Continue an exact saved review

The offline desk retains selected years, station/project/characteristic filters,
analytical series, original-row query, page and inspection tab in browser storage.
The storage key binds the complete original-input identities, authored producer,
presentation and default comparison. A different source edition starts with its
own selection; a saved selection cannot silently carry over to changed data.
The visible status reports whether this browser retained the selection. All
source inspection and exports continue if browser storage is unavailable.

Save the entire generated folder for handover. Browser storage is convenience
state on that browser; the original source, full comparisons and defaults remain
inside the offline file and its companions. Comparison and original-row CSV
exports contain every filtered row across all pages.

## Native application and portable receiving

The additive `integration/component_fragments/observation-comparability.json`
selects the complete four-file component and its maintained observed-context
and generic scientific-report-rendering dependencies through the ordinary installer. It does not change the shared
component catalogue. The existing Sources import and ordered Scientific study
reports controls consume its original native manifest/recipe; this component
does not introduce a parallel report engine.

The native delivery command keeps its actual receiving project and selected
collection IDs. A completed or partially written export is bound to its original
project/source/recipe before any later report/export write. To deliver a changed
source edition, select a new output directory. The established default SV-833
archive filename is retained; other source families use their explicit source
prefix. Existing complete native source/report/archive artifacts remain intact.

The published original 7C31 computation and completed native receiving remain the
baseline for this reusable producer. Arithmetic, original-source screening,
activity deduplication and common-month weighting are unchanged. This edition
adds source-aware presentation, usable review continuity and complete application
publication.


A repeated delivery with its completed portable ZIP first verifies that original
archive through the maintained portable inspector, then reuses its exact saved
report selection and report bytes. It does not rerender with a later formatter
and pair that output with an older ZIP. Missing exported report members and the
final receipt can be recovered from the verified original archive after an
interruption. Different existing bytes are preserved and reported explicitly.
Per-Workspace and per-export kernel locks keep two receiving invocations from
writing this report simultaneously.

To intentionally render an existing source with newer application/formatter
code, pass `--new-rendering` and choose a new export directory. That creates a new complete snapshot while
the prior export remains available. The returned report_selection points to the
export's own native-selection.json, so later work on the Workspace does not
silently change the selection described by that completed handover.


A completed Workspace report is also resumed before an outer ZIP exists. Its
entire saved formatter and observed-source file inventory is verified against
the same original selection and binding. The native formatter is not called
again on that original report directory. This covers an interruption between
report completion, output copying and portable publication.

An explicit `--new-rendering` uses the existing
`model.observed_report_render.prepare/render` operations. The retained
preview binds the installed renderer source files, selected observations,
presentation, title, organization and Workspace. It is saved before rendering;
a retry continues that exact preview. New report bytes have a separate
`renderings/<original-operation-id>/` directory, and every prior saved
selection remains under `retained-report-selections/` before the
current selection advances. Both the original completed report and its previous
portable export remain usable.

```sh
python -m measurement_workspace.observation_comparability_delivery \
  --workspace /absolute/path/to/owned/workspace \
  --manifest /absolute/path/to/retained-source/model-sources.json \
  --output /absolute/path/to/new-rendered-edition \
  --new-rendering
```

Ordinary repeats omit this flag. A completed output directory always denotes
its captured original edition. Report member publication uses the maintained
bounded, atomic original-file retention, so a lost receiver does not leave a
new partially written PDF under its final filename.

An interrupted export freezes its own `native-selection.json` before any report
member is copied. If another output later selects a new rendering, the earlier
output resumes its saved report directory and exact bytes. Its portable archive
uses the maintained delivery-file index to retain that exact selection and
complete report inventory, so archive-only receiving chooses the same report
even if the Workspace's current report marker has advanced. Original older
archives remain readable through their original saved marker.
