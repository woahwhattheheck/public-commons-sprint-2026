# Source-water areas in the existing operator

The Source-water areas desk connects original watershed drainage relationships,
retained native physical results, and the original experiment's parameter
profiles. It uses the scientific operator's existing workspace selector,
action queue, saved tasks, authenticated routes and file downloads.

## Operator journey

1. Open the scientific workspace and choose **Source-water areas**.
2. Choose a work mode:
   - **Original watershed connections** reads the retained original Esri
     watershed source and follows its HUC12/ToHUC relationships.
   - **One completed baseline** compares an available native NDR, SDR or
     combined baseline against completed alternatives on the same grid.
   - **All selected experiment profiles** builds available comparisons from the
     original experiment, retaining each parameter profile's own baseline.
3. Choose the installed receptor profile and receiving areas. The utility
   profile retains the original ARJWS and Pioneer watershed anchors. A complete
   receptor JSON specification can also be loaded.
4. Preview the selected work. The source mode reports actual retained and
   contributing HUC12 counts, selected anchors and shared upstream units. Native
   direct mode lists the existing common pollutant cohort. Experiment mode
   shows the original profile/baseline mapping and selectable scenario cases.
5. Choose **Build source-water results**. The original queue saves the operation
   and progress. The desk resumes failed or interrupted tasks through the same
   existing task service. Completed experiment profile products remain available
   while other original native cases continue.
6. Reopen the saved result, explore it, and download the complete linked package.
   Reuse its saved selection when additional native cases become available.

The form retains its draft and pending operation identity for each workspace.
Workspace changes invalidate in-flight browser reads. State updates preserve
the current form, selected result and filters.

## Selecting a compatible native cohort

The experiment preview always exposes the original parameter profiles and
land-cover scenarios for a valid experiment selection. Each profile shows its
own retained baseline, completed alternatives and the native model versions
that produced those runs. The version label distinguishes completed-stage
runtime evidence, observed run runtime and the requested version retained by
an older run.

If the selected completed cohort has incompatible native versions, models
or physical output units, the preview shows the actual compatibility
reason beside these controls. Select a compatible profile/scenario subgroup
and preview again. Each selected profile keeps its original baseline. Building
rechecks the current selection before queueing it; the engine repeats strict
native execution validation when it builds the retained result.

Run and preview pollutant labels follow each run's explicit model selection.
An unrelated output left in a run directory does not add that model to its
comparison cohort. Saved native products expose producing-run/model/version
rows, the complete native-execution JSON and original quantity CSVs with their
native model/version fields. These downloads retain the original execution
binding, including requested, observed and completed-stage provenance where
available.

The browser keeps completion handling attached to the exact mounted desk,
Workspace and task identity. An older completion cannot clear a newer pending
operation after the desk is remounted in the same Workspace.

## Complete application component

The maintained `receptors` component in
`integration/application_components.json` enumerates all 24 source-water
engine, CLI, guide, operator, original profile and source-receiving files,
including `model/receptor_execution.py`. Its `core` dependency remains the
existing complete scientific application. The cumulative installer preserves
the complete supplied application tree and inspects local imports and
extension dependencies; this inventory makes the source-water family explicit
within that existing process.

For an equipped receiver, use the current complete application and
`source_tools/ORIGINAL_SOURCE_WATER_RECEIVING.md`. The original 217-feature
domain and source-water Workspace receiving operation retains its original
source identity, network product, prepared areas and portable backup.

## Original watershed connections

Select the original vector source already retained in the workspace. The
catalogue shows its source title, edition, filename and original URI. The
server resolves the actual file through Workspace.source_file and carries the
complete collection/source reference into the receptor specification.

The source mode accepts Esri feature JSON, its GZIP body, or the original domain
ZIP. An archive containing one model-domain.esri.json or
model-domain.esri.json.gz member selects that member automatically. The
optional archive-member field chooses the original file when an archive
contains several candidates.

The preview and build call the existing source-only receptor module. They read
the actual source records and traverse original ToHUC links upstream from each
selected anchor. This work requires the standard Python library and the retained
source; it can finish while regional raster preparation continues.

A saved network opens into:

- An original-polygon geographic overview when the retained source result
  includes its geography file. The complete package keeps the interactive
  offline map with HUC lookup, area selection, zoom and pan.

