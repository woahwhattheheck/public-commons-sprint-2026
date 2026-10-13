# Ecosystem Sciences — monitoring design and field operations

**ASTRA-MONITOR12 · original source 1.2.0 · current integration 1.3.0**

A complete additive workstream for the original Upper Savannah scientific
Workspace: source-bound hydrologic coverage, constrained monitoring design,
editable campaigns, source-station binding, complete field calendars, retained
sampling history, reports and original-workspace handover.

The overlay is installed into the original `opportunities/upstate_forever_2026/`
application. It does not create a second application, replace the scientific
models, or rewrite another owner's operator server, source collections, metadata,
ensemble, allocation, experiment or report modules.

## Install into the existing source composition

For the maintained current application, receive the complete source and use
`python -B operator/install_receiving_waters.py --root . --check`, then the same
command without `--check`. This composes the registered receiving-water →
Monitoring workflow while preserving current host joins. Its complete source,
weight-method, candidate-scope and transfer instructions are in
[`operator/RECEIVING_WATER_MONITORING.md`](../operator/RECEIVING_WATER_MONITORING.md).
The archived installer instructions below describe the retained original package;
do not copy its historical runtime over the maintained current application.

Python 3.10+ and the geospatial/scientific dependencies in
`requirements-monitoring.txt` are required. Reuse the original application's
existing environment when these are already installed.

```sh
python install_monitoring.py /absolute/path/to/original/source --check
python install_monitoring.py /absolute/path/to/original/source
```

The installer accepts either the application directory (containing `model/` and
`operator/`) or its full repository root. **The current shared ECSA extension host
is the preferred integration.** When it is already installed, this overlay adds
`operator/extensions/monitoring.json` and the owned modules. It does not add a
second shared-host implementation or another queue. It uses the host's existing
`.locks/extension-install.lock` while composing.

On an application with our earlier direct monitoring joins, the installer removes
only those exact hooks and keeps the other desks and shared registry intact.
Fresh installation, repeat installation and unchanged 1.0.0/1.1.0 source upgrades
are supported. Preimages are retained; unrecognized concurrent source is not
silently overwritten. Install the existing cumulative extension host before this
registered desk. The host source itself is maintained and delivered by ECSA, not
bundled or replaced here.

For an earlier original app without a registry, a compatibility installation joins
its `Operator._invoke`, action allowlist, authenticated read handler, file-ticket
decorator and browser navigation. Rerun this installer after adopting the shared
host to migrate those direct hooks. The older package-based `route_action`/static
operator has its own compatibility join.

**Monitoring design** is a normal navigation view. All seven writes execute in
the original task queue; passive reads use `/api/monitoring`. Downloads use the
original `/api/file/<ticket>` path. The registry supplies the original authorized
API client and workspace identity. Styles are external, shadow-scoped grayscale
CSS, preserving the original Content Security Policy. The registered receiving
verifier checks monitoring records and retained source bindings within the
original workspace receiving flow.

Switching views and source-catalog refresh preserve unsaved controls. A failed
campaign-creation response retries the original mutation, even when the form
creates another UUID on the retry click. Completed shared-source operations
refresh the retained-source choices without discarding the current design draft.

## Start with retained sources

Import native domain and station vectors through the existing Sources workflow.
The current Workspace stores **source editions containing named entries**. Call
`monitoring.network.import` with `domain_collection_id` and `domain_source_id`;
optional station inputs have their own `station_collection_id` and
`station_source_id`. Omitted station edition defaults to the selected domain
edition. The browser's source-edition selector supplies actual retained entries.

GeoJSON, GeoPackage, Shapefile with sidecars and gzip-compressed ESRI JSON use the
installed Fiona/GDAL reader. Source coordinates are transformed to WGS84 for
geodesic planning and map display. The native CRS, driver, layer, fields, source
edition, named entry, complete original bytes and companions remain retained.
Select `domain_layer`/`station_layer` where the native source has multiple layers.

Supply the actual field names. Defaults `huc12`, `tohuc` and `site_no` are
mappings, not declarations about the original 217-HUC source. String IDs retain
leading zeroes. External downstream IDs remain explicit; no edge is inferred
from map adjacency. Invalid topology and ambiguous point-to-catchment joins are
reported. A `station_assignments` choice can resolve a boundary ambiguity only
to a source polygon that covers that point. `station_outlet_field` must contain
an actual Boolean assertion; textual values are not treated as verification.

## Design, price and schedule one complete campaign

The visible form covers budget, site count, setup/visit costs, overhead, dates,
round interval, round completion window, crew count and travel allowance. The
advanced JSON editor adds required/excluded catchments, stratum minima,
incompatible pairs, network separation, site-specific costs, eligible existing
stations, weekday/month restrictions, blackout dates and solver options.

Costs are explicit operator inputs in exact integer cents. No market prices are
invented. Each candidate's total is setup plus **every planned sampling round**;
programme overhead is added once. Existing external station costs are not
silently charged or declared free: include programme-funded baseline costs in
overhead. Minimum and maximum site counts are constrained by the actual shortest
round's available crew slots, including a truncated final round.

