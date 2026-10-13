# Monitoring design and field operations in the current application

Operation ECO13-MONITORING-DD6B-20261013. This complete source composition adopts ASTRA-MONITOR12 Monitoring 1.2.0 and joins it to the maintained original Upper Savannah application as edition 1.2.1. The maintained receiving-water planning integration is edition 1.3.0; the original implementation and this earlier composition remain retained.

## Continue directly from a saved water study

A saved receiving-water plan or completed priority-raster analysis now creates a
retained planning source and opens its native Monitoring network. The full
original HUC graph remains intact; context-only catchments have zero weight and
visible, editable candidate exclusions. Actual costs, calendar, stations and
campaign events remain the original Monitoring workflow. See the
[complete installation, methods and receiving guide](../../operator/RECEIVING_WATER_MONITORING.md).

## Open the scientific workflow

Use the existing operator and its current Workspace. Choose **Monitoring design** in the normal navigation. Import the actual retained vector domain and optional original station source by source edition and named entry. Enter their real catchment, downstream and station field names. The original source network retains all geometries, original attributes, complete source files and companions.

Enter the actual planning budget, setup and sampling-visit costs, campaign dates and crew schedule. The original design engine solves the complete source network, prices every sampling round and saves its feasible design or diagnosed outcome. Budget comparison executes each explicitly supplied budget and retains progress through the original frontier job.

Open a feasible saved design and create a campaign. Bind catchments to actual retained source stations before recording collected samples. Field entries retain the source station, planned visit, sample identifier, occurrence time, observations and immutable revision history. Adopting a new design preserves earlier field events and requires explicit reconciliation of incompatible station bindings.

Download the complete field package, readable report or editable Workspace from the same desk. The campaign export includes its selected revision, full calendar and event history under one original monitoring lock. A concurrent revision requires reopening the campaign before another export. The complete Workspace capture also acquires the original operator-session lock so its saved view is captured consistently.

## Native registration

The installed descriptor is `operator/extensions/monitoring.json`. It uses the maintained extension registry, original queue, authenticated reads and native file tickets. Seven actions remain the original implementation:

- `monitoring.network.import`
- `monitoring.design`
- `monitoring.frontier`
- `monitoring.campaign.create`
- `monitoring.campaign.revise`
- `monitoring.campaign.event`
- `monitoring.export`

Passive reads use `GET /api/monitoring` with the actual Workspace key, read action and JSON payload. The original adapter preserves a request identity before submission and reuses it after a lost response. Failed or interrupted work remains an original task that can be resumed in Operations.

For queued exports, the provider retains the selected campaign revision and completed file under that task's output directory. An unchanged resumed operation reopens its original completed file after verifying its byte count and SHA256. A fresh explicit export click starts a new operation and can capture later work. File downloads use the existing task decorator and `/api/file/` transport.

The registered receiving verifier reads actual immutable records, source objects and companions without creating monitoring directories or rebuilding source views. It follows plan, frontier, campaign and event references in the original Workspace. Reads of an empty project leave it unchanged.

## Receive the same project and continue field work

The original native continuation is:

```sh
python -B operator/monitoring_receiving.py \
  --workspace ACTUAL_EXISTING_WORKSPACE \
  --selection ACTUAL_MONITORING_SELECTION_JSON \
  --output ACTUAL_RECEIVING_DIRECTORY
```

The selection file contains the actual `network` source choices and explicit `configuration` accepted by `model/MONITORING.md`. Reuse the existing project's retained sources and planning choices. The original runner imports the complete network, saves the design, creates its campaign, exports the field package and full native Workspace, restores into an independent directory, and revises that receiving copy. It retains progress in `receiving.json` and preserves the sender's campaign.

For operator receiving, download **Complete editable workspace**, then use the original Restore workflow. Open the received Workspace and its retained Monitoring campaign, calendar and field history. Reopening the desk must show the same original network, plan and campaign IDs; a new receiving edit appends its own native revision.

Use the actual existing scientific Python environment. `model/requirements-monitoring.txt` lists the original SciPy, Shapely, PyProj and Fiona requirements. No hosted CI or separate web service is needed.

## Receive original observations with an existing campaign

The same receiver accepts an exact saved `campaign_id` or `plan_id`. It reuses that
original network and design. With an existing `network_id`, supply the explicit
original `configuration`; the older `network` import selection remains supported.
Do not supply a new network/configuration beside an already saved plan or
campaign. Optional retained network/plan IDs must agree with the selected
campaign.

Add `observed_context` to the selection to carry the original observational
source through the complete receiving journey:

```json
{
  "campaign_id": "ACTUAL_RETAINED_CAMPAIGN_ID",
  "observed_context": {
    "source_manifest": "/ACTUAL_APPLICATION/eighteenmile_monitoring_context.sources.json",
    "source_id": "eighteenmile-monitoring-observed-context-20261013",
    "station_mapping": {},
    "title": "Original observations for the saved monitoring campaign"
  }
}
```

Replace the application path and campaign ID with the actual retained values.
An empty station mapping uses exact original station IDs only. If the saved
network uses different IDs, provide the reviewed mapping from each original
source station ID to its actual retained network station ID. The receiver does
not assign stations or move calendar dates automatically.

