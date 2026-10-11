# Sheets source authoring through the merchant MCP

Prepare a reviewed Sheets source through the maintained merchant operator, then
publish it with the original dataset publisher. These tools open the same
[Sheets source workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/workspace/WORKSPACE.md)
and its browser. Browser edits and agent edits share the original draft,
observation, preview, saved-version and request records.

The host declares existing private workspaces, optional existing Google
connections and named input files. Agent arguments select those aliases and
original identities. This adapter creates no alternative source database,
credential store, extractor, scheduler, dataset writer or payment engine.

## Host setup

Use Linux, Node 22.16 or later and util-linux flock, matching the original
source workspace. The code has no additional npm dependency or frontend build.
Paths below are examples; choose the actual private operator directories.

Create an original source workspace once, or use an existing one:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs workspace init \
  --directory /private/sheets/catalog-source
~~~

The installed equivalent is:

~~~sh
starforge sheets-source workspace init --directory /private/sheets/catalog-source
~~~

If the original source browser or another CLI already owns that directory,
stop it cleanly before the MCP opens it. Keep the original directory and its
contents. Do not remove its lock file to defeat a running owner.

Create a mode-0600 connection declaration outside the repository:

~~~json
{
  "schema": "stellar-forge.sheets-authoring-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Merchant catalog",
      "directory": "/private/sheets/catalog-source",
      "connections": "/private/sheets/google-connections.json",
      "inputs": {
        "catalog_observation": {
          "kind": "observation",
          "file": "/private/sheets/original-cells.json",
          "range": "'Catalog'!A1:H500",
          "label": "Retained catalog observation"
        },
        "received_source": {
          "kind": "packet",
          "file": "/private/sheets/received-source.json",
          "label": "Original portable source packet"
        }
      }
    }
  }
}
~~~

Both connections and inputs are optional. Declare only the inputs available to
this operator; their files are checked when inspected/imported, rather than
during MCP startup. An observation is the complete original Spreadsheet
CellData resource, bound to its exact provider-requested qualified range. A
packet is the original workspace export and retains its own range.

Each workspace must be an existing, canonical, private mode-0700 directory
with its original mode-0600 sources.sqlite file. Alias names use 1–64 lowercase
letters, digits, underscores or hyphens. Declare a directory once. The reader
rejects duplicate directory aliases, symlink database files and nonprivate or
multiply linked database files.

Input JSON files and both connection files must be regular mode-0600 files
with one link. Input inspection and import open the original file without
following a final symlink, hash the complete bytes and check its file identity
again after reading. Observation size uses the original 64 MiB capture limit;
private packet transport allows twice that limit.

### Existing Google account

The optional google-connections.json uses the original source-workspace map:

~~~json
{
  "merchant": {
    "label": "Merchant Google account",
    "oauthDirectory": "/private/google/merchant"
  }
}
~~~

Create and manage that directory through the original
[Sheets connection workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/auth/README.md).
Its account/scopes, refresh, disconnect and recovery remain the credential
owner. An alias can instead declare accessTokenEnv with the name of an
existing process-provided access token. It declares exactly one of that name
and oauthDirectory; never put an actual token in the connection JSON or a tool
argument. Relative renewable directories resolve beside this connection file.
Optional original timeoutMs and maxResponseBytes remain supported.

The adapter neither lists the entire Drive account nor changes Sheet sharing
or cells. Workbook metadata and a CellData observation require their explicit
tools. Importing a retained observation requires no Google connection.

### Existing merchant MCP or a dedicated configuration

For an existing merchant-mcp.json, add the single host field:

~~~json
{
  "sheetsWorkspaceConnection": "/private/sheets/sheets-workspaces.json"
}
~~~

Preserve all its existing schema, merchant name, release store, sources and
other connection fields. Stop/restart the original MCP to adopt the changed
host configuration.

For a new operator configuration:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-sheets-workspaces \
  --dir /private/sheets/merchant-operator \
  --connection /private/sheets/sheets-workspaces.json \
  --name "Merchant Sheets authoring"
~~~

This creates the original merchant configuration, its release metadata and
private customer-export directory. It validates the declared source
workspaces without opening their model, reading Google or starting a
publisher. The source directories themselves remain where the host declared
them.

Start the original authenticated transport with its already-configured private
MCP_ACCESS_TOKEN environment value:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/sheets/merchant-operator/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Use the original [MCP connection guide](README.md) or [stdio guide](STDIO.md)
for the client transport. This addition uses that existing authentication and
tool registration. Nothing is anonymously exposed to the network.