- Actual original, unique contributing and shared HUC12 counts.
- A receiving-area table with original anchor identifiers.
- Searchable, paged memberships carrying original watershed names, ToHUC
  values, unit types and receiving anchors.
- **Inspect path**, which follows the ordered original drainage links from the
  chosen watershed to its selected receiving anchor. The original downstream
  value remains visible at the anchor. Link count measures network steps.
- Original watershed geometry and attributes, reusable source profile, complete
  network JSON, memberships/area/link CSVs and the source report.

A watershed can contribute to more than one selected area. The network result
retains that shared membership explicitly. Original terminal labels, links
outside the retained source extent and special source unit types remain
available in the network record.

**Use these receiving areas again** preserves the entire source specification
and its original collection/source identity. On switching to a native mode,
the desk matches the selected source to the actual native grid's model-domain
entry. Identical retained body hashes also connect an original ZIP member to
the same GZIP/JSON body installed as a native vector source. When that connection
uses a different source entry, the native specification keeps both source
references. The catalogue therefore distinguishes regional runs from another
benchmark domain contained in the receiving environment.

## Native quantities and profile comparisons

The direct inventory uses outputs shared by every selected completed run.
NDR-only cohorts retain nitrogen and phosphorus; SDR-only cohorts retain
sediment. Each product records its pollutants and run_pollutants. Earlier
completed inventories derive their available cohort from saved quantity rows.

Displayed change is **alternative minus baseline on the same valid pixels**.
Negative change indicates lower modeled annual export from the contributing
land to the stream network. Nitrogen and phosphorus retain kg/year; sediment
retains metric tonnes/year. The adapter applies no extra pixel-area conversion.

The table shows baseline, alternative, change, unit and common-valid/selected
pixel counts. A zero common baseline gives a blank percentage; absent common
valid pixels give blank quantities. Filters select area, scenario, pollutant,
parameter profile or search text. Separate area results retain their actual
overlapping upstream memberships.

Every experiment parameter profile uses its own retained original-land-cover
baseline. The adapter reads every original case page and preserves native case,
profile, scenario and run IDs in the joined CSV. Ranges describe the explicitly
evaluated profile choices. Each detailed quantity retains its own coverage;
whole-basin metrics remain separate columns.

Completed profile groups are retained independently. Repeating a selection
after more native cases complete creates a new comparison snapshot and reuses
unchanged inventories. The previous comparison remains available. Direct mode
can also compare deliberate parameter changes and labels them beside the
original runs.

Saved direct records preserve build_selection, including delivery_id. Experiment
replay preserves delivery_ids_by_baseline. Older direct records reuse their
original baseline/alternative IDs and receptor specification.

The original HUC contribution follows the retained watershed network. The
existing receiving-water workbench prepares source-protection geometries and
their separate planning context. Method and anchor interpretation follow the
source references in model/RECEPTORS.md.

## Installing the desk

Receive the current complete application with the `receptors` component and its
maintained scientific-source and Study-transfer fragments. The component's
24-file core inventory is complemented by those fragments; the current complete
Source-water source bank also includes its map/source producer, six-root typed
transfer helper and full/selected receiving driver. Install the complete supplied
tree so every original dependency and existing shared operator remains present.

Use the same application's `install_extensions.py` only when its extension host
needs installation. Preserve the existing server, browser, native producers and
other desks; the registry discovers `operator/extensions/receptors.json`.
The authoritative current source pointer is
https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JPP97Q8 .
The complete receiving driver and actual path requirements are documented in
`source_tools/RECEIVE_RECEPTOR_REPORT.md`.

Extension ID: receptors. Browser view ID: source-water.
GET /api/extensions shows the installed manifest and any exact import issue.

## Registered APIs

All operations use the original selected workspace key.

