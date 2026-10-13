# BDNB territory, edition comparison and customer handover

This application adds a BDNB operating view to the maintained Datasette/Analysis workspace. An operator imports complete publisher CSVs, selects a territory, compares selected editions through documented correspondence, records individual review decisions, and produces a report, workbook, complete data annexes and an editable whole-workspace archive.

The application keeps original CSV text separate from exact typed values. Missing, null, invalid and zero values remain different states. Source geometry retains its declared EPSG:2154 coordinates. Published counts describe the complete selected population; supplied energy or building attributes are not converted into estimated savings or conclusions.

## Open the application

Use the existing merchant runtime **Applications → Datasette customer Analysis** entry with the original Python installation and its **workbooks** extra. Select the intended Analysis workspace and operation ID, then open **BDNB territory** in the Datasette operator. The existing Analysis application remains available on the same private server.

For an installed command line, this product entry delegates to that same maintained runtime:

~~~sh
node products/ntico/bdnb-territory/cli.mjs \
  --runtime-workspace /private/operator \
  --runtime-directory /private/runtime \
  --runtime-id ACTUAL_RUNTIME_ID \
  --installation-id ACTUAL_INSTALLATION_ID \
  -- serve --workspace /private/bdnb-analysis \
  --operation-id ACTUAL_ANALYSIS_OPERATION_ID --port 0
~~~

Replace the path and identity values with the actual existing installation. The launcher verifies the selected source manifest, Python installation and workbooks dependency. It does not install another runtime. The returned private launch link opens the original local application.

The complete model and publisher-source contract are in [BDNB_SOURCE.md](../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/BDNB_SOURCE.md). The browser working-file panel preserves unfinished forms, pending original requests and selected records independently of accepted Analysis entities.

## 1. Retain the original publisher files

Acquire the complete original departmental or territory release using the maintained [data.gouv source operator](../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datagouv/CUSTOMER.md). Preserve its publisher metadata, retrieval receipt, original archive and each extracted CSV identity. A resource URL or metadata entry alone does not establish receipt of its data.

Prepare a descriptor selecting the actual millésime, structure version, scope, publisher, licence, and complete CSV paths/lengths/SHA-256 values. Each file has its original table name, delimiter, null tokens and geometry encoding. Optional extra field definitions preserve explicit source semantics. When the publisher release uses another structure, supply the complete source-backed five-table dictionary matching that structure; keep its original provenance.

The import retains every original byte as ordered Analysis document segments and every projected record in the original native dataset database. Segments are a storage representation of one complete original source, not a row sample. Inspect the full source inventory and paged records before selecting a territory. Unknown columns and incomplete keys remain visible findings.

## 2. Select the territory and compare editions

Create a named immutable selection from an imported edition. Filters use exact department, commune or building-group identifiers; an empty filter list leaves that dimension unrestricted. Read the returned scope and row counts to verify the intended selection.

Choose the exact before and after selections. A direct comparison uses the selected source identifiers and supplied passage evidence. A chain additionally requires its explicit ordered edition path and the imported passage editions needed to establish every step. Select comparison fields explicitly or use the contract's full-field selection; retain the choice in the request.

Correspondence classifications, evidence hashes and field changes remain attached to their original rows. An unobserved record, unresolved passage or inconsistent chain remains a coverage/review issue. It is not silently treated as a new or demolished building. Address-denominator weights retain the original source meaning; they are not divided across a group's addresses.

## 3. Record reviews and corrections

Open the exact comparison item and inspect its original evidence. A review records the selected item/evidence hash, author, outcome and reason. The supported outcomes are accepted, needs-review, deferred and rejected. Correct a review by naming its current predecessor; keep the original record and its history.

A publication freezes the complete current review set before native output work starts. A later review creates a later state but does not change an existing publication. Conflicting current tips remain visible in the frozen publication and report.

Use **Inspect original request** after a transport interruption. Resume the same request and complete body when it is interrupted. A changed business plan needs a successor ID; retain the old attempt and an explanation. The browser's working-file download carries all drafts and pending request data for a later session.

## 4. Publish the complete report and workbook

Select a territory selection or comparison and provide a title and note. A title may contain at most 300 characters and 600 UTF-8 bytes. Publication performs original native Analysis jobs and is accepted only after all required outputs are complete.

The report and workbook contain readable original scope/millésime metadata, complete collection counts, field-state counts, geometry states, finding counts, correspondence classifications, review outcomes, unresolved review conflicts, unreviewed-item counts and a complete annex register. These are calculated over the entire immutable selection using the native streaming reader.

