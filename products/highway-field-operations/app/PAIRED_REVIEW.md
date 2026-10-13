# Paired review and portable receiving

The Highway workbench uses the existing paired dataset engine for import review, canonical comparison, decisions, immutable reports, and warehouse receiving. County observations and approved local proposals remain separate source editions.

## Prepare the original inputs

1. Select one saved capture, layer, and form edition. Require complete captured feature coverage.
2. Define every exposed column explicitly in fieldMap. Each row has captureField, deliveryField, and optional encoding. Use native for the ObjectID integer and values that the original CSV producer can represent exactly. Use json-text for complete features, geometry, arrays, large integers, precision-sensitive decimals, and any mixed field type.
3. For the original side, use sourceKind captured. For the proposed side, use sourceKind approved-proposal with the actual saved proposalId and proposalSha256. The materializer checks the original supervisor decisions and frozen proposal values. These are proposed local values, not County edits.
4. Call materialize_dataset(state, selection, read_blob, private_directory). It retains selected-rows.csv, selected-rows.jsonl and projection.json. Pass its producerOptions to the original loadCsvDataset. This preserves null as an unquoted empty CSV field and an empty string as quoted empty text.
5. Use the original handler's pages with the original SF100 init, appendMany, finalize and scan. Retain the actual complete finalized scan. Do not wrap local CSV in a fabricated delivery report.

Use an ObjectID column plus a @feature column with json-text when every source attribute and geometry must travel in one compact mapping. Additional individual source fields can be exposed for direct comparison. The projection identifies every alias and encoding; JSON text is compared as explicit text, not guessed numeric or domain meaning.

The bridge supports 64 MiB per complete native member and 256 MiB for the complete retained operation. The original CSV producer supports up to 64 declared columns. Capacity errors preserve original inputs and do not justify dropping rows or files.

## Native owner and original request

The server owns one configured DuckDBWorkspace and lends it to ReconciliationAdapter(native_workspace, state_provider, read_blob, directory). The private adapter directory is separate from the warehouse. The server closes the native owner after its HTTP handlers finish.

Before calling dispatch, persist the complete value returned by adapter.input(operation, body). Use a stable requestId UUID for every mutation. The bridge maps that UUID to the original engine's 32-character request ID. Retrying the same saved request recovers that original operation; changing a definition requires a new request.

Persist the full returned result and import every adapter.retained_files member by its exact bytes and digest before associating it through reconciliation.record. The Highway revision check occurs after the native effect. If another staff member changed the Highway workspace, retry only the association with the retained native result; do not start a second native comparison.

## Import, compare and decide

Use review-import with the actual finalized report path, selection, optional native column declarations and native keys. Its binding checks every original JSONL value and ObjectID against the complete selected capture or approved proposal.

Use import with the returned binding. The engine retains its original review and source files. Keep the resulting editionId and binding.

A review-pair definition names source_edition, target_edition and explicit canonical columns. Each column declares its name, source column, target column and key or value role. Optional original engine mappings, windows and notes retain their normal semantics. Save the reviewed definition through save-pair with the returned review digest and expected revision.

Run the saved pair with its exact definition digest. Read full groups and rows with page, following next_offset through total; inspect one source row with row. Record each decision through decision with the original run revision, exact subject, outcome, actor and reason. Supported native outcomes remain OPEN, ACCEPTED_DIFFERENCE, REQUIRES_CORRECTION and DEFERRED.

Create an immutable report for the chosen run review revision. An optional before_run_id creates the original engine's outcome comparison. Bind all selected source editions, including the earlier run's editions when comparing runs. A missing row in a later scope does not by itself prove correction.

## Request recovery

request returns the original native request record. resume uses that record's frozen original kind and body, and checks its source edition bindings before resuming. Preserve interrupted request IDs and errors. A transport failure does not authorize changed arguments or a replacement operation.

Read operations expose original native records and pages. The Highway source association retains input.json, result.json, complete native source files, exact captured/proposed row bindings and any full package files. No external path substitutes for those bytes.

## Export and cold receiving

export calls the original engine's complete report exporter. Retain the immutable report, original request, source editions, query products, warehouse, operating guide and manifest. The handover embeds every complete member.

After receiving the Highway handover in another private workspace:

1. Choose the retained reconciliation record that contains the complete native package.
2. Persist restore_input(state, record_id, package_directory, destination, request_id).
3. Call restore_native_package with the same values and original request UUID.
4. Retain its complete return and associate it with the Highway workspace.

The package directory and working warehouse destination must be distinct. The helper restores the exact original files, verifies the original manifest, and invokes the maintained receive_package API. A matching completed repeat preserves later valid warehouse edits.

Interrupted file publication is reconciled only when the exact private hash-named temporary alias has the same inode and complete bytes as its final member. Unrelated files and aliases are never adopted or removed.

## Source and scope

The adapter is highway/reconciliation.py. The original engine remains stellar_forge_buyer.reconciliation and the original native delivery/CSV producer retains its published source and license. The Highway component validates source linkage and transports complete evidence; comparison and receiving stay with the maintained native implementations.

All staffing, assignments, inspections, supervisor choices and approved proposals in this local programme are explicitly recorded application work. Public County feature records are observations. This programme performs no County edit, replica creation or external customer contact.
