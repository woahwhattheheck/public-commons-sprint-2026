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

## Transfer the exact native reference trio

A selected Study whose explicit roots are exactly the original baseline,
restoration and matched-control **run IDs** can retain the existing Geographic
case without first creating a separate scientific report edition. Keep
`include_related_results: true`. The exporter admits only one saved preparation
in the same project whose original baseline plus two alternative IDs equal that
three-run set, with the same original grid, profile and per-run scenario
selections. It preserves the preparation's baseline/restoration/control order.
Titles, run prefixes and prose provenance are never matching criteria.

For example, replace every placeholder with the actual full retained ID:

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Original regional reference study and editable Geographic case",
  "roots": [
    {"kind": "runs", "id": "ACTUAL_BASELINE_RUN_ID"},
    {"kind": "runs", "id": "ACTUAL_RESTORATION_RUN_ID"},
    {"kind": "runs", "id": "ACTUAL_MATCHED_CONTROL_RUN_ID"}
  ],
  "include_related_results": true
}
```

Use the existing preview/export/inspect commands below and a **new archive
destination**. Reusing an existing completed destination intentionally returns
that sealed archive; it does not broaden its recorded scope.

Preview exposes `geographic_native_studies` only when the exact original
preparation exists. Its capture pins both prepared.json and the original input
receipt by bytes and SHA, plus the exact completed Receiving/allocation and
interpretation context records already present. The original resolver retains
the matched-control inputs, editable footprints, native grids/profiles/scenarios,
full saved ensemble design and pending progress, and any matching saved
Programme. It does not synthesize an absent context, comparison, Programme or
result. Existing completed context sources follow their original complete
recipes and companion files.

If two original preparation editions share the exact cohort, the exporter
requires an explicit original scientific report source rather than choosing
one arbitrarily. If no preparation matches, the ordinary native Study retains
its existing scope; preview's empty Geographic list makes that absence visible.
Disabling related results preserves the ordinary narrow selection.

Receiving uses the captured preparation and context IDs and verifies their
immutable descriptors; it never discovers another case by scanning the
recipient's later preparations. Old receipts without this optional field keep
their original native scope. The previously sealed native reference Study
remains valid and unchanged. A complete successor from the original Workspace
can add the saved editable Geographic continuation while preserving all
completed scientific output bytes and the honest pending sensitivity status.

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
| Saved reference GIS/history | Captured handover identity, original preparation/ordered trio/joint comparison, complete original GIS export and source-choice/history trees |

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


### Retained operator adoption and opening

The selected matched Programme now also retains its original completed
Geographic adoption and opening operations through
`geographic_operator_transfer.include_programme`. A matching current
`operator-session.json` travels under the existing session lock only when it
still belongs to that exact selected scientific view. Later or wider views
remain historical and never replace the recipient's selection. CLI-only
studies without operator history remain valid. See the complete
[operator continuity guide](../docs/GEOGRAPHIC_OPERATOR_TRANSFER.md).


## Retain the saved reference GIS and execution history

A new selected Study of the exact native reference trio also captures any already-saved Geographic GIS handover belonging to that original preparation. Keep **Include related results** enabled. The captured `geographic-gis-handovers` context names the exact complete record by ID, bytes and SHA; its original project, preparation, ordered run trio and joint comparison must agree with the selected case.

The transfer retains the original reference context, source choices, native execution-history directory and complete GIS export tree, including its editable QGIS project, offline source/table/map desk and GIS archive. It follows the handover's original selected sources and native dependencies. It does not re-export GIS, run a comparison, perform receiving or start a model. Only the context selected in the original capture belongs to this portable edition.

After restoring the archive with the existing command above, use the original **Saved geographic studies**, GIS and native history controls to open those same saved records. Open the offline GIS desk, editable project, complete GIS ZIP and history index as their recipient would. Scientific source choices, units and original elapsed/reuse history remain inspectable. Preserve the difference between the upstream modeling domain, reporting support and utility/intake footprints.

Previously sealed Study archives retain their original scope. An explicit empty context list remains empty, and a captured list never grows when the recipient later receives or adopts another GIS export. Select a new archive destination from the original completed Workspace to include a newly saved handover. A preparation without a saved matching GIS handover continues through the ordinary Study flow.

See the [regional reference GIS guide](../source_tools/GEOGRAPHIC_REFERENCE_GIS.md) for the original prepare, full-Workspace handover and copied-application receiving sequence. The selected-Study extension reuses those retained products and preserves the existing Programme/operator-session continuation.

## Complete current owner direction

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.4`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build and finish as much of the existing Eco science application as possible before Bryce's call. Bryce renewed this work directly at **October 13, 2026, 10:46 a.m. Eastern / 14:46 UTC**, after the earlier 10 a.m. preservation checkpoint. Resume the existing unfinished work from its actual saved state and preserve completed outputs, active processes and original implementation ownership.

## Direct owner instructions

Latest direct instruction, October 13 at 10:46 a.m. Eastern:

> Get as much of eco science done with the fleet as possible before my call. Try to get it finished its possible im throwing shit ton of agents just get it done

This current instruction supersedes the earlier 10 a.m. Eco work cutoff. Prior cutoff records remain historical evidence. Coordinate at the existing Eco thread, reconcile actual issued handles, complete unfinished integration and native receiving, and publish usable durable handoffs in the existing application. Preserve the distinction between the sender's completed runs and the runs actually included in a received Study. Existing workers keep their current operations; additional workers clear complementary blockers. The recorded call remains unchanged; this direction schedules no meeting or automation and authorizes no client message.

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

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.4` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
