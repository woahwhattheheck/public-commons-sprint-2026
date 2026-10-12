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


## Complete point-list modelling

The same catalog also exposes the original three-part modelling actions. For example, the native action `semantic.model.read` is `haystack_semantic_model_read` on direct MCP and `merchant_haystack_semantic_model_read` on the maintained merchant host. Their required arguments remain the catalog's original fields, including the reviewed workspace revision and exact model head for writes.

Retain a complete CSV or TSV as a host-selected `point-list` input. Add entries to the existing private connection configuration:

~~~json
{
  "points": {
    "path": "/absolute/private/original-point-list.tsv",
    "kind": "point-list",
    "format": "tsv",
    "delimiter": "\t",
    "sha256": "THE_COMPLETE_ORIGINAL_64_CHARACTER_SHA256",
    "name": "original-point-list.tsv",
    "sourceReference": "THE_ORIGINAL_SOURCE_REFERENCE"
  },
  "contractor-return": {
    "path": "/absolute/private/complete-returned-workspace.json",
    "kind": "workspace-return",
    "sha256": "THE_COMPLETE_RETURNED_64_CHARACTER_SHA256",
    "name": "complete-returned-workspace.json"
  }
}
~~~

These are members of the original workspace's `inputs` object. The file's declared format, delimiter, full bytes and source reference remain bound to that alias. Column positions distinguish repeated or blank headings. A native grid uses `kind: "source"`; it retains its original JSON v4 path and tool.

The workspace's optional `maxReturnBytes` is separate from `maxInputBytes`. Original grids and point lists remain bounded at 32 MiB; complete returned workspaces may be up to 192 MiB. Both limits are enforced before the alias bytes enter the original action. An alias with a different declared purpose cannot be used for that operation.

Use `merchant_haystack_semantic_intake_import_file` with `workspace`, `input`, `expectedSha256`, the original `operationId` and `expectedRevision`. An optional `sourceUrl` supplies a deliberately selected source reference; otherwise the configured reference is used. The host supplies the original filename, format, delimiter and complete file.

Continue the operator workflow through the same catalog:

1. Page `semantic.intakes.list`, then read the complete selected `semantic.intake.read` pages. Each source row retains its original cells and physical line identity.
2. Use `semantic.model.preview` with explicit column positions, selected original source IDs, naming rules and proposed classes. Read the complete preview before creating its saved model.
3. Create or save the full model through `semantic.model.create` or `semantic.model.save`. A save retains its expected head and original source context; later workspace or model changes require an explicit comparison.
4. Inspect `semantic.catalog`, saved models, full model comparison pages and review history. A dictionary entry or reviewed name is an operator decision. It does not establish a live field observation.
5. Run `semantic.validate` against the exact saved model head using the selected offline Brick runtime. Read `semantic.validation.read` and download **every** output in its returned metadata through `semantic.output.read`. The complete native Boolean, report bytes, runtime identity and source-linked mapping observations remain distinct.
6. Save `semantic.model.review` for the exact saved version. Retain the actual validation ID where applicable.
7. Prepare `semantic-report` in JSON, CSV or HTML, `semantic-dictionary` in JSON or CSV, or the complete `workspace` package with the original `delivery.prepare` operation.

Every mutation and delivery has one original UUID and exact payload. A transport interruption keeps that request and its reviewed revision. Read `operation.read`; retry only the identical envelope to recover its original result.

### Complete large JSON views

A complete model, catalogue or returned-model comparison can exceed the merchant host's 8 MiB response capacity. The underlying native HTTP client retains the full response. Read it through the original-content range wrapper rather than omitting rows or model fields.

Call `merchant_haystack_semantic_read` with:

~~~json
{
  "workspace": "building",
  "action": "semantic.model.read",
  "args": {
    "expectedRevision": 12,
    "modelId": "THE_ORIGINAL_MODEL_ID"
  },
  "offset": 0,
  "length": 1048576
}
~~~

The response declares `stellar-forge.haystack-semantic-json-range.v1`, the original workspace, action, complete byte count, full SHA-256, chunk SHA-256, base64 bytes and next offset. Keep the **same action, arguments and workspace revision**, add its `expectedResponseSha256`, and continue until `complete`. Verify all offsets and hashes, concatenate every byte, then decode the full UTF-8 JSON. Do not decode individual chunks that may end inside a multibyte character.

The wrapper accepts only declared stable read actions: semantic lists and record reads, the original catalogue and saved-version comparison. Native source/output byte reads retain their existing file-range tools. New previews remain explicit native requests.

### Review a contractor return

Use `merchant_haystack_semantic_return_preview_file` with the original workspace alias, pinned return input, file SHA-256 and reviewed local revision. It invokes the original complete returned-workspace comparison. Optional `offset`, `length` and `expectedResponseSha256` read the same full preview through the range contract above.

Review every returned model. `keep` preserves the complete current local head; `adopt` deliberately chooses the complete returned model against the exact local and incoming heads. The original return retains incoming versions, source files, contexts, native outputs and prior decisions even when the operator keeps a local head. It does not infer a field merge.

Apply the explicit decisions with `merchant_haystack_semantic_return_apply_file`. Supply its original UUID, reviewed revision, author, note, input pin and the unchanged native `decisions` array. Each decision includes `modelId`, `decision`, `expectedLocalHeadId` (null for a new local model) and `expectedIncomingHeadId`. Recover a lost reply with that same selected file and envelope.

The source API also exposes `./seller/haystack/merchant-client`, `./seller/haystack/merchant-tools`, `./seller/haystack/semantic-model` and the complete semantic receiving/browser programmes. The host borrows the original server; its cleanup drains only its own clients.

## Managed Applications and the offline validator

The original **Haystack building turnover and point modelling** application keeps its root workspace URL and adds a **Point-list modelling** related link to `/semantic.html`. Both links use one original application lifecycle, selected workspace UUID and connection record.

Prepare the exact wheel archive through `install_semantic_runtime.py` as described in `SEMANTIC_NATIVE.md`. Keep the virtual environment at its final selected path. In the maintained Applications form, select its existing **environmentFile** field with an owned private JSON file:

~~~json
{
  "HAYSTACK_SEMANTIC_PYTHON": "/absolute/private/semantic-runtime/bin/python"
}
~~~

The common Applications provider retains that file and its SHA-256 with the saved launch. Start, Open, Stop and reopen use the original controller. The product does not add a second validator selector or process controller. The complete ontology/dependency identity is visible in the modelling view and saved with each actual native result.

`SEMANTIC_BROWSER.mjs` consumes the sole point-modelling programme's existing server and records desktop/mobile operation, exact source downloads, reviewed model edits, interrupted-response recovery, stale peer comparison, complete native outputs and explicit contractor-return decisions. It also exercises the same merchant provider and replays the original saved operations. Actual managed Start/Stop receiving requires the original READY runtime/controller selection and is reported separately until that input is supplied.
