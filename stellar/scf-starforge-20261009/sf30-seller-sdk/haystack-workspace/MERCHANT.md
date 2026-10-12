# Haystack turnover through native and managed MCP

The direct MCP endpoint and maintained Merchant provider use the same complete action catalog and original HTTP workspace as the operator application.

## Direct native MCP

Serve an initialized or received project through stdio:

~~~sh
node mcp.mjs --directory /absolute/private/building
~~~

The process writes JSON-RPC responses to stdout. Its `tools/list` exposes the native catalog with names such as `haystack_workspace_status`, `haystack_records_list`, `haystack_proposal_prepare` and `haystack_delivery_prepare`. `tools/call` forwards its complete arguments to the native workspace.

The running HTTP application also accepts MCP JSON-RPC at `POST /mcp`. Its access token and original workspace/instance headers apply to that connection. Read `/api/identity` first.

## Configure one existing workspace

Start the original application and retain its private `connection.json`. An optional token file remains separate from connection metadata:

~~~sh
starforge haystack serve \
  --directory /absolute/private/building \
  --port 8768 \
  --token-file /absolute/private/building-token
~~~

Create an owned mode-0600 configuration file with the original workspace UUID and exact connection path:

~~~json
{
  "schema": "stellar-forge.haystack-workspace-host.v1",
  "workspaces": {
    "building": {
      "label": "Building turnover",
      "connectionFile": "/absolute/private/building/connection.json",
      "workspaceId": "THE_ORIGINAL_WORKSPACE_UUID",
      "tokenFile": "/absolute/private/building-token",
      "timeoutMs": 120000,
      "maxInputBytes": 33554432,
      "inputs": {
        "original": {
          "label": "Original building grid",
          "path": "/absolute/private/original-grid.json",
          "kind": "source",
          "sha256": "THE_COMPLETE_ORIGINAL_64_CHARACTER_SHA256",
          "name": "original-grid.json",
          "mediaType": "application/json",
          "sourceReference": "https://THE_ORIGINAL_SOURCE"
        }
      }
    }
  }
}
~~~

Relative paths resolve beside that private configuration. Each alias binds one original workspace ID. An input binds one original regular file and SHA-256. Connection and token files must be owned private regular files. The application writes its connection file in that form.

The maintained provider is `haystack-workspaces`, family `haystackWorkspaces`. Its private configuration input is `haystackWorkspaceConnection`. Existing merchant configuration and initialization compose it through the source-owned provider registry.

For an existing Merchant host, set its top-level `haystackWorkspaceConnection` to the complete private configuration path and use the maintained host's normal configuration reload/lifecycle. For a new host, invoke the provider's initializer through the existing merchant-provider initialization operation, passing the new directory and configuration path. The setup keeps its original release-store and configuration identities and resumes its own original setup directory.

The source API is:

~~~js
import { initializeHaystackMerchantWorkspace } from "./merchant-setup.mjs";

const initialized = await initializeHaystackMerchantWorkspace({
  directory: "/absolute/private/haystack-merchant",
  connection: "/absolute/private/haystack-connections.json"
});
~~~

Run that setup from the maintained full source installation; its release-store and host modules come from that same selected product.

## Native agent workflow

1. Call `merchant_haystack_workspaces` to select the configured alias and inspect its original input pins.
2. Call `merchant_haystack_workspace_status` with `workspace`. Retain the returned revision.
3. Page `merchant_haystack_records_list` and `merchant_haystack_diagnostics_list` at that same `expectedRevision`. Continue `nextOffset` while `hasMore` is true.
4. Inspect complete rows and their source-local relationships with `merchant_haystack_record_read`.
5. Prepare the full set of intended typed edits, inspect the saved proposal, then accept or reject with a reason.
6. Save an immutable edition. Compare it with the selected prior edition, supplying explicit source pairs for different original exports.
7. Prepare complete registers, native grids or the full editable workspace. Download every returned range and verify the final file.

Every native action is available under `merchant_haystack_` with periods replaced by underscores and a required `workspace` alias. The declaration is derived from `catalog.mjs`; HTTP, stdio, SDK and Merchant share the same arguments.

## Import a complete host-selected original

`merchant_haystack_input` verifies the existing source alias and returns its complete file metadata. `merchant_haystack_import_file` passes the original whole bytes through the same native import:

~~~json
{
  "workspace": "building",
  "input": "original",
  "expectedSha256": "THE_COMPLETE_ORIGINAL_64_CHARACTER_SHA256",
  "operationId": "THE_ORIGINAL_OPERATION_UUID",
  "expectedRevision": 0,
  "select": true
}
~~~

The original file remains pinned during recovery. Its configured name and source reference become the source metadata. Reusing an identical file retains the existing native source. Choose its selection explicitly where needed.

Direct native `source.import` accepts complete base64. The host adapter accepts requests up to 8 MiB and responses up to 8 MiB; a complete larger original file uses its host-selected alias. Native source capacity remains 32 MiB.

## Preserve an original interrupted operation

A saved mutation carries its UUID, reviewed revision and exact arguments. The borrowed client tracks each active local wait and any uncertain result. Keep the original complete envelope.

`merchant_haystack_operation_read` recovers a completed mutation or delivery directly by UUID. Repeating the identical mutation or delivery preparation returns its original completed outcome. The original expected revision stays with that request even when later work advances the workspace.

`merchant_haystack_connection` reads the application's current connection record without changing an attached client. After a restart, inspect that record and call `merchant_haystack_reconnect` with its exact `expectedInstanceId`. The workspace UUID remains pinned.

`merchant_haystack_cancel` cancels the adapter's local wait. Recover that original native operation to read its saved outcome. Closing the adapter cancels its own waits and drains its clients. The existing operator application has its own normal lifecycle.

## Complete customer delivery

Prepare a workspace delivery with `kind: "workspace"`, its reviewed revision and an original operation UUID. The response identifies its complete name, byte length and SHA-256. It includes every retained native source, proposal/review, edition, original operation and portable application file.

Read `merchant_haystack_delivery_read` with the same delivery UUID. Concatenate all ranges in offset order until `complete` is true, and check the full SHA-256. Native source reads use the original source ID and the same range rules.

The original receiver verifies the package and installs the same workspace in its new owned directory. Start the received editable application through its own CLI or select that directory in the maintained Applications view.

For a large native response, the adapter returns a confirmed saved identity when the mutation's complete response exceeds its view. The full original result stays in the native operation history and editable workspace package. Page record collections or retrieve complete file ranges to consume the work.
