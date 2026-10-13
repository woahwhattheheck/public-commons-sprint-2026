# Laboratory results intake

The native Implementation & fieldwork view imports an original laboratory CSV into a saved plan’s existing samples and activities. The operator maps source columns explicitly, reviews every conflict and saves the selected results, source bytes and mapping in one native revision.

## Operator journey

1. Open the original plan in **Implementation & fieldwork**, then **Field records**. Its sites, visits and sample activities must already represent the field collection. Existing browser edits remain available.
2. Choose **Import laboratory CSV**, then select the original CSV or tab-separated file. The existing operator upload service retains and verifies the original bytes. Choose the source delimiter and encoding; **Read original headers again** applies a changed format.
3. Map **Activity ID**, or **Sample ID** with any needed **Site ID** and **Visit ID** selectors, to the existing records. Source identifiers match exactly, including meaningful surrounding whitespace; use an explicit reviewed record override to choose a different binding. Map **Original result text** to a real source column. Map parameter and result type explicitly. Select the original unit, chemical basis, fraction, qualifier, method and QA columns when available.
4. Use **Open mapping JSON** to load a prepared source mapping, or choose each control manually. **Export mapping JSON** retains the complete mapping for another file of the same declared layout. Loading a mapping rereads the original headers with its delimiter and encoding.
5. Choose **Preview laboratory results**. If the plan has unsaved edits, the control is **Save plan and preview laboratory results**; it first uses the original save/import/create queue. Browser edits made while that save runs remain in the draft and require another reviewed save.
6. Review the counts, record decisions and all source issues. The result-type counts describe accepted source rows; append, replace, identical and skip describe decisions, and collection-times-filled counts previously empty activities. The first 200 decisions are shown, and all issues are available in pages of 50 with severity filters. **Export full preview JSON** preserves the complete returned preview, including all issues.
7. For a specific problem, expand **Resolve a specific original data record**. Select an explicit existing activity, name the exact existing observation to replace, or skip the record. Record a reason. Decisions refer to one-based data records after the header, while the preview separately shows original physical line spans. Re-preview after every change.
8. Choose **Import reviewed results in one native revision**. The native task commits the reviewed source operation. A changed current revision is handled by the original store’s revision conflict; it does not overwrite somebody else’s work. The result shows the applied revision and retained source.
9. Use **Review saved field observations**, then **Register saved field observations**, to make the saved results available in the existing **Observed water quality** view. From **Handover**, export the complete plan JSON or retain its native report package. The observations flow also supplies **Prepare client report** with the original field context.

The complete plan remains the unit of offline exchange. A portable offline workbench supports field editing, JSON export/return and the implementation report. CSV upload and source registration use the native workspace. Reopen the returned plan JSON through the original revision-aware import, then review the actual resulting revision.

## Explicit scientific mapping

The mapping schema is `upstate.implementation-lab-mapping/v1`. Result types are **numeric**, **censored**, **text** and **missing**. No browser heuristic chooses a type from punctuation or the apparent shape of a result.

- Numeric results use the selected numeric column, or original result text when no numeric column is selected. The source text remains independent of the parsed finite value.
- Censored, text and missing results keep a null numeric value. Their original source condition and qualifiers remain available. A categorical text value such as “123” is not a quantitative result.
- Detection and quantitation limits have distinct optional columns. Map them only when the source states that meaning. A lower reporting limit is retained as its original source field unless a declared source mapping establishes the appropriate interpretation.
- A result-type source column can use explicit aliases under **Result-type aliases, original-text/unit fallback columns and record decisions**. Each original label maps to one of the four result types.
- Ordered `fallback_columns` for explicitly mapped fields (such as `original_text` and `unit`) select real source cells only when the primary cell is blank. For example, a source’s detection-condition column can supply a censored row’s original text when the numeric cell is empty. The model retains the field actually used for each row.
- Parameter, result type, unit, basis, fraction, qualifier, method, QA and notes can use explicit constants when their source column is not mapped. Choosing a column clears its paired constant and choosing a nonempty constant clears that column, so the displayed choice is unambiguous.
- Decimal separator, delimiter and encoding are explicit. Header names are preserved exactly. Only exact canonical header names are preselected; the operator reviews their meaning before import.

The optional **Actual collection timestamp** column checks the source against the existing activity. **Fill an empty activity collection time from a complete source timestamp with timezone** defaults to off. Enabling it permits filling an empty time from a complete source timestamp; existing times are not silently replaced. Date-only text stays in the CSV. Different actual timestamps for the same activity are conflicts.

## Source identity and one-revision apply

The preview binds the original CSV bytes/hash, explicit mapping and exact saved plan ID/revision/document digest. The import passes that original source operation identity back to the model before writes.

The original operator upload ticket supplies the CSV path. Browser requests cannot supply arbitrary filesystem paths or replace the saved plan with an unverified document. The provider reads the retained historical revision and passes the original filename to the model.

The model retains the full CSV, mapping, original record/line identities, source decisions and source-link context together with the imported observations. The source record distinguishes append, replace, identical and skip decisions. The same source operation can reconnect after a process interruption; a later plan revision is preserved. An ambiguous browser response retains the existing native task/operation ID for retry or resume.

A native import can finish while later browser edits exist. The plan view retains those edits separately and shows the actual native saved revision. Use the current native plan and preserved draft to reconcile the changes before another commit; no background operation discards the draft.

## Native API and maintained integration

Read routes are POST requests because the original mapping can contain many explicit row decisions:

- `POST /api/implementation/lab-inspect`: original `upload_id`, delimiter and encoding.
- `POST /api/implementation/lab-preview`: upload ID, saved plan ID, revision and mapping; an optional document digest must match.
- `implementation.lab.import`: queued original action carrying upload ID, plan ID/revision/document digest, full reviewed mapping and `lab_operation_id`.
- `POST /api/implementation/lab-import` is the matching original queue alias.

The provider’s preview adds workspace/upload/plan bindings to `upstate.implementation-lab-preview/v1`. The completed `upstate.implementation-lab-import/v1` receipt retains applied/current revisions, original source link, files and receipt path. It also carries the provider’s original base revision/digest. Generic plan-event replay is bypassed for this action so the model’s full source receipt remains authoritative.

The native browser helper is `operator/web/implementation_lab.mjs`, loaded only when the original native intake is used. The manifest declares its asset and three routes; the complete implementation installer requires the helper and `model/implementation_lab_results.py`. The regenerated portable HTML contains the current planner/report source while preserving native-only source intake.

Install the complete current source edition using `install_implementation.py`, including current report-retention and portable implementation dependencies. Existing model/operator/root collection behavior carries original plan revisions and source attachments in the complete Workspace archive.

## Original WQP receiving case

The maintained Eighteenmile WQP field-intake preparation uses original agency station, activity and result CSVs. Its source guide and mapping are under `observations/eighteenmile_2023/wqp_20261013/field-intake/`. Open that original seed plan, save it through the native plan workflow, choose the source result CSV and load its mapping JSON. The original case’s coverage file supplies the expected counts and source hashes.

A successful receiving run should retain the actual upload/preview/import task, saved revision, native source files and final report/observation edition. Use the existing browser receiver and current application; preserve the original native workspace and running operations.
