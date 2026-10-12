# Operate and receive an original gRPC merchant with an agent

The existing merchant MCP connects to the same private gRPC workspace used by the
merchant's browser. It captures the original protobuf/import closure, edits the
saved source and exact merchant plan, reviews native types and channel readiness,
makes intentional unary calls, prepares the original seller, operates its existing
SF82 release control, and delivers the complete original customer SDK.

Browser and agent use the same revision IDs, preparation intents, native calls,
run identities and release store. The workspace remains the authority for those
operations. The MCP connection keeps only immutable delivery files and temporary
file-read snapshots. Its shutdown releases those reads; the original workspace
and its native merchant continue until an explicit native stop or close.

## Attach the merchant's original workspace

Start the original gRPC workspace as described in
[the native operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/README.md).
Install the maintained native gRPC runtime through that guide's original source
or selected portable distribution procedure.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/server.mjs \
  --state /private/merchant/grpc-workspace --port 8453
~~~

Keep the printed complete private URL in an environment variable or a private
0600 file. A file is convenient when the original process restarts on a new port:
the connector rereads the URL for each request.

Create a private connection file, for example /private/merchant/grpc-connection.json:

~~~json
{
  "schema": "stellar-forge.grpc-workspace-connection.v1",
  "workspaces": {
    "analytics": {
      "label": "Analytics merchant",
      "consoleUrlFile": "./grpc-workspace-url.txt",
      "captures": {
        "analytics": {
          "label": "Analytics merchant",
          "directory": "./protobuf",
          "entrypoints": ["analytics.proto"],
          "sourceFile": "./source.json",
          "planFile": "./merchant-plan.json"
        }
      },
      "files": {
        "summary-request": {
          "label": "Reviewed Summary request",
          "kind": "request",
          "path": "./summary-request.json"
        },
        "received-revision": {
          "label": "Received complete merchant source",
          "kind": "revision",
          "path": "./receiving/grpc-revision.json"
        }
      }
    }
  }
}
~~~

All paths resolve relative to this private connection file. Capture and receiving
handles are operator-selected host references. The caller chooses a handle; the
original native capturer resolves protobuf imports and validates the complete
source. A receiving file may include an optional sha256 to pin its actual bytes.
Use consoleUrlEnv instead of consoleUrlFile when the process environment holds the
original private URL. Declare exactly one of them for each alias.

source.json uses the native gRPC configuration: target, transport, environment
names for metadata/TLS credentials, and original deadlines/size limits.
merchant-plan.json uses stellar-forge.grpc-merchant-plan.v1 and preserves the
complete public origin, selected routes and ordered payment options. Credential
values remain in the native merchant environment.

Initialize and start the existing merchant MCP:

~~~sh
chmod 600 /private/merchant/grpc-connection.json \
  /private/merchant/grpc-workspace-url.txt \
  /private/merchant/source.json /private/merchant/merchant-plan.json

node stellar-forge/mcp-merchant-operator/serve.mjs init-grpc-workspaces \
  --dir /private/merchant/agent \
  --connection /private/merchant/grpc-connection.json

node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/merchant/agent/merchant-mcp.json --port 3211
~~~

Use the existing MCP_ACCESS_TOKEN or original OAuth resource configuration for
the merchant MCP. The original gRPC capability is a separate host-owned
connection and is never copied into merchant-mcp.json.

An existing merchant configuration can declare grpcWorkspaceConnection alongside
its current sources and integrations. Ordinary init also accepts
--grpc-workspaces PRIVATE_CONNECTION_JSON. The dedicated initializer creates the
existing merchant provider's support directories; gRPC release commands operate
the source workspace's own merchant-releases store through its original SF82
console.

Installed source uses the same entry point:

~~~sh
node /installation/forge.mjs run merchant-mcp -- init-grpc-workspaces \
  --dir /private/merchant/agent \
  --connection /private/merchant/grpc-connection.json
~~~

## Capture, inspect and edit the original service

The tool inputs below are ordinary MCP tools/call arguments. Workspace aliases,
revision SHA256s and operation UUIDs are returned by the original tools.

1. Call merchant_grpc_workspaces and choose a declared workspace and capture.
   Call merchant_grpc_status to read its currentRevision and generation.
2. Call merchant_grpc_capture with workspace, capture and baseRevision. Use null
   only when the original workspace has no selected revision. The result names
   the original saved revision and its protoSha256.
3. Read merchant_grpc_revision with that revision. The default summary reports
   the native source identity, method/route counts, environment names and
   readiness. Select section source or plan to inspect the complete values.
   Select methods or routes to page the actual captured inventory.