## Open the original model and its browser

Call merchant_sheets_workspaces to list the declared aliases and this
process's ownership. Then:

~~~json
{
  "workspace": "catalog"
}
~~~

Send that to merchant_sheets_open. The result includes workspace, instanceId,
browserUrl, native and packetReads. Open the complete browserUrl on the
operator host. It contains the original browser's private fragment capability
and binds to loopback. Keep that complete URL private.

The browser and MCP tools now use the same model handle. A browser save
immediately changes the draft revision returned by merchant_sheets_status.
An MCP save appears when the browser refreshes its original state. Neither
side receives an independent editable snapshot that silently replaces a newer
draft.

Opening an already owned alias returns its current instance. Restarting the
MCP creates a new instance and browser capability; saved source state remains.
Opening never automatically fetches Google cells or starts the publisher.

## Import or capture an observation

### Retained original CellData

Call merchant_sheets_inputs with only workspace to list the named inputs.
Call it again with the selected input:

~~~json
{
  "workspace": "catalog",
  "input": "catalog_observation"
}
~~~

The result reports the declaration's kind/range and the exact current file
name, byte count and SHA256. Inspect that identity, then pass it to
merchant_sheets_import with a fresh operation UUID:

~~~json
{
  "workspace": "catalog",
  "input": "catalog_observation",
  "expectedSha256": "SHA256_RETURNED_BY_INPUT_INSPECTION",
  "title": "Reviewed catalog observation",
  "requestId": "A_FRESH_UUID"
}
~~~

The tool rechecks those exact bytes before calling the original importer.
The original range/header/CellData validation and retained capture ID remain
authoritative. Import does not automatically replace the draft or expose any
column.

Retain requestId before dispatch. Repeating the same import with identical
bytes and arguments uses the native idempotent operation. If the host input
has changed or moved, inspect merchant_sheets_operation or use
merchant_sheets_resume for that original ID; do not turn recovery into a
different file import.

### Existing live Google connection

merchant_sheets_workbook takes workspace, connectionAlias and an exact Google
Sheets workbook ID or ordinary workbook URL. It returns the original workbook
and tab metadata through that existing connection.

Choose the exact GRID tab, its stable numeric sheetId, its current sheetTitle
and a bounded A1 rectangle. Call merchant_sheets_capture with those fields,
the same workbook/connection, a title and a fresh requestId. The original
provider reads CellData and retains its exact resource and read receipt. The
tool does not automatically capture another tab or extend the rectangle.

If a provider read's outcome is uncertain, use the original request ID and
receipt recovery described below. Reopening or resume does not automatically
repeat an uncertain Google call.

## Choose and review the public projection

merchant_sheets_columns takes a retained captureId and an optional bounded
subrange. It returns the original observed headers, scalar/formula/blank
counts and short private samples. A capture is private source material;
inspecting it does not select public columns.

The original browser can author the projection without writing JSON. For
agent authoring, read the current draftRevision from merchant_sheets_status,
then send merchant_sheets_draft_save an explicit draft:

~~~json
{
  "workspace": "catalog",
  "expectedRevision": 0,
  "requestId": "A_FRESH_UUID",
  "draft": {
    "captureId": "ORIGINAL_CAPTURE_UUID",
    "title": "Merchant catalog",
    "name": "catalog",
    "range": "A1:H500",
    "columns": {
      "sku": {
        "column": "A",
        "header": "sku",
        "type": "string",
        "nullable": false,
        "formula": "reject"
      },
      "units": {
        "column": "C",
        "header": "units",
        "type": "integer",
        "nullable": false,
        "formula": "reject"
      }
    },
    "emptyRows": "skip",
    "mode": "capture",
    "connectionAlias": null
  }
}
~~~

Use the actual capture's exact header text and absolute column letters, and
the actual current revision rather than the example zero. Include only
reviewed public aliases. Types are string, integer, number or boolean.
Nullable controls whether a missing effective value may become null.
Formula policy either rejects a formula cell or explicitly accepts its
original effective value. Empty-row policy is skip or reject. The original
projector enforces those rules without guessing values.

A live draft uses mode live and one existing connectionAlias. Its authoring
preview still reads the retained observation. A later original publisher
extraction of the live source can make a new provider read; review the source
mode before enabling publication schedules.

For a saved draft, call merchant_sheets_preview with the returned
draftRevision and a new requestId. The original extractor validates the entire
selected retained range, returns the row count and retains a preview ID with
the first 25 public rows. A failed type/range/formula validation leaves a
readable original operation record; edit and save the corrected draft before
requesting a new preview.

