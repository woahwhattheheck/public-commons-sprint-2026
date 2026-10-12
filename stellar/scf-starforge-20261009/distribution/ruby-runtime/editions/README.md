# Managed application data editions

The Data editions desk updates a received Rails application from a completed native or Baserow Ruby data packet. It retains the complete packet, prepares the existing Rails import preview, commits that exact preview to the application's existing tenant and stream, and exports the revised working application with its original source and history.

The application uses its original `Starforge::RailsDataset` mapping and four importer tables. The selected key columns, exact decimal and null handling, target scope, source membership, and removal policy continue to govern every revision. The current packet is resolved from the original SQL stream's committed edition and its retained operator review.

## Open the complete operator workflow

Start the installed customer workspace:

```sh
ruby-customer-workspace serve --directory /absolute/private/ruby-runtime
```

Open its printed private address and choose **Data editions**.

1. Choose the received application. Stop its active application process with the displayed control.
2. Select the completed packet format and its absolute directory. **Read selected source** opens its original manifest and dataset metadata. The preview supplies the exact manifest SHA-256 used by receiving.
3. Give the data edition a stable ID and title, and enter the operator identity. **Receive packet and prepare complete preview** retains that selection before launching the original runtime operation.
4. Open the original review. It contains the full preview counts, original source and mapping binding, prior stream revision, complete JSON and CSV previews, all indexed change records, and the exact preview SHA-256.
5. **Commit this exact preview** retains the approval and calls the original Rails importer. It recomputes the complete current target preview and compares its digest before the same transaction writes target changes, source rows, key state, edition history and receipt.
6. Use the application controls to verify and launch the updated Rails operator. Its source catalog includes every completely received data edition; its original pages expose full row changes, receipt history, and all applicable attachment links.
7. Stop and export the application with the existing runtime controls. The complete archive includes its current database, every received data packet and review, original mapping, receipt history, client sources, Gemfile lock and dependency cache. Ordinary runtime receiving opens it at a new private directory.

The source can contain zero records. For a complete empty snapshot, the original importer applies its declared removal policy to the previously active keys. By default, removed target records remain in the application with their importer key state marked removed. The native verifier checks every currently selected source row and distinguishes active keys from retained removed keys.

### Runtime support adoption

New environments retain the exact `engine.rb`, `application.rb`, and `editions/native.rb` support files in their original immutable selection.

An older environment retains its prior support selection. Export its stopped application, then receive that archive with the current installed runtime. Receiving preserves the original client, project, lock, cache, data and application history while selecting the current runtime support. The resulting application is ready for data editions. The browser's original **Applications**, **Operations** and **Receive** controls provide that complete path.

## Select the original completed packet

Two complete Ruby packet formats are supported:

| Format | Selected directory contains | Preserved content |
| --- | --- | --- |
| `native` | `dataset-customer.json` | Original complete SF100 scan or SF88 dataset session, native manifest, typed JSONL rows, CSV, original pages and source semantics where present |
| `baserow` | `baserow-delivery.json` | Complete compound Baserow customer packet, original received dataset, provider/query/projection membership, all applicable attachment bytes and original row/field/alias references |

These are the completed outputs of the maintained Ruby customer receiver. To receive a new original provider publication first, use the existing native dataset or Baserow customer workflow, preserving its original source key and selected customer identities. Select the completed Ruby packet it returns.

The mapping and tenant are taken from the managed application. A packet whose logical provider, query, projection, primary key mapping or target schema differs from that stream is rejected by the original importer before it becomes an available edition. Use a separately configured application stream when the actual logical selection changes.

Inspect a packet from the CLI:

```sh
ruby-application-editions source \
  --format native \
  --source-directory /absolute/private/received-dataset
```

The result includes the outer manifest filename, complete bytes and SHA-256, original dataset identity, row count, projected fields, snapshot and native query hash. An optional `--expected-manifest-sha256` pins that initial inspection to a supplied original digest. Staging subsequently opens and copies every complete original file and validates its actual Ruby/native bindings before generating the review.