`coverage_mode=local` optimizes weighted catchment-level planning presence.
`coverage_mode=outlet_context` optimizes potential upstream context at prospective
outlets. A retained existing station contributes upstream context only when its
source explicitly marks verified outlet placement; otherwise it contributes
local presence. Both modes require an explicit `existing_station_ids` selection.

Target weights are geodesic source area by default. A nonnegative finite
`priority_field` can instead use a field from a retained model/ensemble-derived
GeoJSON. Retain that complete joined source in the original Sources workflow.
The Receiving waters desk can now prepare this source directly from a saved
plan's contribution-area union or an actual completed analysis priority raster.
It retains the full original HUC graph, including zero-weight context catchments,
and visibly prefills candidate exclusions in the existing design form. The method
records exact vector overlap separately from raster centre support, original
normalization and missing/unassigned coverage. Open the saved planning source's
network, review its exclusions and enter the actual costs and calendar. See the
[complete water-study workflow](../operator/RECEIVING_WATER_MONITORING.md).

Changing priorities creates a new network edition; earlier designs remain pinned
to their original source. Coverage is a planning objective, not an inference of
measured contaminant concentration, measurement sensitivity or pollutant removal.

The MILP maximizes weighted coverage subject to full campaign budget, site
counts, eligibility, stratum minima, source graph separation and explicit
incompatibilities. A second solve minimizes cost while retaining primary
coverage. Infeasible designs retain diagnostics. Time-limited feasible
incumbents keep their solver status and gap rather than becoming “optimal.”
Exact post-solve checks recompute selected IDs, graph coverage and integer-cent
budget feasibility from the discrete solution.

A budget comparison executes every supplied budget. Completed designs are saved
as they finish. Repeating the identical request resumes the same frontier,
reuses completed budgets, and repairs the gap between an immutable plan save and
its progress-head update after interruption. `monitoring.frontier.progress`
reports every completed plan ID. Frontier jobs use their own locks so field
recording is not blocked by another budget solve.

The calendar uses local wall-clock dates and times, explicit crew duration and a
stated per-visit travel allowance. It is not a road-routing model. A round with
no valid field dates is diagnosed; visits are never silently omitted or pushed
outside the declared campaign.

## Record field work without losing history

Create a campaign from a feasible saved design. Every campaign mutation appends
a native immutable revision and changes its head under the original lock helper.
Supply `expected_revision_id` to prevent lost updates and a stable `operation_id`
when retrying a client operation. Replaying the same operation returns the
original result; reusing its ID with a changed payload is an error.

The selected GeoJSON polygons remain **catchment search areas**. The application
does not invent surveyed sample coordinates from polygon centroids. Bind a
selected catchment to an actual retained source station before recording a
collected sample. Outlet-context designs require the bound source station's
outlet verification. This distinguishes planning locations from source-observed
points while leaving planning and design available immediately.

Field records support collected, missed, cancelled and note events, timezone-
qualified occurrence timestamps, sample IDs, free-text notes and JSON values.
Collection events require a sample ID and source-station binding. A sample ID
cannot be silently reused on another planned visit. Events are pinned to their
plan, network, source and visit; adopting a revised plan retains all older events
without misapplying them to the new calendar. Changes and corrections remain
append-only. A later source-station rebinding never relabels an already recorded
sample: `station_id` preserves that event's actual binding, while
`planned_station_id` shows the current plan. Future unsampled visits use the new
binding. Both fields are included in the complete calendar CSV.

## Full exports and independent receiving

The field bundle includes every source catchment polygon, every retained source
station point, the complete network/plan, selected sites, all planned visits, all
field events, campaign revision history, complete selected native source bodies and companions,
native source-edition records, SHA256 bindings, a complete HTML report and a member
manifest. CSV cells that could be interpreted as formulas are escaped; JSON
remains lossless. Report content is HTML-escaped. The source-derived tables and
exports are complete, not samples of the first page.

Use **Complete editable workspace** (`monitoring.export`, `format=workspace`)
for independent receiving. This delegates to the original `Workspace.backup` and
its `model.portable.backup`; receiving uses `model.portable.restore`. Original
application code, source objects, model work and monitoring collections travel
in that existing archive. The native operator writes archives below its own
`outputs/monitoring`, **outside the workspace**, so earlier backups are not
nested into later ones. The CLI uses a sibling export directory by default.

A field bundle is a complete review/field exchange for its selected design; a
full native workspace archive is the independently editable project. Use the
intended recipient's project when exporting a complete workspace, since that
archive includes its other retained material too.

## CLI and API

From the original source root:

```sh
python -m opportunities.upstate_forever_2026.model.monitoring_cli \
  --workspace /absolute/private/workspace capabilities

python -m opportunities.upstate_forever_2026.model.monitoring_cli \
  --workspace /absolute/private/workspace network.import --params network-input.json

python -m opportunities.upstate_forever_2026.model.monitoring_cli \
  --workspace /absolute/private/workspace design --params design-input.json \
  --output complete-design-response.json
```

`API.md` documents every command and the original-server envelope. CLI output is
complete JSON; response files are optional. The same module also runs from the application directory as
`python -m model.monitoring_cli`.

