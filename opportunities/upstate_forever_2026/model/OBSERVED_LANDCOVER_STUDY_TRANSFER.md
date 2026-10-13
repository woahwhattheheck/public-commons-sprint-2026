# Editable selected-watershed comparisons in Scientific Study exports

A Scientific Report containing a saved **Observed watershed change** comparison now carries that original comparison into its selected Study export. The receiving application can reopen the same saved HUC12 selection, read the complete original transitions, and create a new comparison from the retained original analysis.

## Existing workflow

1. Open **Observed watershed change** in the populated original Workspace.
2. Import the completed 217-HUC source or choose its existing original analysis. Select the intended HUC12s, inspect the comparison, and save it.
3. Add that saved source to **Scientific study reports**, preserving the intended order of every other source, then save the report.
4. Select that saved Scientific Report in the maintained **Study transfer** flow. Use its normal preview, export and receiving operation.
5. In the received application's **Observed watershed change** desk, refresh saved comparisons and open the original comparison. Its saved ID and HUC selection remain unchanged. The original input collection remains available for another editable comparison.

The existing source_tools/receive_observed_landcover.py operation is the native receiving course for this feature. The original model.observed_landcover.inspect(workspace, saved_id) and load_inputs(workspace, selection) APIs remain authoritative. Original full-Workspace backup and receiving retain their existing behavior.

## What the selected export carries

For a source produced in the same project, the Study closure retains:

- The complete observed-landcover-selections/<saved-id> directory: original receipt, selected report JSON, binding JSON, all CSVs, HTML, source manifest, recipe, ZIP and original copied inputs.
- The saved comparison's original imported report source collection, its CAS body and every companion.
- The original analysis collection and its complete CAS members. The four explicitly bound inputs are the original analysis-run record, the earlier annual inventory, the later annual inventory, and the complete transition inventory.
- A typed scientific-report lineage record binding the saved comparison ID, original project, selected HUC12s, producer edition, area method, exact source entries and complete companion hashes.

The closure checks the saved receipt's identity, report title, selection, input binding, summary, full file inventory and observed-source binding. It reads CAS records directly and adds the original collections to the existing Study dependency queue. The maintained capture detects file or directory changes and keeps the original source copies.

An imported report from another project keeps its complete original recipe, inputs, companion bytes, declared project and selection lineage. It remains an external source; the receiver does not manufacture a local saved-comparison record from a foreign project ID.

Older selected Studies retain the existing dispatcher behavior: a source absent from their originally captured typed lineage does not acquire new editable dependencies during reopening.

## Integration

The existing model/landcover_study_transfer.py callback delegates only source_kind observed-landcover-selections to model/observed_landcover_study_transfer.py. Its saved_landcover_ledger route continues through the original fractional-ledger implementation. No second hook is required in the shared scientific report dispatcher.

The complete landcover-scientific-report component includes both helpers and this guide. install_landcover.py installs the helper alongside its delegating callback and accepts only the exact previous owned callback/component bodies when upgrading an existing application. Existing unrelated source is preserved.

The lineage uses the ordinary upstate.study-report-lineage/v1 schema:

- report_context_kind: observed_landcover_selection
- observed_landcover_selection_id: original saved comparison ID
- relationship: same_project or external_project
- selection: original source collection, analysis ID/hash and ordered HUC12s
- required_records: same-project original input/report source collections
- original_input_sources and original_members: retained identities

Received navigation uses the existing Observed watershed change desk and its openSaved action for same-project saved comparisons. The existing source/report view remains available for external imported reports.

## Native delivery and human review

Continue the same original selected-HUC report operation. Export its saved Scientific Report as a selected Study, receive it through the maintained portable API, and open the transferred application's own modules. Confirm that the original saved comparison can be inspected, its original analysis loads, and its full selected report files remain present. Continue any existing receiving directory through portable.resume_restore with the original archive identity, then run the same original cold inspection.

Before presenting the outgoing populated application or report as ready, open that exact outgoing version in the actual browser and look at its rendered desktop and narrow screens. Operate source selection, opening the saved comparison, HUC editing, full matrix quantities, downloads, report composition and received reopening. Fix clipped or unreadable output in the maintained source. Keep the plain industrial layout, readable table labels and ordinary controls. Source review and captured screenshots alone do not replace viewing and operating the delivered product.

The companion standalone comparison exchanges up to eight selected HUC12s with the native desk through the original portable-selection request. The native saved comparison and selected Study retain their complete declared HUC roster.
