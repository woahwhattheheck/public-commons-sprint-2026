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

## Ordered original scientific sources

Both field registration and laboratory reconciliation accept the complete current report selection through `existing_report_selection`. When `observed_context_sources` is present, its explicit order is authoritative; `source_roles.OBSERVED_CONTEXT` names the first entry. The complete binding covers every selected source, including sources that are not copied into the new producer's recipe.

For a new field or laboratory edition, the first original report is retained inside the new recipe at `existing-context/`, including all of its original source files, links and numeric figure specification. The new recipe replaces that entry in the ordered list. Every other original report remains in its existing position, with its original collection and source ID. For example, a selected regional study followed by an outcome report becomes the composed regional-and-field report followed by that same outcome report. Independent sources are collected once by the existing report engine.

Preparing the same saved field or laboratory edition again recognizes its own selected source even after it has been moved within the list. It verifies the producer's retained original selection, restores only the inherited source in that slot, and replaces the slot with the resulting source edition. Added or reordered independent sources remain selected. A producer that originally had no inherited report remains in its own insertion position. This prevents recursive copies of the same field or laboratory sections while retaining deliberate source-order changes.

The original implicit single-source selection remains supported. Its completed source identities and receipts remain reusable. Explicit ordered selections record the original composition slot in the producer identity, so preview, queued import, reopen and restored-Workspace reads use the same deterministic selection. The producer does not change model runs, report/economic bindings, contact details, geography or other source roles.

For the original Eighteenmile laboratory cycle, the laboratory recipe already contains the original field report. Appending a saved outcome therefore produces two selected source documents: the laboratory report with its retained field sections, then the outcome report with its figures and supporting records. All three scientific contexts remain available without adding the field report a second time.


### Carry the current Report desk selection through field work

In **Field records**, open **Preserve an existing report selection** and choose
**Use current Report desk selection** before reviewing the saved field revision.
The captured selection includes its complete original source order and unrelated
report, model and geography settings. Saving a dirty field plan preserves this
snapshot; preview and **Register saved field observations** use the same bound
selection. **Register without preceding report selection** explicitly returns to
the original source-only flow.

For a laboratory request, the same **Use current Report desk selection** control
is alongside the existing registered-field and original JSON choices. Review and
register the request's scientific report source after choosing the intended
selection. A later change to the Report desk does not silently replace that
reviewed snapshot.

**Prepare standalone scientific report** opens every source from the completed
receipt in its original order. **Prepare client report** opens the complete
retained delivery selection. Neither registration automatically replaces the
current report draft. These are explicit handoffs; the saved source edition and
its original revision remain available after further plan edits.


### Inspect the outgoing populated workflow

Before presenting this product as client-ready, use the existing native receiving
operation to run this exact installed edition with its populated saved plan and
ordered report sources. Open the real screen and view its actual screenshots at
the screenshare width and 390 px. Operate selection capture, save/review,
registration, both report handoffs, downloads and reopening; inspect the
relevant empty, loading and error states. Fix clipped or unreadable content in
the same workflow. Keep plain industrial presentation with readable tables,
clear hierarchy, consistent spacing and useful labels. Source/API review and an
empty-Workspace screen do not replace this actual rendered-product inspection.
