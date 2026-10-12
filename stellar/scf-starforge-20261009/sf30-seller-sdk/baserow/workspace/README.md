# Baserow source workspace

A complete local workspace for turning an existing Baserow shared grid or table into a reviewed data product. Inspect the real fields, capture the selected rows and files, edit a source projection, retain versions, and use the original dataset publisher and merchant release controls.

The browser, CLI and trusted model API use the same durable source workspace. A saved request ID reopens its original operation after a lost reply. Captures, source versions, published candidates and customer files keep their original identities.

## Start the workspace

Use Node 24 on Linux with util-linux flock. Choose an absolute private project directory and keep host connection files private (0600). The workspace creates its own private source database and subdirectories.

From the repository root:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/cli.mjs init \
  --directory /absolute/private/baserow-project

node stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/cli.mjs serve \
  --directory /absolute/private/baserow-project \
  --connections /absolute/private/baserow-connections.json \
  --port 0
~~~

Open the complete private URL printed by the server. Keep that process running while operating the workspace. The default fixed port is 8462; port 0 selects a free loopback port. **serve --create** combines initialization and startup for a new directory. **init --target** selects a separate dataset directory; the default is the project's dataset subdirectory.

The installed entry point is **starforge baserow-workspace**. The source entry above exposes the identical commands.

A project can be opened without live connections to import, review and receive an already retained source. Its publisher and deployment controls use the same saved versions.

### Host connection file

Connections select an API server and source kind. Credential values remain in the host environment; the browser receives aliases and configuration state.

~~~json
{
  "publicCatalog": {
    "label": "Public software catalog",
    "server": "https://api.baserow.io",
    "kind": "public-grid",
    "pageSize": 50,
    "requestIntervalMs": 250,
    "timeoutMs": 1800000,
    "maxCaptureBytes": 268435456
  },
  "teamTable": {
    "label": "Team table",
    "server": "https://api.baserow.io",
    "kind": "table",
    "tokenEnv": "BASEROW_READ_TOKEN",
    "pageSize": 100
  }
}
~~~

A protected public grid can use **publicTokenEnv** for its existing public-view token. A table connection uses **tokenEnv** for its existing database read token. Each alias has one source kind, so a grid and table on the same server use separate aliases.

