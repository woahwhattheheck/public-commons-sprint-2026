# Return original field records to their Monitoring campaign

The same Monitoring campaign can now receive reviewed records from its saved Implementation plan. This completes the workflow from a native campaign into editable fieldwork and back into the original campaign history, calendar, report and refreshed field plan.

## Operate the full workflow

1. In Monitoring, select the original campaign and use Update fieldwork from this revision. The source station, field calendar and complete original package remain attached to the saved plan.
2. Open that fieldwork plan. Record actual visit times, sample IDs, collection times, field methods, custody references and observations in the existing forms. Save the native plan.
3. Return to Monitoring and open Return field records to the campaign. Choose the campaign and Review saved field records.
4. Review the exact saved field revision, original visit keys, source stations, sample identities, actual times and original evidence. Expand a record to read its retained values and units. Select the records to return, then review the changed selection again.
5. For a cancelled visit, enter its actual cancellation timestamp with timezone if that time is absent from the saved record. The review retains this supplied time with the original field revision. It does not infer a cancellation time from a scheduled date.
6. Choose Return reviewed records. The existing native queue appends the selected original events, retains a campaign report and refreshes the fieldwork plan. Open saved fieldwork or download the campaign report from the completed result.

Completed sample activities become collected events. They require a completed visit, actual collection time, original sample ID and the campaign's bound source station. Completed visits with inspections, measurements or photographs retain those original activities and observations in a note event. A completed visit without a sample remains a visit note; the campaign's sample-collected state requires an actual sample. Cancelled visits become cancellation events at their recorded time.

Unchanged original campaign samples and previously returned evidence are identified in the review. Planned visits remain visible for completion. A station, design or coordinate mismatch must be reconciled with the original saved source; the return does not create a new surveyed station or move a sample between source catchments.

## Original identity and editable continuation

Each return binds the exact campaign revision, native field-plan ID and revision, complete document digest, chosen entries and actual cancellation annotations. Original activity and observation records retain their values, units, censoring and source fields within each returned event. Existing laboratory records remain part of the same field plan.

The original field_event method owns each campaign mutation. Its existing revision check prevents applying the next event over intervening campaign changes. Its operation ledger reopens an already committed event when a reply was lost. A multi-record return records each resulting event and revision and resumes those exact operations.

After return, the maintained campaign-to-fieldwork importer refreshes the same field plan. A verified return reconnects the original local activity ID, so its sample and observation references remain together. The merge compares generated fields against their saved original values and preserves later local edits and additional fields. An unrecognized ID collision still reports a source mismatch. Earlier native event history and original field revisions remain available.

The updated campaign report uses the original native report renderer at the return's exact final campaign revision. Another agent may subsequently continue the campaign; the retained report and returned revision stay bound to this operation.

## Retained native files

The original Workspace contains:

- monitoring_field_returns/REQUEST_SHA/request.json: immutable reviewed request and selected event payloads.
- monitoring_field_returns/REQUEST_SHA/field-plan.json: complete original saved field plan.
- monitoring_field_returns/REQUEST_SHA/state.json: actual event progress and first failure, if any.
- monitoring_field_returns/REQUEST_SHA/completed.json: original final campaign/fieldwork/report identities.
- monitoring_field_returns/REQUEST_SHA/campaign-report.html: the complete report for the returned campaign revision.

The refreshed source packet includes the exact original request and field-plan files alongside campaign, design, network, event/history and publisher sources. Full Workspace capture and restore carries all retained returns. A selected campaign transfer includes the referenced request.json and field-plan.json for each returned event; native receiving validates those original bindings.

## Original command and queue

Read command: campaign.fieldwork.preview-return.

Queued write: monitoring.campaign.fieldwork.return, through the original POST /api/actions route.

The preview takes campaign_id, expected_revision_id, optional plan_revision, selected_entry_ids and event_times. The write supplies the exact reviewed plan_revision, expected_request_id, selected_entry_ids, event_times and its existing operation_id. Native task decoration provides the authenticated report download and saved Implementation item.

For the actual retained native Workspace:

~~~sh
python -B source_tools/return_monitoring_fieldwork.py \
  --workspace ACTUAL_WORKSPACE \
  --campaign-id ORIGINAL_CAMPAIGN_ID \
  --campaign-revision-id REVIEWED_CAMPAIGN_REVISION \
  --fieldwork-revision REVIEWED_FIELDWORK_REVISION \
  --output NEW_PREVIEW.json
~~~

Repeat --entry ORIGINAL_ENTRY_ID to choose records. Supply an actual cancellation annotation as --event-time 'ORIGINAL_VISIT_ID=ACTUAL_ISO_TIMESTAMP_WITH_TIMEZONE'. Apply the reviewed selection with --apply --operation-id ORIGINAL_RETURN_OPERATION and a fresh output filename. Repeat the same identities and operation to continue an interrupted return.

Source plans, completed native simulations and original cost estimates retain their existing scientific meanings. This workflow records actual field evidence and its return to the original campaign.
