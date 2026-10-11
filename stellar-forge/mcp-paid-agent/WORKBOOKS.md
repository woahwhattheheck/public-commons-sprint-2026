# Native agent customer workbooks

Use the existing native MCP analysis connection to turn complete retained
customer results into an editable, reviewed Excel delivery. These operations
call the original running AnalysisWorkspace and its workbook engine. They
retain its definition revisions, source digests, build IDs, cancellation,
completed files and recurring-edition history.

The customer can use the same workbook in the existing Workbooks browser tab
or through the original Python workbook client. There is one database owner
and one build worker, regardless of which interface starts an operation.

## Host setup

Use the complete maintained source/package containing the customer workbook
and recurring-edition modules. In a source checkout these are under
`stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python`; the original
Python runtime must have its declared `workbooks` extra installed. Keep every
original Python module and native bridge selected by that source version.
The workbook feature does not add a new package build, parser or dependency.

Start the original analysis application using its supported launcher. Give
its original worksheet staging directory enough space on the selected
volume. For example, on a host which already has this source and environment:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/database serve
~~~

If that workspace is already open, retain its current process and private
launch file. Register its existing database with the native MCP host:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  analysis-register --dir /private/customer/mcp \
  --name customer --database /private/customer/database
~~~

Serve the same native workspace with the original MCP authentication. The
host registration contains the database path and exact workspace identity;
agent inputs contain only the `customer` alias. On each call the adapter
reads the current private launch capability and checks the running service's
workspace identity. A service restart can change its port and capability
without changing the saved registration. Closing MCP leaves the separately
owned original analysis application and its jobs with their host.

See [ANALYSIS.md](ANALYSIS.md) for the complete original setup, agent request
envelope, query/report preparation and backup workflow.

## Choose complete original sources

Every request uses the existing native action:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "workbook-sources",
  "analysisRequest": {"kind": "query-export", "limit": 25}
}
~~~

Call again with `kind: "report"` for published report sections. Copy each
selected source's original `kind`, `id`, `sha256`, and, for a report, `section`.
Use the returned `next_before` sequence unchanged to read the next page.

A query source must be an original COMPLETE query export with typed JSONL.
Its complete row count can exceed an earlier query preview. Report sources
are exact published sections; an unpublished report execution is not a
workbook source. The source picker returns the original ordered labels,
row count and source identity. It performs no SQL, acquisition or payment.

Use `workbooks` to page saved definitions, or `workbook-definition` with
`name` and an optional historical `revision` to reopen one.

## Save, review and build the workbook

Send `save-workbook` with a stable 32-character lowercase hexadecimal `id`,
the workbook's `name`, `expected_revision` (zero for a new name), title, notes
and all sheets. Each sheet selects one of the complete sources above.

The following request shape uses placeholders which must be replaced with
actual original source IDs and digests:

~~~json
{
  "name": "customer_operations",
  "id": "00000000000000000000000000000001",
  "expected_revision": 0,
  "title": "Customer operations",
  "notes": "Reviewed complete customer results.",
  "sheets": [{
    "name": "Inventory",
    "source": {
      "kind": "query-export",
      "id": "ORIGINAL_COMPLETE_QUERY_EXPORT_ID",
      "sha256": "ORIGINAL_MANIFEST_SHA256"
    },
    "columns": [
      {"source": "sku", "header": "SKU", "type": "text"},
      {"source": "units", "header": "Units", "type": "integer"},
      {"source": "note", "header": "Note", "type": "text",
       "null": "text", "null_text": "NULL"}
    ]
  }]
}
~~~

Generate a new stable request ID for each different intended save. Preserve
the complete request before sending it. A lost response can be recovered by
sending that same request again; the original store returns its historical
revision. Reusing its ID for different content is rejected. A stale expected
head is a revision conflict, so reopen and review the actual current
definition before choosing a different save.

Column choices use the original workbook rules:

- `source` is the original label. For report data, include the actual
  `source_index` when a label repeats; the engine checks label and position
  together. Ordinals are zero based.
- `type` can be `native`, `text`, `integer`, `number`, `decimal-text`,
  `boolean`, `date`, `datetime-utc`, `datetime-local`, or `binary-base64`.
- `precision: "preserve"` keeps values beyond Excel's numeric precision as
  text. `excel-number` explicitly chooses Excel numeric representation.
  `decimal-text` retains the original decimal spelling and scale.
- `null: "text"` and `null_text` select the displayed null label.
  `null: "blank"` selects an empty Excel cell. The handoff retains the
  original distinction between null and empty text.
- Source strings, including values starting with `=`, remain literal text.
  The original writer validates Excel cell and sheet limits.

After saving, call `workbook-preview` with the returned `name`, `revision`,
`definition_sha256`, chosen sheet ordinal and a sample limit. Review the
actual projected cells and their conversion/type annotations. The result's
`preview_only` flag states whether more original rows exist. The adapter
checks the exact definition digest before returning this preview.

Build by calling `workbook` with a new stable job `id` and the exact saved
`name`, `revision`, and `definition_sha256`. This invokes the original
`/api/start/workbook` worker, which iterates every row of the pinned sources.
Reopen the same ID with the existing `job` operation to read its actual
status and progress. Use `workbook-runs` for paginated original history and
`cancel-workbook` to request cancellation of the original worker.

A COMPLETE job contains the exact workbook, ZIP and manifest records.
Completed delivery recovery is owned by the original application. An
interrupted or failed job retains its original outcome; do not silently
replace its request ID or assert that its partial files are complete.

## Receive complete original files

For each selected completed file, call `workbook-file` with:

~~~json
{
  "id": "ORIGINAL_COMPLETE_BUILD_ID",
  "filename": "handoff.zip",
  "manifest_sha256": "ORIGINAL_BUILD_MANIFEST_SHA256",
  "sha256": "ORIGINAL_FILE_SHA256",
  "byteOffset": 0,
  "maxBytes": 65536
}
~~~

The supported files are `workbook.xlsx`, `handoff.zip` and `manifest.json`.
The adapter checks the original COMPLETE build, its expected workspace and
directory, definition identity, current manifest and chosen file digest.
It shares the native SavedFileReader cache: a changed descriptor is verified
before use, and subsequent calls read only the requested bytes. It does not
download the entire file through HTTP for each chunk.

The result gives the original file identity, `encoding: "base64"`, the
requested offset, `returnedBytes`, `data`, `nextByteOffset` and
`verifiedSavedFile: true`. Keep the same manifest and file hashes for every
range. Append decoded bytes only at the expected offset, and use the returned
next offset. End-of-file is explicitly `nextByteOffset: null`. On reconnect,
reopen the original job and continue the same selected file.

The receiving customer should stream the bytes into its own private
temporary file, retain its selected offset/identity, and verify the entire
final size and SHA256 before publishing the download. Never replace an
unrelated existing destination. No agent-supplied local path is accepted by
the MCP tool.

Receive the downloaded handoff using the existing original receiver:

~~~sh
python -m stellar_forge_buyer.analysis_workbooks receive \
  --archive /private/customer/handoff.zip \
  --destination /private/customer/received \
  --sha256 ORIGINAL_HANDOFF_SHA256
~~~

The original receiver verifies every retained member and the complete
manifest/history. It extracts into private source-bound staging and
atomically publishes the complete destination without replacing an existing
directory. Reuse the exact source, digest and destination after an
interrupted extraction. Reopen without a live analysis service:

~~~sh
python -m stellar_forge_buyer.analysis_workbooks inspect \
  --delivery /private/customer/received \
  --manifest-sha256 ORIGINAL_BUILD_MANIFEST_SHA256
~~~

The existing `WorkspaceWorkbookClient` and `stellar-forge-workbook-deliver`
remain available for a host-driven complete save/build/download/receive
workflow. See the original
[customer workbook guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/WORKBOOK_DELIVERY.md).

## Review and deliver a recurring edition

The native interface also calls the original recurring-edition engine.

1. Read `workbook-definition` at the exact base revision and retain its
   `definition_sha256`.
2. For each worksheet, call `workbook-candidates` with `name`, `revision`,
   `definition_sha256`, `sheet`, and optional `before`/`limit`.
   Query-export candidates follow original SQL and typed parameters.
   Report candidates follow the saved report/query and section lineage.
   Page the original cursor even when a scanned page has no matching item.
3. Inspect the returned source identities, row counts, schema/order changes,
   duplicate labels, SQL/parameter/view changes and unresolved columns.
   These are retained result editions; a different query or projection is
   not evidence of upstream record movement.
4. Form a proposed definition containing every existing worksheet in order.
   Keep the exact old source and mapping for a worksheet being retained.
   For a replacement, use the chosen complete source ID/digest and explicitly
   resolve renamed/repeated columns. Retain original positions for report
   cells. Dropping a column means omitting it from that sheet's projection.
5. Call `workbook-refresh-review` with `name`, `base_revision`,
   `definition_sha256`, `expected_revision`, an accurate `reason` and that
   complete `definition`. Read the original per-sheet review, cell samples,
   errors, `ready` and `review_sha256`.
6. After reviewing that result, call `workbook-refresh-save` with the
   identical fields plus a stable new `id` and its exact `review_sha256`.
   The original engine recomputes the source/mapping review and performs its
   definition CAS. A repeated exact request recovers the same saved revision
   after a lost response.
7. Build and receive that returned revision using the same original
   `workbook`, `job`, `workbook-file` and offline receiving operations.

The refresh digest covers the base and proposed definitions, expected
revision, reason and full before/after source bindings. Current-head display
information is outside that immutable review digest, preserving exact replay
after a committed save. Host-only source directory fields are omitted from
the agent's lineage display; the original service retains the full reviewed
record and remains the authority for its digest.

A refreshed handoff carries exact predecessor definitions at
`history/definition-N.json`, their complete original sources, and the
current workbook/definition. The original offline receiver verifies that
descending history chain. Earlier definitions and completed files retain
their original bytes.

## Operation reference

| Native analysis operation | Original application operation |
| --- | --- |
| `workbooks` | Existing `state.workbooks`, paged for the tool |
| `workbook-sources` | `GET /api/workbook-sources` |
| `save-workbook` | `POST /api/workbooks/NAME` |
| `workbook-definition` | `GET /api/workbooks/NAME?revision=N` |
| `workbook-preview` | `GET /api/workbooks/NAME/preview` with exact definition check |
| `workbook` | `POST /api/start/workbook` |
| `job` | Existing `GET /api/jobs/ID` |
| `workbook-runs` | `GET /api/workbook-runs` |
| `cancel-workbook` | `POST /api/workbook-runs/ID/cancel` |
| `workbook-file` | Original COMPLETE workbook build plus shared native file reader |
| `workbook-candidates` | `GET /api/workbooks/NAME/refresh` |
| `workbook-refresh-review` | `POST /api/workbooks/NAME/refresh-review` |
| `workbook-refresh-save` | `POST /api/workbooks/NAME/refresh` |

Use the original generic analysis `backup` and exact verified `file`
operations when transferring the retained SQLite state. External native
sources and workbook/query-export directories are separate artifacts; a
database backup alone does not include them. A finished workbook handoff
already carries its complete selected typed sources and predecessor
definitions for offline receiving.
