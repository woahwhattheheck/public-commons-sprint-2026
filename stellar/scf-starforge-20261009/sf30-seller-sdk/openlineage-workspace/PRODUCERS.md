# Receive original pipeline events

Use the workspace's existing `POST /api/v1/lineage` endpoint for native OpenLineage HTTP producers. The same workspace receives the source, projects lineage, saves reviewed editions, and exports the complete application and original files.

The receiver accepts a JSON event, JSON event array, or JSON lines, either uncompressed or with `Content-Encoding: gzip`. It keeps the actual request body. For gzip, the source ID is the SHA-256 of the compressed wire bytes; the source record also retains the decoded byte count and SHA-256. Complete original downloads return those compressed bytes. Source inspection can display the verified decoded JSON.

## Start the selected workspace

Use the installed `starforge openlineage` command, or the received application's `node /absolute/application/cli.mjs` entry. The following examples use the native entry directly.

For an authenticated producer, select two different private token files. The operator token accesses the whole workspace. The producer token admits original events only at the native producer endpoint.

```sh
node /absolute/application/cli.mjs serve \
  --workspace /absolute/lineage-project \
  --port 8767 \
  --token-file /absolute/private/operator-token \
  --producer-token-file /absolute/private/producer-token
```

Both tokens must contain at least 24 characters, and they must differ. Keep the token files with the selected host's existing secret configuration. The application writes its nonsecret current connection to `/absolute/lineage-project/connection.json`.

The default listener is `127.0.0.1`. A pipeline running on that same host can use it directly. A remote deployment needs the operator's existing authenticated transport to this listener, retaining its expected Host and origin. The workspace does not deploy a proxy or alter network configuration.

A local unprotected workspace can omit both token flags. A workspace configured with only the operator token retains its existing common-token behavior.

## Generate private producer settings

Generate settings from the actual connection file, using the producer's token file:

```sh
node /absolute/application/cli.mjs producer-config \
  --connection /absolute/lineage-project/connection.json \
  --token-file /absolute/private/producer-token \
  --client python \
  --compression gzip \
  --timeout 30 \
  --out /absolute/private/python-openlineage.yaml
```

The command creates a new private file and prints its path, workspace identity and authentication status. It keeps the token out of standard output. The output is a complete JSON document, also valid YAML, containing the client's native `transport` configuration. Point the producer's existing OpenLineage configuration loader at that file using `OPENLINEAGE_CONFIG`.

For the Java client, select `--client java`. The Python configuration uses `timeout` in seconds and `custom_headers`; the Java configuration uses `timeoutInMillis` and `headers`. Both select HTTP, the original lineage endpoint, gzip, bearer API-key authentication, and `X-OpenLineage-Workspace` with the original workspace ID. That header survives a server restart and rejects an accidentally substituted workspace.

Use `--compression identity` for an uncompressed client. Produce a new settings file from the observed connection when the host address or port changes. The server instance ID belongs to operator reconnect handling; it is deliberately absent from a producer configuration that continues across ordinary restarts.

The browser's **Producer intake** control shows this same endpoint, original workspace identity, active queue and server counters. It can create the same complete client settings after the operator enters the selected producer token locally. A downloaded settings file contains that selected token and belongs in the producer's private configuration.

## Operate the included native producers

The complete application includes runnable Python and Java producers pinned to OpenLineage SDK 1.53.0. Both connect to this original endpoint, preserve their input files and the SDK's actual transmitted bytes, and match the saved workspace acknowledgement before completing a delivery. Stable event operation IDs and retained request bodies support continuation after an interrupted send or receiver restart.

| Producer | Installed entry | Preparation and operation |
| --- | --- | --- |
| Python | `starforge openlineage native-python emit\|resume\|status` | [PYTHON_PRODUCER.md](PYTHON_PRODUCER.md), Python environment and pinned requirement |
| Java | `starforge openlineage native-java prepare\|emit` | [JAVA_PRODUCER.md](JAVA_PRODUCER.md), JDK 17 or later and retained Maven classpath |

The received application's `node /absolute/application/cli.mjs` entry exposes these same commands. Use the existing `producer-config` output for an already integrated upstream pipeline, or operate retained original source files through the included producer commands. Producer runtime preparation remains outside the Node receiver's dependency set.

## Acknowledgement, retries and simultaneous arrivals

The receiver acknowledges an event only after the original source, event references and operation result have been committed through the workspace's atomic writer. Concurrent producer bodies wait in that server's append queue. An unacknowledged body stays the producer's responsibility if the process or connection is lost.

The default operation ID is `intake-` followed by the SHA-256 of the unchanged wire body. A client can instead supply its stable original `Idempotency-Key`. Retrying the same bytes, source name, reference and encoding returns the original committed response with `replayed: true`. It does not advance the workspace revision again. A changed request under the same explicit operation ID returns a conflict.

Native appends select the current revision inside the original writer. They do not overwrite earlier events or reviewed editions. If a sender explicitly supplies `If-Match`, that sender's revision must still match. Browser and SDK review, edition, attachment and explicit source-import operations continue using their existing revision checks.

