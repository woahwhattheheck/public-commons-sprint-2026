# Geographic reports as editable selected studies

TokenJunkieLabs. This continuation extends the original selected-study exporter,
archive, restore and Geographic operator. It retains the native case behind an
explicitly selected saved scientific report. It does not run a model, recreate a
source, or create a second project format.

## What the recipient receives

A saved report containing an original Geographic allocation or source-loading
interpretation can now retain its editable case in a selected-study archive.
The source document and every companion remain byte-identical. The recipient
also receives the original preparation, its complete committed inputs, matched
control evidence, prepared grid, parameters, three scenarios and native runs,
compiled land-cover footprints, and the saved sensitivity design and progress.

For a completed allocation, this includes its original Receiving plans,
scope-specific analyses and scientific sources, complete allocation source
directory, physical-input contrasts and any retained same-cell native contrasts.
Source-pixel-origin export means modeled mass from selected source cells that
reaches the modeled stream network. It is not concentration, intake load or
mass crossing the boundary of a reporting polygon. Original pairwise support
and shared three-run support remain separately labeled.

For source-loading interpretation, the resolver follows the exact original
document recipe and four original inputs. It retains any matching in-Workspace
interpretation context, manifest and source identity. The original Node
executable and external invocation directory remain provenance. Receiving does
not require those donor paths to exist.

## Reference-complete and full-course completion

A completed reference report does not imply every sensitivity member has run.
The original three prepared reference runs may be complete while the sensitivity
design is unfinished. The archive preserves that original design, prepared
member runs, current progress, source dependencies and interrupted paired
analysis controls so the recipient can continue the same work.

Completed historical course result editions, original reports and quantitative
archives remain present where retained. Their frozen archives keep their exact
original identity even if a current editable analysis has subsequently advanced.
The selected-study reader checks each captured paired-report signature against
its original quantitative ZIP. It uses that archive's complete member inventory
and exact original analysis/report JSON, while independently retaining current
editable reports and any later spatial-review additions. Archive checks read
only the directory, manifest and two JSON records; original raster payloads stay
inside their hash-bound quantitative archive. An interrupted report with no
published archive still requires its original live report signature.
No pending case is marked completed by this exporter, and no full-course
completion requirement is imposed merely to export a completed reference report.

The existing whole-Workspace geographic archive and original
`source_tools/receive_geographic_headwaters.py` course remain supported. Their
reference-basis and completed-case checkpoint semantics remain authoritative.
This selected-study path is an additional bounded selection from the same
Workspace, not a replacement for the existing receiving course.

## Select the actual saved report

Use the original Study transfer desk and select the completed scientific report
edition that contains the relevant original Geographic source. The catalogue
kind is `scientific-report-editions`. A Sources document by itself is not a
saved operator edition; use the existing ordered scientific-report workflow to
select and retain the actual source when that is the intended deliverable.

The current original CLI can inspect the real available editions:

```sh
ACTUAL_PYTHON -B -m model.study_transfer_cli catalog \
  --workspace ACTUAL_WORKSPACE --kind scientific-report-editions
```

Write a selection using the actual returned edition ID, preserving the title and
related-results choice appropriate for the delivered study:

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Original geographic scenario and scientific report",
  "roots": [
    {"kind": "scientific-report-editions", "id": "ACTUAL_SAVED_EDITION_ID"}
  ],
  "include_related_results": true
}
```

The placeholder is not a runnable native ID. Use the exact retained edition from
the catalogue. Export uses the same original workspace locking and source
closure; a running owner whose files are being changed may require continuing
at its existing safe boundary. Preserve its process and do not start another
model run to satisfy export.

```sh
ACTUAL_PYTHON -B -m model.study_transfer_cli preview \
  --workspace ACTUAL_WORKSPACE --selection SELECTION_JSON
ACTUAL_PYTHON -B -m model.study_transfer_cli export \
  --workspace ACTUAL_WORKSPACE --selection SELECTION_JSON \
  --destination NEW_ARCHIVE_OUTSIDE_WORKSPACE
