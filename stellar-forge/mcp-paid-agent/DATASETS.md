# Complete datasets in the native MCP buyer

The existing native MCP buyer can acquire a complete paginated SF30 dataset, keep the original page approvals and accounting, deliver it through SF100, and give an agent typed rows or exact saved files. The agent keeps one acquisition ID throughout preparation, execution, interruption, delivery and reopening.

This is the customer workflow over the existing [dataset session](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-session.mjs), [dataset CLI](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs) and [SF100 delivery](../../stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/README.md). Ordinary API requests, complete object requests and dataset purchases share the native workspace's original operator approval gate.

## Register the original merchant description

Start with the existing private SF88 workspace configured for the merchant's HTTPS GET dataset route and its original payment terms. Its base URL must have no query parameters. Its original signer, operator, ledger, asset, network, payee and transport remain the selected settings.

Initialize the MCP workspace in the normal way, then register the merchant's original saved dataset description:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs init \
  --dir /private/mcp-buyer \
  --workspace /private/existing-sf88-buyer

node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs datasets-register \
  --dir /private/mcp-buyer \
  --description /private/received/original-dataset-description.json
~~~

Use the original SF30 dataset description object: its dataset name, snapshot, columns and declared types/capabilities, row count, default page limit and maximum page limit. Registration preserves its exact bytes. The returned source ID is the SHA-256 of those bytes. A new published dataset edition is registered as a new source; existing acquisitions keep their original edition.

Registration is a host operation. The MCP tool has no argument that reads an arbitrary local path, replaces a signer, imports credentials or selects a different workspace.

The existing private catalog configuration can be supplied with the normal `init --catalog` option when it is not already part of the original SF88 workspace. See the [native workspace CLI](./native-workspace-cli.mjs) and [object customer guide](./OBJECTS.md) for the shared host setup and serving path.

## Select and retain a query

Use the existing tool `sf43_discover_review_and_pay`. First inspect the registered dataset:

~~~json
{"action":"dataset-sources","limit":25}
~~~

~~~json
{"action":"dataset-describe","sourceId":"REPLACE_WITH_RETURNED_64_HEX_SOURCE_ID"}
~~~

The description reports the merchant's real columns and enabled capabilities. Query values are strings in the original HTTP query format:

| Input | Meaning |
| --- | --- |
| `fields` | Comma-separated projected field names, in the desired original output order |
| `limit` | Rows in each original page, within the merchant's declared maximum |
| `where_COLUMN` | Equality selection on an enabled filterable column |
| `gt_COLUMN`, `gte_COLUMN`, `lt_COLUMN`, `lte_COLUMN` | Enabled typed range bounds |
| `sort` | An enabled sortable column, prefixed with `-` for descending |
| `snapshot` | Optional exact generation selector for an original version-store route that supports it; a different value is refused |

The selected snapshot is always pinned in the original native session and checked against every received page. The plain original CSV route does not accept a `snapshot` URL parameter, so the adapter forwards that parameter only when explicitly selected for a supporting version-store route. The original native session chooses each subsequent cursor. Initial cursor injection is refused.

For example, the retained inventory example exposes `sku`, `units` and `available`. After choosing the returned source ID and caps appropriate to the configured offer:

~~~json
{
  "action":"dataset-prepare",
  "acquisitionId":"inventory-available-20261011",
  "sourceId":"REPLACE_WITH_RETURNED_64_HEX_SOURCE_ID",
  "query":{
    "fields":"sku,units,available",
    "where_available":"true",
    "sort":"units",
    "limit":"2"
  },
  "maxAtomic":"1000",
  "maxTotalAtomic":"20000",
  "maxPages":20,
  "maxRows":1000,
  "maxPageBytes":1048576
}
~~~

The amounts above are example atomic-unit ceilings, not a quote. Select amounts for the actual original offer and asset. `maxAtomic` may be omitted to use the existing workspace's per-page cap. The whole-query cap, page count, row count and page byte ceiling are explicit. A whole-query cap must cover at least one page cap. The original cumulative and daily ledger policy still applies.

Preparation returns the normalized exact query, selected column definitions, typed filters/ranges, snapshot, limits and original native session identity. It creates no page attempt or payment. Repeating the same acquisition ID and selection reopens that request. Changing its source, query or limits under that ID is refused; use a new meaningful ID for a different purchase.

The stored review also pins the existing operator configuration, workspace descriptor, policy and signer source. A changed setup must be reviewed as a new acquisition before buying more pages. This does not replace the original per-page quote/terminal approval.

## Run, interrupt and recover the same acquisition

~~~json
{"action":"dataset-run","acquisitionId":"inventory-available-20261011"}
~~~

The original dataset CLI executes untouched pages and retains the original page response and evidence. It uses the selected original workspace's keys, current terms/caps and evidence RPC through `queue.workspaceExecution`. The original executor still performs its terminal preflight before writing an attempt marker.

A tool call does not constitute payment approval. Each required approval is the original buyer's independent operator decision. Ordinary requests, objects and datasets cannot compete for this host's approval terminal.

To inspect progress or request cancellation:

~~~json
{"action":"dataset-status","acquisitionId":"inventory-available-20261011","offset":0,"limit":25}
~~~

