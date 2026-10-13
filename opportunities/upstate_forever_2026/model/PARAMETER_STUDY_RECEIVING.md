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


## Transfer the selected scientific report with its editable Parameter study

Open the completed scientific report edition in **Sources → Saved scientific
reports** and choose **Transfer this report and its studies**. The existing
**Study transfer** desk selects that exact saved edition. **Preview contents**
now follows each original Parameter scientific source to its saved specification,
current checkpoint and complete prepared case cohort. Choose **Export editable
study**, then use the original download and **Receive study archive** flow.

This is the Parameter family stored as `experiments/<study-id>/experiment.json`
and `experiment-specs/<study-id>.json`. It is distinct from the experiment
programme family whose record is `plan.json`. The source's original experiment
ID, selected result SHA256 and reference run remain unchanged.

The selected archive carries:

- The exact ordered scientific-report edition, all original source companions,
  frozen result/CSV/export manifest, case and area choices, figures and report
  outputs.
- The original Parameter specification and complete current study directory,
  including its partial checkpoint, case history, pair-cache/context, original
  exports and saved result descriptors.
- Every originally prepared case run, including unfinished or failed cases;
  their original profiles, scenarios, prepared grid, source collections,
  large native inputs, outputs, intermediates and retained comparisons.
- The selected scientific-source operation and any current source operation
  referenced by the study's latest-source pointer, under their original paths.

The reference is retained even when its displayed row is excluded. Selecting a
few completed cases for the report does not discard the other cases needed to
continue the original design. Capture keeps their saved state and starts no
native computation. A later result edition can coexist with the earlier frozen
report; the transfer preserves each identity instead of rewriting the report
to use current numbers.

An interrupted export can leave a saved descriptor ahead of a file. The complete
working study still travels with its exact checkpoint and present files. The
ordinary Parameter receiving summary identifies declared exports requiring
refresh. Use **Refresh completed results** to rebuild those exports from retained
completed runs; **Resume remaining cases** is the separate native execution
action. An original scientific source imported from another project keeps its
contained source bytes and project provenance. Its donor's editable study is
included when transferring from that original Workspace.

### Open the received Parameter source and its saved study

In **Study transfer → Received studies**, open the received Study. Its
**Parameter studies and saved source editions** cards distinguish **Captured
report edition** from **Current retained study**. The captured case counts and
original result SHA256 identify the report's immutable edition; current progress
belongs to the retained editable study and can advance independently.

Choose **Open saved study** to open that exact original ID in the existing
**Parameter studies** desk. **Open reference run** and each **Open saved run**
open the original native run records. **Add source to report** sends the exact
retained scientific source to the ordinary composer. Switching to another
received Study or Workspace while an opening is pending cancels the obsolete
opening before it changes the selected study.

Expand **Original selected cases**, **Source identities and reference**,
**Captured study results and exports**, and **Complete original source, inputs
and methods** to inspect the original selection and download its retained files.
Each related scientific report's downloads remain available alongside its
source. An external-project report exposes its original captured inputs and
results; it opens an editable study when received from that study's original
Workspace with its complete dependency records. Opening and inspecting these
cards starts no native computation.

### Continue the actual received case

Use the saved scientific report edition ID returned by the original report
catalogue. This selection uses the existing transfer CLI:

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Original Parameter report and editable study",
  "roots": [
    {"kind": "scientific-report-editions", "id": "<original-full-report-edition-id>"}
  ],
  "include_related_results": true
}
```

```sh
python -B -m model.study_transfer_cli preview --workspace /actual/workspace --selection selected-report.json
python -B -m model.study_transfer_cli export --workspace /actual/workspace --selection selected-report.json --destination /actual/output/parameter-study.zip
python -B -m model.study_transfer_cli inspect --archive /actual/output/parameter-study.zip
python -B -m model.cli restore /actual/output/parameter-study.zip /actual/new-receiving-directory
```

Use the application and Workspace paths actually returned by restore. In that
received application, open the original saved report and the same ID in
**Parameter studies**. Confirm the original reference, selected cases, unfinished
cases, source editions and retained downloads by using those screens. Open the
report's actual HTML/PDF pages, original CSV/JSON, figures, maps and archive
contents. Reopen the delivered working project in a fresh process and operate
its ordinary study selection, report selection, downloads and continuation
controls at the actual screenshare width and a narrow width.

For the existing Gura course, use its actual `studies[].study_id`, original
`reference_run_id` and saved report edition. Keep that case and its results
through this receiving operation. The native Ensembles demonstration is a
separate family; its twelve selections are not a substitute Parameter fixture.
Inspect the actual outgoing version and every attachment under the owner rule
above, repair visible defects directly, and preserve current computation and
the October 13 cutoff.

### Source installation and original locking

Receive the complete maintained `model/parameter_study_transfer.py`, its narrow
hooks in `model/scientific_report_study_transfer.py` and
`model/study_transfer.py`, this guide and
`integration/component_fragments/parameter-scientific-study-transfer.json`.
Compose shared files on their current versions so other study families remain
present. The additive fragment includes the helper and receiving guide in the
same application source inventory.

The original export acquires the existing study's `.experiment.lock`, source
operations' `.prepare.lock`, native run/grid locks and Workspace transfer locks.
It then resolves the same original dependency set again before copying. Receiving
uses the original scientific-source lineage receipt and portable Parameter
verifier. Earlier archives retain their captured source-only dependency semantics;
a newly received source does not retroactively invent an absent study.

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

## Current owner direction carried with this receiving operation

The following is the complete owner brief from `CURRENT_OWNER_DIRECTION.md`,
version `2026-10-13.3`. Carry it into the actual receiving host and delegated
work order with this guide; preserve active native work and existing owners.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
