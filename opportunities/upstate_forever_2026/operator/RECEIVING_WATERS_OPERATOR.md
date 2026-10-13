# Receiving waters in the scientific operator

This module connects agency water designations, utility receiving areas, native model results, and the existing seven-map delivery. Its browser controls use the original authenticated operator, task queue, workspace registry, and file downloads.

## Install into the cumulative application

Receive these additive components beneath opportunities/upstate_forever_2026:

- model/receiving_waters.py and model/RECEIVING_WATERS.md
- model/receiving_water_delivery.py and model/receiving_water_cli.py
- operator/receiving_water_actions.py
- source_tools/receiving_water_catalog.py and its source guide
- operator/web/receiving_waters.mjs, operator/web/receiving_waters.css and operator/web/receiving_waters_extension.mjs
- operator/receiving_waters.extension.json
- operator/install_receiving_waters.py and this guide

The scientific component is published in public sprint PR2634:
https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2634

The original science commit is b34d0cf46d6c7d331f6b9ae32b73d243c64273b6. Its delivery bridge includes the current regional renderer's shared 0-1 scale contract. Use that edition or a later cumulative revision.

From the actual application directory:

    python -B operator/install_receiving_waters.py --root .

The installer joins five maintained files: operator/server.py, operator/web/app.mjs, operator/web/index.html, model/delivery.py and model/portable.py. It also permits the browser module and stylesheet through the original static-file route. It checks every selected seam before writing, parses Python changes, preserves file preimages, and applies only these joins. Repeating the same installation leaves completed joins in place. The optional --check flag reports proposed joins without writing.

The installer targets the maintained Python Workspace/operator and regional delivery interfaces. Apply it to the current cumulative edition so its source, scenario, experiment, and customer-review controls remain composed.

Reopen the existing operator using its original workspace and local URL. Choose **Receiving waters** in the analysis navigation.

## Prepare published agency waters

Choose **Choose published waters**. Set the as-of date and choose which plan to prepare: effective or proposed designations.

Each source row names an actual imported vector source and a source profile supplied by the installed compiler. The current profiles include:

| Profile | Source |
| --- | --- |
| scdes_classified_waters | SCDES classified-water features from the original layer profile |
| scdes_classified_streams | SCDES active SCHydroClass stream features |
| scdes_surface_intakes | SCDES surface-water intake features |
| scdes_source_water_areas | SCDES source-water protection areas |
| scdes_protection_zones | SCDES published protection zones |

Select the original ArcGIS layer metadata source when it is already imported. The advanced source controls also accept the complete original layer metadata JSON, exact native feature IDs, exact attribute equality filters, field mappings, source status filters, and object-ID keyed interpretations.

Record the source edition's designation status and authority evidence URLs. Effective dates remain attached to that source. The effective-until date is exclusive: a source ending on that date is historical as of that date. Classified-water sources additionally require the selected designation codes and a rationale for that class selection.

Select the retained HUC/ToHUC catchment network for surface-water upstream associations. Catchment field names default to huc12 and tohuc and can be set to the original source names.

The completed task opens a saved catalog. Its record table shows original classifications, edition selection, retained source records, and selected waters. Search and page through the records, inspect their original provenance, or open the prepared effective/proposed plan. All original catalog and GeoJSON files remain downloadable.

A prepared source selection can also be loaded from JSON through the source form. This supports the source acquisition team's complete retained selection without re-entering its fields.

## Prepare utility or custom receiving areas

**Use utility profile** accepts the existing utility-focus JSON profile. Choose the prepared grid that binds its original catchment source. The source engine resolves the retained HUC anchors and saves an ordinary receiving-water plan.

**Define receiving areas** supports a plan containing several original water sources. For each area choose its name, stable ID, family, source, original feature selection, and relationship rationale:

- **Original HUC / ToHUC upstream land** follows the source network from the selected receiving units.
- **Published source-area polygon** uses the published boundary directly.
- **Explicit geometric context** uses the selected geometry and a declared buffer in metres.

