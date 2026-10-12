# gRPC operations and incident workbench

The original gRPC workspace now turns its saved native calls, service-health observations, source revisions and merchant preparations into an immutable operations capture. An incident adds reviewed findings, linked original records, corrective actions and a complete revision history. Native browser, typed client, CLI and Merchant Console use that same store and original workspace lease.

Open **Operations & incidents** in the native gRPC browser. In the installed product’s persistent **Merchant Console**, choose **Customer files → gRPC merchant**, select the original workspace, then open **Investigate operations and manage incidents**. Both surfaces use the same editor.

## Investigate the original records

Choose a time window, an optional saved source revision and exact method paths. **Capture selected records** saves its UUID before requesting a capture. An exact retry returns the first completed capture for that UUID and selection.

The call window selects original attempts by their saved start time, inclusive of both boundaries. Matching health operations overlap that window; captured health histories retain the complete original chain prefix through the selected end time. Table views apply the selected start boundary while the full chain stays in the exported source. A whole-server health observation or List response can accompany the selected method’s service.

Each capture contains:

- Complete original attempt metadata, normalized input and retained unary output or native stream-capture descriptor.
- Original stream SHA-256, byte and record counts, preview, completeness and native terminal metadata.
- Frozen Check, List and Watch event chains, their original operation IDs, source revisions and exact snapshots.
- Complete source configuration references, protobuf file or reflected descriptor closures and merchant plans for all represented source revisions.
- Matching original preparation metadata and the source workspace’s final attempt-inventory snapshot.

The original stream’s complete NDJSON bytes remain available through its existing **Retained call** export. Its capture descriptor identifies those bytes precisely. Keep that original attempt export alongside the incident when the full streamed payload is needed for investigation.

Switch between **Call outcomes**, **Health events**, **Combined timeline**, **Method outcomes** and **Source revision cohorts**. Every page belongs to the same immutable capture SHA-256. Search and phase filters select rows from that capture. Open a row to inspect its original record, download the complete selected record or link it to the incident.

### Reading the numbers

The four call phases are the original native outcomes: ATTEMPTED, COMPLETED, OUTCOME_UNCONFIRMED and NOT_STARTED. A completed retained response is recovered through the original native attempt reader before capture.

Recorded elapsed time spans the saved attempt’s start and finish, including connection acquisition and result persistence. Each method and source cohort reports the sample count, missing times, minimum, nearest-rank median/p95 and maximum. Compare cohorts alongside the exact method, request and source revision.

Request-sequence counts describe the saved planned input. Response-stream counts describe the original retained records and byte prefix. Health rows preserve reported statuses and original lifecycle, terminal and retry events. Their timestamps show when each observation occurred; quiet intervals stay quiet.

## Review an incident

1. Select a complete capture and choose **New incident from this capture**.
2. Enter its title, severity, state, summary, impact and findings.
3. Open original calls, source revisions or health events and link the relevant records.
4. Add corrective actions with stable IDs, owners, state, due time and progress notes.
5. Save the incident revision. Set the review to **Reviewed**, name its reviewer and retain the review note when the findings are ready.

Save uses the observed current version and a retained operation UUID. Repeating that exact request returns the first saved revision. A different edit using the same operation UUID is rejected. Concurrent changes produce a version conflict so the operator can reopen the current saved case and compose the intended revision.

Historical edits remain accessible. Opening an older revision fills the draft from that revision; saving it creates a new revision against the observed current version. Existing actions retain their IDs. A case stays bound to its original capture; create another case for a newly captured operating period.

## Complete delivery

**Prepare complete delivery** freezes the selected incident version, all preceding revisions and its original capture:

| File | Contents |
| --- | --- |
| grpc-operations.json | Complete capture and incident revision chain, with original hashes and IDs |
| calls.csv | Every captured call’s native outcome, source, input/output identities and recorded timing |
| health.csv | Every selected health/lifecycle event row and its original chain identity |
| actions.csv | Every action in every selected incident revision |
| report.html | Readable incident, findings, review, actions and source/method cohort comparison |

CSV cells use UTF-8/RFC4180 quoting and protect spreadsheet formula prefixes in textual values. The full JSON retains the original text and values. The report is a self-contained neutral HTML document.

The Console sends the same five files through its existing immutable manifest, saved request and customer receiving owner. Receive them in **Customer files**, then download the complete archive. The saved Console procedure **Prepare incident delivery recipe** carries the selected case/version/capture and original tool definitions through inspection and full delivery.

## CLI and typed client

The connection file is the original private gRPC URL file. It can contain the URL as text, or a JSON object with its native url/browserUrl. Keep it private.

~~~sh
starforge grpc-operations --connection-file /private/grpc.url capture --id 11111111-1111-4111-8111-111111111111 --selection /private/selection.json
starforge grpc-operations --connection-file /private/grpc.url read --capture 11111111-1111-4111-8111-111111111111 --section calls
starforge grpc-operations --connection-file /private/grpc.url save --case 22222222-2222-4222-8222-222222222222 --capture 11111111-1111-4111-8111-111111111111 --operation 33333333-3333-4333-8333-333333333333 --expected-version 0 --edit /private/incident-edit.json
starforge grpc-operations --connection-file /private/grpc.url export --case 22222222-2222-4222-8222-222222222222 --version 1 --directory /private/received-incident
~~~

Use new UUIDs for a new intentional capture, case or edit; preserve those UUIDs for its exact retry. The complete edit shape is declared in operations/client.d.mts and the merchant tool catalog.

~~~js
import { createGrpcOperationsClient } from './operations/client.mjs';
const client = createGrpcOperationsClient({ url: originalPrivateWorkspaceUrl });
try {
  const capture = await client.request('capture', { id: savedCaptureId, selection: { includeHealth: true } });
  const page = await client.request('read', {
    id: capture.id, section: 'calls', offset: 0, limit: 50,
    expectedSnapshot: capture.captureSha256
  });
  // Preserve page.snapshot and continue at page.nextOffset until null.
} finally {
  await client.close();
}
~~~

The installed package’s actual name appears in its generated package.json. Source consumers can import the same module by its selected source path.

## Storage and lifecycle

All captures, incident revisions, saved mutation intents, exports and incoming receipts live in the original workspace’s operations/ directory. The existing native workspace lease and execute() queue serialize these operations. Existing Watches keep their own append owner while a capture freezes selected original prefixes.

The complete portable JSON is bounded at 128 MiB. Capture collection accounts original records incrementally, and each saved incident version must remain a complete export within that bound. Narrow the selected period or methods when a larger operating history needs separate cases. File limits and the complete selected source remain declared in the native module.

Reopening the original workspace restores its cases and all prior revisions. See operations/RECEIVING.md for online/offline handover and exact-prefix reconciliation.
