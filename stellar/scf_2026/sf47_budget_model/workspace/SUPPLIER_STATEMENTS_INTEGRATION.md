# Supplier statement integration into the original Operations owner

Compose these additive hooks with the fresh shared source. The product modules preserve the original Operations database, account calculations, Work Intake parser, source attachments and request journal.

## Operations owner

Import `operations_supplier_statements as supplier_statements`.

Inside `command`, alongside the original review branches:

~~~python
elif command == supplier_statements.ACTION:
    result = supplier_statements.save(self, context, data, actor, next_version, note)
    before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
    extra_receipt = {"supplierStatement": result["supplierStatement"]}
~~~

The parent transaction retains the request fingerprint before current-version checks and writes the native event, review, case version and result together.

Add methods on the original `Operations`:

~~~python
def list_supplier_statements(self, program_id):
    with self._snapshot():
        return supplier_statements.listing(self, self._context(identifier(program_id, "operation")))

def seed_supplier_statement(self, program_id, body):
    with self._snapshot():
        return supplier_statements.seed_document(self, self._context(identifier(program_id, "operation")), body)

def inspect_supplier_statement_source(self, program_id, body):
    with self._snapshot():
        return supplier_statements.inspect_source(self, self._context(identifier(program_id, "operation")), body)

def preview_supplier_statement(self, program_id, body):
    with self._snapshot():
        return supplier_statements.preview(self, self._context(identifier(program_id, "operation")), body)

def supplier_statement(self, program_id, review_id):
    with self._snapshot():
        return supplier_statements.show(self, self._context(identifier(program_id, "operation")), review_id)

def supplier_statement_request(self, program_id, body):
    with self._snapshot():
        return supplier_statements.request(self, self._context(identifier(program_id, "operation")), body, SCHEMA)

def export_supplier_statement(self, program_id, review_id):
    with self._snapshot():
        return supplier_statements.export(self, identifier(program_id, "operation"), review_id)
~~~

The normal `ops_reviews` export includes all complete statement editions automatically. In generic `_read` review summaries add the supplier summary to this purpose, using `supplier_statements.summary(review)`.

In `import_bundle`, preserve original raw input for the request fingerprint; inside its original transaction, before the existing wrapper chain:

~~~python
original_case, supplier_selection = supplier_statements.unwrap_bundle(raw)
# Feed original_case into the existing wrapper/native _unpack sequence.
~~~

After original case events/reviews/records/sources, Work Intake and historical plans have been validated and `selected_plan_at` is available:

~~~python
supplier_statements.validate_import(context, document["reviews"], document["events"],
    files, selected_plan_at, document.get("workIntakes", []))
supplier_statements.validate_received(supplier_selection, document, files)
~~~

Use the actual existing context variable, retained source map, native event/review arrays and Work Intake array; no parallel reconstruction. If a selected wrapper exists, retain `selectedSupplierStatement` in the import result with original review ID/SHA and selected statement ID. The receiving case gets its ordinary new local identity; historical source/review snapshots retain their original author identity.

## HTTP and named staff

Import `operations_supplier_statements_http.handle`. Invoke it in existing authenticated read/write dispatch with `handle(handler, parsed, store(handler), "GET"/"POST")`. Preserve original cookie, CSRF, staff actor/installation and assigned-case checks.

Add read views for list, saved review and ZIP. POST source/seed/preview/request are pure reads and should use the existing financial read permissions; save uses `supplier-statement.save` through the original command financial-write role. Contributor profiles keep their existing restricted records and do not gain the full financial desk.

Register:
- `/operations_supplier_statements.mjs` as JavaScript;
- `/operations_supplier_statements.css` as CSS;
- `/SUPPLIER_STATEMENTS.md` as Markdown.

## Browser composition

