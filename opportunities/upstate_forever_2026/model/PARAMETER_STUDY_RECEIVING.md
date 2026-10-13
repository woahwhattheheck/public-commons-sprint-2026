# Continue parameter studies in a received workspace

The complete Workspace archive and Project transfer keep the original parameter study selection, native case identities, partial completion state and every retained result descriptor together. The transfer summary identifies each study, native models, case completion, retained result files and original difference maps.

In **Transfer and restore**, capture the current workspace or receive its existing snapshot and parts. **Inspect and restore** shows the retained parameter studies alongside fieldwork and source acquisitions. After **Restore editable workspace** completes, choose **Open saved study** on the study row. The original application selects the received workspace and opens that exact saved study in **Parameter studies**, where its current case results and authenticated report, CSV, JSON, GeoTIFF and complete ZIP downloads are available.

A partial study opens with its original cases and selections. Use its ordinary **Resume remaining cases** action to continue. A completed study keeps its original results; **Refresh completed results** builds a current export edition from its retained native outputs. Opening the study never starts a simulation.

The capture records the original study checkpoint and selection SHA256, case/run/profile identities and every result file descriptor. Restoration joins those records to the original Workspace and checks the saved study relationships without executing the transported application. The same semantic summary is recovered after a lost receiving reply. Older archives without the summary remain readable: the receiver derives it from their retained native study files.

The report links and large GIS members are the files produced by the maintained parameter-study export workflow. Full result archives preserve their nested paths. Capture and restore use the existing complete Workspace locks, transfer queue, original file checks and create-only destination behavior.

If a prior export stopped between writing files and committing its result descriptors, the transfer preserves both the exact captured files and the original declared descriptors. The summary identifies exports needing refresh, allowing the complete recoverable workspace to travel. Matched exports retain the original byte count and SHA256. Scientific selections and case bindings remain validated by the native study API.

## Report completed native cases from a partial study

A partially completed study already contains usable comparisons when its original
baseline and one or more selected native cases have completed. In **Parameter
studies**, open that same saved study and use **Refresh completed results** when
its retained report needs refreshing. This summarizes the original completed
outputs under the study lock. **Resume remaining cases** is the separate action
that continues unfinished native execution.

Use the study's scientific-report selection to choose its completed cases,
reporting areas and pollutants. The selection is pinned to the original
`results.json` SHA256. If a newer result edition arrives while choosing, review
the refreshed selection before preparing the report. The prepared scientific
source retains the original study export manifest, native arguments, case and
profile identities, requested maps, source editions and exact numeric files.
It can be appended to the existing ordered report in **Source reports**.

The report distinguishes completed cases in the saved result edition, total cases
in the original design, and the subset selected for presentation. A report of all
currently completed cases can still represent a partial original design.
Unfinished cases contribute no substitute value. Selecting fewer completed cases
does not calculate a new minimum or maximum.

The original reference remains the study's saved `baseline_run_id`, with its
actual profile, scenario and grid. Excluding the baseline's displayed row does not
change that reference. The case position printed in the tables and figures is an
index into the selected case order in this immutable report edition. It is not a
parameter value, execution rank or effectiveness ranking. Use the adjacent case,
run and profile keys to identify a result across reporting areas and pollutants.

### Interpret the separate quantity and support tables

Read each area and pollutant separately, using the original annual-mass units.

| Report quantity | Meaning |
| --- | --- |
| Paired baseline and case mass | Original annual mass summed only over cells where both runs have valid, finite values in the selected reporting area. |
| Signed change | Original case mass minus its original baseline mass on those paired cells. A negative value indicates lower modeled export. |
| Percentage change | Stored signed change divided by paired baseline mass, times 100. A zero paired baseline leaves the percentage undefined even when the absolute change exists. |
| Paired cells | Count of valid cells shared by the baseline and case inside that area. |
| Baseline and case valid cells | Each run's own valid-cell count inside the area; these counts may differ. |
| Independent full masses | Each run's total on its own valid cells. They can cover different areas and therefore are not substitutes for the paired comparison. |
| Paired area | Retained paired-cell count multiplied by the original affine pixel area; the source stores the resulting hectares. |
| Support changed | The original paired mask differs from at least one run's own valid mask in the selected area. |

