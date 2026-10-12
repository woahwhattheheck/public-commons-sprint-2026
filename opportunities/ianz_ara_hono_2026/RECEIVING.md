# Local native receiving product

This module implements the **Ara Hono local receiving store**, a real Python and SQLite target for a complete selected IANZ import. It creates an actual persisted local environment, assigns native row IDs, applies the selected values, resolves original-key relations, retains all selected files and source metadata, and produces a complete native return package.

It has no connection to a customer's accreditation system and makes no claim of customer deployment, accreditation approval, accepted commercial work, or an imported customer database. The existing project and native target adapter remain the integration entry. This component supplies their local receiving implementation. It starts no web server, service, browser, network client, or parallel project.

## Source and runtime

Place reference_receiver.py beside the maintained schema.py and mapping.py, with the original contracts/data-contract.json. They are the actual package, canonical-field, and mapping implementations. The receiver uses Python's standard library only.

The supported Python API is:

~~~python
from reference_receiver import ReferenceReceiver

receiver = ReferenceReceiver(actual_receiver_directory)
descriptor = receiver.describe()

result = receiver.import_package(
    complete_import_zip_bytes,
    operator=actual_operator,
    reason=actual_import_reason,
)

complete_return_zip_bytes = receiver.export_return(result["native_request_id"])

correction = receiver.correct_record(
    result["native_request_id"],
    selected_target_entity,
    selected_typed_external_key,
    explicit_changed_values,
    operator=actual_operator,
    reason=actual_correction_reason,
    command_id=original_stable_correction_id,
    expected_revision=receiver.status()["receiver_revision"],
)

corrected_return_zip_bytes = receiver.export_return(result["native_request_id"])
~~~

The caller obtains the descriptor from this actual environment before preparing the target-bound mapping and import. The generated environment ID is stored in SQLite and remains the same after reopening the directory. Passing a different directory creates a different actual local target. A fixed template environment ID is never substituted for the generated identity.

ReferenceReceiver holds no connection between method calls. Each successful method closes its transaction before it returns. A complete SQLite directory can therefore be handed over after the calling operation has stopped and all owners have closed their work. Do not copy a live database or discard an adjacent active SQLite journal. For a running or shared installation, use SQLite's supported online backup procedure under that installation's existing owner.

### API results

| Method | Result |
| --- | --- |
| describe() | Stable persisted ianz.native-schema/v1 descriptor, including actual product, environment_id and version |
| status() | ianz.reference-receiver/v1 with current receiver_revision and actual native counts |
| import_package(bytes, operator=..., reason=...) | Original ianz.native-result/v1 result; revision is the committed receiver-wide integer revision |
| inspect_request(native_request_id) | Original result, original package and manifest pins, original-cohort native IDs/current revisions, complete member inventory and saved export receipts |
| original_package(native_request_id) | Exact accepted original import ZIP bytes |
| correct_record(...) | Original ianz.native-correction-result/v1 receipt with revision, previous_revision, actual native_id, full resulting values and changed_fields |
| export_return(native_request_id) | Complete ianz.native-return-package/v1 ZIP bytes |
| history(native_request_id) | Original result and complete native row, relation, document and correction histories for that request's selected native IDs |

revision is receiver-wide. The first accepted import increments it once. A later accepted import or explicit correction increments it once again. An exact repeated import or correction returns the original receipt and original revision without another native revision.

inspect_request returns receiver_revision separately from the original result. The original result is never rewritten to pretend that a later correction occurred during the original import.

## Accepted complete import

The receiver calls the actual schema.unpack(package, schema="ianz.native-import-package/v1"). That validates every original ZIP member against its complete MANIFEST.json inventory. The import_manifest_sha256 is calculated from the actual retained MANIFEST.json member bytes.