Full territory records stay in complete JSONL and spreadsheet-safe CSV annexes. Each annex includes its native manifest, full row count, source version, selected query binding and hash. JSONL retains exact raw/typed values, geometry, lineage and full row JSON. CSV neutralizes spreadsheet formula text as the native exporter defines.

The source-basis annex retains the complete selected entity and frozen review set in ordered text parts. Concatenate each section's text by numeric part order and verify its SHA-256 to recover the exact original JSON. Long display cells are split into labelled deterministic parts; no text is silently shortened. The workbook is the complete metric/report view and full annex index, rather than a territory preview disguised as a full spreadsheet.

Publication retains these original outputs:

| Output | Content |
| --- | --- |
| Report HTML | Readable territory, coverage, change and review summary |
| Report JSON | Complete native report data and bindings |
| Report CSV ZIP | Complete native report section tables |
| Workbook XLSX | Complete summary and annex register |
| Workbook handoff ZIP | Original native workbook delivery |
| Collection JSONL/CSV/manifest | Every selected row, native bindings and full identity |
| Review annex | Every frozen current-tip operator decision |
| Source-basis annex | Complete selected entity and frozen review metadata |

Native report/output capacity errors remain failed requests with retained evidence. A failure does not publish a partial edition as COMPLETE.

## 5. Pack, download and receive

Select the completed publication and a fresh pack ID. The pack ID is also the original HTTP request ID. The browser, workflow adapter and connected CLI enforce this identity.

The pack uses the maintained Analysis workspace archive. It carries the same SQLite database, immutable source versions, original document segments, complete native report/query/workbook outputs and source history. Earlier portable ZIPs remain separate to avoid recursively embedding old archives; their identities stay in SQLite.

The pack reads its catalogue from the database actually captured in that archive. This may differ from the live catalogue observed before a retried export. The archive's own database length/hash and immutable entity identities are retained in the pack. The final pack entity is committed after the snapshot and is therefore not expected to appear inside that same snapshot.

Download files using their selected name and expected SHA-256. Receive the archive into a separate original Analysis workspace through the maintained receiver. Reopening uses the same Analysis operation ID and the current installed application source. Replaying the original receive preserves legitimate later customer work.

[RECEIVING.md](RECEIVING.md) provides the complete producer → customer review → returned workspace → independent reopen programme.

## Exact CLI operations

Keep JSON bodies in files. The complete source schema is available through the same authenticated reader:

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py \
  call --workspace /private/bdnb-analysis --operation-id ACTUAL_ANALYSIS_OPERATION_ID \
  --connect --action bdnb.schema --request /private/empty-object.json
~~~

The installed launcher accepts the same arguments after its installation selection. Four read actions are bdnb.schema, bdnb.status, bdnb.get and bdnb.rows. The six mutation actions are bdnb.import, bdnb.select, bdnb.compare, bdnb.review, bdnb.publish and bdnb.pack.

For mutations supply --request-id with the stable original request identity. The connected pack command selects body.pack_id when --request-id is omitted, and rejects a differing explicit ID. Read or resume the original request using the existing request command. Full file downloads use the original download command and --sha256.

## Original workflow and Kestra/JMS integration

[WORKFLOW.md](WORKFLOW.md) binds a complete reviewed BDNB action plan into the existing source/report workflow. It retains the original API/JMS request, correlation, native action IDs, all publication files, whole archive, actual publication attempts and recipient receipt.

No new broker transport is added. The original native Kestra flow set, result receiver and acknowledgment flow remain the implementation. Select the actual installed namespace, broker, credentials and plugin/runtime versions with that original operator. Local domain receiving and actual broker delivery are reported as separate outcomes.

## Application source

The product entry and guides live in products/ntico/bdnb-territory. Model, UI and native integration remain in the maintained datasette-analysis application:

- bdnb_source.py, bdnb_dictionary.json and bdnb_contract.json: original CSV custody and explicit source semantics.
- bdnb_adapter.py: immutable edition/selection/comparison/review records in the original database.
- bdnb_products.py: native report/workbook/query exports and whole archive.
- bdnb_operator.mjs: mounted operator and editable browser working file.
- bdnb_workflow.py: original workflow's installed BDNB profile.
- bdnb_receiving.py: complete same-operation customer receiving programme.
- Existing model, server, client, CLI and installed source selection contain only the required additive integration hooks.

Commercial contacts and customer credentials remain with the original project owner. This generic source package uses the operator's actual supplied files, decisions and destination configuration.
