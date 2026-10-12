# Use a saved native purchase in analysis

The native MCP buyer can attach an already saved object or response to its
host-registered AnalysisWorkspace. The same response workspace then reviews
record collections and typed mappings, imports the complete selected data,
runs saved SQL, publishes reports and builds editable workbooks.

Attachment reads existing local custody. It does not acquire, execute,
recover, finalize or assemble a purchase. The original request outcome and
payment classification remain unchanged.

## Host setup

Use the existing native MCP workspace and one matching, complete source
installation. The Python analysis service and native MCP service must be able
to read the same private retained files.

Start the original Python service with its selected private database:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /PRIVATE/customer-analysis \
  --checkout /INSTALLED/source \
  --node /SELECTED/node \
  serve --port 0
```

Register that running service through the existing native host command:

```sh
node /INSTALLED/source/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  analysis-register --dir /PRIVATE/native-mcp --name customer \
  --database /PRIVATE/customer-analysis
```

The host retains only the original workspace identity and directory alias.
Each analytical call reads the current private launch capability and checks
the identity of the original service. The model supplies the alias, existing
purchase ID and analytical request; it does not supply a local path or token.

The existing `native-workspace-cli.mjs serve --dir /PRIVATE/native-mcp`
command exposes these actions in `sf43_discover_review_and_pay`, alongside
the existing purchase, dataset and workbook actions. Use the original MCP
access configuration described in NATIVE_WORKSPACE.md.

## Select the original saved source

Use ordinary `history` and `status` to inspect direct native requests, or
`object-history` and `object-status` for object acquisitions. The attachment
does not change these histories.

All calls below use the existing tool envelope:

```json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "attach-response",
  "analysisRequest": {
    "name": "orders",
    "intent_id": "EXISTING_ORIGINAL_INTENT_ID",
    "format": "json",
    "expected_revision": 0
  }
}
```

For an already assembled JSON or CSV object, use:

```json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "attach-object",
  "analysisRequest": {
    "name": "inventory",
    "acquisition_id": "EXISTING_ORIGINAL_ACQUISITION_ID",
    "format": "csv",
    "expected_revision": 0
  }
}
```

### Existing CLI or SDK inboxes

A host can grant read-only access to an existing original SF88 inbox once,
without copying any request or rerunning its buyer:

```sh
node /INSTALLED/source/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  analysis-inbox-register --dir /PRIVATE/native-mcp --name original_buyer \
  --inbox /PRIVATE/existing-original-session/inbox