4. Call merchant_grpc_method with the exact revision and method path, such as
   /stellarforge.analytics.v1.Analytics/Summary for the included native example.
   The native schema distinguishes absent values from false, zero and empty
   values. Streaming methods remain visible and cannot become unary paid routes.
5. Save the intended changes through merchant_grpc_save. Its revision selects
   the retained protobuf closure to edit; baseRevision is the current selected
   native revision. Omitted source, plan and title retain that source revision's
   values. A supplied plan is a complete replacement validated by the original
   compiler.

A typical save has this structure:

~~~json
{
  "workspace": "analytics",
  "revision": "ORIGINAL_REVISION_SHA256",
  "baseRevision": "CURRENT_REVISION_SHA256",
  "title": "Reviewed analytics merchant",
  "plan": {
    "schema": "stellar-forge.grpc-merchant-plan.v1",
    "publicOrigin": "https://merchant.example",
    "paymentOptions": ["COMPLETE_REVIEWED_NATIVE_OPTIONS"],
    "routes": ["COMPLETE_REVIEWED_NATIVE_ROUTES"]
  }
}
~~~

The plan placeholders above must be replaced by the actual complete native
objects read from the saved merchant. Keep every ordered option's scheme,
network, quoted atomic amount, asset, payTo, maxTimeoutSeconds and extra fields.
Keep 64-bit request values as exact decimal strings and protobuf bytes as
canonical base64. Read the native operator guide for map keys, enums, oneofs,
special floating-point values and standard protobuf message fields.

When another browser or agent saves first, the original workspace returns
GRPC_WORKSPACE_REVISION_CONFLICT. Open the new current revision, compose the
intended source/plan, then save against that current base. Checkout selects an
existing original revision with the same explicit base check. Refreshing
inventory does not advance a caller's intended save base.

## Review and intentionally call the native upstream

merchant_grpc_review takes workspace and the selected saved revision. It retains
the original contract and channel readiness result.

For an intentional application call, choose an operationId UUID and send
merchant_grpc_call with workspace, revision, method and exactly one of input or
file. input is a complete typed request object. file selects a host-declared
request JSON file and supports requests larger than the MCP message budget.

~~~json
{
  "workspace": "analytics",
  "revision": "SELECTED_REVISION_SHA256",
  "operationId": "7954b0dd-306c-4bc1-90b5-08362fd2542e",
  "method": "/stellarforge.analytics.v1.Analytics/Summary",
  "file": "summary-request"
}
~~~

Retain a fresh UUID for each new intentional business request. If a reply is
interrupted, call merchant_grpc_attempt with the same operationId. The original
workspace recovers an already-retained output and its exact responseSha256.
Repeating merchant_grpc_call with the same ID and identical input retrieves
that same native outcome; different input with that ID is rejected. Its
ATTEMPTED, COMPLETED, NOT_STARTED and OUTCOME_UNCONFIRMED phases retain the
upstream's actual outcome and original recovery semantics.

The transport allows the native five-minute RPC deadline and its original
channel-readiness interval. Callers should allow that original operation
lifetime. Neither a local tool timeout nor a failed reply assigns a fresh
operation ID or automatically dispatches another upstream request.

Complete large method schemas, review results and call outputs are retained as
JSON exports. A COMPLETE_RESULT_RETAINED response carries the original identity
and a delivery manifest. Receive that complete file with the commands below.

## Traverse complete retained history

merchant_grpc_inventory supports revisions, prepared, intents, attempts and
exports. Read page zero, retain snapshot, then repeat with nextOffset and
expectedSnapshot until nextOffset is null. limit defaults to 50 and accepts
1–250. A changed snapshot starts a new traversal from page zero.

The attempts inventory calls the original POST /api/attempts route backed by
attemptsPage in the original native model. It reads every retained attempt and
returns the original operation IDs. The browser's compact /api/state response
continues to show the newest 50 while reporting the full attemptCount. The
complete route uses the same original files and state lease.

Revision methods and routes have the same snapshot paging contract. Delivery
inventory lists complete manifests, so a finished export remains discoverable
when its first reply is lost or the MCP process restarts.

## Prepare and operate the original merchant

Call merchant_grpc_prepare with the selected revision and a stable operationId.
The original preparation retains its intent and returns its preparation ID.
After an interrupted preparation, inspect prepared and intents and reuse that
same ID.