The plan saves its original water features, contribution geometries, source identities, and relationship interpretations. The source inspector shows the actual native field names and sample records while editing a receiving area.

HUC/ToHUC relationships operate at the retained catchment scale. The plan records the receiving units, upstream memberships, boundary ambiguity, and relationship precision. The source guide describes those spatial methods.

## Analyze native model results

Choose **Analyze model results** or **Analyze** beside a source plan.

Select a completed baseline. The form offers completed land-cover alternatives on that same grid and scientific profile. A baseline-only analysis is also supported.

Choose the quantity domain:

| Domain | Numerical source |
| --- | --- |
| Reporting area | Existing reporting-masked mass-per-pixel native artifacts |
| Full modeled domain | Retained original native outputs over the modeled domain, converted by the recorded pixel area once |

Default priority weights are equal across the native quantities actually present. The engine records its fixed baseline caps. The advanced controls accept explicit weights and normalization selections when those are part of the study.

The browser lists available quantities from the analysis itself. Completed NDR-only results can report nitrogen and phosphorus; completed sediment outputs enter analyses that include that native quantity.

Operations run through the existing task admission, operation ID, queue, and saved attempts. The analysis view refreshes progress and completed areas. Failed or interrupted tasks can resume through the normal operation controls. Repeating an analysis uses its original immutable selection and completed geometry checkpoints.

## Read physical results

Open a saved analysis. The table can filter individual receiving waters or combined family areas and either water family. It shows physical totals, valid coverage, and area within the selected quantity domain.

Select an alternative run to switch among total export, signed change, increased export, and avoided export. **Details** shows each pollutant's paired baseline and alternative sums on the common valid pixels, signed difference, increased and avoided quantities, coverage, and units.

Nitrogen and phosphorus totals are kg/year. Sediment totals are metric tonnes/year. Priority statistics remain dimensionless. A valid zero displays as zero, and an absent value remains empty of a numerical estimate.

Combined family areas unite overlapping contribution masks so each land pixel enters its family total once. Individual receiving-water totals retain their own catchments and can overlap.

Saved files include physical quantity CSVs, source and contribution GeoPackages, priority rasters, signed change rasters, original selections, and complete analysis records. File downloads use the original operator's content identity and authenticated file route.

## Include results in the full delivery

In **Maps and delivery**, select a completed receiving-water analysis in **Receiving-water contribution maps**. It must use the selected delivery baseline and the same completed alternatives.

The joined delivery collects the full source plan and analysis, uses the actual family-specific priority layers for drinking-water and high-quality-water map families, appends their physical interpretation to the report, and includes the source boundaries and per-water quantities in its working assets. The current regional map scale contract remains in use.

Normal workspace backup recursively includes the new model, operator, source, plan, catalog, and analysis files. The installed portable join also acquires active receiving-water analysis locks during capture. The restored copy uses the same saved source and native run identities.

## Native receiving operation

Use the existing equipped application and retained regional workspace:

1. Install the complete additive components and join the current operator.
2. Prepare the existing utility-focus profile or the source team's compiled agency selection.
3. Open the saved plan and inspect an original utility anchor and its upstream memberships.
4. Analyze a completed baseline and compatible land-cover alternative using the intended quantity domain.
5. Compare one reported pollutant sum and paired coverage with the selected original raster pixels.
6. Open the browser on desktop and phone widths, inspect a receiving-water result, download its quantities, and reopen the saved analysis.
7. Select that analysis in the complete map delivery and reopen the transferred workspace.

Return the actual workspace, source plan, grid, baseline/alternative run, analysis and delivery IDs with any native exception. The component owners can then repair that precise integration in the same cumulative source.

## API joins