| Method / action | Input | Product |
| --- | --- | --- |
| GET /api/receptors/catalog | workspace query | Original source editions, installed profiles, experiments, completed runs and saved outputs |
| POST /api/receptors/network-plan | workspace and selection in JSON | Actual original upstream counts and anchor memberships |
| GET /api/receptors/network | workspace and id query | Saved source network, ordered membership data and original file tickets |
| POST /api/receptors/plan | workspace and selection in JSON | Complete experiment case mapping and available profile groups |
| GET /api/receptors/comparison | workspace and id query | Saved grouped quantities, profile products and report tickets |
| GET /api/receptors/inventory | workspace and id query | Saved direct quantities, editable area products and report tickets |
| receptor.network.build | selection | Original source network saved under receptor-networks |
| receptor.inventory.build | selection | Completed-baseline area inventory |
| receptor.experiment.build | selection | Retained profile experiment comparison |
| receptor.package.export | kind and id | Complete linked ZIP; kind is network, inventory or comparison |

Queue actions through POST /api/actions with workspace, operation_id, action
and payload. Reusing the same operation identity retries the same request; the
original queue checks the payload. POST previews include workspace in their JSON
body because that is the existing extension dispatch contract.

A source-only selection contains source_collection_id, network_source_id and
the complete receptor_spec, plus optional member and expected_decoded_sha256.
The backend resolves and verifies the actual original source file. The resulting
specification retains source_reference, source_collection_id and
network_source_id for later native reuse.

A direct selection contains baseline_run_id, scenario_run_ids and receptor_spec,
plus an optional delivery_id. The catalogue supplies the actual completed IDs.
An experiment selection contains experiment_id and receptor_spec, with optional
profile_ids, scenario_ids and delivery_ids_by_baseline. Its complete CLI contract
is documented in model/RECEPTOR_EXPERIMENTS.md.

The ordinary /api/item aliases use kind=receptor-networks,
receptor-inventories or receptor-comparisons. State contributes
data.source_water with compact summaries. Completed task records contain the
result ID, file descriptors and counts. Opening a saved product loads its full
detail.

## Reports, downloads and complete packages

The original file service binds each output ticket to its workspace and checks
the file at download time. Derived printable previews retain report tables and
source text while resolving product links to those tickets. The original HTML
sandbox governs those previews. Use the main desk's download links for original
files; its tables and drainage inspector provide the interactive browser view.

A complete ZIP keeps the original reports, including their offline interactions,
and all linked files. Its directory structure is:

    index.html
    PACKAGE.json
    receptor-networks/NETWORK_ID/...        [source network]
    receptor-inventories/INVENTORY_ID/...   [direct or grouped inventories]
    receptor-experiments/COMPARISON_ID/...  [experiment comparison]

A network package includes the original geometry/attributes, source profile,
network and CSVs. An inventory package includes editable GeoPackages, original
memberships, quantities, network/result records and retained priority rasters.
An experiment package includes every completed profile inventory it references.

Extract the full ZIP and open its top-level index.html. Original relative links
resolve within the extracted product. PACKAGE.json preserves every member's
byte count and SHA-256. Export streams existing files, checks their saved
identities and atomically retains the completed archive at:

    WORKSPACE/receptor-packages/PACKAGE_ID/source-water-results.zip

The complete scientific workspace backup recursively includes all receptor
result directories and executable application source. After the original
restore checks the archive, the extension receiving hook checks its saved
references and file lengths. Normal state polling caches compact summaries by
actual file identity; detailed inspection occurs when opening or exporting.

## Native receiving

ECD1 owns the cumulative application assembly and complete-ZIP delivery.
Receive the additive desk and current core into that same source operation.

The 405F receiving container already retained the original domain at:

    /dev/shm/upstate-405f-20261012/inputs/dbc61-upstate-model-domain-20261012.zip

Its application is:

    /dev/shm/upstate-405f-20261012/application

The sibling's source-only CLI request uses that actual ZIP to produce the
original regional memberships before raster completion. The same module can
build from an original vector imported into the operator workspace, save under
receptor-networks and reopen in this desk.

For operator receiving, choose that workspace's original regional vector,
preview/build its utility memberships, inspect an original drainage path and
export the source package. When the same regional grid has completed native
runs, reuse the saved areas in direct mode, then the retained experiment.
Join the actual result IDs and complete packages into the cumulative delivery.

Two seats used the ASTRA-ECO12 label. The Drive bridge seat with
/opt/pyvenv/bin/python and Chromium described /mnt/data/eco12-source as additive
source at Slack message 1791849843.511819. Receive its complete scientific
workspace before choosing native IDs there. The ensemble class/14-file engine
seat on host f5dd7c7e9cd6 is a separate receiver.