~~~json
{"action":"dataset-cancel","acquisitionId":"inventory-available-20261011"}
~~~

Cancellation signals this host's active acquisition or finalization command and awaits its exit. Completed pages stay saved. A response that was attempted but not completed is retained for the original native recovery/accounting path; it is never automatically requested again.

If a process was lost, use:

~~~json
{"action":"dataset-recover","acquisitionId":"inventory-available-20261011"}
~~~

Original recovery checks the retained lock owner and only recovers a proven-dead same-host process. It inspects the existing response/evidence files; it does not buy a page. A later explicit `dataset-run` can continue when the original state is `READY`. Completed and reconciliation-required states return their existing native status without dispatching a child or requiring a new-purchase configuration.

A constructor interrupted before its final session manifest leaves its files in place. Repeating the original prepare request resumes a completed native constructor or preserves an empty incomplete generation before creating the next one. A generation containing native page/evidence work is never silently abandoned.

## Deliver and use the complete dataset

Once the original acquisition reports `COMPLETE`:

~~~json
{"action":"dataset-deliver","acquisitionId":"inventory-available-20261011"}
~~~

This invokes the original offline SF88-to-SF100 delivery. The result is a complete native data room with:

- `dataset.jsonl`: original typed rows;
- `dataset.csv`: the original portable CSV;
- `review.html`: the native review document;
- `manifest.json`: original query, page identities, source/evidence hashes, chain digest and output hashes.

The response lists each file's SHA-256 and byte size, the exact query/snapshot, and the original source binding. A repeated delivery reopens and verifies the same files with zero appended pages. A partial native room remains available to the original delivery recovery logic.

Typed rows are bounded by row count and response bytes:

~~~json
{
  "action":"dataset-rows",
  "acquisitionId":"inventory-available-20261011",
  "offset":0,
  "limit":50,
  "maxBytes":32768
}
~~~

Values remain JSON strings, numbers, booleans and nulls; the reader does not coerce them to display text. Continue at `range.nextOffset`. `maxBytes` is the row-array byte budget (2–65,536), while `limit` is at most 100 rows. Metadata is returned separately.

If the next individual row exceeds the selected response budget, the result includes its exact byte offset and an explicit `dataset-read` action. That row is not silently skipped and the same row offset remains available. Increase the allowed row budget when possible, or consume its original JSONL bytes.

Exact file access is also bounded:

~~~json
{
  "action":"dataset-read",
  "acquisitionId":"inventory-available-20261011",
  "filename":"dataset.csv",
  "byteOffset":0,
  "maxBytes":65536
}
~~~

The native saved-file reader returns base64 bytes, the original whole-file hash and `nextByteOffset`. Decode and concatenate the returned ranges in order; do not reserialize the manifest or CSV. A small complete UTF-8 file can additionally have a `text` field.

The existing reader hashes an opened file once, retaining its exact descriptor identity and expected SHA. Later unchanged reads use that verification cache; changing the file invalidates it. Typed previews stream through the same reader and keep small row-offset checkpoints, avoiding repeated whole-dataset hashing or buffering the entire data room.

## Accounting stays with the original purchase records

~~~json
{"action":"dataset-accounting","acquisitionId":"inventory-available-20261011","offset":0,"limit":25}
~~~

~~~json
{"action":"dataset-finalize","acquisitionId":"inventory-available-20261011","offset":0,"limit":25}
~~~

Follow the original accounting `range.nextOffset`. Finalization reconciles existing attempts through the original finalizer and ledger; it does not fetch another product page. It remains available when a later policy/signer change prevents a new purchase.

The delivered file's existence, HTTP success and local hashes do not decide payment outcome. The separate original accounting response retains actual outcomes, including `NO_PAYMENT_REQUIRED` for an unsigned native example.

## Reopen and hand off the existing source

Restart the same configured MCP workspace and inspect:

~~~json
{"action":"dataset-history","limit":25}
~~~

History identifies retained requests and complete delivery availability without silently starting work. Use the saved acquisition ID for status, rows, files and accounting.

For the existing analysis integration, the trusted host can call:

~~~js
const source = await nativeWorkspace.completedDataset(acquisitionId);
~~~

This verifies the original complete session, SF100 source/manifest binding and saved files. It returns the exact original `session` and `room`, session/configuration identities, source/snapshot/query, and native output paths/hashes. The host passes that existing source to the original analytical workspace. The MCP caller selects a retained ID rather than supplying local paths; the handoff performs no new acquisition or payment.

## Source layout

- [native-datasets.mjs](./native-datasets.mjs): original descriptor custody, saved acquisition selection, original lifecycle calls, complete delivery and bounded typed reads.
- [native-workspace.mjs](./native-workspace.mjs): the shared operator gate and dataset dispatcher.
- [native-workspace-cli.mjs](./native-workspace-cli.mjs): host registration and the existing serve/call path.
- [mcp-buyer-acceptance.mjs](../../stellar/scf-starforge-20261009/sf43-agent-commerce/mcp-buyer-acceptance.mjs): the existing tool's dataset action schema.
- [dataset-session.mjs](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-session.mjs): the original acquisition engine, with optional selected-workspace execution for query-specific configurations.

