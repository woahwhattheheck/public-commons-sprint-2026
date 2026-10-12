# Study extraction from Python and Merchant

This transport operates the existing authenticated Research workspace and the single study-extraction/publication engines. Forms, independent drafts, submissions, resolutions, table editions, publication impact and every source binding remain in the original dossier history. No separate listener or authentication system is created.

## Python

Use the existing `ResearchWorkspace` connection, checkout, private call directory and lifecycle. The new facade is `workspace.extraction(dossier_id)`. It uses the existing Node bridge; typed source numbers remain original `["number","..."]` arrays, and source strings remain `["str","..."]`. Python never converts those payload strings to floats.

```python
from stellar_forge_buyer import ResearchWorkspace

with ResearchWorkspace(
    checkout="/absolute/current-sdk",
    connection_file="/absolute/original/console.json",
    directory="/absolute/private/python-calls",
    expected_workspace_id="research_<original 64-hex identity>",
) as workspace:
    extraction = workspace.extraction(dossier_id)
    view = extraction.read(revision=revision, section="overview")
    values = extraction.source_values(
        occurrence_id,
        ["/protocolSection/identificationModule/nctId"],
        revision=revision,
        file_name="study.json",  # Only when this is the actual retained member.
    )
    all_results = list(extraction.iter_records(
        section="results", revision=revision, result_set_id=result_set_id
    ))
    tables = extraction.publications(
        revision=revision, table_id=table_id, publication_id=publication_id
    )
```

Omit `file_name` for original textual record content. For a SourceBundle use its actual file member, including its original spelling. The store resolves that member with the original SourceBundle byte reader before the maintained Decimal parser sees it.

The complete Python read methods are `read`, `iter_records`, `source_values`, `publications` and `iter_publications`. The mutation methods are `review` and `review_publication`. Each accepts the complete original five-field request:

```json
{
  "requestId": "a-retained-request-id",
  "expectedRevision": 12,
  "actor": {"id": "registered-reviewer", "name": "Registered reviewer"},
  "action": "save-extraction",
  "data": {"resultSetId": "the-original-result-set", "answers": [], "reason": "Actual review reason"}
}
```

The example illustrates the envelope only: supply the complete action data required by the native engine, including all required answers. The action contracts live in `study-extraction.mjs` and the original publication module. An inclusion decision and an authored extraction value are distinct workflow records.

Before a mutation, Python retains its exact request, original expected revision, workspace identity and replay-safe flag in the existing call journal. After an interrupted reply, inspect `extraction.saved_request(request_id)` and use `extraction.recover(request_id)`, or call the same mutation with `resume=True`. Do not replace the expected revision to manufacture a new request after an uncertain result. The engine resolves an exact committed replay before a stale-revision check.

`export(file, revision=..., form_id=..., result_set_id=..., format=...)` retains the complete original extraction report in JSON, Markdown or HTML. `export_publication(file, revision=..., table_id=..., publication_id=..., format=...)` supports JSON, CSV, Markdown and HTML. `against_publication_id` selects the original comparison export when supplied. The method returns the existing `FileDelivery`; its `.open()` verifies the complete retained bytes. `export_portable` delegates to the original whole dossier JSON/gzip export and includes all protocol, source, extraction and publication histories.

The existing Python Research CLI gains:

- `extraction-view`, `extraction-source-values`, `extraction-publications`.
- `extraction-review --request FILE [--resume]` and `extraction-publication-review`.
- `extraction-saved-request --request-id ID` and `extraction-recover`.
- `extraction-export --revision N --format json|md|html FILE` and `extraction-publication-export --revision N --format json|csv|md|html FILE`.

Use the original global `--checkout`, `--connection`, `--directory`, `--node` and timeout arguments. The source-values command supports repeated `--pointer` or one `--pointers-file`, plus optional `--file-name`.

## Merchant tools

Configure and attach the original Research workspace through the existing Merchant Research configuration. Its `directory` is the original server workspace directory, whose path supplies the existing expected workspace identity. Private Merchant export storage remains the existing `exportsDirectory`.