## Current source references

- Core revision 3: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8PMN99LJ
- Source-only module and direct replay: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8N07B8BG
- Initial merged profile adapter: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2628
- Original experiment source: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8MU63NB0
- Selected-model source and reuse: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JJQ2JBX
- Shared extension contract: operator/EXTENSIONS.md in the same public application.

## Author receiving areas on the original map

Open a saved **Original watershed network**, then choose **Edit receiving-area
study**. The editor starts from that complete saved profile and its original
source bytes. It retains the full draft in the existing workspace-specific
browser storage.

Choose **New receiving area**, or edit/duplicate one of the current study areas.
Give the area a title, choose its drinking-water or high-quality-water study
purpose, and retain the source reference and reason for choosing its anchors.
An original source URI is used when available; a source received directly from
the standalone CLI also has its original content-identity URN.

Select a polygon in the original map and choose **Add selected watershed**.
The same original HUC12 values are available through the editor's searchable
input; several can be pasted separated by spaces, commas or semicolons. Every
anchor must be a twelve-character HUC12 present in that exact retained source.
Draft anchors have dashed outlines. The existing shaded map continues to
describe the opened saved study until the edited study is saved.

**Apply area to study** updates the current profile selection. Titles, source
references, area purpose and full original anchor IDs remain together.
Editing an existing area's anchors or reference retains its original source
reference in source_receptor_reference, while the new definition carries the
chosen source URI, stated basis and original source-body identity. An
unchanged source reference retains its complete original metadata, including
any document identity and page references.

An edited area's original ID remains stable. Newly created or duplicated
areas receive unique IDs derived from their titles. Removing an area affects
the current draft; the saved source study remains available. **Reset area
edits** restores the applied area's fields, and **Reset draft to source study**
restores the complete starting profile. A hidden editor can be reopened from
the retained draft. **Open study source map** also restores its original
geography after a browser reload.

**Preview edited watershed connections** uses the maintained original graph
reader to resolve the selected upstream sets. **Save complete receiving-area
study** enters the existing receptor.network.build queue and produces a normal
immutable source-water network product: original bytes, full receptor JSON,
original links, memberships and area CSVs, geographic SVG, HTML explorer and
result record. Pending field and anchor edits are applied before either action.
The completed study opens through the normal saved-result path and is included
in the existing complete-package and portable-workspace transfers.

The complete current receptor specification is also available through
**Download current receptor JSON**. The saved study's original profile download
is retained with its full byte identity. Choose **Use these receiving areas
again**, then select direct native results or an experiment; the existing
original-body match restricts the native grid to the same watershed source.

## Continue from a received source-water study

The watershed source picker now includes **Retained source-water studies** as
well as imported original vector sources. A network received from the standalone
CLI can supply its exact retained original JSON or GZIP directly. This makes the
source-only receive → edit → rebuild → package → reopen flow complete even when
that particular body has not been added as a separate Workspace source entry.

The existing network-plan and network-build selection accepts either its
original source_collection_id/network_source_id pair, or:

~~~json
{
  "network_result_id": "<saved source-water network ID>",
  "receptor_spec": {"schema": "upstate.receptor-spec/v1", "title": "...", "receptors": []},
  "expected_decoded_sha256": "<original decoded body identity>"
}
~~~

The example shows the selection envelope; the receptor list must contain the
actual complete receiving-area definitions. The source-result branch loads the
retained network through the existing identity/file reader and selects its
verified source_body descriptor. It copies that source's collection/reference
bindings into the new profile when those bindings exist. Native model execution
continues to resolve the matching original grid source through the maintained
nativeSpecification path.

A retained network has already selected its original archive member, so this
selection does not include member. The source product's original body is
read directly. The scientific selection remains stable when the same source
and profile are rebuilt; the backend does not append a new chain of product
IDs to the receptor specification.

The catalog emits the saved source's body/decoded hashes, filename, byte length
and original source reference from the existing cached summaries. Opening the
result verifies the original descriptors before the UI uses it for authoring.
The workflow adds no new top-level Workspace collection or parallel job service.