## Complete CLI lifecycle

The installed `ruby-application-editions` command uses the same runtime methods as the browser. Every mutation reads a complete retained JSON request. Choose version-4 UUIDs once and preserve the original request file.

A stage request has this shape:

```json
{
  "id": "received-application",
  "editionId": "october-update",
  "title": "October source edition",
  "format": "native",
  "directory": "/absolute/private/received-dataset",
  "expectedManifestSha256": "THE_64_HEX_ORIGINAL_PACKET_MANIFEST",
  "reviewId": "THE_SELECTED_VERSION_4_REVIEW_UUID",
  "operationId": "THE_SELECTED_VERSION_4_OPERATION_UUID",
  "actor": "Application operator"
}
```

Replace the placeholder hashes and UUIDs with the actual source inspection and selected original values before saving the private JSON file.

```sh
ruby-application-editions stage \
  --directory /absolute/private/ruby-runtime \
  --input /absolute/private/stage-edition.json --wait

ruby-application-editions show \
  --directory /absolute/private/ruby-runtime \
  --id received-application --edition-id october-update
```

Read the resulting `reviews[].review.summary.preview_sha256` and its complete preview files. A commit request retains that exact selected review:

```json
{
  "id": "received-application",
  "editionId": "october-update",
  "reviewId": "THE_ORIGINAL_PREPARED_REVIEW_UUID",
  "expectedPreviewSha256": "THE_64_HEX_ORIGINAL_PREVIEW",
  "operationId": "THE_SELECTED_VERSION_4_COMMIT_OPERATION_UUID",
  "actor": "Application operator"
}
```

```sh
ruby-application-editions commit \
  --directory /absolute/private/ruby-runtime \
  --input /absolute/private/commit-edition.json --wait

ruby-application-editions file \
  --directory /absolute/private/ruby-runtime \
  --id received-application --edition-id october-update \
  --review-id THE_ORIGINAL_PREPARED_REVIEW_UUID \
  --name receipt.json --out /absolute/private/received-receipt.json
```

The file command streams the complete verified snapshot into an exclusive temporary file, syncs it, and publishes the selected destination. Repeating the command checks an existing destination against the original byte count and SHA-256. Omitting `--out` writes the complete original bytes to stdout.

Use `list` with `--offset` and `--limit` to page the complete received edition catalog. `show` returns its original selection, all reviews and receipts, original operations, and complete file descriptors.

### Changed targets and interrupted operations

An uncommitted review remains immutable. If the working data or preceding committed revision has changed, prepare a new review with this request:

```json
{
  "id": "received-application",
  "editionId": "october-update",
  "reviewId": "A_NEW_VERSION_4_REVIEW_UUID",
  "operationId": "A_NEW_VERSION_4_PREPARE_OPERATION_UUID",
  "actor": "Application operator"
}
```

Call `ruby-application-editions prepare --directory RUNTIME --input REQUEST --wait`, review the complete new result, and select its exact digest for commit.

A lost HTTP or CLI reply does not select a new operation. Repeat the same original request to observe it. The browser saves the complete selected request before dispatch and offers **Read original operation** and **Continue the same action**.

The ordinary `ruby-runtime` operation controls resume or cancel the same original UUID. The Data editions view exposes those controls beside its full log. An interrupted packet copy continues the original create-only receiver. An interrupted preview reopens its retained preview bundle. An interrupted commit reopens the original SQL operation receipt before any repeated target effects.

The runtime's environment and application admission locks coordinate stage, prepare, commit, launch, verification and export. The worker retains its original lease, generation, cancellation request and process group. Closing the desk drains its HTTP and file operations; the original background operation remains available in its runtime directory.

## JavaScript methods

`openRubyRuntime({directory})` and the complete customer workspace expose these additive methods:

| Method | Input | Result |
| --- | --- | --- |
| `previewApplicationEditionSource` | `{format,directory,expectedManifestSha256?}` | Exact completed packet metadata and selected manifest descriptor |
| `stageApplicationEdition` | `{id,editionId,title,format,directory,expectedManifestSha256,reviewId,operationId,actor}` | Original runtime operation |
| `prepareApplicationEdition` | `{id,editionId,reviewId,operationId,actor}` | Original runtime operation |
| `commitApplicationEdition` | `{id,editionId,reviewId,expectedPreviewSha256,operationId,actor}` | Original runtime operation |
| `applicationEditions` | `{id,offset?,limit?}` | `{applicationId,offset,total,nextOffset,editions}` |
| `applicationEdition` | `{id,editionId}` | Original source selection, reviews, native receipts, operations and files |
| `openEditionFile` | `{id,editionId,reviewId?,name}` | Complete unlinked file snapshot `{handle,name,bytes,sha256,type}` |

Close every returned file handle after consuming it. The runtime `close()` drains admitted methods. List limits are 1–100; the default is 25. IDs use the original runtime's 80-character identifier rule; review and operation IDs are original version-4 UUIDs.

Without a review ID, available names are `selection.json`, `source.json` and `source/<complete original member>`. With a review ID, names come directly from the original review descriptors, including `preview.json`, `preview.csv`, `changes.jsonl`, `mapping.json` and the committed `receipt.json`.

The customer HTTP server maps these same methods to `POST /api/editions/source|stage|prepare|commit`, `GET /api/editions`, `GET /api/edition` and `GET|HEAD /api/edition/file`. It reuses the original private loopback session, exact origin policy, complete hash-bound file snapshots and range downloads.

## Retained records and portable receiving

The existing application directory gains `data-editions/<edition ID>/selection.json`, `source.json`, and `source/` containing the complete copied packet. Its original operator directory retains each review, full preview bundle, copied source, approval and receipt.

The selection preserves the original application manifest, source format and digest, original source path, mapping digest, tenant, stream, actor and operation ID. Original paths remain source provenance. Reopened reviews read their own copied packet.

The original SQL stream's `latest_edition_id` resolves the committed operation hash. The manager locates that operation's original retained review, verifies its copied packet and receipt, and uses it for full current-target verification and the running application. A process restart after the SQL commit follows the same selected source.

Application export copies the complete stopped working tree and records every original file. Receiving verifies the full archive and opens the current source, actual target values and original receipt history at its new root. It preserves all original data-edition IDs and review UUIDs while assigning the received runtime's existing application identity.

## Continue an existing native customer operation

The executable example extends an already completed managed customer, using its retained original archive and selected Ruby/Bundler identity:

```sh
node SOURCE/stellar/scf-starforge-20261009/distribution/ruby-runtime/editions/examples/customer-editions.mjs \
  --managed-directory /absolute/private/original-managed-customer
```

It opens the original completed result, receives that same archive into a dedicated application with current runtime support, and uses its actual complete source packet. It records the full observed change counts, exact review and native receipt, opens the current Rails view, and verifies current targets and original history. It exports the revised application, parks its producer directory, receives the complete archive into a different runtime, opens the actual authenticated Rails review, and verifies the same target and history observation.

To select an actual later completed packet, add all three options: `--format native|baserow`, `--source-directory ORIGINAL_COMPLETED_PACKET` and `--manifest-sha256 ORIGINAL_HASH`. The source, edition ID and all operation/review UUIDs are retained before dispatch. An omitted later packet uses the customer's own retained original source and records the actual resulting unchanged-row revision.

The result is retained at `application-editions/application-editions-result.json` under the original managed directory. It includes complete source/review/receipt/file identities, observed changes, native HTTP receiving and original/recipient target-history observations. Repeating the same command verifies the complete received application's retained file inventory and original receipt.
