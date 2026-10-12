# Service health in the original gRPC merchant workspace

Service health is available in the saved gRPC workspace, its CLI, the merchant MCP server and the original resumable receiving client. It uses the endpoint's standard grpc.health.v1.Health service with the saved TLS, client certificate and metadata environment references. The original merchant preparation, generated customer client and SF82 release controls remain the operating workflow.

The standard service has three operations:

| Operation | Native request | Retained result |
| --- | --- | --- |
| Check | One service name; the empty string selects whole-server health | Native status and terminal outcome |
| List | Empty request | Every reported service and native status, paged in the editor and agent tools |
| Watch | One service name | Original status changes, channel endings, reconnects and final observation outcome |

The vendored protocol is the complete official definition, including List. [Protocol source and license](health/PROTOCOL.md) identify its exact file and Git hashes. [The official gRPC health guide](https://grpc.io/docs/guides/health-checking/) describes the standard health service.

## Operate in the browser

1. Open the existing private gRPC workspace. Capture the source, configure its connection and save the revision.
2. Open **Service health**. The source label identifies the saved endpoint and revision used for a new observation.
3. Choose **Check one service**, **List reported services**, or **Watch one service**. The service field suggests service names from the captured methods and accepts the endpoint's exact service name. Clear it for whole-server health.
4. Set the native deadline. A Watch also has an original observation duration and total event allowance.
5. Start the observation. Its original UUID appears immediately and remains in retained history. The editor can reopen the same UUID after a lost reply.
6. Inspect the reported health, last observation time, native connection count and complete event pages. A List has its own service search and complete service pages. The **Follow latest events** setting follows the last 50 durable events; previous pages keep their observed prefix.
7. Stop a running Watch with **Stop this Watch**. Reconnect an interrupted or stopped Watch with **Resume original Watch** while its original deadline and event allowance remain. Select that operation's original saved revision first.
8. Download the complete observation. Its JSON contains the original request, source references, protocol identity, every saved event and the complete snapshot SHA256.
9. Continue in **Operate & deliver**. **Review channel and terms** includes the latest retained health observations for that exact saved revision alongside the native channel-readiness review. Prepare the original merchant, receive its generated client, and use the original release control for stage, activation, drain and rollback.

A saved operation can remain open in the health panel while the editor selects another revision. The binding line identifies that difference. The last native status and its time remain visible through a reconnect or a quiet interval.

### Native status meaning

| Status | Meaning in the retained observation |
| --- | --- |
| UNKNOWN | The endpoint returned the zero/unknown enum, including an omitted proto3 zero |
| SERVING | The endpoint reported that selected service as serving |
| NOT_SERVING | The endpoint reported that selected service as not serving |
| SERVICE_UNKNOWN | Watch reported an unknown service and stays subscribed for later changes |
| UNRECOGNIZED | A future numeric enum is retained with its exact code |

An unknown Check normally returns native NOT_FOUND. List is the endpoint's non-atomic inventory: services may change while it gathers the response. A Watch that ends UNIMPLEMENTED closes with that explicit unsupported result. Other native endings, including OK, reconnect with exponential backoff while the original observation remains open.

A quiet Watch renews its connection when its native deadline expires. The stored last status keeps its original observation time. Connection changes do not create another serving-status value.

## Saved connection and limits

The operation reads its configuration from the selected immutable gRPC revision. Its operation record contains the target, transport configuration and environment reference names. The existing workspace process captures the corresponding credentials in memory.

A Watch can coexist with ordinary upstream requests and the running merchant. Up to four health operations can run in one original workspace.

| Setting | Default | Accepted range |
| --- | --- | --- |
| timeoutMs | 30,000 ms | 1–300,000 ms |
| Watch durationMs | 60,000 ms | 1–3,600,000 ms |
| Watch maxEvents | 1,000 | 1–10,000 |

The Watch event allowance counts opening, status, terminal and retry records. Its native idle deadline equals the current connection lifetime. Consecutive connections without a status back off from 250 ms to ten seconds; an actual status resets that backoff.

Source acquisition and native work consume the observation's selected lifetime. A resumed Watch receives only the time and event allowance remaining from its original operation. Each deliberate resume is retained in the same journal. An operation permits up to 32 connection epochs across explicit resumes; native reconnects inside each epoch remain part of the same event budget.

The saved source's protobuf message and JSON limits still bound native responses. The durable journal has a 36 MiB cap and the complete portable snapshot has a 40 MiB cap.

## CLI

Use the installed grpc-health command, or the original grpc command's health subcommand:

~~~sh
starforge grpc-health --help
starforge grpc health --help
~~~

Choose exactly one connection:

- --console-url-file points to the existing private URL file written by the original running gRPC workspace.
- --state opens the original private workspace directly under its existing writer lease. Stop the browser console before opening its state locally.

The console URL file retains its private capability. CLI output uses original operation IDs and source reference names.

### Check and List

~~~sh
starforge grpc-health check \
  --console-url-file /private/grpc/console.url \
  --revision SAVED_REVISION_SHA256 \
  --id ORIGINAL_OPERATION_UUID \
  --service package.Service \
  --timeout-ms 30000

starforge grpc-health list-services \
  --console-url-file /private/grpc/console.url \
  --revision SAVED_REVISION_SHA256 \
  --id ANOTHER_OPERATION_UUID
~~~

Create a UUID for each intentional new observation. Retain it before dispatch. Repeating the same UUID and normalized request reopens that original operation.

### Watch, stop and resume

~~~sh
starforge grpc-health watch \
  --console-url-file /private/grpc/console.url \
  --revision SAVED_REVISION_SHA256 \
  --id ORIGINAL_WATCH_UUID \
  --service package.Service \
  --duration-ms 120000 \
  --timeout-ms 30000 \
  --max-events 1000 \
  --follow true

starforge grpc-health stop \
  --console-url-file /private/grpc/console.url \
  --id ORIGINAL_WATCH_UUID

starforge grpc-health resume \
  --console-url-file /private/grpc/console.url \
  --id ORIGINAL_WATCH_UUID \
  --version OBSERVED_INTEGER_VERSION \
  --follow true
~~~

The default command waits for its original operation to close. --follow true emits the durable event rows as JSON lines, followed by the final operation summary. SIGINT/SIGTERM requests cancellation of that exact operation.

A Watch on an already-running console can use --detach true. The original workspace then owns the observation until its selected limit or explicit stop. A direct --state command keeps its writer lease and native owner in the foreground.

### Read all retained work

~~~sh
starforge grpc-health observations \
  --console-url-file /private/grpc/console.url \
  --limit 50

starforge grpc-health open \
  --console-url-file /private/grpc/console.url \
  --id ORIGINAL_OPERATION_UUID \
  --section events \
  --after 0 --limit 50
~~~

Each event/service page returns throughSequence and snapshot. Pass both values with the returned nextAfterSequence as --through, --snapshot and --after to continue the same immutable prefix. A service page accepts --section services --filter package. Inventory pages use --offset and their own --snapshot.

### Freeze and receive a complete observation

~~~sh
starforge grpc-health export \
  --console-url-file /private/grpc/console.url \
  --id ORIGINAL_OPERATION_UUID \
  --out /private/receiving/grpc-health.json

starforge grpc-health inspect \
  --file /private/receiving/grpc-health.json \
  --section summary
~~~

The receiving parent directory must already be private. New files are published create-only. Repeating export to the same file re-derives its original event prefix from the native journal and verifies the exact saved bytes. A later live observation belongs in another output file.

Supply --through VERSION --snapshot EVENT_PREFIX_SHA to export an already-reviewed prefix explicitly. The file's snapshotSha256 identifies its complete operation metadata, history and summary. Offline inspect can page all events or services, verify an expected --snapshot-sha, or return the full original JSON.

The CLI reports operation completion separately from the endpoint's serving enum. FAILED, UNSUPPORTED and INTERRUPTED operation phases use exit status 2.

## Merchant MCP tools

These tools are available on the existing configured merchant server:

| Tool | Original operation |
| --- | --- |
| merchant_grpc_health_observations | Page retained observation summaries |
| merchant_grpc_health_start | Start Check, List or Watch with a saved revision and UUID |
| merchant_grpc_health_read | Read complete event/service pages or a summary |
| merchant_grpc_health_stop | Stop and await this exact native owner |
| merchant_grpc_health_resume | Resume its original Watch with the observed version |
| merchant_grpc_health_export | Freeze complete original health JSON for retained delivery |

Example start arguments:

~~~json
{
  "workspace": "merchant",
  "revision": "SAVED_REVISION_SHA256",
  "operationId": "ORIGINAL_OPERATION_UUID",
  "request": {
    "kind": "watch",
    "service": "package.Service",
    "timeoutMs": 30000,
    "durationMs": 120000,
    "maxEvents": 1000
  }
}
~~~

The tool starts a retained operation and returns its original state. Use merchant_grpc_health_read while it runs. A read requires the same workspace handle and operationId; paging uses afterSequence, throughSequence, expectedSnapshot and limit. List-service filtering uses section:"services" and serviceFilter.

The health export uses the original merchant_grpc_export_manifest / merchant_grpc_export_file protocol. Its immutable manifest has kind:"health", original operation/revision/snapshot identities and one grpc-health.json file. Large complete read results use the existing retained-result mechanism.

~~~js
import { downloadGrpcHealthExport } from '@tokenjunkielabs/starforge-merchant/merchant/mcp/grpc/health-receiving';

const received = await downloadGrpcHealthExport({
  client,
  exportId,
  expectedManifestSha256,
  directory: '/private/receiving/health-observation'
});
console.log(received.operation, received.snapshotSha256, received.healthFile);
~~~

Use the existing original file client and retained manifest values. The transfer checkpoint stays in transfer/; the usable grpc-health.json and original manifest are materialized in the receiving root. Repeat the same receiving call after an interruption. It verifies the original file bytes, snapshot hash, operation UUID and revision.

## Original state and recovery

Each operation lives beneath the original workspace's private health/UUID directory:

- operation.json is create-only. It binds the original UUID, revision, normalized source, normalized health request, protocol hash, creation time and original deadline.
- events.ndjson is an ordered append-only journal. Every event binds the preceding hash, original UUID, sequence, observation time and full JSON payload.
- A native onEvent call returns only after its complete event has been written and fsynced. The next stream record or reconnect therefore follows the durable observation.
- The original writer lease owns operation creation, append, recovery and workspace closure.

The workspace closes health sources before releasing its writer lease. Reopening reconciles an unfinished owner as interrupted. An already-retained Check/List success terminal is completed from its original journal. An explicit Watch resume uses the same immutable request and source.

Only an incomplete final journal append can be truncated during recovery. Complete lines must retain their sequence and content hashes. Snapshot validation checks the operation binding, every event link, the derived summary and the complete snapshot hash.

Health snapshots travel with the source and operator history needed to interpret them. The generated merchant customer files and the original SF82 release selection remain the concrete delivery and deployment interfaces.