The catalog adds five operations:

| Tool | Native operation |
| --- | --- |
| `merchant_research_extraction` | Read complete extraction sections at a selected revision. |
| `merchant_research_extraction_source_values` | Resolve original source pointers, with optional `fileName`. |
| `merchant_research_extraction_review` | Commit or replay one original extraction request. |
| `merchant_research_extraction_publications` | Read original table, publication and impact sections. |
| `merchant_research_extraction_publication_review` | Commit or replay one original publication request. |

All mutation fields stay intact. Only their explicitly open `data` object allows native action fields; existing closed Merchant argument objects retain exact-field validation. The original domain validates action-specific types, source locators, forms, reviewer authority, dependencies and concurrent revisions. Metadata projection is selected by the existing HTTP route, not inserted into the native five-field request.

The existing `merchant_research_export` gains `extraction-json`, `extraction-md` and `extraction-html` for the original report selected by `formId`/`resultSetId`, plus `extraction-publication-json`, `extraction-publication-csv`, `extraction-publication-md` and `extraction-publication-html`. Use `revision`, `tableId`, `publicationId` and optional `againstPublicationId`. Complete files flow through the original content-addressed export store, receipt inventory, `merchant_research_file_read` and `merchant_research_file_release`. No export is truncated into the model response.

Later pages retain the same revision and selection. Views use the actual flat `{dossierId, revision, ...}` envelope. Source-values retain the complete original occurrence, content hash/byte length, parser identity and ordered pointer results. Missing members, JSON null, strings, booleans and exact decimal tokens remain distinct.

## Whole original receiving continuation

`study-extraction-merchant-receiving.mjs` exports:

```js
await runStudyExtractionMerchant({
  connectionFile,
  workspaceDirectory,
  expectedWorkspaceId,
  dossierId, revision,
  formId, resultSetId, tableId, publicationId,
  source: {occurrenceId, fileName, pointers, sha256, bytes},
  replayRequests: [
    {kind: 'extraction', file: extractionRequestFile,
     sha256: exactRequestFileSha256, operationId: committedExtractionOperationId},
    {kind: 'publication', file: publicationRequestFile,
     sha256: exactPublicationRequestSha256, operationId: committedPublicationOperationId}
  ],
  runDirectory,
  signal
});
```

Omit `fileName` when no member is selected; `againstPublicationId` is optional. The source digest/byte length describes the exact textual record or selected original file. Each replay file contains exactly the original request JSON bytes, not an outer caller/result envelope.

This continuation:

1. Attaches to the original listener and checks the actual workspace/dossier revision.
2. Retains every extraction and publication page, including original operations and source history.
3. Resolves every supplied source pointer and checks its original content identity.
4. Finds each selected request in already-committed native operation history before allowing a replay; requires the same operation and `duplicate:true`.
5. Retains the complete original source record/member, all three extraction report formats, all four publication formats and both whole-dossier portable formats through the existing Merchant file pipeline.
6. Reads every byte from the original hash-pinned chunk reader and uses the existing atomic, write-once portable file publisher.
7. Drains its own attachment and file readers. The original server stays with its caller.

The original programme owns the process and `runDirectory`. The helper persists steps and original selections in `merchant-receiving.json`; a restart reuses completed steps and independently verifies every retained file. If an export reply was lost, it first consults the original export receipt inventory. A completed invocation reopens its retained result without replaying the native workflow.

The return schema is `sf88-research-study-extraction-merchant-receiving/v1`. It contains `state:"COMPLETED"`, original selection IDs/revision, `source` with values/content/record file descriptors, full page descriptors/counts, exact replay request/response descriptors, eleven complete export descriptors, `files`, `journalFile` and `completedAt`. Every file descriptor is `{file,relative,bytes,sha256,contentType}`; `file` is the actual absolute native path. Each export additionally carries its original `kind`, `exportId`, `selection` and `receiptFile`.

The complete customer programme remains the existing source/browser/native/portable receiving operation. This helper has no alternate model, scientific transformation, source download, payment or customer-send action.