`source_manifest` imports through `Workspace.import_sources`, including every
original companion. A relative manifest path is relative to the selection file.
Instead, use `source_collection_id` and `source_id` to reuse a source edition
already imported into the original Workspace. Choose exactly one manifest or
collection. To reopen an existing immutable context, the whole context choice
can be `{"context_id": "ACTUAL_SAVED_CONTEXT_ID"}`; that context must bind the
exact campaign revision being received.

Run the unchanged command shown above with an output directory outside the
source Workspace. The receiver retains the following steps in its original
`receiving.json`:

1. Reopen the actual network, feasible plan and campaign, or complete the
   originally supplied design selection.
2. Import/reopen the original observation source, preview the exact station and
   saved-calendar context, save it through the native immutable collection, and
   inspect the saved record and source companions.
3. Export the standalone observed context and the original field package with
   that context attached. Read every exported member and verify its original
   byte count and SHA256, the exact context record and the campaign revision.
4. Capture the complete original Workspace, verify the native archive, restore
   through `model.portable.restore`, and reopen the identical source collection,
   network, plan, campaign revision and observational context.
5. Append the existing independent receiving campaign revision. Reopen the
   saved context against its retained historical revision and verify that the
   sender campaign stayed unchanged.

The output includes `observed-context-preview.json`, `observed-context.json`,
the complete observed source ZIP, the original field package, and the full
editable Workspace archive. `receiving.json` names their actual paths and
hashes, the saved context and original source binding, and the received
independent revision. A feasible completed journey has `summary.complete=true`;
an infeasible original design instead retains its actual `design_outcome`.

Rerun the same command and unchanged selection/output to continue interrupted
work. Completed exports are verified and reused. An unrecorded restore is
adopted only when every original archive member still matches. The source
campaign revision is frozen for this receiving operation; after that campaign
advances, use a new receiving output for the new revision. Later edits in the
received campaign remain independent, while the prior immutable context stays
attached to its original historical campaign revision. Prepare a new context
through the normal Monitoring desk when interpreting a newly revised calendar.

The source document describes observed concentrations, original stream-network
relations and daily gauge context. Calendar overlap is evaluated on the actual
saved dates. Its export preserves that scientific meaning and the full original
source files.

For the actual operator browser continuation, use the existing [Monitoring browser guide](../../source/MONITORING_BROWSER.md) and its maintained `source/run_monitoring_browser.mjs`, with the original preparation opening, completed receiving receipt and actual saved context ID. That driver operates the current desk, same queued exports and an independently registered received Workspace.

## Source composition and current host

The original archive is Drive `1NLDkD5byBTZ2hOYxQio7Uv_KkxgBLQ8d`, 101,834 bytes, SHA256 `7b61ddcf2cb7eef3fd5d89a4f8474e677a3b13ec7b3ef07fd21050844ccf6a5e`. Its complete original member manifest remains `integrations/monitoring/MANIFEST.json`. The installed production cohort was recovered byte-for-byte from ECD1 edition 3, Slack `F0C8KFCT3S9`, whose decoded full source payload SHA256 is `4064517a7a3ca09db90dc3d936413cf07e8af96e4b30e5cb4a3c9c88a91514a8`.

`integrations/monitoring/source_adoption.json` records original and current installed identities separately. The unchanged native network builder, optimization solver and calendar/cost engine remain ASTRA-MONITOR12's complete implementation. This edition changes current host integration, passive receiving, selected export consistency and asynchronous controls.

The complete current files install directly under `opportunities/upstate_forever_2026/` in the public application. Preserve the current extension registry, operator server, other descriptors and moving application source. No shared host replacement is required. On a separately installed current application, compose these complete owned leaves through its existing guarded cumulative assembler, retaining identical files and reconciling any unknown newer edits. Restart the existing operator after the source is composed and reload its browser.

## Scientific report source continuation

The current Monitoring Reports section can prepare a retained scientific report
source from a saved feasible plan or an exact campaign revision. Follow
[the native report-source guide](../../model/MONITORING_REPORT_SOURCE.md) for the
selection, source files and command. This continues the original native export
into the existing ordered scientific report and customer-review delivery.

Receive the complete source cohort: `model/monitoring_report_source.py`,
`model/monitoring_report_cli.py`, `model/MONITORING_REPORT_SOURCE.md`,
`operator/monitoring_report_native.py`,
`operator/extensions/monitoring-report.json`, and
`operator/web/monitoring-report.mjs`, together with the composed current
Monitoring adapter and maintained installer. The component catalogue selects
this family with both Monitoring and observed-context dependencies.

The maintained `operator/install_receiving_waters.py` validates the actual
backend-only provider, file-ticket and restore bindings before its existing
compare-and-write transaction. Its five guarded browser joins preserve current
observed-context reads, water-network navigation, startup readiness and all
other current Monitoring behavior. It preserves the original archived source
and migrations. Complete Workspace transfer takes the report-source root lock
after the existing workspace lock, before capturing any report output or
retained source; preparation does not acquire the workspace lock afterward.
