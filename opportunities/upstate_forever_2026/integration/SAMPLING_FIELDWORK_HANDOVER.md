# Sampling requirements through fieldwork and receiving

This guide describes the existing Sampling, Monitoring, Implementation and Study workflows. The application retains the original proposal, the exact saved design, the actual fieldwork edits and the returned evidence as distinct records. TokenJunkieLabs attribution and the original scientific source attribution remain part of the delivered application and reports.

## Open the saved Sampling design

Open the saved proposal in Sampling. Review the original observation context, selected station and cohort, historical evidence window, included targets, requested months and visits, requested laboratory limit and its unit, flow goal and scientist rationale. Retain the full cohort definition: constituent, method, fraction, speciation, units and any additional measurement-support fields. An absent value, an explicit null and an empty string remain distinct.

Prepare the native design with the complete explicit configuration and future calendar. Its required catchments must include the selected targets. Every target must have a retained source-station-to-network-station binding. Conflicting target stations in the same catchment require an explicit reconciliation or separate design; the application does not choose a replacement station.

Use **Open design and field calendar** on the saved Sampling design. This opens its actual returned Monitoring plan ID. A different generic plan, even on the same network, does not stand in for the Sampling result.

The saved Sampling design records the exact proposal and digest, context, network, native plan and digest, original configuration, target calendar and station bindings. The calendar records which native visit keys belong to each target. Scheduled counts and requested analytical limits are planning requirements; they do not establish collected samples, laboratory attainment, high-flow conditions or scientific adequacy.

## Create the campaign and receive it into Implementation

Use the existing Monitoring campaign controls to create a campaign from that saved plan. Review the actual station assignments and retain the campaign revision before receiving fieldwork. Campaign station assignments are separate from the source station requested by Sampling.

The existing fieldwork handoff receives the selected campaign revision into Implementation. It retains the complete original campaign package, network/source records, event history and the exact Sampling proposal/design export. The protected source snapshot contains both the original protocol and the original per-visit assignment.

Repeated handoff of the same retained source edition resumes that edition. A later source edition is merged with the existing Implementation plan, preserving local fieldwork edits and recording conflicts. Read the preserved-change information before using a changed field plan. Do not resolve a conflict by replacing its original source record or deleting an older campaign revision.

For a Sampling plan, the original protocol identifies:

| Record | Purpose |
| --- | --- |
| Recommendation ID and digest | Exact authored proposal and target choices |
| Recommendation design ID and digest | Exact saved solver result and target calendar |
| Monitoring design ID | Original native plan used by the campaign |
| Context ID | Original observational context |
| Requirements | Complete target, station, cohort and calendar rows |
| Protocol ID | Digest of the original protocol body |

Each original visit binding retains its native visit key, actual bound station and the targets whose original calendar includes that key. An explicit empty target list means no Sampling target was assigned to that visit. Missing original assignment does not authorize the application to infer targets from a title, date, catchment or station name.

## Edit fieldwork without rewriting the original scope

Use the existing Implementation editor for the real field plan: sites, monitoring records, visits, personnel, activities, observations and attachments. Save the revision before preparing a crew packet or returning evidence.

The protected source remains separate from locally edited protocol or visit metadata. Crew output shows the original requirement, the current metadata, material differences and the current site's station. It labels station applicability as matching the source station, unbound, or different. A current station change does not rewrite the protected historical assignment.

A manually authored visit without a captured source assignment has no inferred original Sampling target. Malformed or edited local metadata is retained for review; the packet labels unverified scope rather than pretending it is the original proposal. Ambiguous or broken protected provenance is visible and must be reconciled through the original source history.

The readable field/laboratory scope includes the original constituent, method and method context, fraction, speciation, unit, measurement support, requested limit and basis, months, planned visits and rationale. Preserve the complete original records alongside those readable fields. Laboratory results and actual field events must retain their own observed values and units.

## Prepare and use the crew packet

Select the exact saved Implementation plan revision and intended visit IDs. Preview the existing crew packet, inspect the selected visits and coordinate information, then prepare with that preview's exact ID.

The packet retains its original plan/revision, selected records, selection and preparation metadata; readable crew HTML; the offline field workbench; sites and visit exports; calendar; coordinate inventory; and original attachments. Where Sampling scope is present it also includes:

- `sampling-protocols.json`: protected source, original visit binding, current metadata and current applicability.
- `sampling-requirements.csv`: readable per-visit target and laboratory scope.

Open `crew-packet.html` and the delivered `field-workbench.html`. Inspect the actual visits and station labels, the human requirement tables and the preserved edits. Open the CSV and JSON companions, the calendar and every relevant original attachment. The calendar describes proposed visits; it does not create a collected event.

The crew packet identity pins the Sampling helper when it contributes to the output. A changed helper or plan revision requires a new matching preview. Completed packets and their original source/history remain inspectable.

## Return actual field evidence

Use the existing Monitoring field-return preview against the saved Implementation revision and expected campaign revision. Review the actual selected entries, event times, station, sample ID, activity, observations and source scope. Resolve any `needs_review` rows before returning. Retain the preview request ID and the original operation ID for retries.

The return uses the reviewed selection and appends original native campaign events. If the campaign or field-plan head has advanced, reopen and review the current state instead of applying a stale selection. If a response is lost, resume the same request, arguments and operation; do not manufacture a second sample.

### Samples already returned before Sampling scope was attached

An existing collected sample remains historical evidence. Adding current Sampling requirements later does not mean those requirements were included in the original return and does not justify another event.