| Interface | Purpose |
| --- | --- |
| GET /api/receiving-waters/catalog | Current original source choices, plans, analyses and catalogs |
| GET /api/receiving-waters/plan?plan_id=... | Saved source plan and downloads |
| GET /api/receiving-waters/analysis?analysis_id=... | Saved physical results and downloads |
| GET /api/receiving-waters/designation-catalog?catalog_id=... | Original designation catalog and prepared plan links |
| receiving.water.catalog | Compile agency sources and prepare the selected designation edition |
| receiving.water.plan | Prepare explicit source-based receiving areas |
| receiving.water.profile | Prepare the existing utility-focus profile |
| receiving.water.analyze | Calculate receiving-water quantities and priorities |

All reads use the existing workspace query and authentication. All actions use the existing POST /api/actions payload and operation_id. The extension supplies normal task result links and file downloads through that same operator.


## Shared extension host and cross-desk operation

Revision 2 uses the existing shared extension host when that host is already installed. The ordinary install command stays the same. It detects the actual server and browser registration, moves this component's earlier backend bindings into the registry, and installs the supplied descriptor at operator/extensions/receiving-waters.json. The scientific delivery, portable-analysis locks, original task-result controls and delivery selector stay integrated with the maintained application.

Install ECSA's complete shared host first, then run the receiving-water installer again against the resulting cumulative source. The installed descriptor owns:

- The four receiving.water.catalog, receiving.water.plan, receiving.water.profile and receiving.water.analyze actions.
- GET /api/receiving-waters/catalog, /plan, /analysis and /designation-catalog.
- The receiving_waters state member containing the saved catalog, plan and analysis summaries.
- The Receiving waters browser view, water- action prefix and three declared web assets.

The same browser reads both the original flat snapshot and this registered nested snapshot. Existing installations without the shared host use the original operator bindings. Both modes preserve the original queue and authenticated file tickets. Running the installer again with unchanged sources is idempotent.

The installed extension exposes direct entrypoints for the designation-selection, legal-source-review and scenario desks:

    await extensions.openExtension('receiving-waters', 'createCatalog',
      originalCompilerSelection, {prepare_vintage: 'effective'});

    await extensions.openExtension('receiving-waters', 'createPlan',
      originalReceivingPlanSelection);

    await extensions.openExtension('receiving-waters', 'openPlan', planId);
    await extensions.openExtension('receiving-waters', 'openCatalog', catalogId);
    await extensions.openExtension('receiving-waters', 'openAnalysis', analysisId);
    await extensions.openExtension('receiving-waters', 'analyze', planId);

createCatalog opens the complete original compiler selection for review. It retains source collection, source, native feature IDs, field mapping, edition evidence and catchment selection. createPlan opens a complete model.receiving_waters.prepare selection containing receptors and its required catchment reference. These calls open the existing review form; its submit control sends the chosen operation through the original task queue.

The openPlan/openCatalog/openAnalysis methods also accept an object containing id. They select the saved record and navigate to the Receiving waters view. The analyze method opens the existing compatible-run picker for the selected plan.

A completed analysis containing nitrogen, phosphorus and sediment has **Add to maps and delivery**. That action opens the original delivery form with the exact baseline, alternatives and receiving-water analysis already selected:

    await extensions.openExtension('receiving-waters', 'openDelivery', analysisId);

The original form retains all other delivery choices. Its receiving-water selector checks the exact run cohort before submitting. Analyses containing the actual available NDR-only or SDR-only quantities remain inspectable and downloadable in their own workflow.

## Revision 2 integration checks

The original current server has an explicit allowed static-file list. Revision 2 adds receiving_waters.mjs and receiving_waters.css to that list; the shared host additionally serves the registered extension wrapper. This repairs the browser import and stylesheet requests in a standalone installation.

The browser source-profile list now comes directly from the installed compiler. The active SCHydroClass profile appears with its own profile ID, and every profile marked classified_water or requiring a classification receives the same explicit class/rationale form checks. The earlier agency profile remains available for a separately retained source edition.