Call merchant_sheets_version_save with that exact draftRevision, previewId,
reviewer, note, the current expectedSelectedVersion (null before the first
selection), and a fresh requestId. It retains the original reviewed source
version and installs its managed source declaration. Saving a source version
does not publish a dataset.

Read any original version with merchant_sheets_version. Compare two saved
versions with merchant_sheets_compare. The comparison returns their original
metadata and retained typed previews, preserving actual values and nulls; it
does not query Google or recalculate historical observations.

merchant_sheets_select selects an existing saved version against the current
expectedSelectedVersion. Plans and customer snapshots already retained by the
publisher keep their original source. A new publisher plan uses the newly
selected source.

## Continue through the original publisher

Call merchant_sheets_publisher_open with the exact selected version and a
fresh requestId. It calls the source model's original openPublisher and serves
the same native publisher against that selected source.

Use currentPublisher.running and currentPublisher.url from the response to
open it. A recordedBrowserUrl in an old operation receipt is historical.
After restart, an old successful open receipt does not restart a publisher or
make its previous URL live. Inspect current state and explicitly request an
open with a new UUID only when the original operation has a known outcome.

The original publisher browser provides the complete retained plan,
extraction, candidate preview, target review, expected snapshot/revision
publication, refresh schedule and buyer preparation. Follow its
[publisher guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/README.md)
and the [Sheets source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/README.md).
Saved enabled native schedules can resume when that original publisher opens;
the adapter does not implement a scheduler.

The existing merchant_publisher_* tools can also own this same retained
publisher after an explicit ownership transfer. Close the source-owned
publisher with merchant_sheets_publisher_close and its retained requestId
first. The source editor itself can remain open. Declare the existing
source-workspace publisher directory as a kind sheets alias in the host's
publisherConnection, using the existing [publisher MCP guide](PUBLISHERS.md),
and restart the MCP to adopt a new host declaration if needed. The original
publisher must have been initialized before that connection is declared.
Then use merchant_publisher_open and the original publisher tools.

Close that exact publisher instance through merchant_publisher_close before
opening it from the source editor again. The original workspace lease
prevents competing source-browser and publisher-MCP owners. Neither adapter
closes a separately owned process or silently substitutes another directory.

For native buyer preparation, the source workspace declaration may include
both seller and resource:

~~~json
{
  "seller": "http://127.0.0.1:8400",
  "resource": "https://merchant.example/data"
}
~~~

Use the actual already-running original dataset seller and resource. Those
host settings enable the original publisher's buyer handoff; they create no
signer and execute no payment. Retained handoffs refer to the original
published snapshot and original advertised price/asset/network.

## Transfer an original private source packet

A source packet contains the exact original capture, public projection,
preview, source-version/review metadata and integrity bindings. It remains
private because it can contain unselected source cells. The original exporter
strips live credential references and makes the receiving declaration
capture-backed.

The shared browser can download the original packet directly. To receive it
through MCP, call merchant_sheets_packet_read with workspace and versionId.
The existing retained-file reader returns:

- readId and file name/content type/total bytes/SHA256;
- offset, bytesRead and nextOffset;
- encoding base64 and the exact chunk data.

Persist the version ID, returned SHA256, readId and completed byte offset
alongside the private receiving file. Decode each base64 chunk, write it at
the specified byte offset, and request the next chunk with the same version,
readId, expectedSha256 and nextOffset. The maximum chunk is 196608 bytes; the
default is 65536. A null nextOffset marks the last chunk and releases the
read snapshot. Verify the final complete bytes and SHA256 before importing.

If a reply is lost, request the same read ID/hash/offset again. If the read
expires or the MCP restarts, omit readId and resume the same original version,
expectedSha256 and offset. The original version exporter has deterministic
bytes; the retained reader verifies the expected complete file hash before
serving the continuation. A changed hash is a conflict, never an instruction
to append a different packet.

merchant_sheets_packet_release releases a read snapshot early. It does not
delete the native version, capture or saved packet. Closing this alias drains
its packet reads. The shared retained-file reader limits active snapshots and
storage; large snapshots use private unlinked descriptors rather than a new
persistent packet registry.

To reopen in another workspace, save the received packet as a private file
and declare it as a kind packet input. Inspect that alias's SHA256, read the
receiving workspace's current draftRevision, and call
merchant_sheets_import_packet with title, expectedSha256,
expectedDraftRevision and a fresh requestId. Its original imported draft is
capture-backed and contains no live account reference. Review it, preview the
saved draft, save a reviewed source version, and continue through the original
publisher.

