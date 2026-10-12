# OpenLineage in the merchant operator

The connected tools operate the same native HTTP workspace as the browser. Imports, event projections, saved editions, review history, results, and exports use the original workspace store and operation journal.

## Start the original workspace

Run the installed OpenLineage command, or the original source CLI:

~~~sh
node cli.mjs serve --workspace /absolute/path/to/lineage-project --host 127.0.0.1 --port 0
~~~

The startup JSON and the project's private connection.json contain its workspaceId, instanceId, and local origin. For a token-protected server, add --token-file with a private plain-text token file.

## Select workspace and complete file aliases

Save an owned private JSON file with mode 0600. Paths are relative to that file unless absolute. The workspaceId must come from the original project's startup record. SHA-256 values must cover every byte of each original input file.

~~~json
{
  "schema": "stellar-forge.openlineage-workspace-host.v1",
  "workspaces": {
    "operations": {
      "label": "Production lineage",
      "connectionFile": "./lineage-project/connection.json",
      "workspaceId": "REPLACE_WITH_ORIGINAL_WORKSPACE_UUID",
      "timeoutMs": 120000,
      "inputs": {
        "production-events": {
          "label": "Original production event export",
          "path": "./inputs/production-events.ndjson",
          "kind": "source",
          "sha256": "REPLACE_WITH_COMPLETE_FILE_SHA256",
          "name": "production-events.ndjson",
          "sourceReference": "Original production OpenLineage export"
        },
        "quality-result": {
          "label": "Complete quality query result",
          "path": "./inputs/quality-result.csv",
          "kind": "result",
          "sha256": "REPLACE_WITH_COMPLETE_FILE_SHA256",
          "name": "quality-result.csv",
          "mediaType": "text/csv",
          "sourceReference": "Original quality query and run reference"
        }
      }
    }
  }
}
~~~

Add tokenFile to the workspace entry when required. Its contents remain in the host; tool responses expose workspace identity and input metadata. A configuration supports 1–32 distinct workspace aliases and up to 128 complete input aliases per workspace.

The default host input capacity is 40 MiB. maxInputBytes may raise it to 1 GiB when the native server's intake capacity and host memory are configured for the corresponding complete base64 request. The default native HTTP intake is 64 MiB, including JSON/base64 overhead. A file beyond the configured capacity returns a size error and retains its original bytes.

The selected application uses a literal HTTP loopback origin, 127.0.0.1 or ::1. Tool callers choose configured aliases, native entity keys, record collections, and retained object IDs.

## Install in the original merchant host

The source-owned contribution registers:

~~~json
{
  "merchantProviders": {
    "openlineage-workspaces": "stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/merchant-provider.mjs"
  }
}
~~~

An existing merchant-mcp.json selects the private connection file with:

~~~json
{
  "openlineageWorkspaceConnection": "/absolute/path/to/openlineage-host.json"
}
~~~

For a new merchant directory, call the provider's initialize hook or its native module:

~~~javascript
import { initializeLineageMerchantWorkspace } from "./mcp-setup.mjs";
const result = await initializeLineageMerchantWorkspace({
  directory: "/absolute/path/to/new-merchant",
  connection: "/absolute/path/to/openlineage-host.json",
  name: "Operations lineage"
});
console.log(result.configuration);
~~~

The optional provider declaration and initializer run inside the complete installed merchant distribution, where the original provider contract, release-store/configuration modules, and shared durability helpers are present. The initializer uses the original release-store initializer, private setup lock, immutable configuration publication, and full merchant configuration reader. Repeating the same setup recovers its existing release store and configuration.

## Core client without the full merchant distribution

The call/summary/close owner and host client use Node builtins plus this workspace's native client and pure tool catalog. They can be exercised beside the existing source application:

~~~javascript
import { readLineageWorkspaceConfiguration } from "./mcp-client.mjs";
import { MerchantOpenLineageWorkspaces } from "./mcp.mjs";
const host = await readLineageWorkspaceConfiguration("/absolute/path/to/openlineage-host.json");
const owner = new MerchantOpenLineageWorkspaces({ openlineageWorkspaces: host });
try {
  const selected = await owner.call("merchant_lineage_workspaces", {});
  const metadata = await owner.call("merchant_lineage_workspace_metadata", { workspace: "operations" });
  console.log(selected, metadata);
} finally {
  await owner.close();
}
~~~