merchant_grpc_run starts the preparation's original SF30 merchant and returns its
native run, source, documentation and Operations identities. merchant_grpc_stop
drains that direct merchant using its original lifecycle.

Release control starts after stopping the direct merchant:

| Step | Tool and original selection |
| --- | --- |
| Stage | merchant_grpc_stage with preparation and releaseId |
| Open | merchant_grpc_release_open |
| Inspect | merchant_grpc_release_status; retain state.generation and console.instanceId |
| Compare | merchant_grpc_release_diff with to and optional from |
| Select | merchant_grpc_release_activate with id, expectedGeneration and reason |
| Run | merchant_grpc_release_run with expectedGeneration |
| Change running release | merchant_grpc_release_restart with instanceId and expectedGeneration |
| Drain | merchant_grpc_release_stop with instanceId |
| Roll back | merchant_grpc_release_rollback with expectedGeneration, reason and optional to |
| Close | merchant_grpc_release_close |

These operations call the original SF82 console obtained from the gRPC workspace.
The server supplies its native x-release-token and exact same-origin request.
The original console enforces generation and owned-instance checks. Retain the
returned original status, refresh after a changed generation, and inspect it
after any interrupted action.

Staging captures the original protobuf closure, merchant plan and generated files.
The original release manager can reopen its retained package after the former
prepared folder moves. Software restart preserves the original workspace's
saved source, call/preparation history and release selection.

## Receive complete customer files

Call merchant_grpc_export with workspace, kind customer and preparation. The
original server validates each native customer file against its prepared
manifest and returns its exact bytes and SHA256. The agent transport streams
those files sequentially into one immutable completion manifest.

The customer export contains every original file:

| Original path | Received purpose |
| --- | --- |
| methods.json | Exact native method schemas |
| openapi.json | Prepared merchant OpenAPI |
| client/seller-client.mjs | Original generated JavaScript customer client |
| client/seller-client.d.mts | Original generated declarations |
| client/seller-openapi.json | Customer client OpenAPI |
| client/package.json | Customer package metadata |
| client/README.md | Original customer guide |

Inspect and download the export:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs inspect-grpc \
  --url http://127.0.0.1:3211 \
  --export-id RETURNED_EXPORT_SHA256

node stellar-forge/mcp-merchant-operator/serve.mjs download-grpc \
  --url http://127.0.0.1:3211 \
  --export-id RETURNED_EXPORT_SHA256 \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --out /private/customer/analytics \
  --chunk-bytes 196608
~~~

The existing receiving engine checkpoints verified byte prefixes, resumes the
same original read or reopens an expired snapshot, validates every full file,
and publishes the completion manifest. The gRPC receiver then reconstructs
the exact client/ directory using the verified original bytes. Open its
client/README.md and use its package immediately.

A second invocation with the same endpoint, exportId and directory resumes or
verifies the completed receiving. The manifest and all seven file SHA256s remain
pinned. Transfer files also remain in their flat transport names so the original
checkpoint can verify a later continuation.

For a direct MCP client, use merchant_grpc_export_manifest, then
merchant_grpc_export_file. Pin expectedManifestSha256 and expectedSha256 on
every read; continue with readId and nextOffset. Each chunk contains base64
data, its byte position, total file identity and original manifest identity.
merchant_grpc_export_file_release releases an unfinished temporary read while
keeping its complete export.

## Receive the merchant's complete source or a retained call

A kind revision export carries the exact saved connection references, captured
protobuf/import closure and full plan in grpc-revision.json. A kind attempt
export carries the original operation input, output, native phase and hashes in
grpc-attempt.json. The same inspect/download commands handle both.

To receive source on the same merchant host, call merchant_grpc_import on the
destination workspace with the original revision exportId and its current
baseRevision. For another host, download the revision, declare its local private
file handle in the destination connection, then call merchant_grpc_import with
file and baseRevision. The complete native revision identity is checked before
the original workspace validates and saves it. A title override intentionally
creates a new native revision.

Choose customer exports for buyers. Revision and attempt exports support the
merchant's source transfer, receiving and operation recovery.

## Package API

The maintained distribution registers:

- ./merchant/mcp/grpc: MerchantGrpcWorkspaces, grpcWorkspaceTools and the private
  connection reader.
- ./merchant/mcp/grpc/receiving: inspectGrpcExport and downloadGrpcExport.
- ./merchant/mcp/grpc/export: the immutable original-file manifest contract.

The original merchant-mcp command exposes init-grpc-workspaces, inspect-grpc and
download-grpc. The same provider retains every existing merchant integration.
