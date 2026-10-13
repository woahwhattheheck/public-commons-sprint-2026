# Monitoring designs and field history in the scientific report

A saved feasible Monitoring design or a selected campaign revision becomes an ordinary retained scientific report source. The original Monitoring exporter supplies its plan, network, catchment geometry, actual source station points, source editions and companions, calendar, costs, field events and revision history. The existing ordered scientific report renders the source's typed tables and links alongside other retained reports.

The producer preserves an existing saved decision. A campaign selection requires the exact revision displayed when capture begins. Subsequent campaign activity does not change this retained report.

## Meaning of the original source

* **Planning weights and coverage:** the saved target weights, coverage definition, selected search areas and original solver result. A receiving-water source can represent projected contribution-overlap hectares or priority-weighted whole-cell hectares. These are planning quantities, not pollutant measurements, concentration estimates or estimates of monitoring effectiveness.
* **Catchment search areas:** original polygons and ToHUC topology remain intact. A selected polygon is not a surveyed sampling coordinate.
* **Actual station bindings:** retained original point features identify field locations. Ambiguous or unassigned stations remain explicit in the original network and station table.
* **Field events:** original operator-entered records, values, timestamps, notes and sample identifiers remain unchanged. A collected status records collection of a sample; it does not establish laboratory validation, units, detection limits or a concentration conversion.
* **Costs and calendar:** costs retain the original currency and integer-cent planning inputs. Calendar times are local wall times, with the original explicit travel allowance. The report does not infer routes or travel times.

The map displays all original catchment polygons and actual source station points in NAD83 / Conus Albers (EPSG:5070). Selected catchments are dark, covered context gray and actual stations are circles. Original WGS84 GeoJSON is also retained. No centroid or inferred outlet is presented as a station. The SVG is a linked scientific report companion alongside editable geometry and the original Monitoring HTML report.

## Existing operator course

From the original Monitoring desk, choose a saved feasible design or the displayed campaign revision and prepare its report source. The existing operator queue owns execution. Open the completed source in the ordinary delivery editor, keeping other selected reports, and continue the existing scientific report workflow.

The backend action is monitoring.report.prepare. Its backend-only extension uses the existing queue, authenticated file tickets and delivery navigation. Browser and provider code are maintained separately from this producer and use the exact API below.

## Python API

~~~python
from model.workspace import Workspace
from model import monitoring_report_source

workspace = Workspace(actual_workspace_path)
report = monitoring_report_source.prepare(workspace, {
    "plan_id": actual_saved_feasible_plan_id,
    "title": "Selected monitoring design"
})
~~~

For a campaign:

~~~python
report = monitoring_report_source.prepare(workspace, {
    "campaign_id": actual_campaign_id,
    "expected_revision_id": actual_displayed_revision_id,
    "title": "Field history at the selected revision",
    "delivery_id": optional_existing_delivery_id
})
~~~

Supply exactly one of plan_id, campaign_id or comparison_id. A campaign requires expected_revision_id; a plan or saved comparison does not accept it. Title and delivery_id are optional. Omit delivery_id when no existing delivery is selected.

The callable prepare(workspace, selection, *, progress=None) returns the immutable record plus a delivery selection:

~~~json
{
  "schema": "upstate.monitoring-report-source/v1",
  "id": "actual content identity",
  "state": "complete",
  "title": "retained title",
  "created_at": "fixed capture time",
  "selection": {"plan_id": "actual saved plan"},
  "source": {
    "source_collection_id": "actual retained source edition",
    "source_id": "monitoring-design-and-field-history"
  },
  "summary": {},
  "files": [],
  "delivery_selection": {},
  "record_sha256": "retained record checksum"
}
~~~

Files are exact descriptors relative to the Workspace root; the original operator exchanges them for authenticated download tickets.

The callable inspect(workspace, id, verify=True) verifies the retained identity, complete file inventory, native ZIP manifest, original immutable records and imported recipe/companion closure. It returns the immutable report record. catalog(workspace) reads compact completed manifests for the existing operator inventory.