The original standalone receiving command is also available after releasing
any owner of the receiving workspace:

~~~sh
starforge sheets-source workspace import-package \
  --directory /private/sheets/received-source \
  --input /private/sheets/source-v2.json \
  --title "Received catalog" --revision CURRENT_REVISION \
  --request ORIGINAL_REQUEST_UUID
~~~

Initialize that receiving source directory once before the import. Both
receiving paths use the same original packet validator and importer.

## Recover an uncertain operation

Retain a UUID before each native mutation. The original model binds that UUID
to its operation kind and normalized input. The adapter does not create a
second request journal.

| Observation | Action |
|---|---|
| The response is lost | Read merchant_sheets_operation with the same requestId and inspect current source state. |
| The original request is complete | Use its retained result. Do not create another version/import merely because the response was lost. |
| The same request is still pending in this owning process | Continue reading that request; resume can await the original pending completion. |
| The original request is interrupted | Call merchant_sheets_resume with that same requestId. It uses retained inputs and native recovery. |
| The original request failed with a terminal code | Correct the material input or make the explicitly chosen new observation with a new UUID. Preserve the old receipt. |
| A host input changed after import | Recover its existing request using operation/resume; a new import requires a newly inspected SHA256. |
| Another browser saved a newer draft | Reload its current draft/revision and resolve the edit. Do not adopt the new revision for an old draft silently. |
| Source selection changed during review | Read current selection, inspect the intended saved version and request the deliberate selection/review against that current value. |
| An old publisher-open receipt has an expired URL | Read currentPublisher; only a currently running publisher's URL is usable. |
| A packet read expired | Resume the same saved version, expected SHA256 and offset with a newly opened read snapshot. |

SHEETS_READ_NOT_RETAINED means the process ended before a successful provider
response was retained. SHEETS_READ_RECEIPT_NOT_RETAINED means bytes remain but
the original successful read receipt was not retained. Recovery does not
repeat that Google call. The original operation terminates with its specific
code; the operator can explicitly import retained bytes or choose a new
observation. Other unresolved input I/O remains attached to its original
interrupted request.

Tool errors return the original safe error code. The original operation
receipt, original browser and current source state supply the recovery
context without returning local credential or storage paths in MCP errors.
Wrong UUID/kind/input, stale revision, stale selection and changed file hashes
retain their original conflicts.

## Stop and reopen

merchant_sheets_close requires this process's current instanceId. It drains
accepted MCP reads/operations, releases alias-owned packet snapshots and
closes the original browser, model and any publisher that model owns. The
source directory and original receipts remain. Do not send an earlier
instanceId to a later owning process.

Closing the merchant operator closes all of its owned source instances and
uses the original model shutdown for pending work. It never stops another
CLI/server or removes that process's lease. Browser requests already accepted
by its original service drain through that service's native shutdown.

Restart the original MCP with the same merchant-mcp.json. List aliases,
explicitly open the source workspace, and inspect current draft/selection and
any prior request ID before continuing. Browser capabilities and process
instance IDs change; saved versions, captures and request IDs do not.
Publisher startup and new Google observations remain explicit.

## Tool map

| Tools | Original operation |
|---|---|
| merchant_sheets_workspaces, open, close, status | Declared aliases, one model/browser owner, current native source state |
| merchant_sheets_inputs, import, import_packet | Exact host-declared original file identity and native import |
| merchant_sheets_workbook, capture, columns | Existing Google metadata/read and retained source inspection |
| merchant_sheets_draft_save, preview, version_save | Native revision save, complete typed preview and reviewed source version |
| merchant_sheets_version, compare, select | Original saved versions, retained comparison and selected source |
| merchant_sheets_operation, resume | Original UUID receipt and interruption recovery |
| merchant_sheets_publisher_open, publisher_close | Explicit lifecycle of the source-owned original publisher |
| merchant_sheets_packet_read, packet_release | Original private source packet and existing verified file-chunk transport |

All shortened names after the first entry in a table row retain the
merchant_sheets_ prefix. Exact schemas and required fields are provided by
tools/list in the original MCP transport. This source adds five maintained
files/joins: this guide, sheets-workspace.mjs, and narrow configuration,
registration/lifecycle and CLI/transport hooks. The original source model,
browser, Google custody, publisher and seller/buyer implementations remain
their sole authorities.
