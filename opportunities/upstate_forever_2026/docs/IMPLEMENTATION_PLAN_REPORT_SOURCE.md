# Saved Implementation plan → scientific report

The Handover tab can publish an existing native Implementation report as an original report source. It uses the same ordered Source Reports composer as Monitoring, receiving waters and other scientific studies.

## Operate the complete workflow

1. Open **Implementation & fieldwork** and the intended saved plan. Save actual field edits through its normal revision control.
2. Open **Handover**. Choose the actual report date and **Native report package**, or select an already retained report. Every report is tied to its original saved revision and date.
3. In **Saved native report editions**, choose **Review whole plan report**. Inspect the report revision, task/site/visit/activity/result counts and the availability of original local attachments. A newer browser draft stays separate from this selected edition.
4. Choose **Register reviewed report source**. The original operator queue retains the operation and its reviewed source identity. If the process is interrupted, resume the existing task. If the response is lost, retry the same task operation.
5. Choose **Open scientific report**. The original Source Reports composer appends this source to its current ordered selection, deduplicates the exact original selector and preserves the other studies and contact details. Review the complete order and use the composer's ordinary preview and render controls.
6. Open the saved scientific edition's HTML/PDF and complete report ZIP. Original plan JSON, native report HTML and CSV tables, the attachment inventory and all available managed attachment bytes travel with the source. The editable plan remains in Implementation.
7. Use the existing complete Project transfer to capture the Workspace. On the received project, open the exact saved Implementation revision and its retained report, then review/register the report again. This reuses the same native source operation. The saved scientific report can also reopen through its own retained edition controls.

A historical native report can be selected while a later browser draft exists. Source registration does not save, discard or overwrite that draft. The completed source task returns to the same Handover review. After a browser refresh, the source review and queued operation remain in the existing plan's local draft record; after a complete Workspace transfer, the original report permits the same review to be reconstructed without browser storage.

## What the source contains

The typed recipe uses `upstate.observed-report/v1` and the original `OBSERVED_CONTEXT` role. Its sections show the selected plan/revision/report date; original tasks, dependencies and progress; separate budget/commitment/actual ledger entries; sites and monitoring design; planned visits and actual field timestamps; activities, samples and custody/evidence references; and original intervention/source references.

Monetary values remain the original integer USD cents. Missing duration, coordinate, date or measurement fields remain unavailable. Original result records are linked in their complete JSON and CSV, preserving units, detection bounds, qualifiers and method/source IDs. No new environmental calculation or completion event is derived from task status.

Every original report member is verified against the native `upstate.implementation-report/v1` manifest and the exact saved plan revision. The native summary and report date are retained. The source includes complete managed local files with their original byte count and SHA-256. A referenced file that was never attached remains a named unavailable reference; it does not become a claimed attachment.

The imported source's metadata contains `report_context_kind: implementation-plan-report` and `implementation_plan` with the original project, report, plan binding, report date and member identities. Source-only sharing carries the complete original report and included attachments. Full Workspace transfer also carries the editable revision history and original managed source bank.

## Native API and CLI

From the application root, use a real retained plan/report ID from `ImplementationStore.list_reports(plan_id)`:

```sh
python -B -m model.implementation_report_source \
  --workspace /actual/workspace \
  --plan-id ORIGINAL_PLAN_ID \
  --report-id ORIGINAL_REPORT_SHA256 \
  --preview
```

Review the returned operation identity, original report/revision and attachment inventory. Register that exact selection:

```sh
python -B -m model.implementation_report_source \
  --workspace /actual/workspace \
  --plan-id ORIGINAL_PLAN_ID \
  --report-id ORIGINAL_REPORT_SHA256 \
  --expected-operation-id REVIEWED_OPERATION_SHA256
```

For an existing mapped-delivery JSON selection, add `--delivery-selection /actual/selection.json` to both calls. All original delivery settings and ordered observed report selectors are retained; this source is appended once. The result supplies the saved `delivery_selection_path`, original bindings, source collection/source ID, report ID and verified output file descriptors.

Python entry points:

```python
from model.implementation_report_source import (
    preview_report_source, import_report_source, get_report_source,
)

preview = preview_report_source(ws, plan_id, report_id)
result = import_report_source(
    ws, plan_id, report_id,
    expected_operation_id=preview["operation_id"],
)
reopened = get_report_source(ws, result["source_key"], result["operation_id"])
```

The native provider exposes POST `/api/implementation/report-source-preview`, GET `/api/implementation/report-source-detail` and the existing queued action `implementation.report-source.import`. A write requires the reviewed operation SHA. Download tickets are reissued from verified retained files whenever the task/source is reopened.

## Receiving and installed dependencies

Use the current cumulative application or the maintained Implementation installer with its current source bundle. The complete component catalogue selects `scientific-report-editions` as an Implementation dependency and includes the native producer, provider and extension descriptor. The existing `openImplementationSourceReport` helper calls the maintained `host.openScientificReport` capability; no alternate compositor or direct core-server route is installed.

The source bank is `implementation/report-context/<source SHA>/`. The immutable identity includes the actual native report member hashes and attachment inventory. Source publication holds the original Workspace lock while copying/importing its source edition; backups therefore cannot capture half-published source state. Each source also holds its own operation lock. Successful replays verify the retained original members and imported object binding before returning the prior operation.

For the existing DD6B receiving course, use the actual plan/report IDs produced by `receive_monitoring_fieldwork.py`. For the existing original Eighteenmile case, use its actual retained WQP plan report. Keep each project's original identity and active scientific source edition. The new whole-plan source complements the separate original observations, Outcomes and QC sources, which can be selected alongside it in their intended reading order.