The original reader also accepts page, response-byte, capture-byte, row, page-count, timeout and request-interval limits. See the [source declaration](../README.md#1-select-the-original-source) for their native meaning. The source server can contain a fixed reverse-proxy prefix. Local loopback HTTP works for a local instance; another HTTP server requires the host's explicit allowHttp option.

## Capture an original source

1. Open **Capture source**, select a connection and enter the grid slug or numeric table ID. For a table, a view ID is optional.
2. Add an optional search or the original grouped filter JSON, then select **Inspect metadata**.
3. Select the fields, public aliases, scalar types, value encodings and null policy.
4. Choose field sorts. Their numeric IDs come from the inspected metadata; the native reader keeps Baserow's row-order and row-ID tie breakers.
5. Choose attachment metadata or complete original-file retention, then select **Capture every selected page**.

The slug is the final part of the existing shared grid URL. For example, the original first-party catalog used by the native source journey is:

https://baserow.io/public/grid/4si6SNrY_T9_ENsCPjjSr2LDynTxbDh7OkvLkQorPY8

The UI shows the public grid's saved sort metadata separately. Choose the desired field sorts explicitly; the native public API's applied order is preserved with the capture.

A grouped filter uses the original field IDs and native operator names:

~~~json
{
  "filter_type": "AND",
  "filters": [
    { "field": 123, "type": "equal", "value": "Published" }
  ],
  "groups": []
}
~~~

Here 123 is an example field ID. Use the IDs and permitted operations from the actual selected table.

### Exact field values

| Choice | Result |
| --- | --- |
| Native | Original text or boolean; explicitly selected safe numeric values |
| Identity text | Original row ID or decimal row order as text |
| Number text | Original JSON number token as text |
| Decimal number | Explicit conversion of a decimal string when exactly representable |
| JSON text | Complete structured value, with original number tokens |
| Select value | Original single-select display value |
| Attachments | File names, type, source URL, byte count and SHA256 from retained original files |

Ordinary fields use their stable **field_N** row keys and actual provider types. **$recordId** and **$order** expose the original native row identity and order. Display-name changes do not substitute for a different field ID.

Decimal strings stay strings with Native/Text. JSON text keeps complete related rows, multiselects, formula or lookup structures. The original reader requests complete related values.

Review empty strings separately from null. A nullable dataset column uses an empty CSV cell for null; choose **Use null** for empty source strings or a non-nullable Text column to preserve them. The original row pages remain unchanged.

After capture, **Review columns → Inspect every retained row** pages through all saved rows. Each cell identifies its native representation. Expand a long text or structured value to read it completely. The field statistics and examples above the editor cover the complete saved capture.

### Retain and receive original files

Select **Retain original file bytes**, enter the exact observed storage origins, and choose file/count limits. Retention includes every original file in each selected File field. The original provider controls URL, size, redirects and row references.

Metadata mode keeps the original file descriptions within the saved row pages. Retain mode also saves the file payloads. Each payload remains bound to the capture manifest, original row, field and file index.

Open **Receive retained files** to page the saved files and download an individual file. Before saving it, the browser checks both the selected manifest and the SHA256 of the actual received bytes. The source packet described below includes the same complete original files.

## Review and retain source versions

A completed capture becomes the current draft when its expected draft revision still matches. If another window has already advanced the draft, the capture is saved in **Overview** and can be selected explicitly.

The source editor supports multiple named queries, public column aliases, scalar encodings and null handling. Keep the complete captured field/type union across the queries. The original publisher chooses any published column subset from that reviewed source.

1. **Save draft** retains the projection with the current draft revision.
2. **Validate every row** runs the original source reader over every captured row. The browser displays up to 25 projected sample rows per query.
3. Enter the reviewer and change note.
4. **Freeze and select source version** retains the reviewed exact source and selects it for subsequent publisher plans.

Each version retains its source hash, original capture hash, projection, source selection, reviewer and note. **Saved versions** supports comparison, selection and complete source download. Existing publisher plans keep the source they originally copied, even after another source version is selected.

## Publish and operate

**Publish & operate → Open original publisher** starts the existing durable dataset publisher over the selected source version. The link opens its native browser controls.

Use that publisher to configure the dataset query contract, extract the complete candidate, inspect it, record review and publish the selected version. The original publisher retains plans, extraction runs, reviews, publication identities, schedules and buyer handoff.

Return to the source workspace and **Refresh original publications**. A published run is shown with the source version that produced its exact capture and candidate. Select that run, supply the actual merchant terms, and continue:

1. Review the original merchant package.
2. Prepare the package using the returned review SHA256.
3. Stage it in the original release store with its package source hash.
4. Open the original release controls to compare, activate, run, stop, restart or roll back.
5. Use that console's generated client and the original buyer/collection applications for customer receiving.

The workspace uses the existing SF82 release lifecycle and its native process ownership. Selection, release generation, current console instance and actually running merchant remain visible. A lost deployment reply is recovered by reading that same retained operation and original release state.

The [core merchant guide](../README.md#5-prepare-the-merchant-and-customer-handoff) describes actual terms and the five-file package. The [publisher guide](../../postgres/publisher/README.md) covers extraction, review and publication. The [collection workflow](../../../sf88-operator-buyer-cli/collections/WORKSPACE.md) covers the original buyer's run, approval and received response.

## Import, export and reopen

A source packet contains the complete original capture: opening and closing metadata, every row page, the closing count/order observation and all retained attachment files. It includes the reviewed source projection and optional original version/reviewer information.

**Overview → Download** exports an observation. **Saved versions → Download complete source** exports a reviewed version. Import either packet through **Capture source → Import an existing complete observation**. Import validates every expected filename, byte count, SHA256 and source selection, then reopens the original capture reader.

Host operators can convert an existing frozen source into a portable packet:

~~~sh
node workspace/cli.mjs packet \
  --source /absolute/private/original/source.json \
  --out /absolute/private/baserow-source-packet.json

node workspace/cli.mjs import \
  --directory /absolute/private/receiving-project \
  --packet /absolute/private/baserow-source-packet.json \
  --title "Received source" --expected-revision 0 \
  --request 12eca3d4-640c-4e46-aa9e-6ea993b17254
~~~

These shorter paths are relative to the baserow directory. Initialize the receiving project first. The request UUID above illustrates the format; use and retain one UUID for each real operation.

**import-source** accepts an existing local frozen source directly. This host-only command invokes the same packet and capture validation. Browser requests select uploaded packets instead of arbitrary host file paths.

The transport supports a complete packet up to 528 MiB. The original capture limits remain authoritative inside it. Source bytes are never replaced with generated rows or truncated file data.

## CLI and model operations

Run **node workspace/cli.mjs --help** for the full argument list. Commands accept **--request UUID** for durable writes. If omitted, the CLI creates a UUID and prints it to stderr before the operation.

| Task | CLI commands |
| --- | --- |
| Create/open | init, serve, status |
| Native metadata/capture | discover, capture, attempt |
| Retained source input | packet, import, import-source |
| Inspect complete data | inspect-capture, capture-rows, capture-files, capture-file |
| Draft/version workflow | draft, preview, save, select, compare |
| Portable output | export, export-capture |
| Original request recovery | operation, resume |
| Publisher | publisher |
| Merchant lifecycle | deployment-status, deployment-review, deployment-prepare, deployment-stage, deployment-package, deployment-console, deployment-compare, deployment-file |
| Managed startup binding | identity, source-identity |

Public-grid discovery:

~~~sh
node workspace/cli.mjs discover \
  --directory /absolute/private/baserow-project \
  --connections /absolute/private/baserow-connections.json \
  --connection publicCatalog \
  --slug 4si6SNrY_T9_ENsCPjjSr2LDynTxbDh7OkvLkQorPY8 \
  --request ORIGINAL_DISCOVERY_UUID
~~~

For a table, use its table connection with **--table ID**, optional **--view ID**, **--filters PRIVATE_FILTERS.json** and **--search TEXT**.

A capture selection file contains:

~~~json
{
  "discoveryId": "ORIGINAL_DISCOVERY_UUID",
  "connectionAlias": "publicCatalog",
  "orderBy": [
    { "field": 123, "direction": "asc" }
  ],
  "attachments": { "mode": "metadata" },
  "queries": {
    "catalog": {
      "columns": {
        "record_id": {
          "source": "$recordId",
          "type": "string",
          "encoding": "identity-text"
        },
        "name": {
          "source": "field_123",
          "providerType": "text",
          "type": "string",
          "nullable": true,
          "empty": "null"
        }
      }
    }
  }
}
~~~

Replace the UUID and example field with the actual discovery result.

~~~sh
node workspace/cli.mjs capture \
  --directory /absolute/private/baserow-project \
  --connections /absolute/private/baserow-connections.json \
  --selection /absolute/private/capture-selection.json \
  --title "Reviewed catalog" --expected-revision 0 \
  --request ORIGINAL_CAPTURE_UUID

node workspace/cli.mjs capture-rows \
  --directory /absolute/private/baserow-project \
  --capture ORIGINAL_CAPTURE_UUID --offset 25 --limit 25

node workspace/cli.mjs capture-files \
  --directory /absolute/private/baserow-project \
  --capture ORIGINAL_CAPTURE_UUID --offset 0 --limit 25

node workspace/cli.mjs capture-file \
  --directory /absolute/private/baserow-project \
  --capture ORIGINAL_CAPTURE_UUID --file attachment-000001.bin \
  --manifest-sha256 ORIGINAL_CAPTURE_SHA256 --sha256 ORIGINAL_FILE_SHA256 \
  --out /absolute/private/received-original-file
~~~

The capture/file identifiers and hashes come from the saved source. File reading reopens the complete original capture and verifies its retained bytes before returning the selected payload.

The trusted model entry is **openBaserowAuthoring({directory, create, connections, environment, targetDirectory})** in [model.mjs](model.mjs). It supplies the same discovery, capture, input, rows/files, source/version, publisher, deployment and recovery operations. The original synchronous operation/version/discovery reads remain synchronous; asynchronous reads and writes drain before close releases SQLite, publisher and merchant ownership.

## Recovery and shutdown

The browser retains a small request marker before a write. That marker includes the exact operation UUID and input hash. Uploaded source bytes stay out of browser storage; after a reload, reselect the exact original packet only when needed to recover a request whose receipt is absent.

An uncertain request freezes edits while its original receipt is checked. A completed receipt restores the saved result, including when an earlier status refresh failed. An interrupted local step can resume against its retained input and output.

A source read can be adopted after interruption when its original complete manifest is present. Incomplete pages remain in the original attempt directory and are shown through **Retained files**. A new capture is an explicit new observation with its own request and timestamps; it does not splice incomplete observations.

On shutdown, the source reader receives its existing abort signal. The workspace drains admitted reads and writes, then closes its original publisher and merchant console before releasing the source database and lease. It reopens saved operations and versions through the same normal entry point.

## Installed Applications contract

[launch.mjs](launch.mjs) exposes the same source-workspace launch structure used by the existing managed application family:

- inspectBaserowAuthoring binds the original directory, SQLite inode and immutable settings.
- inspectBaserowLaunchSource binds the nine workspace code/assets files.
- prepareBaserowManagedLaunch binds that source and the private host connection file.
- baserowManagedStartup emits the exact listening workspace identity and **baserowWorkspace** URL.

Managed serve accepts the expected source hash, workspace identity and optional connection-file hash, and emits one compact startup JSON line with **--startup-json**. The schema is **stellar-forge.baserow-authoring-startup.v1** and status is **BASEROW_AUTHORING_READY**. A running workspace keeps its original lease and ordinary Start/Stop lifecycle.

## Continue the original native customer journey

The [public catalog native driver](../examples/public-catalog.mjs) operates the real first-party source and original publisher/deployment APIs. A receiving operator can continue from its retained **source.json**:

1. Import that frozen source into this source workspace.
2. Read complete row/file pages and receive an original file.
3. Save, validate and retain the same projection.
4. Export the complete source packet and import it into a second private workspace.
5. Reopen that imported source and compare its original capture, rows and attachment hashes.
6. Use its selected source version for the original publisher and merchant controls.

The same retained capture and native operation supply this continuation. Actual source counts, capture hashes, publication IDs and file results are recorded by the original operator at execution time.