## Receiving in the actual original application

The included continuation-capable runner consumes an existing original
Workspace and actual selected source IDs. Its selection file has a `network`
object (the intake parameters), an explicit `configuration` object (the planning
choices below), and optional `title`. It creates the source-bound network,
solves/saves the campaign, exports through the native archive writer, receives
that archive into a new directory and independently edits the receiving copy.

```sh
python operator/monitoring_receiving.py \
  --workspace /absolute/existing/workspace \
  --selection /absolute/monitoring-selection.json \
  --output /absolute/new-receiving-directory
```

Repeat the exact command after interruption; recorded network, plan, campaign,
archive and receiving identities are reused. Changed selections require a new
output directory. No observation or field collection is invented by this runner.

## Engineering execution in this delivery

Twelve substantive checks cover the exact optimizer versus exhaustive search,
full-calendar capacity, source geometry/topology, exact money, campaign replay,
revision conflicts, historical sample-station custody, complete exports, frontier checkpoint recovery, native
source-edition custody, projected GeoPackage/gzipped ESRI reads, native file
adapters and installation. A 512-catchment authored workload solved 30 selected
sites and 90 visits. A second source/queue contract fixture deliberately omits
legacy primitive names and stores immutable JSON without an `id` field, matching
the current native contracts read from the maintained source.

```sh
python tests/test_monitoring.py
python tests/test_native_contract.py
python tests/browser_journey.py
python tests/native_browser_journey.py
# Use the actual registry from the receiving cumulative source:
python tests/shared_registry_journey.py /absolute/current/operator/extension_registry.py
```

Both Chromium action journeys pass with no page errors: open → create campaign →
bind retained station → append field event → download complete package → reopen.
The native-transport journey also tests source-edition selection and preservation
of an unsaved draft across view switches and source refresh, plus an intentionally
lost creation response that replays into one saved campaign. The shipped service/optimizer and
browser transport execute against explicit storage/HTTP contract fixtures.
Direct loopback navigation is restricted by this container's browser policy, so
bootstrap, asset loading and API calls are bridged to the local test server.
These executions are component/contract journeys on authored inputs; the included
original-application receiving runner is the separate full-product entrypoint.

The actual ECSA registry received through the shared Drive source carrier was
also executed with these monitoring modules: all seven actions registered with
zero issues; source reads, network/design/campaign, native ticket decoration and
receiving verification completed. That registry file's SHA256 is
`ae573df9f2ad99307f34b8638ffe430b215670caecf6ad8bd669859918acfe5e`.
The registry is actual peer code; its storage/queue harness uses the explicit
current-contract fixture described above. The full regional application and its
217-HUC scientific run remain the cumulative application's separate execution.

Current joins were read from original Workspace `4785867`, common `dc48652`,
server `8434eba9` and portable `720dd74`. This source lineage fixes source-edition intake,
native primitive names, ID-free frontier crash recovery, shared-queue execution,
file-ticket delivery, stylesheet policy and backup placement. The complete
source ZIP and all-member manifest accompany the operating guide.

## Maintained implementation contracts

The geodesic geometry and MILP calls use primary library interfaces:

- SciPy mixed-integer linear programming: https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html
- pyproj geodesic geometry area: https://pyproj4.github.io/pyproj/stable/api/geod.html#pyproj.Geod.geometry_area_perimeter
- Shapely polygon coverage: https://shapely.readthedocs.io/en/stable/reference/shapely.covers.html

Observed local environment: Python 3.13, SciPy 1.17.0, Shapely 2.1.2,
pyproj 3.7.2 and system Chromium. No hosted Actions or paid compute were invoked.


## Current integration 1.2.1

See `integrations/monitoring/RECEIVING.md` for the installed original registry and independent receiving workflow. Campaign exports accept optional `expected_revision_id`; the current browser supplies its selected immutable revision. Queued exports retain that selection and completed native file across task resumes. Full Workspace export uses the original operator-session lock while the complete campaign snapshot uses its existing monitoring lock. Passive catalogue and receiving reads leave absent collections and native source views untouched.

## Retain a programme in the scientific report

After opening a saved feasible design or a campaign revision, use **Use this
programme in the scientific report** in Monitoring's existing Reports section.
Prepare the source from that exact saved selection, then open the existing
scientific delivery form. A selected existing delivery keeps its current report
selection while adding the retained Monitoring source.

The source retains the original native plan, network, explicit costs, station
assignments, calendar and recorded field history. Water-study planning sources
retain their original contribution-area or priority-raster provenance. The original
source companions carried by the native field package remain retained; the
report keeps observational context separate from planned work. Preparation records the
expected campaign revision and preserves the original queued request on retry.

See [MONITORING_REPORT_SOURCE.md](MONITORING_REPORT_SOURCE.md) for the native
command, immutable source contract, saved-source reopening and interpretation
limits. Install the complete current source with
`python -B operator/install_receiving_waters.py --root .`; its existing guarded
transaction composes the report helper into the current Monitoring adapter and
adds the report-capture lock to portable transfer. The backend-only
`operator/extensions/monitoring-report.json` registers the preparation action and
read route through the original shared host. No separate report desk is needed.