The receiving-workbench helper and extension wrapper share the same complete controller. The wrapper refreshes its visible summary when saved waters, runs or relevant tasks change and preserves the selected record across navigation and workspace reopening. Unrelated task polling leaves the current water-detail view in place.


## Current cumulative application task controls

Revision 3 composes receiving-water task controls at the original customer-review task term. Current programme and experiment controls can appear between that term and the ordinary file downloads; they remain in their existing order. This supports the complete scientific-workbench application as well as the earlier operator layout. The receiving-water browser and registry interface are unchanged from revision 2.

The installer retains its single-anchor and original-file checks before any application files are replaced. Its normal first and repeated invocation uses the same --root argument. Run it against the current full application after receiving the current scientific, source and shared-host components.

## Receiving-water maps and original spatial reviews

Revision 4 joins saved receiving-water plans and completed analysis layers directly
to the existing **Spatial review** catalog. Run the maintained installer after
receiving the complete scientific and browser sources:

    python -B operator/install_receiving_waters.py --root ACTUAL_APPLICATION

The complete public application carries the resulting registry, map and archive
joins. The installer also upgrades the original version-2 receiving descriptor and
retains its existing source preimages.

Open a saved source plan and choose **Boundaries** for the desired water. The map
opens its published feature and contributing geometry together, using the plan's
retained coordinate system. The contributing boundary supplies the initial extent.
Both layers retain their original plan, source and relationship metadata.

Open a completed analysis and choose **Review receiving areas** for its full
GeoPackage. Each result row also opens the selected water's priority raster.
Choosing an alternative and increased or avoided export selects that same saved
run and statistic. In the detailed physical comparison, **Signed change** opens
the exact pollutant change raster for its named alternative.

Priority maps start with the recorded dimensionless range of zero to one.
Contribution masks are categorical. Physical-change maps retain their original
per-pixel mass units and the spatial workbench's normal physical-scale controls.
The selected analysis feature uses both its exact subject ID and individual-water
or family-union kind.

Use the existing map controls to inspect native pixels and feature properties,
add review markers, save the view, and export or print the retained review. The
saved binding includes the receiving plan and analysis, selected water, run,
quantity domain, statistic and normalization identity. Reopening and workspace
receiving resolve the same retained artifacts through the original GIS file
reader and archive member checks.

The native catalog watches plan and analysis manifests, so a completed operation
appears when spatial sources refresh. It reads compact original metadata for the
catalog and verifies a layer's file when that layer is actually opened. Original
source selections, full classifications, relationship records and numerical
summaries remain in their saved plan and analysis records.


## Operate the complete browser receiving journey

Use the existing live operator and its original server ready JSON. The native source preparation returns the plan ID; a completed receiving-water analysis can be added when its actual baseline and alternatives are available. The browser command opens every selected original source/contribution pair, every available individual/family priority and physical-change map, saves each view through the original queue, exports and downloads its complete native map ZIP, then closes and opens a fresh browser context to reopen those saved views.

Create a private control JSON using the actual existing paths and IDs:

```json
{
  "ready_file": "/actual/operator-ready.json",
  "output": "/actual/receiving-water-browser",
  "plan_id": "ACTUAL_64_HEX_PLAN_ID",
  "analysis_id": "OPTIONAL_ACTUAL_64_HEX_COMPLETED_ANALYSIS_ID",
  "node_modules": "/actual/installed/node_modules",
  "chromium": "/actual/installed/chromium",
  "paper": "letter",
  "dpi": 220
}
```

Omit `analysis_id` for the original utility geography journey. Either a plan or an analysis is required; selecting only an analysis resolves its own saved source plan. The operator ready file selects its original workspace unless `workspace_key` explicitly selects another workspace already registered by that same operator. Omit `node_modules` when the existing runtime sets `CODEX_PRIMARY_RUNTIME_NODE_MODULES` or resolves the installed Playwright package normally; omit `chromium` to use that installation's existing browser. The ready file and capability stay on the native host.