Closing the borrowed owner aborts its local waits and drains its tasks. The native server remains available to its browser and other clients.

## Operator workflow

1. Call merchant_lineage_workspaces to choose the original workspace and inspect complete input aliases.
2. Call merchant_lineage_workspace_metadata and retain revision. Page merchant_lineage_records_read with collection, expectedRevision, offset, and limit. Follow nextOffset until null.
3. Verify an input with merchant_lineage_input. Import a complete source with merchant_lineage_import_file, supplying input, expectedSha256, operationId, and expectedRevision. Native merchant_lineage_source_import also accepts complete text or base64 within the host's tool request capacity.
4. Inspect original entities with merchant_lineage_entity_read. Read their complete events, facets, source attribution, and reviews. Use merchant_lineage_lineage_read for upstream/downstream nodes and edges at a chosen depth.
5. Save a named edition with merchant_lineage_edition_save. Compare it with another edition or the current workspace using merchant_lineage_edition_compare.
6. Save named review decisions with merchant_lineage_review_save, including title, reason, entityKeys, decision, and the optional editionId.
7. Attach a complete result with merchant_lineage_attach_file. Include its host-pinned input and SHA-256, entityKeys, editionId, sourceReference, operationId, and expectedRevision. Query or experiment details may accompany the attachment.
8. Call merchant_lineage_workspace_export with includeApplication true. Read all bytes of that retained export with merchant_lineage_export_read and its returned ID.
9. Receive and reopen the complete package through the original CLI:

~~~sh
node cli.mjs receive --input openlineage-workspace.json --out /absolute/path/to/received-project
node cli.mjs serve --workspace /absolute/path/to/received-project --host 127.0.0.1 --port 0
~~~

The complete source export includes the original application and the retained event, source, edition, review, and result records.

## Complete records and original bytes

| Operation | Continuation |
| --- | --- |
| merchant_lineage_records_read | Keep collection, edition, and expectedRevision; continue at nextOffset until null. |
| merchant_lineage_object_read | Keep original id; concatenate each decoded base64 range in offset order until complete. |
| merchant_lineage_export_read | Keep export id; concatenate ranges in offset order until complete. |
| merchant_lineage_source_read | Returns the complete original object as base64 when it fits the tool response. |
| merchant_lineage_report_read | Returns complete JSON, CSV, or HTML report text. |

Range reads default to 262,144 bytes and accept 1–4,194,304 bytes. Verify the final reconstructed file's SHA-256 against its original id. Range bytes, offset, nextOffset, totalBytes, and completion state remain explicit.

Tool requests accept 128 KiB; host file aliases carry larger complete inputs. Complete responses accept 8 MiB. When an entity/report/record page exceeds that response capacity, use smaller native record pages or original object/export ranges. Oversized read responses return an explicit size error. A successfully saved mutation with an oversized response returns outcome CONFIRMED, its original operation ID and revision, and a complete export retrieval route. Its responseView.complete is false; the full saved response remains in the original operation journal and complete workspace package.

## Recovery and concurrency

Every mutation requires an operationId and expectedRevision. The native workspace stores successful operations with their input identity and replays a completed operation before checking its old revision.

After timeout, cancellation, connection interruption, or an unexpected server error, repeat the identical operation, including its original ID, expected revision, file SHA, and full input. The borrowed client's metadata records active operations and uncertain operation identities. The original workspace's operations collection is the durable server record; retaining the caller's exact request supports recovery across client restarts.

The client pins the workspace and application instance at attachment. A later server restart leaves that pin in place. Call merchant_lineage_connection to inspect the current host-selected instance, then merchant_lineage_reconnect with its exact expectedInstanceId. This explicitly connects to the same configured workspace. Recover the original mutation afterwards.

A revision conflict includes currentRevision. Read the changed workspace, review the intended edit against it, and submit the reviewed edit with a new operationId and current expectedRevision.

merchant_lineage_cancel cancels one active local wait by operationId. Its response identifies cancellation requested; the native server may already have saved that operation, so recover the original request.

## Errors and effects

Authentication, startup identity changes, source SHA changes, validation, revision conflicts, active writer responses, connection interruption, and uncertain mutations remain distinct. Provider errors carry their native HTTP status and details. Mutation recovery details include operation ID, expected revision, payload hash, configured workspace, and attached instance.

Read tools use the configured local workspace. Imports, saved editions, reviews, result attachments, and exports use the original native actions. Workspace exports write their retained complete package in the original project. 