The callable delivery_selection(workspace, source, delivery_id=None) appends the source once to the existing ordered observed_context_sources. It preserves previous sources, keeps the original primary first, preserves other delivery fields and removes an obsolete combined observed binding so normal delivery preparation can bind the new ordered selection. The original saved delivery remains immutable.

Delivery choice is deliberately excluded from the report content identity: one retained source can be used in several deliveries.

## Native receiving CLI

Use the actual existing scientific Workspace and the complete application's maintained Python environment. Select the real saved IDs through the original Monitoring desk or its current native command help.

For a design:

~~~sh
"$PYTHON" -B -m model.monitoring_report_cli \
  --workspace "$WORKSPACE" \
  --output "$OPERATION/monitoring-report-receiving.json" \
  prepare --plan-id "$PLAN_ID" --title "Saved monitoring design"
~~~

For an exact campaign revision:

~~~sh
"$PYTHON" -B -m model.monitoring_report_cli \
  --workspace "$WORKSPACE" \
  --output "$OPERATION/monitoring-campaign-report-receiving.json" \
  prepare --campaign-id "$CAMPAIGN_ID" \
  --expected-revision-id "$REVISION_ID" \
  --delivery-id "$DELIVERY_ID"
~~~

Omit the optional delivery flag when no delivery is selected. A complete JSON selection can instead be passed with prepare --selection ACTUAL_SELECTION_JSON; do not combine it with individual flags.

~~~sh
"$PYTHON" -B -m model.monitoring_report_cli --workspace "$WORKSPACE" catalog
"$PYTHON" -B -m model.monitoring_report_cli --workspace "$WORKSPACE" inspect "$REPORT_SOURCE_ID"
~~~

The optional receiving result must be outside the scientific Workspace. Standard output contains result JSON. Progress and concrete exception stage/type/message go to standard error. Successful prepare also runs the full inspector and includes receiving_verification. Direct execution of model/monitoring_report_cli.py is supported.

Continue the returned delivery_selection through the existing delivery editor or current Workspace delivery API. Scientific formatting and workspace transfer remain with their original maintained owners.

## Retained original closure

Each report is retained below monitoring-report-sources/<report-id>/:

| Member | Purpose |
| --- | --- |
| intent.json | Fixed identity and creation time before capture. |
| native-monitoring-bundle.zip | Original complete Monitoring export. |
| native/ | Every original ZIP member, manifest-verified. |
| history/ | Original immutable plans/networks referenced by campaign history or events, full source bodies/companions and original source manifests. |
| history-records.json | Exact native collection and record inventory. |
| bridge-selection.json | Receiving-water bridge IDs selected for this exact domain edition. |
| receiving-water/<bridge-id>/ | Matching original bridge record, method, support accounting, source geometries and selected raster. |
| monitoring-map.svg | Original polygon/station geometry display. |
| report-source.json | upstate.observed-report/v1 typed report recipe. |
| sources.json | Original Workspace source-import manifest. |
| prepared.json | Completed preparation checkpoint. |
| report.json | Completed immutable identity and file inventory. |

Historical plans and networks preserve the source context of events recorded before a campaign changed plans. Every recipe companion has an exact length and SHA256 in inputs. Human-facing links emphasize the original package, saved design/network, field events, map and editable geometry. The entire original closure remains in the native source edition and full workspace transfer.

A receiving-water match requires both exact domain source collection and source entry; a similar title or geometry is insufficient. Its original area/raster method remains explicit. The report does not relabel these planning quantities as observations.

## Revision, interruption and portability

Preparation acquires .monitoring-report-source.lock before writes. The original native exporter then acquires monitoring.lock, checks the expected campaign revision and captures the bundle. The report producer does not recursively acquire that native lock.

Portable capture takes .workspace.lock, then .monitoring-report-source.lock, followed by the existing other capture locks. The producer never acquires .workspace.lock after its report lock and never performs a workspace backup inside capture.