```sh
node operator/receiving_water_browser.mjs /actual/receiving-browser-control.json
```

The default case set includes all plan areas, the analysis overview, and every retained baseline/alternative priority and signed pollutant-change artifact. An explicit `subjects` array can select original `{ "id": "...", "kind": "receptor" }` or `{ "id": "...", "kind": "family_union" }` pairs for a specific operating selection. Individual and family areas with the same ID remain separate. Gura and regional source plans retain their own actual geography and native resolution.

The command writes `receiving-water-browser.json`, the actual map ZIPs and native-browser screenshots to the chosen directory. The result identifies the project, source plan, analysis, each target, original queue tasks, saved review/export, exact source bindings and cold-reopened viewport. Resuming the same control selection and application edition reconciles its retained original operation IDs and complete downloads. The operation identity includes the actual installed driver, operator and renderer source hashes, and the command checks that the live server serves those same browser modules. Keep a changed application edition in its own output directory so its exports and screenshots remain distinguishable. Active tasks remain recorded when the observation duration elapses; `task_timeout_seconds` sets that duration. A native exception identifies its original task, stage and message in the same output.

The receiving detail controls retain both subject ID and kind. The spatial workbench refreshes when a source plan or analysis finishes, and saved map titles identify their original statistic and model run. These joins use the existing operator, native spatial renderer, export producer and persisted queue.


## Broad source catalogs and receiving-water results

The receiving-water workspace keeps source plans, completed analysis tables, and download lists to 75 visible rows per page. Search and family/type filters apply to the entire saved record before pagination, so a water on the final page is reachable directly by its exact native ID. When the search exactly matches an ID, that ID takes precedence over partial name or source matches. Analysis area type continues to distinguish individual receiving waters from combined family areas when their IDs coincide.

Previous and Next show the current range and matching total. Changing a filter resets the view to the first matching page; continuing an active analysis preserves the current page and clamps it to the available results. Catalog searches reuse each original record's search text within the loaded source edition.

Downloads are listed when their section opens, with search by file name, label, or SHA256 and the same 75-row page size. The plan's original source-selection JSON is also materialized when opened. Every original download and source record remains available; these controls change rendering, not the retained scientific or source artifacts.

The maintained browser journey waits until the exact selected plan or analysis has finished loading, then locates each target through its exact native ID and area type before opening the original map. This operates waters beyond the first page while retaining the same saved map, export, and fresh-context reopening checks. Use the browser command from the same application edition as the served receiving-water UI.


## One native invocation owns the service and browser

Use `operator/receiving_water_operate.py` when the native receiving operation
should start the original operator, run the complete receiving-water browser and
close its own service in one process/network namespace. It reuses the maintained
`OperatorProcess`, command runner and private atomic writer from
`operator/receiving.py`.

The input is the actual `public-water-preparation.json` already produced by the
original source preparer. The owner opens its absolute scientific Workspace,
verifies the saved plan, original source collection and receptor IDs, then serves
that same Workspace. It does not need a manually copied capability, ready URL or
plan ID.

From the actual application root and existing GIS Python environment:

```sh
PYTHON -B operator/receiving_water_operate.py \
  --preparation ACTUAL_PUBLIC_WATER_PREPARATION_JSON \
  --output-dir OUTSIDE_WORKSPACE \
  --node ACTUAL_NODE \
  --node-modules ACTUAL_NODE_MODULES \
  --chromium ACTUAL_CHROMIUM
```

`--node` defaults to `CODEX_PRIMARY_RUNTIME_NODE` or installed `node`.
`--node-modules` defaults to `CODEX_PRIMARY_RUNTIME_NODE_MODULES`; omit it when
Node resolves the installed Playwright package normally. Omit `--chromium` to use
that Playwright installation's browser. The command checks explicitly selected
executables and module paths before starting its own service.