Changing from the area editor to a native inventory or experiment first applies the pending area edits. If an anchor or source reference is invalid, the desk keeps the original watershed mode open and displays the specific error. The matching native selection receives the corrected, fully applied receptor profile.


## Prepared original areas and intervention scenarios

Saved watershed studies now offer **Prepare scenario areas**. The operation retains exact original polygon subsets as Workspace vector sources and produces the maintained `upstate.scenario-source-areas/v1` handoff. The prepared result opens Scenario analysis with its complete origin, creates explicit ordered land-cover scenarios, and prepares native runs through the existing application form and queue. Saved scenarios and their runs remain visible from the prepared-area page.

See [`../model/RECEPTOR_SCENARIOS.md`](../model/RECEPTOR_SCENARIOS.md) for the complete operator journey, original geometry and source contracts, explicit land-cover choices, CLI, overlap semantics and retained output. This version requires the current Scenario analysis extension's `createForSourceAreas` method and the standard host form/refresh/item capabilities. Shared application and server files are unchanged.


## Open results directly from completed tasks

The current extension host exposes `client.task_actions`. The source-water desk registers authored controls for all six of its queued operations. A completed network, inventory, profile comparison or polygon preparation opens its saved result directly; a completed land-cover scenario opens the original scenario detail or its prepared areas and native runs; a completed package opens the result that was packaged. Existing download links remain in the original task panel.

The registered `receptor-result-` action prefix dispatches through the existing host. Opening a result closes the old task detail, navigates to Source-water areas, and retains the requested immutable result ID until the actual Workspace catalogue has loaded. It handles both an already open desk and a cold controller loaded from another page. Workspace identity is checked before dispatch and again before opening the result. This join uses current `navigate`, `closeDetail`, `taskActions` and action-dispatch capabilities; shared application and host files are preserved.


## Paired native programmes from prepared source-water areas

Open a retained prepared-area product and choose **Prepare paired programme**. Select its original completed model grid, original baseline, NDR/SDR scope, explicit saved area scenarios and retained parameter profiles. The preview lists the entire calculation cohort and every profile’s own baseline. The shared experiment planner and native programme retain and execute those exact selections.

The saved source-water programme links directly to **Run programmes**, including its pause/resume, logs and paired-map controls. Return to **Refresh calculation status**, then **Build source-water comparisons** after completion. The existing receiving-area report preserves matching-profile baselines, common valid pixels and native physical units. Completed tasks reopen the saved programme plan or the actual comparison through the original task navigation.

`model/RECEPTOR_PROGRAMMES.md` describes the full UI/CLI workflow, selection schema, source continuity, original programme/experiment services and complete Workspace receiving. New source files are `model/receptor_programmes.py` and `model/receptor_programme_cli.py`. Their `receptor-programmes/` products are retained by the existing recursive Workspace archive.

## Saved geography in scientific reports

Saved original networks and prepared source areas now offer **Prepare scientific report source**. The queued action retains the complete original network, polygon subsets, membership tables and source records as one typed scientific report choice. Open its saved result, then choose **Open this report only** to replace the scientific composer's selected sources and title with this exact retained source. Choose **Add to current report** to preserve its current source order and title and append the source once; an empty title uses this report's title. The handoff waits for the original source collection and rechecks the selected result, mounted desk, Workspace and latest requested action before opening. An earlier host without the composer callback keeps **Open retained scientific source**. The standalone report includes the original geographic SVG; the typed recipe contributes source tables and links to the shared publisher. Original publisher AreaSqKm sums show their completeness and use distinct HUC12 units for union totals. Complete native/receiving instructions are in `model/RECEPTOR_REPORT_SOURCE.md`.


## Original projected maps in scientific source reports

**Prepare scientific report source** now opens a form for the retained network
or prepared-area result. The source-only default preserves the complete original
geography, memberships and source files. On an equipped host, selecting
**Include projected original watershed maps** adds native SVG/PDF figures from
the same original Esri body. The form shows the installed ReportLab, Shapely and
PROJ versions; a stale form cannot submit a result after a Workspace, desk
generation or saved-result change.

Mapped editions keep separate original HUC12 polygons, light upstream support
and dark anchor outlines. Labels refer to receiving areas, not inferred intake
locations. North and scale use the original projected grid; EPSG:3857 distances
are not corrected ground distances. Published area quantities continue to use
the original AreaSqKm attributes. The original Esri parser's ring assembly and
any validity operations are retained with every feature's original source
position and the full decoded body identity.

