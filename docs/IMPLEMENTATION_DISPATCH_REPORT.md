# Laboratory request reconciliation in the scientific report

The existing Laboratory requests and returns workflow prepares an immutable request for original saved sample activities. This companion adds its complete reconciliation to the existing scientific/client-report source. It accepts a request before results exist and retains all missing orders. It creates a source document; it does not create a measurement dataset or change the field plan.

## Original source and comparison

Each edition binds the workspace, original dispatch ID and requested plan revision, selected current plan revision and document digest, actual native reconciliation, original package member hashes, current original attachment inventory, and any already-selected observed-report source.

The native reconciliation supplies every status. Exact original returned dispatch/order IDs take precedence; otherwise matching uses original activity and parameter plus each optional requested unit, basis, fraction and method. Changed sample/site/visit/collection context remains explicit. A timezone offset text change alone leaves equal collection instants equivalent, while both source strings remain retained.

The report distinguishes directly linked results, competing results, records outside the requested set, and unchanged records already present at request creation. “Returned” describes the native comparison’s new or changed saved records. Censored and text records may be returned. An explicit missing result remains missing. Status does not record physical transfer, custody completion, analytical acceptance or compliance.

## Complete retained report content

The human report contains the original laboratory and reference, requested analyses and exact optional definitions, status counts, linked and competing result IDs, actual original result types and numeric/text values, original qualifiers and QA labels, and original/current sample context.

Distinct source-result counts include linked, competing, unrequested and pre-existing records once each, even when one record relates to several orders. Measurements retain their recorded units, basis, fraction and method; the report performs no measurement averaging, substitution or unit conversion.

Long report tables display their first 100 rows and link their complete sources:

- `tables/requests.csv`: every native order, status, linked/competing result ID, result type and issue.
- `tables/results.csv` and `result-records.json`: every referenced saved observation with its full original metadata, collection method, custody reference, native limits, lab source and complete original CSV row.
- `tables/sample-context.csv`: every original/current sample context.
- `reconciliation.json`: complete original native reconciliation.
- `dispatch/`: every verified original package member, including submission, blank return template, explicit mapping, original requested plan and ZIP.
- `current/`: exact compared plan/revision, attachment inventory and every available local source file verified against its native digest and size.

Missing local-file references remain described by their actual source inventory state. Original provider URLs and other source-link records remain in the full plans. The source document includes these files as companions; links in a final delivery resolve through the existing observed-context collector.

When an observed report is already selected, all of its retained source bytes, sections, source links and scientific figures are composed. Other delivery selections and source roles remain intact. The earlier field producer’s identity is retained descriptively rather than being presented as the new wrapper’s producer; this prevents a later field-source reopen from discarding the added laboratory sections.

## Native APIs

Module: `model.implementation_dispatch_report`

```python
preview = preview_dispatch_report(
    workspace, exact_saved_plan, dispatch_id,
    existing_report_selection=original_delivery_selection,
)
result = import_dispatch_report(
    workspace, exact_saved_plan, dispatch_id,
    expected_operation_id=preview["operation_id"],
    existing_report_selection=original_delivery_selection,
)
```

Both operations verify the exact native saved revision. Preview writes no files. The import recomputes the complete source operation before writing, then compares the reviewed operation ID. API errors use the original `ImplementationError`.

Both return schema `upstate.implementation-lab-dispatch-report/v1`, `operation_id`, `dispatch_id`, `dispatch_plan`, `plan`, `summary` and the original reconciliation `interpretation`. Each plan binding includes `id`, `revision`, `document_digest` and `title`.

The preview has `state="preview"` and null `source_collection_id`, `report_source` and `delivery_selection`. A completed import has `state="imported"`, `reused`, the actual `source_collection_id`, complete `report_source`, top-level `delivery_selection`, `directory`, and verified workspace-relative `files`.

`report_source` includes source collection/entry IDs, `source_role`, `binding`, `original_binding`, `delivery_selection`, `delivery_selection_path`, `directory` and `files`. The selection can open the existing native delivery form; it preserves original source-role choices and carries the actual new `OBSERVED_CONTEXT` binding. It is not a submitted delivery job. There is no `observation_ids` requirement.

Summary fields are `samples`, `orders`, `returned`, `missing`, `ambiguous`, `unrequested`, `preexisting`, `issues`, `source_result_records`, `source_result_types`, `sample_context_changes`, `package_members`, `current_attachment_files`, `current_attachment_references`, and `existing_report_composed`.

## Receiving, restart and restore

The source lives under `implementation/laboratory-reports/<operation_id>/`. Original files are copied through the maintained streaming retention helper, with byte/hash checks. Immutable bodies and the final receipt retain the same operation across a restart. A completed reopen verifies all retained files and the actual imported source binding.

Selecting this same prepared source for the same dispatch/current revision unwraps its own producer layer before recomposition. The previous original context binding is checked, so repeated preparation does not duplicate report sections. A different saved revision or changed source choice produces another source edition while preserving the earlier one.

Ordinary working-archive retention includes the implementation operation, source collection and module. Install the module alongside the original laboratory-dispatch and field-observation sources; use the existing observed source collector and report formatter.