The existing original operator state defaults to the Workspace's sibling
`WORKSPACE_NAME-operator` directory, matching the original server. An explicit
`--operator-state` selects an existing operation's actual state location. The
original state lock prevents a second owner from taking an active service. For
an already-running operator, continue to use the existing
`receiving_water_browser.mjs PRIVATE_CONTROL.json` interface with that service's
own ready file.

Add `--analysis-id` only for a completed analysis of this same prepared plan.
`--paper`, `--dpi` and `--task-timeout-seconds` retain the browser command's
original selections. Every original source/contribution pair and selected
analysis artifact remains in the browser case set.

The owner creates an edition-specific subdirectory beneath `--output-dir`,
derived from the preparation identity, actual Workspace/plan, installed source
hashes, runtime paths and map settings. It holds one operation lock, records the
actual server process and Workspace key, and writes private ready/control JSON
files for the child browser. The browser performs its original save, export,
download and cold-context reopening workflow. The owner then drains the service
it started and removes its private ready/control files.

The complete result is `receiving-water-owner.json`, containing the actual
preparation, application identities, browser result file digest, exported map
count and owned process closure. Child stdout/stderr, original browser progress,
map ZIPs and screenshots remain beside it. A failed stage preserves its actual
error and the original browser task identities for continuation. Run the same
command to continue that same edition. Source or runtime changes receive their
own subdirectory.

If the original operator has marked a previously captured browser save/export
task `interrupted`, the resumed browser verifies its Workspace, action and
payload and resumes that exact task ID once in the new browser attempt. It keeps
the original operation identity and retained map outputs. Failed and cancelled
task results remain explicit in the progress file for the responsible native
repair.

The native source/map/export/Workspace journey remains the preceding maintained
command:

```sh
PYTHON -B model/receiving_water_journey.py \
  --preparation ACTUAL_PUBLIC_WATER_PREPARATION_JSON \
  --output-dir ACTUAL_NATIVE_MAP_OUTPUT \
  --archive-and-reopen
```

Both commands consume the same preparation and scientific Workspace. The native
journey retains its original map/archive result directory; the browser owner
retains its own browser receiving output. Existing upstream HUC network and
scenario-source operations can enrich the same Workspace without replacing the
published utility source boundaries.


## Nested catchments, intake totals and reservoir domains

In **Analyze model results**, open **Nested catchments and reservoirs**. Add a
catchment group, name it, and choose the downstream total from the original
receiving areas in the saved source plan. Mark its contributing upstream areas
as **Upstream catchment** or **Reservoir catchment**. Retain the original source
URLs or citations and the rationale for those relationships.

A group uses the plan's original contribution boundaries and relationship
precision. Published source-area polygons preserve their actual geometry;
HUC/ToHUC associations retain catchment-scale precision. An intake point alone
does not define its complete contributing catchment. Prepare that source
relationship in the existing source-plan workflow before selecting the group.
Changing the source plan clears groups that refer to the previous plan.

The analysis forms each upstream union once. On the original native grid, it
separates the parent mask into upstream land and the remaining incremental land.
Where reservoirs are selected, the disjoint partition is above-reservoir land,
other upstream land and downstream incremental land. The upstream union remains
a useful subtotal. The complete downstream total and its upstream subtotal must
not be added together.

**Open accounting** beside a completed group shows the saved per-pollutant
quantities, valid-cell coverage, selected-cell partition and mass reconciliation.
Baseline and alternative export are reported separately. Signed change, increased
export, avoided export and common-cell baseline/alternative quantities preserve
the same valid support as the original paired analysis. Every accounting area
also appears in the main result table under **Catchment accounting partition**.
Its physical details and available maps use the normal operator controls.

The saved closure records the sum of disjoint partitions, its residual from the
downstream total, valid-cell residual and the floating-point summation allowance.
An area without valid pixels has no numerical export estimate. Coverage remains
specific to the selected pollutant and run.