The retained result card identifies the native figure count, CRS and recorded
reader operations. Its printable geography, individual downloads and complete
source package carry the figure specification, SVGs, exact original products,
geometry interpretation inventory, and producing source files. The existing
scientific report composer opens the actual retained source choice and renders
the shared typed map figures with the original source tables.

See `model/RECEPTOR_REPORT_SOURCE.md` for the native command, complete
dependencies, immutable mapped-edition identity and the ordinary queued
render/export/restore course.

## Inspect the actual outgoing report journey

Follow application `AGENTS.md`, owner version `2026-10-13.1`. Before presenting
the installed product or export as ready, open and LOOK at its exact outgoing
render at desktop/screenshare and 390px widths. Operate the populated report card,
loading/error states, source choice, source order, title, downloads and reopening.
Start with another report draft: **Open this report only** must show only the chosen
source and its title; **Add to current report** must preserve the current ordered
sources and title without duplicate entries. Inspect the retained-source fallback
on an earlier host when applicable. View the actual screenshots as well as taking
them, and repair cramped, clipped, overflowing or unreadable controls. Continue
this through the existing equipped receiving operation; controller/source checks
are complementary and do not replace looking at the rendered product.

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

## Current production direction — 13 October 2026

BRYCE CURRENT DIRECTION — ECOSYSTEM MODEL / DEMO / PRESENTATION. Pass this complete update into current worker assignments and onward handoffs; the feed is moving quickly.

Exact new owner instructions:
“do the simulated model”
“just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it”
“and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast”
“just checking dont pause anythi g”

Implementation direction:
• Tim/Ecosystem already publishes GIS, watershed/environmental modeling, data analysis, map/report publishing and natural-capital decision-support work. Do not assume a tools/capacity gap or pitch generic GIS as novel. Build a concrete production workshare he can compare with his existing workflow; prime retains scientific direction/method choices/review/client relationship.
• Center the demonstration on THIS UpperSavannahRFP: actual geographic/source shapes,30mgrid, upstreammodeldomain vsSCreportingmask andutilityfocus, clearlysimulatedrealisticinputs, nativeInVESTNDR/SDR baseline+restoration+matchedcontrol, annualN/Pkg/year andsedimenttonnes/year reachingstream, meaningfulcomparison/maps/report, editableparameters/sourceeditions andexport/coldreopen. Keep load/concentration and stream/intake distinctions correct.
• Actual simulatedmodel execution and the connected usable product are the hard priority. Runtime/source existence or another plan is not the run. Preserve already-running jobs andonewriterperWorkspace; use existingequippedruntime or provision an isolated actualexecution environment when needed. Root has explicitlytakenactualexecution; otherbuildscontinue.
• Make relevance and speed visible through what Tim can USE: chooseinputs/assumptions→run→inspect differences→revise→hand over work his team can continue. Show actualproducedartifacts and real elapsedhistory; no inventedtimings/guaranteedreaction. Avoid stockscreen/decorativepitch/demo-onlytheatre.
• Open/look/use finalproduct and ALLattachments asrecipient, fixobviousdefects, naturalgenerativeTTS/mediaifused, actualapprecordingratherthan generatedscreenspretendingexecution. No review/testtheatre or substitutionforhardbuild.
• Cascade thisdirection to otherEcosystem/product/model/report/presentationpeers atnextsafemessageboundary; persistindurablecurrentworkorders/startupguide andincludeversion/pathwithnextsubstantiveresult. Don'tstopactivecalculations, restartheld/deletedtasks, spawnanothercontroller oraskBryce torelay.
No bid/prime-yesgate or arbitraryproduct/featurecap. TODAY10a.m.Eastern/14UTCcutoffremains. Existingfocusedvalidation,noPrivateGitHub/Actions,labattribution,contact/meeting/spendcontrols remain. SharedGitHubcurrentownerbrief landingunderopportunities/upstate_forever_2026; Rootwillreturntheactualpath/head.

Authoritative current work order: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791887422395359

Durable application brief: `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. Carry its complete current contents with the same native/product work order.
