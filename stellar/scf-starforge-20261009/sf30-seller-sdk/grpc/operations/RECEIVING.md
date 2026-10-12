# Receive a gRPC operations case

An operations export carries the immutable original capture and every incident revision through the selected version. The capture includes original native call outcomes, source closures/plans and frozen health chains. Corrective actions and links retain their original IDs.

## From the native workspace

Use the exact descriptor returned by operations-export or client.request('export'). Persist that descriptor before receiving and reuse it after interruption.

~~~js
import { receiveGrpcOperationsDownload, readGrpcOperations } from './receiving.mjs';
const received = await receiveGrpcOperationsDownload(nativeClient, savedDescriptor, '/private/incident-delivery');
const reopened = await readGrpcOperations('/private/incident-delivery');
~~~

The receiver validates the destination before publication. It downloads each original file, checks its complete byte count and SHA-256, and publishes complete files atomically. A repeat uses the existing exact files. A different incident or a changed file produces a conflict.

The offline reader verifies all five files against the full original capture/history. A supplied complete JSON bundle can also be received with receiveGrpcOperations(bundle, directory); its five derived files follow the same deterministic native publication.

## Into another original workspace

~~~sh
starforge grpc-operations --connection-file /private/receiver-grpc.url receive --operation 44444444-4444-4444-8444-444444444444 --bundle /private/incident-delivery/grpc-operations.json
starforge grpc-operations inspect --directory /private/incident-delivery
~~~

Receiving validates the capture, original source bindings, all native call/health identities, revision hashes, linked records and complete parent chain before publication. Matching existing revisions are reused. A longer existing local history remains intact; an incoming matching later history appends its complete revisions. Divergent edits are retained separately until the operator selects an explicit composition.

The incoming operation receipt retains the original export SHA-256, capture/case IDs, incoming version, current receiving version and receiver workspace. Reuse the original receiving operation UUID to continue the same handover.

Re-export the selected original case/version to obtain the same portable export identity. Later review edits create later case versions with the receiving workspace as their author while preserving all original predecessors.

## Through merchant MCP and Console

merchant_grpc_operations_export returns the existing gRPC retained-file manifest. It contains kind operations and the exact case revision, capture hash and original portable export SHA-256.

Use downloadGrpcOperationsExport from merchant/mcp/grpc/operations-receiving with the original merchant client connection, selected export ID, manifest SHA-256 and a private output directory. It uses downloadGrpcExport and its original transfer/ checkpoint; the five native files are restored beside that checkpoint. Repeat the same receiving with the same descriptor.

The persistent Merchant Console receives those exact files in Customer files and includes them in its original archive/profile handover. Its Operations & incidents editor uses the original saved Console requests, full retained-result reader and the same native workspace. Select an existing operations export ID or a host-declared operations file to receive a complete case through that editor.

Host file declarations use kind operations and the optional exact SHA-256 in the existing grpc-workspace connection configuration. The original host owns the declared path; the agent selects its configured alias.

## Working with original stream output

The case stores each stream’s original hash, byte/record count, completeness, terminal metadata and preview. Receive the original call/stream export as well when the full NDJSON payload is part of the investigation. Its operation ID and response identity join it to the same captured call.