| Response | Meaning and continuation |
| --- | --- |
| `200` | Original source and operation are committed, or this is their exact saved replay. The response includes source identity, byte metadata, counts and original revision. |
| `400` / `415` | Correct the invalid JSON, gzip, request header or unsupported media/encoding before sending that corrected request. |
| `401` / `403` | Use the selected token, host and origin. Producer credentials apply only to the native intake endpoint. |
| `409` | The workspace pin, explicit revision or existing operation identity differs. Inspect the original selection and request. |
| `413` | The wire or decoded source exceeds its configured capacity. Select an appropriate source or explicitly configure that receiving host. |
| `503` with `Retry-After: 1` | The queue or original writer is occupied. Retry the same original body. |
| `500` / interrupted response | Preserve the original body and operation ID. A retry reconciles any commit that completed before the response was lost. |

An equivalent JSON event encoded differently has a different original source identity. Canonical event identity still joins duplicate event observations, retaining every contributing source location. Recompression may therefore create another original compressed source while retaining the same logical event.

## Capacity and observation

Default producer capacity is 64 admitted requests, 128 MiB of retained wire bodies, 64 MiB per wire body, and 64 MiB of decoded content per body. Decoding happens within the serialized commit path. The SDK host's `startServer({ producerLimits })` can select explicit limits. The decoded/source ceiling is 256 MiB; the wire buffer must accommodate one maximum-size body.

A body that cannot be admitted receives retryable backpressure. The response does not claim that its source was saved. The configured byte limits cover retained wire bodies and each decoded body; parsing and immutable workspace projection also require memory.

`GET /api/producer` reports admitted, committed, replayed, rejected and failed requests, accepted wire bytes, current queue occupancy, and the last committed source and operation. These are counters for the current server instance. Complete saved sources and operation history remain in the original workspace across restarts. Use the existing `records.read` operation with the current revision and continue every returned page for durable history.

## Native client and merchant operation

The supplied `LineageClient` can send the same native producer request:

```js
import { readFile } from "node:fs/promises";
import { LineageClient } from "./client.mjs";

const producer = new LineageClient(originalConnection.url, {
  token: selectedProducerToken,
  expectedWorkspaceId: originalConnection.workspaceId
});
const originalWire = await readFile("/absolute/source/events.json.gz");
const saved = await producer.emitSource(originalWire, {
  name: "events.json.gz",
  contentEncoding: "gzip"
});
```

Keep `originalWire`, its source metadata and any explicit operation ID unchanged for response-loss recovery. The client performs one original HTTP call and returns the server's saved acknowledgement.

An operator can import a compressed original through `source.import` with its complete base64 body and `contentEncoding: 'gzip'`. The original Merchant Workspace source-import tool and host-selected import-file tool accept the same encoding. They retain their explicit operation/revision and pinned input-SHA contracts.

`source.read({ id, decode: true })` returns the original base64 body and, for gzip, the verified decoded base64 body and decoded hash. The normal object/range download still returns the exact original wire file. Complete paging and export receiving remain the existing merchant operations.

## Complete customer receiving

Save the reviewed edition and use the original full workspace export. Version 3 application packages include producer reception, typed producer interfaces, decoding, private-configuration authoring, both native SDK producer implementations and their complete operating guides. Each compressed source is re-decoded and compared with its original decoded hash and source event references during receiving.

The current receiver also accepts the original version 1 application packages with their 35-file source set and version 2 packages with their 40-file portable application set. Existing uncompressed originals use their original parser during receiving; new ingress capacities do not invalidate an earlier complete source. The received package retains its original complete application edition.

The tokens and producer configuration files remain outside the exported project. Reopen the received application with the receiving operator's selected host configuration and generate producer settings from its actual new connection.

Continue the complete original native producer programme with:

```sh
node /absolute/application/PRODUCER_RECEIVING.mjs \
  /absolute/original-receiving-operation/producer-intake
```

It verifies unchanged upstream fixtures, generates private Python/Java settings, receives simultaneous plain/gzip originals, exercises actual writer backpressure, saves an edition, restarts the server, reconciles the same original producer request, exports the whole application and data, and starts an independently received application. Its saved operation, wire files, request identities and prepared export support continuation in the same directory after an interrupted run.

## Original client contract

The receiving behavior follows the original [Python HTTP transport configuration](https://openlineage.io/docs/client/python/configuration/) and [Java HTTP transport configuration](https://openlineage.io/docs/client/java/configuration/), checked on 2026-10-12. The pinned Python transport used for the implementation review is [http.py at 07864a6b](https://github.com/OpenLineage/OpenLineage/blob/07864a6b5f5d30b878e157eba8409dda84d68d4f/client/python/src/openlineage/client/transport/http.py), Git blob `c23dfdfcad2d2b3800d887723e34c5eb1d482d05`. It emits JSON with `Content-Type: application/json`, optional gzip and bearer API-key authentication, and supports the configured custom headers. Upstream event bodies and their original license remain in this application's existing fixture inventory.
