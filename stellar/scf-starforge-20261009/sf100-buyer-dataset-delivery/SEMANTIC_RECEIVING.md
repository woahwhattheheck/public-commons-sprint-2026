# Receive published source meaning through the original customer engines

CKAN, OData, Superset and Directus use the same SF30 dataset-page, SF88 buyer and SF100 completed-room flow. The receiving engines retain the original meaning document, exact selected output files and existing customer operation identities. Python analysis, native agent tools and the generated customer clients consume that same completed delivery.

## Source contracts

| Published document | Original source meaning retained | Required semantic response header |
| --- | --- | --- |
| stellar-forge.ckan-semantics.v1 | Reviewed CKAN projection, retained capture, optional CSVW definitions, aliases, keys, units and URI templates | x-ckan-semantics-sha256 |
| stellar-forge.odata-semantics.v1 | OData 4 protocol 4.0/4.01 source and CSDL; source paths/types and reciprocal value/state columns | x-dataset-semantics-sha256 |
| stellar-forge.superset-semantics.v1 | Apache Superset 6.1 chart identity, saved query context, authenticated principal digest, result query ordinal, native column names/ordinals/types and selected result scope | x-dataset-semantics-sha256 |
| stellar-forge.directus-semantics.v1 | Directus 12.5 collection, original query and authenticated principal, primary field, complete native field/relation definitions and exact JSON number lexemes | x-dataset-semantics-sha256 |

These protocol values identify the published producer contract. The source operator keeps the original captured server metadata and selected source version with each edition.

Every semantic document carries sha256, definitionSha256 and source.captureManifestSha256. The original SF100 validator recomputes both canonical meaning identities. The definition identity omits only the capture and raw schema digests from source; the document identity binds that definition to its retained capture. These identities remain separate from the physical dataset snapshot and from the byte hash of semantics.json.

The source producers are [CKAN](../sf30-seller-sdk/ckan/SEMANTIC_WORKFLOW.md), [OData](../sf30-seller-sdk/odata/README.md), [Superset](../sf30-seller-sdk/superset/README.md) and [Directus](../sf30-seller-sdk/directus/README.md). They publish through the original [dataset handler](../sf30-seller-sdk/dataset-handler.mjs). Receiving preserves their explicit source kinds.

## Continue the existing merchant and customer operation

Use the original retained source edition, reviewed projection, merchant package, release, buyer selection and destination. Superset and Directus native customer callbacks should select the complete source containing all four receiving modules listed below before their original paged acquisition.

1. Reopen the source owner's complete edition and publish its existing selected merchant version through the original source-specific merchant operation.
2. Use the actual SF82 seller response and original SF88 buyer attempt. The original wire recorder retains real response headers with the response body.
3. SF88 reads the expected semantic header and x-dataset-snapshot from that original response. When a query includes semantics, its value must match the returned meaning identity. An existing page chain keeps the same query, snapshot, semantic identity and recorded response metadata on every page.
4. SF100 appends the original pages through its existing session, cursor and archive checks, then finalizes the same room. Its output includes dataset.jsonl, dataset.csv, review.html and the complete semantics.json, with their exact lengths and hashes in manifest.json.
5. The original Python receiving entrypoint opens that finalized room. It checks its native scan, exact dictionary file, selected fields, original page metadata and every retained page dictionary before importing customer data.
6. Continue the original SQL, query, report, workbook and portable customer operation from that same received source. Keep its current job IDs, edition IDs and selected-view revisions on recovery.

The original SF100 command can inspect the existing room without acquiring another page:

~~~sh
node stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs status --out /absolute/original/customer-room
~~~

The native Python entrypoint uses its original checkout and an explicit Node executable:

~~~sh
python3 stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/native-dataset-receive.py --room /absolute/original/customer-room --node /absolute/original/node
~~~

