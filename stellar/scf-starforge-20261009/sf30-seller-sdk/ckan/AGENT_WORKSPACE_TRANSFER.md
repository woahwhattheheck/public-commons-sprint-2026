# CKAN workspace handover through merchant MCP

The merchant agent can export a complete CKAN project, inspect every archived
file, receive the exact archive, restore it into a configured sibling project,
and reopen the restored project. These commands use the same workbench, archive,
publisher, dataset and seller implementation as the Workspace tab and CLI.

The transferred project includes captured provider pages, source declarations
and reviewed field meanings, publisher plans and history, retained dataset
versions, merchant packages, seller release history and prepared buyer
configurations. Receiving retains original source bytes and release digests,
then binds their installed capture and handler locations to the receiving
directory.

## Declare the original and receiving projects

Keep the existing private merchant configuration and its
`ckanWorkspaceConnection`. Add an explicit receiving alias in that connection:

```json
{
  "schema": "stellar-forge.ckan-workbench-connection.v1",
  "workspaces": {
    "svk": {
      "label": "Svenska kraftnät",
      "directory": "/private/projects/svk"
    },
    "received": {
      "label": "Received Svenska kraftnät",
      "directory": "/private/projects/svk-received",
      "receiveTarget": true
    }
  }
}
```

The original project must already exist. Its receiving sibling selects a new
directory, or the same directory of an earlier interrupted or completed
workspace receive. The parent must be private and canonical. Each directory
has one alias. A receiving alias becomes openable after the original receive
finishes; the configuration remains usable after restarting the merchant host.

For an archive copied from another machine, declare its original private file
under the existing project's inputs:

```json
{
  "inputs": {
    "customer-workspace": {
      "file": "/private/incoming/customer-workspace.ckanw",
      "label": "Customer workspace",
      "kind": "workspace-archive"
    }
  }
}
```

An existing capture input defaults to `kind: "capture"`. All archive operations
select a retained archive UUID or a declared input alias. Filesystem paths come
from the host configuration and original archive records.

## Run the complete workflow

Start the original managed application:

```sh
stellar-forge ckan-agent serve \
  --config /private/merchant/merchant-mcp.json \
  --workspace svk
```

The original MCP access token is supplied through the selected environment
variable. The startup record contains the authenticated MCP address and the
original browser URL. Use the current protocol version exported by
`stellar-forge/mcp-paid-agent/http-tools.mjs`, initialize the connection, and
send the normal MCP `tools/call` requests with their declared arguments.

The five handover tools join the existing CKAN tools:

| Tool | Result |
| --- | --- |
| `merchant_ckan_workspace_archives` | Paged complete archive descriptors, exact hashes, project counts and original download route. |
| `merchant_ckan_workspace_archive` | Starts the original full-project archive operation. |
| `merchant_ckan_workspace_inspect` | Verifies the full archive and pages every relative filename, byte count and hash. |
| `merchant_ckan_workspace_read` | Reads the complete selected archive in exact base64 chunks through the existing native file reader. |
| `merchant_ckan_workspace_receive` | Starts or resumes the original receive into a declared sibling alias. |

First read `merchant_ckan_status`. For each changing request, use its
`native.operation?.id ?? null` as `expectedOperationId`. After a start returns
`operationId`, continue reading that same original operation until it finishes.
Its `state` and `error` describe the actual result.

A full export request is:

```json
{
  "workspace": "svk",
  "expectedOperationId": null
}
```

Send that to `merchant_ckan_workspace_archive`, substituting the actual
operation baseline. The original archive engine acquires the existing
publisher, dataset and release ownership before saving one complete archive. Optional
`maxBytes` and `maxFiles` select a smaller workload budget; the MCP ceiling is
8 GiB of retained payload and 100,000 files.

Read `merchant_ckan_workspace_archives` after completion. Its `items` provide
the original `archiveId`, `sha256`, `manifestSha256`, byte and file counts,
and an authenticated `download` route. List and inventory pages accept
`offset` and `limit` from 1 through 100; continue to `nextOffset: null`.

Inspect the selected complete archive:

```json
{
  "workspace": "svk",
  "archiveId": "ORIGINAL_ARCHIVE_UUID",
  "expectedSha256": "ORIGINAL_ARCHIVE_SHA256",
  "offset": 0,
  "limit": 100
}
```

Use `input: "customer-workspace"` in place of `archiveId` for a host-declared
incoming archive. Exactly one selector is required. The first inspection checks
every compressed and uncompressed byte through the original decoder.
Subsequent pages reuse one verified metadata table and check its file identity.

## Receive the complete archive bytes

An agent can call `merchant_ckan_workspace_read` with the same selector and
`expectedSha256`. Append each returned `data` after base64 decoding. Continue
with `readId`, `expectedSha256`, `nextOffset` as `offset`, and the optional
chunk `limit`. Verify the complete final byte count and SHA-256.

The native reader opens one private read-only descriptor, hashes the original
file once, and serves later chunks from that descriptor. It checks identity
around each read and releases the descriptor after the final chunk.
`merchant_ckan_file_release` releases an abandoned read. After an expired read
or host restart, omit `readId` and resume with the same selected archive,
expected hash and byte offset.

The Workspace tab provides the same full download. A program may GET the
descriptor's `download.path` on the original `browserUrl` origin using its
fragment token as the bearer credential. The response carries the selected
`x-archive-sha256` and complete content length. Stream it to a private file and
verify its full hash. Keep the browser capability and MCP token private.

## Restore and reopen

Send the current operation baseline and the selected exact archive to
`merchant_ckan_workspace_receive`:

```json
{
  "workspace": "svk",
  "targetWorkspace": "received",
  "archiveId": "ORIGINAL_ARCHIVE_UUID",
  "expectedSha256": "ORIGINAL_ARCHIVE_SHA256",
  "expectedOperationId": "CURRENT_ORIGINAL_OPERATION_UUID"
}
```

The original workbench receives into the destination named by its configuration.
An open destination or another receive owns that alias until it closes.
Extraction, retained originals, path relocation, installed seller-handler
bindings and resume are performed by the original workspace engine.

After the operation completes, call:

```json
{"workspace": "received"}
```

with `merchant_ckan_open`. The response identifies its own original project
instance and browser. Existing source-meaning, publication, file and buyer
inspection tools operate on this alias. A host restart preserves the configured
alias and received project.

Generic merchant release controls follow the host's existing `releaseStore`.
To operate the received seller through those controls, select its own
`seller-releases` in the merchant host configuration. The receiving project
retains its exact installed release and the browser's native seller workflow.

If a receive is interrupted, inspect its original operation and call receive
again with the same archive hash and target alias. The native receive marker
continues that directory. A different archive cannot replace its selection.
Stop drains the original accepted calls, active operation and file descriptors.

## Complete existing-project receiving program

The source-owned example exercises authenticated MCP and browser delivery using
an existing reviewed and published project:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/examples/agent_workspace_transfer.mjs \
  --config /private/merchant/merchant-mcp.json \
  --workspace svk \
  --target /private/projects/svk-mcp-received \
  --out /private/receiving/ckan-agent-handover
```

It writes a private receiving-specific connection and merchant configuration,
exports the original project, pages the full inventory, receives the complete
archive through HTTP and MCP, restores the declared sibling, queries the
original publication and reviewed meanings, downloads the unchanged source,
then closes both original owners and reopens the received project after host
restart. Its existing receiving journal makes a repeated invocation continue
the same directories and artifact selection.

The complete customer archive, file inventory, original source declaration,
reviewed meanings and receiving journal are retained in the chosen output
directory. The original project's captures and publications supply the data
throughout this workflow.