The fixed content identity includes Workspace ID, selected design or revision, title and producer checksum. Repeating the same request returns the same source; source manifests and capture time remain stable.

A completed native ZIP is recovered if execution stops before the report checkpoint. Its exact design, network, revision, event IDs and manifest are verified before reuse. Later campaign activity cannot replace that captured history. If no complete bundle was captured and the campaign head changed, the original exporter rejects the stale revision so the operator can select the intended current one.

ZIP validation covers every member and rejects duplicate/nonportable names. Extraction preserves full bytes and rejects changes to retained files. Source import verifies the original recipe and every companion. Ordinary full workspace transfer already recursively includes this folder, source objects and application code; the maintained capture lock supplies consistency.

Dependencies are the existing Monitoring scientific environment and pyproj for the original geometry map. The complete Monitoring descriptor, report-source consumer and export APIs must be installed together. Source preparation does not call the optimizer or create another Workspace.

## Saved budget comparison in the same scientific report

Open and save the comparison in **Monitoring → Saved budget choices**, then choose that exact saved comparison in the existing scientific-report panel. The same queued `monitoring.report.prepare` action accepts:

~~~python
report = monitoring_report_source.prepare(workspace, {
    "comparison_id": actual_saved_comparison_id,
    "title": "Regional monitoring budget choices",
    "delivery_id": optional_existing_delivery_id
})
~~~

The original native entrypoint also accepts:

~~~bash
python -B model/monitoring_report_cli.py --workspace ACTUAL_WORKSPACE \
  --output OUTSIDE_WORKSPACE/result.json prepare \
  --comparison-id ACTUAL_COMPARISON_ID --title "Regional monitoring budget choices"
~~~

The returned report record uses the original report store, source collection, authenticated downloads and ordered scientific-delivery selection. Its `summary` contains `comparison_id`, `frontier_id`, `network_id`, `baseline_plan_id`, ordered `plan_ids`, `plan_count`, selected `context_ids`, original `weight_basis`, complete comparison `rows`, catchment/station counts and retained receiving-water bridge IDs.

The report displays every original budget outcome, exact currency and integer-cent cost, source-weight coverage, baseline delta, added/removed/retained search areas and complete saved calendar. Feasible plans include maps rendered from the original native polygons and source-station coordinates. Infeasible or interrupted outcomes retain their actual status and unavailable numerical results.

Each selected observed context retains its exact source edition and period, explicit station mapping, flow scope and historical campaign revision. The report links the complete context HTML and JSON; all original context tables and source bodies travel as report companions. Source-station counts within selected catchments describe search-area support. The saved campaign remains the authority for actual field bindings.

The complete original comparison ZIP and every member are retained, hashed and streamed into the report source. Inspection reopens the saved native comparison, frontier, network, every original plan and selected context, then compares the captured complete records. The existing report-source verifier and full Workspace backup/restore carry this same editable project. The comparison producer never recalculates the optimizer, alters a plan or advances a campaign.

### Report members

| Member | Contents |
|---|---|
| `native-monitoring-comparison.zip` | Original complete comparison export with its own manifest. |
| `native-comparison/` | Every original packet member, including source bodies, observed reports and exact plans. |
| `maps/<plan-id>.svg` | Map of each feasible plan using original source polygons and station points. |
| `comparison-records.json` | Exact comparison, frontier, network, plan and context identities. |
| `receiving-water/` | Existing same-domain water-study provenance and original files, when applicable. |
| `report-source.json` | Typed original scientific-report sections and links. |

The unchanged original plan/campaign report path remains available. Older saved reports are inspected using their retained source editions. The new comparison helper's full source digest participates in the preparation identity, so a formatter change produces its own report edition.

For this report kind, the scientific composer uses the prepared per-plan observed sections. It preserves every nested original companion while skipping its separate single-published-study concentration inference, which cannot combine distinct study editions into one source. Other original report kinds retain their current enrichment behavior.