The selected merchant receiving packet retains the complete analytical example at sf88-operator-buyer-cli/python/examples/semantic_analysis.py, original Git blob5ee6cf736d650a1d5d94c28261661bb058353d44. Select the actual original finalized scan and separate private analytical/output directories. Its optional columns object maps reviewed original field names to SQL aliases; it preserves every unmapped selected field. The program imports the full original rows, retains the source dictionary, selects the original SQL view, runs saved queries and full query exports, publishes its report, builds a two-sheet workbook, opens the authenticated analysis service and reopens its consistent database backup.

## Value, null and missing fields

OData, Superset and Directus publish paired value and presence columns. The presence value is exactly value, null or missing. Receiving checks the reciprocal names and original source definition of each pair. It does not derive a source value from a display label or infer missing rows from a changed query.

Superset retains its original native column name, ordinal and type code in both members of each pair. Directus uses independently generated value and state aliases; its state name need not be the value name followed by _state. Directus value columns are non-null strings containing exact JSON text when the source field has a value. The original empty value cell plus its presence column distinguishes source null from missing. Keep that pair when downstream logic needs the distinction.

The Directus dictionary retains the original collection field and its applicable relations. Its projected primary key refers only to the value column of the original native primary field. A projection that excludes the key retains an incomplete key description. Superset keeps the exact reviewed row-key mapping. OData keeps its original entity-key interpretation.

Python's original read_delivery_semantics, sql_descriptor, sql_context and same_json interfaces stay unchanged. sql_descriptor binds reviewed SQL aliases to source fields and reports the actual retained key completeness; it does not create a new database constraint. SQLite, DuckDB and PostgreSQL keep their existing case and identifier rules, including sql_context(..., case_sensitive_targets=True) for the PostgreSQL consumer.

## Native agent receiving and analysis

The native MCP dataset receiver permits these four explicit published semantic schemas when the original SF100 manifest declares semantics.json. Its full original file/manifest/session checks, complete dictionary reads and retained file ranges remain the same.

The original native agent tool is sf43_discover_review_and_pay. After the host registers its original running AnalysisWorkspace alias, use action: analysis with that alias and the original operation-specific request:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "attach-dataset",
  "analysisRequest": {
    "acquisition_id": "ACTUAL_COMPLETED_NATIVE_DATASET_ID",
    "name": "received_source",
    "expected_revision": 0
  }
}
~~~

Read sources and use the actual returned revision for import. The existing job retains the immutable version_id. The semantics and semantics-file analysis operations read that original imported edition's checked dictionary and complete file. Existing query, query-export, report, publication, workbook and workspace archive operations consume the same edition.

The complete original agent workflow is [ANALYSIS.md](../../../stellar-forge/mcp-paid-agent/ANALYSIS.md), with [WORKBOOKS.md](../../../stellar-forge/mcp-paid-agent/WORKBOOKS.md) and [ARCHIVES.md](../../../stellar-forge/mcp-paid-agent/ARCHIVES.md). Source-document collections are registered by their existing host operation before agents select their source alias; use the original response-preview and response-import workflow for those documents.

## Source composition and receiving result

The complete joined source consists of:

- sf100-buyer-dataset-delivery/deliver.mjs: original canonical meaning, provider-specific source/column/key validation, page continuity and complete final output.
- sf88-operator-buyer-cli/dataset-page.mjs: original query pin and actual response-header continuity.
- sf88-operator-buyer-cli/python/stellar_forge_buyer/dataset_semantics.py: exact finalized dictionary/native/page bindings, source-specific structural validation and the existing SQL mapping.
- stellar-forge/mcp-paid-agent/native-dataset-meaning.mjs: original native delivery-file selection and full dictionary access.
- This operating guide.

A complete native receiving result retains the original source/capture and semantic identities, physical snapshot, every original page/request/response record, final manifest and full dictionary, imported row count, actual SQL aliases, complete query/report/workbook outputs and the original received customer workspace. Preserve the actual row and page counts from the selected original source.

A changed semantic pin, source/principal/query identity, reciprocal column definition, primary key, response header or selected dictionary byte causes the corresponding original receiver to report that exact mismatch. Resume its existing operation with the original selected source and recorded files, or use the source owner's reviewed new-edition workflow for a different source selection.