```

This immutable binding includes the exact original inbox manifest hash. The
same alias cannot be repointed at another inbox. Use `response-inboxes` to
list the registered names, then `saved-responses` with
`{"inbox_alias":"original_buyer","offset":0,"limit":25}` to discover the
original intent IDs, outcomes and saved-file identities. Listing never calls
run or recovery. A failed partial result remains visibly partial and is not
attachable through this complete-source path.

For one of those original intents, add `"inbox_alias":"original_buyer"` to
`attach-response`. Omit the alias to use this native MCP workspace's ordinary
request inbox. Both paths retain original request/configuration/attempt/terminal
identity and use the same original queue validator. The alias grants data
reading only; it does not grant approval, signing or execution authority for
that external inbox.

The source names in these examples are new analytical aliases. Replace the
capitalized IDs with the original IDs returned by this native MCP workspace.

| Attachment | Required retained custody | Formats |
| --- | --- | --- |
| `attach-object` | Complete original SF88 object session, existing MCP delivery and original recorded assembly receipt | JSON, CSV |
| `attach-response` | Original MCP request, original inbox request/configuration/attempt/terminal and a `SAVED` response file | JSON, CSV, NDJSON, SSE |

Binary objects remain available through the original object file actions.
They do not become tabular data merely because a JSON or CSV format was
selected. The original reader reports unsupported or invalid content during
inspection.

A missing or incomplete native delivery is reported without creating a new
attempt. Existing partial stream aliases can still be used through the
original response workspace. Native saved-response attachment requires the
original complete saved file; it does not reclassify a failed partial file
as complete.

## What is bound before registration

The native host derives the selected paths from its retained request or
object acquisition. It uses the existing queue/session validator and saved
file reader. The Python service independently performs the same native
selection before it commits the source alias.

For a direct response, this includes the original source configuration,
normalized execution configuration, request, attempt and terminal, plus any
retained request body or operation ticket. The complete saved response must
match the original destination, byte count and SHA-256. No new result receipt
is written. The Python consumer envelope retains the original terminal
summary and actual configuration/result hashes without inventing a process
exit code or successful payment.

For an object, this includes the merchant description, selected object,
configuration, session binding, complete delivery and original assembly
receipt. The original ObjectBuyer selects that same recorded assembly and
performs its native validation. Attachment cannot manufacture a missing
assembly receipt.

The source reply exposes `native_source.sha256` and its portable binding.
Its input identities contain original roles, byte counts and SHA-256 values;
host paths stay in the private source registration. The binding survives the
mapped data manifest, original DatasetDatabase import, saved queries, reports
and workbook source records.

## Review the complete projection

Call `response-source` with the returned source name and revision to inspect
the actual collections and field hints. Its sample is bounded and explicitly
labelled. Choose the collection and column types before starting the original
complete projection.

For example, an original JSON response with an `orders` array might use:

```json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "response-preview",
  "analysisRequest": {
    "id": "0f51ef0786a943e6a17a7a513f51c199",
    "source": "orders",
    "source_revision": 1,
    "mapping": {
      "collection": "/orders",
      "columns": [
        {"name": "order_id", "pointer": "/id", "type": "text"},
        {"name": "units", "pointer": "/units", "type": "integer"},
        {"name": "amount", "pointer": "/amount", "type": "text"},
        {"name": "fulfilled", "pointer": "/fulfilled", "type": "boolean"}
      ]
    }
  }
}
```

Choose pointers and types from the actual source. Decimal strings should
remain text when exact scale matters. A `number` mapping intentionally
selects a floating-point SQL value. Missing-field handling is explicit:
`error` by default, or `null` for a reviewed nullable column.

The existing response engine exhausts all selected retained records before
publishing the preview. It retains mapped row/byte counts, the complete
output digest, exact mapping, source identity and provider truncation
declarations. Poll the original `job` ID until it is complete; preserve the
same ID when recovering an uncertain reply.

Import using that completed preview's exact ID and digest:

```json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "response-import",
  "analysisRequest": {
    "id": "943ec1c4b737405dbb0ac02a6d423765",
    "preview_id": "0f51ef0786a943e6a17a7a513f51c199",
    "preview_sha256": "COPY_THE_ACTUAL_64_CHARACTER_PREVIEW_SHA256"
  }
}
```

An originally declared truncated result requires the existing explicit
`allow_incomplete` acknowledgement. This represents all retained selected
records, not an assertion that the provider returned every possible record.
A projected response remains a response-derived data edition; it is not
relabeled as an SF100 delivery or another purchase.

## NDJSON and SSE

Select `ndjson` or `sse` only for an original saved response in that format.
The Python integration invokes the existing native retained-stream exporter.
Its original framing, final-record, count and all-byte checks remain active,
and its stable request fingerprint reuses the same retained export on later
inspection. No connection is reopened.

NDJSON record values use their original collection and field pointers.
SSE retains event, ID, retry and data fields. Select the existing mapping's
`sse_data: "json"` only when the original event data is application JSON;
ordinary text data stays text. Provider completion and truncation remain
visible in the original projection manifest.

## Continue through SQL, reports and workbooks

After the import, use the existing `activate` operation to select the returned
immutable version under a named SQL view, with the current expected view
revision. Review `state.views` and pass that complete selection to the
original query/report operations.

The maintained ANALYSIS.md documents saved SQL, one-snapshot multi-query
reports, publication, complete JSONL/CSV/SQLite exports and private backup.
WORKBOOKS.md documents typed editable sheets, original source attachments,
refresh review/save, interrupted downloads and offline receiving. These
operations use the same imported data and retained source binding. They do
not call the merchant again.

## Revisions, restart and recovery

A new alias uses `expected_revision: 0`. A different source selected under an
existing name requires its current revision. Registration verifies the actual
source before that original compare-and-swap transaction; stale native
bindings or alias revisions fail before another revision is committed.

Reattaching the identical original source returns the same source revision
after current file and native metadata verification. The exact verified
native binding is returned even for an existing identical alias. Reopening a
registered historical source verifies that its original native inputs still
match before it is projected again.

After process restart, reopen the same original Python database and native
MCP workspace. The original analysis alias, source revisions, imported
versions, jobs, query/report/workbook identities and completed files remain
available. A new service launch supplies its own current private capability.

The database backup retains imported mapped rows, mappings, source identity,
jobs, SQL and report state. The original native MCP workspace, operator
configuration, inbox/assembly receipts and raw purchase files remain separate
private custody and are needed for a new preview or projection. The portable
workspace feature carries its selected analytical files; it does not create
a replacement native purchase history. Retained imported data can still be
queried and reported without another acquisition.