Required members are import.json, dataset.json, mapping.json, and documents.json. All other complete original members remain retained in SQLite, including readable native/*.csv files, source-references.json and actual assets/<sha256> members.

import.json must have the original ianz.native-import/v1 request:

- operation_id, project_id, run_id and native_request_id;
- source_revision;
- target_product, target_environment_id and target_schema_version;
- exact SHA-256 pins for the actual mapping.json, dataset.json and documents.json bytes.

The target identity and full mapping descriptor must match this actual persisted native environment. The selected mapping must be a received_native_schema binding. The receiver runs the original maintained mapping over the complete supplied canonical record cohort and checks that the issued records, relationships, omissions and issue lists are the actual resulting dataset. It does not invent mappings, silently repair fields, select another source edition, or discard unresolved original mapping findings.

Each native row retains:

- the actual target table and typed external key;
- one generated native ID, stable across upserts of that native table/key;
- its current complete typed values;
- original canonical entity/key, source edition and record edition;
- complete original annotations and provenance;
- the complete matched canonical source row;
- every imported/upserted/corrected native revision, operator, reason and original operation.

The receiver's local tables use the actual maintained canonical field definitions. JSON booleans and integers remain distinct. Monetary amounts and exact quantities remain decimal strings. Arrays and objects retain their complete typed values. Date and month precision follows the original canonical contract.

A native upsert merges only fields present in the issued native row. A field omitted by an explicit preserve-blank mapping retains its existing native value. An explicit null is an explicit value and must satisfy the actual field's optional/required rule. Identity and native-key collisions are rejected before an accepted transaction can be committed.

The declared package capacity is the original 512 MiB compressed/expanded package limit, 20,000 complete ZIP members, 64 MiB per actual asset, and 200,000 selected native records. This is a bounded reference receiver, not an unbounded data transfer service.

## Real two-pass relations

The first import pass assigns or locates every actual native row ID in the selected cohort. The second pass resolves each relation's original five fields:

~~~json
{
  "entity": "original canonical source entity",
  "key": "original canonical source key",
  "field": "original reference field",
  "target_entity": "original canonical target entity",
  "target_key": "original canonical target key"
}
~~~

Both ends must exist in this same complete imported cohort. An unrelated target row with a similar label is never a fallback. The native relation stores the actual source and target native IDs, native field, original relation, request identity and revision.

An import replaces only relation fields actually present in its issued native values. Omitted preserve-blank fields keep their existing native joins. Original request relations and every later relation revision are retained separately.

A return extracts the current actual joins among the original request's selected native IDs. If a later import points a selected row at a row outside the original cohort, that unrelated row's data is not exported. The omitted out-of-cohort join is counted explicitly and the receiving comparison can observe the changed field or missing original relation. The return does not falsely echo a no-longer-current original join.

## Documents, visibility and all source assets

documents.json is the full selected edition list. Every selected canonical document record must have its matching actual document entry and content. Each entry retains document_key, document_edition_id, sha256, bytes, access_class, original associations and file_id. The original file_id is sha256:<actual content hash>.

The actual document native ID is the imported document row's native ID. Associations to programme, accreditation, assessment and participant are resolved against the selected imported native rows. Visibility remains exactly public, client_private, assessor_private or internal; export does not change it.

A document edition cannot acquire different bytes or a different native identity. Changed contents require a distinct actual document edition. Later complete imports may update that edition's associated native metadata, with full history. The ordinary value-correction command cannot alter document content, identity, visibility or native association fields.

All assets are stored by actual hash with complete bytes in SQLite. Original request membership retains every selected asset, including source PDFs and other evidence files that are not document attachments.

source-references.json retains its full original list of:

~~~json
{
  "file_id": "sha256:<actual 64-character digest>",
  "asset_path": "assets/<same digest>",
  "sha256": "<same digest>",
  "bytes": 123,
  "filename": "<original filename>",
  "media_type": "<observed media type or null if unknown>"
}
~~~

Each reference is verified against its actual selected asset. The complete source-reference bytes and every original selected asset are returned. No file is substituted with a marker, catalogue entry or download instruction.

## Financial receiving metadata

A charge_line's annotations.financial_receiving is retained in the actual native row metadata and in every full history version. It contains the complete original submitted line, calculated canonical line and calculation trace. The original submitted line carries invoice_key, group_scope, tax_basis, quantity_origin, applicability and other actual receiving context.

return.json includes billing_lines. For each selected charge line, the receiver reverses the selected native field mappings and exact quantity conversions, then combines:

~~~python
{
    **retained_financial_receiving["original"],
    **current_canonical_charge_values,
}
~~~

Current native amounts and quantities are applied last. An explicit native correction therefore survives export instead of being hidden by a replay of the original billed amount.

An ambiguous reverse enum/reference mapping is reported in billing_issues. Its unresolved field is removed from the merged line so an old original amount cannot silently fill the gap and appear to reconcile. The original annotation, current native row and correction history remain available. The receiver does not calculate a replacement invoice, tax result or cap decision; the maintained billing receiving comparator owns those calculations and original invoice/group boundaries.

## Atomic import and original request replay

The full original ZIP and its actual package SHA-256 are retained against native_request_id. Every member, native record, two-pass relation, document association, history record and original result is committed in one SQLite transaction.

If validation or storage fails before commit, no partial accepted native import exists. This receiver uses an all-or-nothing applied result; it does not claim partial success. A validation rejection raises WorkspaceError with its actual code/status/details. Such a rejected package may be corrected by its producing workspace and submitted under that workspace's next original request identity.

For an existing native_request_id:

1. The receiver verifies the complete supplied package and compares its raw ZIP size/hash with the original accepted package.
2. A different package raises native_request_conflict.
3. The exact same package returns the retained original result before checking current target revisions or reapplying any native values.

A lost response can therefore be reconciled by inspect_request or by submitting the exact original package again. A later native correction is not undone by that replay. The first accepted operator and reason remain the original import's audit fields.

SQLite uses its own original transaction journal, full synchronous commits and foreign-key constraints. The receiver does not create a second outbox, remote requester, controller or background writer. It refuses an unrelated database or a partially missing receiver schema instead of manufacturing replacement tables around missing history.

## Explicit native correction

The correction command changes actual local values after a successful original import. It requires:

- the original native request ID;
- a selected target table and exact typed external key from that request's cohort;
- an explicit nonempty object of changed values;
- operator and reason;
- one stable command_id;
- the actual current receiver-wide expected_revision.

The full command, its fingerprint, native value change, complete new history version and result are committed together. An exact repeated command returns its original receipt before current-revision comparison. A divergent request under the same command_id raises native_command_conflict. A stale new command raises native_revision_conflict and preserves the caller's intended values.

The command edits ordinary native values. External-key fields, resolved reference fields, document content/identity/visibility and document associations require a new complete reviewed import. It does not invent the missing relations for a direct value edit.

The original accepted import, request package and native-result.json remain unchanged. A subsequent export shows the deliberate current native correction, making it available to the existing receiving comparison and explicit adoption decision.

## Complete native return and export replay

The complete return ZIP has an exact ianz.native-return-package/v1 manifest and contains:

- return.json, schema ianz.native-return/v1;
- original native-result.json;
- every actual selected assets/<sha256> member;
- original source-references.json when supplied.

return.json retains the original native_request_id, run_id, import_manifest_sha256 and target identity, complete:true, current selected native records, current actual native relations, full document metadata and IDs, billing_lines, control_totals, the actual export ID and frozen selected-state digest.

The extraction is scoped to the original request's full native-ID cohort, including rows that were updated rather than newly created. It never dumps all other target records into an unrelated receiving package.

The receiver freezes and retains each complete export in SQLite. Its selection includes the current selected row/document versions, values, annotations, native joins, assets and original result. Repeating export with an unchanged selected state returns the exact original ZIP bytes. An unrelated target operation does not rewrite the old export merely because the global receiver revision advanced. A changed selected native state creates a distinct complete export while the earlier one remains preserved.

The return's receiver_revision is the actual global revision when that selected export was first frozen. Its native_export_id, exported_at and package bytes remain those of the original export on replay.

## Command-line operation

All commands use the actual root selected by the operator:

~~~sh
python3 -B reference_receiver.py --root /actual/local/receiver init
python3 -B reference_receiver.py --root /actual/local/receiver describe
python3 -B reference_receiver.py --root /actual/local/receiver status
~~~

Import the complete original issued package:

~~~sh
python3 -B reference_receiver.py --root /actual/local/receiver import \
  --package /actual/original/native-import.zip \
  --operator "actual authenticated local operator" \
  --reason "Receive the selected reviewed project edition"
~~~

Use the native_request_id returned by that actual import:

~~~sh
python3 -B reference_receiver.py --root /actual/local/receiver status \
  --request ORIGINAL_NATIVE_REQUEST_ID

python3 -B reference_receiver.py --root /actual/local/receiver export \
  --request ORIGINAL_NATIVE_REQUEST_ID \
  --out /actual/receiving/native-return.zip

python3 -B reference_receiver.py --root /actual/local/receiver original \
  --request ORIGINAL_NATIVE_REQUEST_ID \
  --out /actual/receiving/original-import.zip

python3 -B reference_receiver.py --root /actual/local/receiver history \
  --request ORIGINAL_NATIVE_REQUEST_ID
~~~

For a deliberate native correction, put only the selected changed fields in an actual local JSON file. Supply the typed external key as JSON; quote a string key rather than converting it to a number.

~~~sh
python3 -B reference_receiver.py --root /actual/local/receiver correct \
  --request ORIGINAL_NATIVE_REQUEST_ID \
  --entity charge_line \
  --external-key-json '"ORIGINAL_CHARGE_LINE_KEY"' \
  --values /actual/review/explicit-native-correction.json \
  --command-id ORIGINAL_STABLE_CORRECTION_COMMAND \
  --expected-revision ACTUAL_CURRENT_RECEIVER_REVISION \
  --operator "actual authenticated local operator" \
  --reason "The explicit receiving correction selected by the operator"
~~~

The capitalized identifiers and revision are placeholders to replace with actual native results. They are not precreated operations or claimed customer data.

The CLI writes normal JSON results to stdout and structured errors to stderr. A return/original output is atomically linked from a complete fsynced temporary file. If the requested path already contains the exact bytes, it is an ordinary replay. A different existing file is preserved and reported as output_conflict. The complete native export also remains in SQLite, so failure to publish an external file does not lose the original return.

## Existing project target-adapter integration

The cumulative project owner retains Project(directory, create=False, target_adapter=...) and its existing target lifecycle. Adapt its actual submitted original request and complete package to this receiver; do not start another host or invent a second project/case.

The receiver's durable package/result lookup is available through inspect_request and original_package. The existing adapter should use the original native_request_id and exact complete package bytes for replay. Any owner-specific submit(original_request, full_package_path), lookup(original_request), request_shutdown() and close() wrapper must use that owner's actual request/result contract. The component does not guess an unseen request shape or claim the adapter has been installed before that integration is composed.

The complete source is supplied for the cumulative owner's real import, native correction, corrected return, cold reopen and handover programme. Source delivery itself is not evidence that those operations have run.