The complete model exports source-linked accounting records, ordinary quantity
CSV rows and receiving-area GeoPackage features. **Maps and delivery** preserves
these records, the original source plan and the scientific files; the report
includes the group definitions and physical partition quantities. Complete
workspace transfers retain the same analysis identities.

### Scientific interpretation

Nutrient and sediment values describe modeled land export to streams within
the selected catchments. Above-reservoir land is a reporting partition.
Transport, retention and release through a reservoir require additional sourced
modelling. The calculation applies no reservoir retention coefficient.

The model basis is documented in the pinned original guides:
- [InVEST 3.20 NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST 3.20 SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

Nitrogen and phosphorus remain in kg/year and sediment in metric tonnes/year.
The native output's mass-per-pixel basis and retained pixel area govern each sum.

### API selection

The existing receiving.water.analyze request accepts an optional accounting
object with a groups array. Each group contains id, title, parent_receptor_id,
upstream_receptor_ids, reservoir_receptor_ids, references and rationale.
All receptor IDs refer to that request's saved source plan. Reservoir IDs are
a subset of its declared upstream IDs. Group IDs are unique, up to 128 characters,
and use letters, digits, periods, underscores or hyphens with an alphanumeric
first character.

The resulting analysis.accounting retains the normalized groups, original
source relationships, subject IDs by role, selected-cell counts and quantity
closure rows. Accounting subjects use kind=accounting and preserve the existing
metrics interface. Delivery requests that prepare an analysis from a plan can
supply this same accounting object inside receiving_waters.


## Original-feature selection and editable study receiving

Use the original source's field names, native feature IDs and coordinate system when defining or revising receiving waters. The geographic reader preserves the source file; any clipped geometry shown while selecting is a display aid. Saving the plan resolves the chosen IDs against the original retained source again. A published source-area relationship uses its original polygon. An upstream HUC relationship also needs the complete retained catchment network and its actual catchment-ID and downstream fields.

The existing native browser owner can now continue through the editable study controls in the same operation:

```sh
PYTHON -B operator/receiving_water_operate.py \
  --preparation ACTUAL_PUBLIC_WATER_PREPARATION_JSON \
  --output-dir OUTSIDE_WORKSPACE \
  --node ACTUAL_NODE \
  --node-modules ACTUAL_NODE_MODULES \
  --chromium ACTUAL_CHROMIUM \
  --editable-selection
```

For an already-running operator, set `"editable_selection": true` in its existing private browser-control JSON. The course opens the original saved plan in Study transfer, verifies its selected root, returns through **Open in Receiving waters**, opens **Revise source plan**, opens the original-feature chooser, operates its native-ID subset control and applies an actual source choice to a disposable form draft, discards that draft, reopens the exact original selection, visits every receiving-area edit page, operates the title control and restores it, then saves the unchanged complete selection through the original queue. The original plan remains unchanged. With the same scientific implementation, preparation can reuse its original identity. If the installed engine has advanced, the course records the actual new immutable result and the exact preserved original selection and engine identity; it never relabels that result as the older plan. If the command also selects an actual completed analysis, the same sequence retains its original run cohort, quantities, normalization and accounting choices. It performs the existing map/save/export course and then reopens those revision forms in a fresh browser context. Original native hydrology runs remain the same saved inputs.

The browser records the actual queued task and complete request before submission and resumes an interrupted original task. Source editions and runtime choices remain in the existing operation identity. It captures the real Study, source chooser, applied draft, revision and reopened screens at 1440px and 390px. These screenshots and exact native results are written beside the original map downloads; they are part of the same operating course.

### Render and inspect the outgoing product

Before presenting this app, report, demo or export as ready for a client or prospect, the producing operator must run the exact outgoing edition, look at its actual screens or real screenshots, and operate its important controls. Check the populated Receiving plan and analysis, source chooser, selected records, loading and error messages, long tables, desktop/screenshare and narrow/phone widths, downloads and fresh reopening. Merely capturing screenshots, seeing HTTP200, counting DOM elements or passing source checks does not replace looking at the product.

Use the retained screenshot paths to inspect the actual text, maps, table columns, clipping, overflow, typography and spacing. Repair observed problems in the maintained source, then reopen the corrected edition. Keep the interface plain and industrial: readable tables, consistent spacing, restrained controls and useful labels. Inspect the downloaded HTML/PDF as well as the app before delivering those files. Record the actual viewed artifact and any repaired problem in the existing operation handoff, while continuing source and native integration.

## Compare saved source-plan editions in the same receiving workflow

The original Receiving view can compare two retained plan records before the operator carries a source revision into an analysis. Select the reference and candidate explicitly. The comparison aligns only exact receiving-area identifiers and distinguishes the requested scientific selection from each plan’s retained compiled source/geometry/support information. A new original source body alone does not establish changed geometry. Added and removed identifiers remain explicit; titles never silently join different areas.

The comparison keeps both original records available and downloads its original comparison register. Its analysis handoff changes only the selected plan in the existing retained analysis form; the native run cohort, pollutant selection, weights, normalization and complete accounting settings stay visible for deliberate review. Missing accounting references must be resolved in that original form. Saving continues through the existing queue with actual immutable output identities.

The maintained --editable-selection browser course also opens the actual original/currently returned plan pair (the identical original is an explicitly labeled no-change comparison when no new plan was produced), operates the source comparison and download controls, and reopens the same pair in a fresh browser context. With a retained analysis, it checks the candidate-plan handoff as an unsaved draft before returning to the original numerical study. Exact populated desktop and narrow screenshots remain subject to the owner-directed visual inspection above.


## Continue the original saved-plan report from a received project

A source bank containing changed application files is an overlay, not a complete standalone installation. Start from the application and Workspace retained together in the original complete project archive. Keep the original archive and extracted application intact; apply the current owned source to a receiving copy, using its maintained installer when provided. Preserve a newer owner edition at an overlapping path and compose that exact source before starting the operator. Receiving the same verified source twice should reuse the same staged bytes. It must not overwrite an advancing application while its operator or native writer is active.

Use the actual qualified scientific Python, application directory and restored Workspace paths from that receiving operation. A saved source plan can produce its scientific source and original-area maps without a new numerical hydrology run. From the received application directory, continue the original plan:

```sh
PYTHON -B model/receiving_water_report_cli.py \
  --workspace ACTUAL_RESTORED_WORKSPACE \
  --output OUTSIDE_WORKSPACE/source.json \
  prepare --plan-id ACTUAL_SAVED_PLAN_ID
```

Read that actual command's result. If it fails, repair the reported source, dependency or input seam in the existing receiving copy and resume the same operation. Preserve an already-issued matching process and its output. The immutable source edition is then available to the original Scientific Reports workflow: explicitly open that report alone or add it to the current ordered report, build its PDF/HTML/data export, and reopen the complete delivered project. Current Receiving and Monitoring report controls make replace versus append explicit; the report composer retains the full selected source set.

The editable-study course above follows this original report and restored project. It opens real saved plan and analysis identities, preserves the original scientific selections, and uses the existing preparation queue. Native model execution belongs to the deliberately selected numerical operation; report rendering, source-plan comparison and read-only source impact do not require a replacement numerical case.

For a source refresh, open **Receiving source impact**, choose the saved Source Updates plan, and inspect its related original Receiving plans or analyses. Consumed geometry and catchment inputs are shown separately from retained context. Open the original study to revise its explicit selection; compare the saved plan editions before carrying the candidate into the original analysis form. A recorded successor run is checked against its current completion and saved dependency mappings. The Receiving analysis engine remains responsible for physical support and computation. Detailed interfaces and the read-only download are in `RECEIVING_SOURCE_IMPACT.md`.

The source producer and receiving worker inspect the exact outgoing screens and attachments described by the standing rule below. Return real command results and opened artifact locations to the same operation so the responsible source owner can repair a concrete failure directly.


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