When there are no paired valid cells, paired masses, signed change and percentage
are undefined. An independent full mass can still exist for a run with its own
valid cells. When a run has no own valid cells, that full mass is undefined too.
A reported zero is a defined numeric result and remains distinct from an
undefined or absent value.

Counts describe the native valid cells used by the comparison. They are not
percentages of the entire catchment, land area or population. The reporting
polygon is intersected with the original reporting extent using pixel centres.
Different reporting polygons can overlap, so do not add their loads without
checking their geographic relationship. The full reporting area and its
subcatchments describe alternative reporting scopes, not additional independent
loads.

Native capture has already converted source densities to annual mass per pixel
using the original affine pixel area. This report copies the saved mass results.
Do not multiply them by pixel area again. Use each original grid's CRS,
resolution and affine area; a cell count has no universal hectare conversion.

### Read ranges and parameter responses

The original saved ranges describe completed cases with nonempty paired support
and support identical to the fixed original baseline, grouped by reporting area
and pollutant. They include the baseline itself when it meets those conditions.
The report preserves those original ranges only when every completed case is
selected; choosing a subset does not create a new range.

The changed-support count in a range record counts cases that have paired mass
but whose valid support differs. It does not include cases with no paired mass.
Read those cases' coverage rows separately. A partial study's minimum and maximum
describe only its completed evaluated cases, not its unfinished design, a
probability interval, a confidence interval or an optimization result.

A response per parameter unit is retained only for a single numeric changed
parameter with a defined mass change and a nonzero parameter step. It is the
stored mass change divided by that finite step. Its parameter name and original
baseline and case values are part of the interpretation. Elasticity additionally
requires nonzero baseline mass and baseline parameter value. Multiple changed
parameters, categorical routing choices, unchanged parameter values and missing
numeric defaults have no such single-parameter response. Preserve absent or
undefined values instead of treating them as zero.

Land cover stays fixed within a parameter study. These results compare parameter
or routing assumptions for that landscape. A restoration-versus-baseline
comparison belongs to its original separate landscape pair, with its own selected
profiles and spatial support.

### Open maps, figures and the original files

Figures use the same selected-case positions and original physical values as the
tables. An undefined physical quantity has no plotted point; its original row
and reason remain available. The case key and coverage tables beside the figure
identify its run, profile and actual support. Inspect the figure's original
coordinate file and the selected JSON or CSV when tracing an individual point.

The requested difference GeoTIFFs retain their original comparison extent, grid,
units and paired support. Their cell values are case minus baseline annual mass
per pixel. Selecting a reporting polygon for a table does not clip or resample
the original map. Keep the extracted directories intact so report links resolve.
The scientific-source package retains the complete original study exports; the
full editable Workspace carries the larger model inputs and native rasters.

To reopen a completed partial report directly in the existing application
environment:

```python
from model.workspace import Workspace
from model import parameter_report_source

workspace = Workspace("/absolute/path/to/retained/workspace")
catalog = parameter_report_source.catalog(workspace, original_study_id)
source = parameter_report_source.prepare(workspace, {
    "experiment_id": catalog["experiment_id"],
    "expected_artifact_sha256": catalog["artifact_sha256"],
}, render=True)
# source["delivery_selection"] joins this source to the existing report workflow.
```

The original study ID comes from its saved record. In a Gura suite, each
`studies[]` item stores its actual `study_id` and `reference_run_id`; the suite
ID itself is not a study ID or an Ensemble ID. Keep the original result edition,
Workspace and case identities through the report and receiving operation.

## Operate and view the exact outgoing delivery

The producing owner opens and uses the exact outgoing application and every
attachment. Inspect actual rendered screens or personally viewed screenshots at
desktop or screenshare width and at a narrow width. Use the study picker, case
and area selection, report preparation, downloads and reopen controls. Check
applicable populated, empty, loading and error states in that same workflow.
Repair clipped tables, unreadable labels, overlapping controls and broken links
in the maintained source, then inspect the resulting edition again.

Open and read the actual HTML and PDF pages, SVG or other figure files, numeric
CSV and JSON, and maps in a viewer that displays their original data. Extract
each outgoing archive and open its contents; restore and operate the working
project. Play any outgoing recording or video. Confirm the same cases,
reference, units, signs and original coverage are understandable in each form.

Saving a screenshot, running a source check or receiving a peer's approval does
not replace looking at the actual output. Keep completed scientific inputs and
results while repairing presentation; a layout correction needs no new model
run.
