# Regional Monitoring: original sources to a complete receiving campaign

The regional preparer connects the retained Upper Savannah hydrologic domain and all 87 original assessment station locations to the existing Monitoring component. It saves a native source selection, runs the original network/design/calendar/campaign workflow, exports the field package, and reopens the complete scientific Workspace in an independent receiving directory. The optional native budget comparison also receives its own complete archive containing all frontier plans.

Run it in the same populated scientific Workspace used by the regional progression. The original Monitoring scientific environment needs Fiona/GDAL, pyproj, Shapely, NumPy and SciPy. All imports, network calculations, optimization, scheduling and portable receiving use the existing application methods.

## Complete operation

From the current application directory:

~~~sh
python -B source_tools/prepare_regional_monitoring.py \
  --workspace /actual/scientific-workspace \
  --output /actual/receiving/regional-monitoring \
  --domain-manifest /actual/retained-domain/sources.json \
  --frontier
~~~

The original retained domain manifest has source ID
`upstate-wbd-upstream-domain-20261012`.
If that edition is already uniquely present in the Workspace, omit
`--domain-manifest`.
If several editions contain that source, use
`--domain-collection ACTUAL_COLLECTION_ID`.
The preparer resolves actual retained records and the original feature-bindings companion.

The station manifest defaults to
`source/assessment_2026/assessment/geography-model-sources.json`.
It imports the complete original source edition, including all three station cohorts and their original companion tables, metadata and source responses. Override with
`--station-manifest ACTUAL_MANIFEST` or
`--station-collection ACTUAL_COLLECTION_ID`.
Repeated `--station-source-id` options select an explicit subset of named cohorts.

Additional original editions, such as the Eighteenmile DMR data and four discharge outfalls, can be retained through repeated
`--context-manifest ACTUAL_MANIFEST` or
`--context-collection ACTUAL_COLLECTION_ID`.
For the published original DMR collection, the actual manifest is
`observations/eighteenmile_2023/npdes/model-sources.json`.
Its full original edition becomes source context and accompanies the station planning edition and portable Workspace. Discharge outfall locations remain discharge features.

## Join the same full regional progression

Prepare the selection before starting the existing single receiving operation:

~~~sh
python -B source_tools/prepare_regional_monitoring.py \
  --workspace /actual/scientific-workspace \
  --output /actual/receiving/regional-monitoring \
  --domain-manifest /actual/retained-domain/sources.json \
  --context-manifest observations/eighteenmile_2023/npdes/model-sources.json \
  --prepare-only

python -B source_tools/receive_regional_progression.py \
  --workspace /actual/scientific-workspace \
  --operator-state /actual/operator-state \
  --output /actual/receiving/regional-progression \
  --monitoring-selection /actual/receiving/regional-monitoring/monitoring-selection.json \
  --opening /actual/retained-regional-opening.json \
  --video
~~~

The progression invokes the original Monitoring receiver in the same Workspace before its final whole-project transfer. It checks the actual native design completion state. It preserves an infeasible or limited native result and its diagnostics in the original receiving journal instead of recording campaign completion.

The named budget comparison is optional. The standalone preparer `--frontier` path operates the original resumable frontier and then makes an additional complete archive/receiving copy containing every comparison plan. The full regional progression uses the prepared primary campaign selection.

Use the same output directory to continue the same exact source/configuration selection. A new planning policy or selected source edition uses a new output directory, keeping the earlier operation and independently editable receiving copies intact.

## Original source identities and coordinate handling

The default domain is the complete original 217-HUC12 native Esri polygon source in EPSG:3857. Its reviewed decoded SHA256 is
`2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`.
The original source edition supplies the HUC12 and ToHUC field names through `feature-bindings.json`, preserving field case and leading zeros. Native network IDs must match the original selected-HUC list. Original ToHUC edges, external downstream references and the native cycle check remain unchanged.

The three assessment station entries are:

| Original source ID | Stations | Original CRS |
| --- | ---: | --- |
| scdes-listed-stations-wgs84-2026 | 67 | EPSG:4326 |
| scdes-listed-stations-nad83-2026 | 6 | EPSG:4269 |
| scdes-listed-stations-scdes-utm17n-2026 | 14 | EPSG:26917 |

The existing `monitoring_sources.read_source` reader uses Fiona and pyproj to project each complete native cohort into EPSG:4326 with explicit x/y axis order. The adapter verifies the actual native CRS against its declared manifest, preserves every original point and property, rejects duplicate station IDs, and combines these existing planning views into one ordinary native vector source.