Use the existing lazy desk loader for `mountSupplierStatements` from `./operations_supplier_statements.mjs`. Mount with original `container,current,api,saveApi,session,mutationId,recordingActor,onCase,onOpen,staffContext`. Keep one session object per original case and call returned `dispose()` and `setHostBusy(boolean)` through the existing host lifecycle.

Navigation key `supplier-statements`, title **Supplier statements**, in the original financial group adjacent to Supplier accounts. Existing account link target is `supplier-account`; Work, Invoices and Cash retain their actual source-owned targets. On complete case import choose this desk when `selectedSupplierStatement` exists and set its session `edition` to the retained review ID.

## CLI and typed client

Import `operations_supplier_statements_cli`; call its `register(command,mutation)` in the normal original CLI registration and its `operate(ops,args,read_bytes,publish)` when `operates(args.operation)`. It uses the original workspace lifetime and create-only output helper.

The original typed client can expose list/show/ZIP through its existing verified read/download methods. The exact new read selections are `supplier-statements` and `supplier-statement`, keyed by original case ID and review ID; source/seed/preview/request POST methods retain the complete JSON body. Add these to the maintained client transport rather than opening another owner. Source-owned Merchant tool metadata should follow the same full document/input-reference and retained file export conventions as original Risks. No second connection configuration or process owner is added.

## Source closure

Include every new product leaf plus the six exact unchanged files in `supplier_statement_engine/` and its provenance. Add these names to the current original `managed-source.json`; preserve all current Portfolio/Risk/Source Desk additions and both existing launch-reader consumption rules. Include Node in the original selected runtime. The small adapter invokes `node` from that runtime, like the existing original commercial adapter.

Complete native/browser receiving uses the original supplied operating case and retained requests. No worksheet or statement generation substitutes for actual supplier source.

In the existing importer’s ordinary `origin` construction add `origin["supplierStatementPrograms"] = supplier_statements.retained_program_ancestry(source_program)` when supplier review books exist or the source origin already retains this field. This carries every actual original programme basis across repeated cold receives. Historical snapshots remain unchanged. The validator binds immutable plan core with original `amendments.same_plan`, exact source registry from the event prefix, and actual original programme ancestry. Add `supplier_statements.ACTION` to the existing in-transaction full-export bound check beside Risks/Funding so a save cannot make its case impossible to hand over.


## Unchanged reconciliation source provenance

The six ordinary source files under `supplier_statement_engine/` are retained verbatim from `woahwhattheheck/smb-showcase-inventory`, directory `apps/supplier_statement_reconciliation/`. Their original Git blob and full-byte SHA-256 are below. The adapter invokes this complete original module graph; these files have no local behavior changes.

| Member | Original Git blob | SHA-256 |
| --- | --- | --- |
| `engine.mjs` | `de9bea0645c179c1e8bd15fc4b5150bac2904f4b` | `9177566131464a718ed80d489bdf1b0d8e88f83dca2780c6f149d95b254edff3` |
| `reconcile.mjs` | `750cd21ab64a254ef78c92ba002a3690c7d6b4c2` | `b0a32a2fd247ecc24ffafd35f31c0e33dfbd39f0e0c8ae28743819de94e523b3` |
| `validation.mjs` | `876f307fe3ebfcade15b73f6b407f08401d10fdf` | `c55e1464fb5e72847728379877eb43aa5cdeaa84bcc1658562c62116881df14d` |
| `guards.mjs` | `864815e4559d004c7d1d54561c7bda7b9a41e1cf` | `faf27c2fa64a99c237f580db0b9262dcfa5f4ecef6b54d70565ba65c1fd7c6f7` |
| `json.mjs` | `14da7535611646d9727df4fc75b18b1cb3565534` | `0c8fc1dae1b331f4e1af72fb1bd62bdfa9b73d4af2ad3407261bbe1458d21305` |
| `clock.mjs` | `aa7c1a581d4be6363a940a649bd6675da99cb5ea` | `d123eb8d58e41bd58e60408ea4a9729465bca1f050c32f1aea6f77cb58bd6f1d` |