The preview can show an entry as `already_returned`, with its original evidence ID. When `protocol_in_previous_return` is false, the current protocol was not included in that prior return. Read this as **sample already returned; current Sampling scope was not historically included**. The original event is retained unchanged and the row is not offered as a new return.

An unchanged original campaign sample is also distinguished from newly authored fieldwork. Local edits, current requested scope and historical observed evidence must remain distinguishable in the report and archive.

## Reports, complete exports and cold restore

Export the existing Monitoring report or bundle from the selected native plan or campaign revision. Sampling material in that export includes the exact original design, full proposal history, original source binding, observational context and retained native evidence. The selected-design export follows the chosen design rather than silently substituting another result belonging to the same proposal.

Use the original whole-Workspace handover for the complete editable workbench. A selected Study is useful for a bounded transfer: select the actual Sampling recommendation design and the existing relevant campaign/Implementation source through the current Study controls. Preserve the exact original root selection and archive receipt.

For an Implementation scientific source, the typed transfer follows the protected campaign snapshot. Its captured Sampling protocol must equal the protocol resolved from the original Monitoring plan, and the transfer includes the exact `monitoring_recommendation_designs` dependency. Existing visitors retain proposal ancestry, context, network, plan, sources and native evidence. Older snapshots without Sampling protocol fields retain their original admission behavior.

On a separate receiving directory, restore with the original Workspace or selected-Study import flow and reopen the application supplied with that delivery. Open the same saved proposal/design, campaign, Implementation plan, crew packet and retained return. Confirm that the original source protocol and current edits remain distinct, attachments open, and an already returned sample is still historical. Resume only through the existing native operations. Do not recreate a missing original design with current solver settings or infer station/source IDs during restore.

## Verified native interfaces

Run these from the application root with its existing Python environment. Replace the placeholders with the actual saved IDs and absolute paths. These are source-verified interfaces, not a claim that this guide executed a native course.

Sampling exposes its original CLI:

```sh
"$PYTHON" -B -m model.monitoring_recommendations --workspace "$WS" catalog
"$PYTHON" -B -m model.monitoring_recommendations --workspace "$WS" inspect --request "$INSPECT_JSON"
"$PYTHON" -B -m model.monitoring_recommendations --workspace "$WS" design --request "$DESIGN_JSON"
"$PYTHON" -B -m model.monitoring_recommendations --workspace "$WS" export --request "$EXPORT_JSON"
```

The inspect/export request selects `recommendation_id`. The design request contains `recommendation_id`, the complete original `configuration`, a retained `operation_id` and optional `title`. Use the resulting saved design and its plan ID.

Crew packet preview, preparation and inspection use the existing CLI:

```sh
"$PYTHON" -B -m model.field_deployment --workspace "$WS" --plan-id "$IMPLEMENTATION_PLAN" --revision "$REVISION" --visit "$VISIT_ID" --title "Field crew packet"
"$PYTHON" -B -m model.field_deployment --workspace "$WS" --plan-id "$IMPLEMENTATION_PLAN" --revision "$REVISION" --visit "$VISIT_ID" --title "Field crew packet" --expected-id "$PREVIEW_ID"
"$PYTHON" -B -m model.field_deployment --workspace "$WS" --plan-id "$IMPLEMENTATION_PLAN" --inspect-id "$PACKET_ID"
```

Repeat `--visit` for each selected visit. The plan ID here is the Implementation plan, not the Monitoring native plan.

The existing application uses these native interfaces; there is no separate campaign CLI asserted by this guide:

- `MonitoringWorkspace.create_campaign(plan_id=..., title=..., operation_id=...)`
- `MonitoringWorkspace.revise_campaign(...)` and `field_event(...)`, with their original explicit revision and operation contracts.
- `monitoring_implementation.receive(service, campaign_id=..., expected_revision_id=..., operation_id=...)`
- `monitoring_field_return.preview(service, campaign_id=..., expected_revision_id=..., plan_revision=..., selected_entry_ids=..., event_times=...)`
- `monitoring_field_return.receive(service, campaign_id=..., expected_revision_id=..., plan_revision=..., expected_request_id=..., selected_entry_ids=..., operation_id=..., event_times=...)`
- `MonitoringWorkspace.export(campaign_id=..., expected_revision_id=..., format="bundle")`, or the mutually exclusive native `plan_id` export. Supported formats are `bundle`, `workspace` and `html`.

## Producing the outgoing application

Deliver this feature in the cumulative application and existing working projects. Preserve active operations, completed outputs, original attachments and current source owners. A feature supplement alone is not the complete workbench.

The producing operator must open, render, LOOK at and use the exact outgoing application at desktop/screenshare and narrow widths, including the populated Sampling result, original calendar, editable field plan, crew packet and return preview. Open and use every outgoing attachment in its recipient-facing viewer; view the actual PDF pages, CSVs, maps and downloaded HTML, extract archives and reopen the delivered project. Repair the affected unreadable or broken result before presenting it. Source review, HTTP status, DOM counts, screenshots that were not viewed, or another reviewer's approval do not substitute for this work.

Retain the exact outgoing source/artifact identity and a concise account of the actual screens, controls, attachments and cold reopen used. Clearly distinguish completed native/visual work from source-only inspection; do not invent execution or acceptance.

Carry the complete current instruction files with the application and source handover: repository `AGENTS.md` (rendered-product instruction version `2026-10-13.1`) and `CURRENT_OWNER_DIRECTION.md` (version `2026-10-13.4`). Read those original files in full. This guide does not replace or abbreviate them. Preserve scientific attribution, plain industrial presentation, source/copyright controls and the original native operation identities.