The derived source retains every original edition body, original manifest and companion under its original relative filename, together with a per-station lineage index and complete native source records. The original three source editions remain in the Workspace as imported. No original source body or coordinate value is overwritten.

Station IDs come from the declared `site` field. The assessment `listed_huc12` field remains source context: actual native point-in-polygon containment determines Monitoring assignment. Boundary ambiguity, points outside the selected domain and differences from agency assessment labels are listed in the opening's source summary. The preparer does not turn a listed HUC label into a geometric assignment.

No outlet verification field is supplied for these sources. Original station attributes remain available, including the source coordinate collection method and quality tier. The native default catchment weights are geodesic area in square kilometres. Assessment priorities and discharge loads do not become numerical coverage weights automatically.

## Named, replaceable planning policy

The ready input is
`source/monitoring/upper_savannah_winter_2026_planning.json`,
schema `upstate.monitoring-planning/v1`.
Its provenance is “DD6B engineering planning scenario, authored 2026-10-13”.
Use `--planning ACTUAL_PLANNING_JSON` to operate another named policy.

This source-catchment planning comparison uses USD4,800 budget, USD600 fixed overhead, USD250 setup per selected catchment, and USD150 per visit. Three rounds cost USD700 per catchment. The original native integer-cents calculation therefore permits six catchments at the primary budget before any additional source constraints.

The three nominal rounds start 2026-11-02, 2026-11-30 and 2026-12-28. Each has an eight-day window clipped at the explicit campaign end of 2027-01-04, with Monday-Friday eligible and 2027-01-01 excluded. One crew works an eight-hour day with 60-minute visits and a 60-minute travel buffer. The final round has five eligible dates: December28-31 and January4. The native capacity is consequently20 sites per round; the first two rounds have six eligible weekdays.

The fixed costs are engineering planning assumptions for comparing coverage. The calendar is an explicit assumed working calendar. Replace these inputs with commissioned operating costs, field access, actual availability and blackout dates when those editions are available.

This scenario deliberately selects `existing_station_ids: []`. A historical assessment listing does not establish funded, active baseline sampling. To include an actual existing monitoring programme, name its station IDs in a separate planning edition; the original solver checks that every selected station is unambiguously assigned. Unmatched source stations remain visible in the source summary.

The optional original budget frontier uses USD4,800, USD9,000 and USD13,200. With the stated USD600 overhead and USD700 per-catchment total, those budgets allow six, twelve and eighteen sites respectively before joint native constraints. The calendar allows all three comparisons. The selected catchments come from the original native MILP and its physical source network.

## Outputs and recovery

`monitoring-opening.json` records the actual project and operator Workspace key, original domain/station/context collection IDs, native station planning edition, exact selection, planning identity, source bindings, original field mappings and actual source summary. Its artifact descriptors bind the selection, planning file, derived source manifest and summary by bytes and SHA256.

`monitoring-selection.json` is directly consumable by the existing
`operator/monitoring_receiving.py` and the regional progression.

`monitoring-source-summary.json` contains original network and assignment counts, explicit station issues, source-label differences, calendar rounds/capacity and native per-catchment costs.

The ordinary complete run retains `receiving/receiving.json`, the field package, the native Workspace archive and an independently editable receiving project. The original receiving workflow reopens the campaign and creates an independent receiving revision, confirming that the sender's campaign is unchanged.

With `--frontier`, `monitoring-frontier.json` records the native comparison. `frontier-transfer.json` records the later full archive and independent `frontier-received` Workspace; every frontier plan and original source binding is reopened there.

Preparation writes the original request and every staged source/selection atomically. Existing complete prepared output verifies its original byte identities before reuse. Source inputs and the exact planning bytes participate in the request identity. The original native receiver and original frontier keep their own durable checkpoints. A process interrupted after archive restoration can adopt that exact receiving directory only when all original archived members match.

## Application boundaries

This CLI composes the original Monitoring scientific APIs and retained source collections. It is complementary to the receiving-water-study producer, observed-context joins, open-network UI and native source work owned by their existing authors. Its source selection and planning edition can be reused by those workflows.

Run source preparation before the managed regional operator takes ownership of the Workspace, or under the same already coordinated scientific worker. Keep output and archive directories outside the scientific Workspace. The CLI preserves the existing project identity and completes native receiving through the original application.
