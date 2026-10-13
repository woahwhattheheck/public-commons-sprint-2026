# Report review to editable fieldwork

The existing client briefing records questions, decisions and follow-up actions against exact pages of its original client report. The Implementation desk now receives that exported meeting file into a saved working plan. Each selected entry retains the original report, page index and notes beside its editable task.

## Operate the complete workflow

1. Open an existing client delivery and its customer briefing. Use Meeting notes to record the actual question, decision or action, owner, due date and status. Export the meeting JSON.
2. Open Implementation & fieldwork and the existing plan, or create a new plan and enter its actual start date. Open Source selections and choose Receive briefing follow-up.
3. Select the saved client report. For an exported delivery, choose Report from an exported delivery and supply its unchanged client-report-model.json and client-report-briefing.json. Choose the exported meeting-notes JSON.
4. Choose Preview follow-up. An unsaved working draft is saved through the ordinary native operation first. The preview identifies the original meeting, report page, selected entries, owners, source due dates, status, new tasks and differences preserved from the working plan.
5. Actions are selected initially. Select a question or decision when it should also become explicit work. After changing the selection, preview again. Receive reviewed follow-up saves the exact source selection and tasks together in one native plan revision.
6. Open Work plan and enter actual durations, dependencies, field methods and cost estimates. Each task keeps the original entry and report page. Original questions and decisions remain in the complete attached meeting file.
7. Use Native report package or the portable HTML report. The Report review follow-up section shows current owner/status, source due date and exact report/page/source identity. Task CSV includes source_due_date and briefing_entry; portable JSON keeps the complete source and revision metadata.
8. Transfer the complete Workspace through Transfer and restore. The ordinary Implementation attachment and revision checks carry the three original files and saved plan history. Reopen the same plan revision, report and source downloads.

Plain language for Tim: “The decisions and actions recorded while reviewing a report become work your team can assign and continue, with the exact report page and original meeting file still attached.”

## Date, status and quantity meaning

A meeting due date is a deadline recorded in the source notes. It is retained as source_due_date and in the task notes and report. It does not become start_not_before, duration_days or a new model date. Working durations stay unknown until entered. The working calendar continues to calculate its original schedule from the entered durations and dependencies.

Source open maps to planned, in-progress to in_progress, and complete to complete. Newly received complete actions use 100 percent progress; other new entries start at zero recorded progress. Subsequent explicitly edited progress remains with the working task. Report quantities, map values, scientific units and cost estimates are not recalculated by this importer. The workshare fee and an implementation cost ledger retain their separate scopes.

## Revisions and returned notes

Task identity binds the original report SHA256 and meeting entry ID. A revised note updates fields still equal to the previous generated values. Later task edits, additional fields, dependencies, evidence, local task deletion and current observations remain preserved, with each difference listed in the preview and saved receipt. Deselecting or removing an entry does not delete or cancel previously created work.

Receiving an exact previously received source/selection reopens the current working plan. It does not roll tasks back to an older meeting file. A changed report has a different identity; its follow-up does not silently replace work from the earlier scientific edition.

Every receive is bound to the exact saved plan revision, original source bytes and selected entry IDs. If the working plan advances after preview, the user previews that new revision. Interrupted submission resumes the original queued operation. If the native commit completed but its final reply was lost, the helper reconnects the already committed revision and does not append duplicate tasks.

## Native APIs and queue

model.briefing_implementation provides:

- delivery_catalog(workspace): small saved delivery choices.
- delivery_sources(workspace, delivery_id): verified original report model and retained briefing index.
- source_bundle(report_path, index_path, notes_path): exact source validation and original slide/table context.
- preview(workspace, document, report_path, index_path, notes_path, selected_entry_ids=None): complete source/working-plan preview.
- receive(..., expected_operation_id, actor=""): one native revision with the original source attachments.

The original historical briefing index is used directly. Page numbering is never reconstructed with a later renderer. Every indexed report section and table range is checked against the original report model.

Registered operations use the existing Implementation provider and queue:

- GET /api/implementation/briefing-catalog.
- POST /api/implementation/briefing-preview.
- action implementation.briefing.import, also available through POST /api/implementation/briefing-import.

Preview and import take plan_id, revision, notes_upload_id and either delivery_id or both report_upload_id and index_upload_id. Optional selected_entry_ids names exact meeting entries. Import also supplies the preview's document_digest and briefing_operation_id. Raw filesystem paths are not accepted by the browser adapter.

## Continue an actual retained meeting file

From the fixed current application, use the actual saved Workspace, plan revision and report delivery:

    python -B source_tools/receive_briefing_followup.py \
      --workspace ACTUAL_WORKSPACE \
      --plan-id ACTUAL_PLAN_ID --revision ACTUAL_REVISION \
      --delivery-id ACTUAL_DELIVERY_ID \
      --notes ORIGINAL_MEETING_NOTES.json \
      --output NEW_PREVIEW.json

Choose exact entries with repeated --entry ORIGINAL_ENTRY_ID. Add --apply to receive the selected original notes. For a delivery supplied as files, replace --delivery-id with --report-model ORIGINAL_CLIENT_REPORT_MODEL.json --briefing-index ORIGINAL_CLIENT_REPORT_BRIEFING.json. Output files are created once; continuing the original operation uses a new output filename while native source and task identities remain stable.

The complete source files are unchanged attachments under the existing plan. No separate server, duplicated task queue or model execution is introduced. The normal client-report and fieldwork owners retain their original workflows.

## Original utility source briefings

The same saved-report chooser includes completed Regional watershed source exports. Their explicit source-context report retains original watershed membership, observations and methods. Open its offline briefing from utility-watershed-packet.zip, record the actual review, and receive the resulting meeting file through the same plan preview and revision. Native callers use --source-export-id; exported files use the original source-context-report-model.json and source-context-report-briefing.json. See [UTILITY_SOURCE_BRIEFING.md](UTILITY_SOURCE_BRIEFING.md) for the complete original-source journey.