ACTUAL_PYTHON -B -m model.study_transfer_cli inspect \
  --archive NEW_ARCHIVE_OUTSIDE_WORKSPACE
```

Preview reports the original source/native file and byte inventory. In addition
to the saved report and its ordered sources, a local Geographic source should
bring the `geographic-headwaters` preparation, `scenario-footprints`, native
runs, sensitivity ensemble and, for allocation, the original Receiving context
and allocation directory. The exact counts depend on the actual retained case;
none are fabricated by this guide.

## Cold restore and original operator

Restore into a new directory through the original archive reader:

```sh
ACTUAL_PYTHON -B -m model.cli restore \
  NEW_ARCHIVE_OUTSIDE_WORKSPACE NEW_RESTORED_WORKSPACE
```

The selected-study receipt preserves the original project and scientific IDs.
Do not use a source-specific importer that allocates a new study identity as a
substitute for this restore. Original extension receiving verification remains
part of the installed application route; the original verifier is also callable
directly from that application:

```python
from model.workspace import Workspace
from model.study_transfer import verify_received_studies

workspace = Workspace("ACTUAL_NEW_RESTORED_WORKSPACE")
verification = verify_received_studies(workspace)
```

Use the current complete application family with the restored Workspace. In the
original Geographic desk, open **Saved geographic studies**. The native provider
discovers the retained `geographic-headwaters/<id>/prepared.json` records, so the
same preparation is available with its original source choices, scenario IDs
and native programme. Inspect its source selection and existing allocation
editions before authoring a change. Continue the original native programme or
receiving course using its retained selection and current progress.

The saved report remains available in the original Sources scientific reports
view, Study transfer's received report links, and any retained Customer review.
Do not replace a complete report with an empty-workspace screen. Open the actual
PDF/HTML, GIS, CSV, JSON and original source members and use their existing
controls and downloads. Reopen the archived working project itself.

## Exact dependency and source rules

| Original object | Retained binding |
| --- | --- |
| Geographic preparation | Native preparation identity before its ID was injected; exact prepared record, input receipt and committed inputs |
| Matched control | Actual copied matcher/adapter results, original masks and matched-pair data inside the committed inputs |
| Grid and parameters | Original prepared grid, physical source collection and reference/sensitivity profiles |
| Scenarios and runs | Original baseline/restoration/control IDs plus all prepared sensitivity member selections and retained progress |
| Scenario footprint | Immutable footprint record plus complete native output directory keyed by the original request digest |
| Receiving context | Original selection, context/progress, plan and scope-specific analysis/source IDs |
| Allocation | Original result/intent, report recipe, complete native inventory and exact imported source |
| Interpretation | Original document and input member identities, optional original in-Workspace context; donor executable paths are not followed |
| Parameter continuation | Original ensemble plan, current state/operations, course and immutable history, paired controls/products, reports and joint archives |

The resolver recognizes the exact original document producer URI, role, recipe
and source inventory. A table that happens to use the interpretation URI is not
accepted as a scientific-report document. Equivalent source reimports may have
different collection IDs; complete body and companion identities must still
match the original capture. Both selected source identity and original native
source history are retained.

A source whose declared project differs from the selected Workspace remains an
external report with its complete CAS-contained files. The resolver does not
borrow same-looking local native IDs to manufacture an editable foreign case.
The source lineage explicitly records that external relationship.

Earlier selected-study archives keep their original captured dependency
contract. The saved-report resolver's existing source-key gate excludes newly
introduced Geographic lineage for receipts that did not originally capture it.
Receiving a historical report does not require current source code hashes to
equal those of its original producer. Native implementation and runtime hashes
remain the captured provenance.

## Consistent capture and continuation

The original exporter holds the existing Workspace guard and original producer
locks. Geographic preparation/context/allocation, compiled footprints, ensemble
operation/state/report/course and paired-analysis locks are incorporated into
the existing deduplicated lock inventory. There is no nested Workspace guard,
second Store, new watcher, or receiving-time computation.

The resolver reads raw source CAS records and immutable member descriptions.
It does not call source view materialization, Geographic preparation, original
report renderers or the parameter-course executor. Donor absolute paths remain
descriptive provenance and are not accessed or rewritten. Process lock files
listed in old input receipts follow the existing portable exception; their
absence after restore does not alter scientific data.

Captured report lineage contains stable source/case IDs and immutable bindings.
Current progress is retained as original files rather than falsely frozen as a
scientific identity. Later legitimate progress can append history while the
original captured source/report remains exact.

## Validation and delivery boundary

This integration has source-contract review against the maintained original
preparation, scenario compiler, Receiving reports, allocation, source-loading
interpretation, native ensemble and paired-product owners. The original
selected-study core and dispatcher are composed using unique guarded joins.

That review does not establish native or visual acceptance. The existing
equipped owner must execute the selected report export/restore on its actual
Workspace, return its real first error if any, and personally open and use the
outgoing restored application and every attachment. Preserve the active
3504/3812/DE67/07AA course and its actual process. No additional native simulation
is requested merely to exercise this transfer.

The producing peer must inspect the exact outgoing version at desktop and
narrow widths, operate important controls and check populated, empty, loading
and error states where relevant. View captured screenshots, not merely produce
them. Open downloaded PDF/HTML/data/GIS/archive/project contents in their actual
recipient-facing tools. Repair unreadable, clipped, broken or unstyled output.
Source/DOM/HTTP checks and peer review do not replace this inspection. Use the
existing original course, not a broad new validation suite.

## Retain the already-saved Geographic Programme

With the original **Include related results** option enabled, selecting a saved
Geographic scientific report also retains each already-saved Programme adopted
from that exact preparation. The source binding includes both the original
preparation ID and the SHA-256 of its captured `prepared.json`. The three named
cases must retain the original baseline, restoration and matched-control run
IDs, grid, profile and scenario selections. A different programme that happens
to reuse the same prose reference is not treated as this original cohort.

The selection uses the existing `compute-programmes` typed dependency visitor.
It keeps the same immutable `programme.json`, current `progress.json`, attempts,
controls, complete report editions and original report files. It follows the
Programme's native producing-stage donors, retained comparisons, mapped
deliveries and declared pair-completion children through their existing typed
visitors. The original Programme, execution and control locks protect this
snapshot during export. This adds no model execution, Programme creation,
report rendering or source-view materialization.

In the existing Study preview, the adopted Programme appears as a retained
`compute-programmes` dependency with its original ID and title. After restoring
the selected Study, open the original **Programmes** desk and select that same
saved Programme. Its retained report, original case roster and ordinary
continuation controls remain available. The Geographic case and original
sensitivity ensemble are still separate saved objects: the reference Programme
can be complete while the remaining sensitivity cases are pending. Neither
state is rewritten to make the other complete.

A preparation with no adopted Programme continues to export normally. Turning
off **Include related results** keeps the original narrower selection. Older
selected-report archives that never contained this Programme remain readable.
No changing progress hash or extra lineage field is added to the source
receipt; captured Programme IDs remain required dependencies, and normal later
history can grow through the original APIs.

The original receiver may also carry `delivery/geographic-programme.json` and
the corresponding `handover-record.json` field. Those are the original caller's
returned adoption record and are preserved by its full handover path. This
selected-study join discovers and retains the actual saved native Programme
directly; it does not invent a missing caller admission or external receipt.
Original input receipts remain byte-exact, including descriptors for runtime
locks that the maintained portable writer intentionally omits. The Programme
owner's cold-reopen verification must follow that existing runtime-lock rule.


## Complete current owner direction

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Current project instructions

Execute the prepared simulated model and deliver a relevant, usable application and presentation that demonstrate the actual work and elapsed delivery time. Continue active work while checking progress. Carry the current demonstration, presentation and Ecosystem instructions through the existing coordination surfaces and onward to participating workers.

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

