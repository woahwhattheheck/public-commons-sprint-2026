# Retained buyer handoffs through the native MCP workspace

The original **sf43_discover_review_and_pay** tool exposes an **operations-handoff** action for selected jobs in an existing SF88 Inbox. It uses the same capture, source interpretation and saved-file verification as the maintained Node, Python and buyer CLI interfaces. A complete saved handoff can then be explicitly received into the original SF47 Operations case.

This action reads original buyer records and saves a private source artifact. It does not enqueue, execute, recover or finalize a purchase, contact its upstream provider, or make a new ledger observation. Existing terminal approval, signing, reservations and accounting remain with their original buyer commands.

## Select the existing workspace and Inbox

Start with the directory containing the actual retained **native-workspace.json** used by the existing buyer MCP server. Reuse its original buyer, catalog, request history and Inbox. Initializing another native workspace is not required to expose this action.

Omit **inbox_alias** to select that native workspace's own original Inbox. To read a separately retained SF88 Inbox on the same authorized operator host, register it through the existing host API. Registration checks and pins the original Inbox header. It neither copies its jobs nor creates an Inbox.

Run from the complete source checkout with the two actual absolute paths supplied by the operator:

~~~sh
SCF_NATIVE_WORKSPACE=/ABSOLUTE/EXISTING-NATIVE-WORKSPACE \
SCF_EXISTING_INBOX=/ABSOLUTE/ORIGINAL-SF88-INBOX \
node --input-type=module <<'NODE'
import {openNativeWorkspace} from './stellar-forge/mcp-paid-agent/native-workspace.mjs';
const {SCF_NATIVE_WORKSPACE,SCF_EXISTING_INBOX}=process.env;
if(!SCF_NATIVE_WORKSPACE||!SCF_EXISTING_INBOX)throw new Error('Existing paths are required');
const native=await openNativeWorkspace(SCF_NATIVE_WORKSPACE);
try{
  const registered=await native.registerSourceInbox({
    name:'original-buyer',inbox:SCF_EXISTING_INBOX
  });
  process.stdout.write(JSON.stringify(registered,null,2)+'\n');
}finally{await native.close();}
NODE
~~~

The alias is a host grant to that existing Inbox. Tool arguments can select an alias but cannot supply a filesystem path or replace the buyer configuration. Keep the original registration and Inbox in their current custody; exporting a source does not authorize moving private buyer state to another host.

Use the existing MCP connection and the same tool name. Its arguments are:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "inboxes",
  "operationsHandoffRequest": {}
}
~~~

The result uses **schema**, **operation** and **value**. The Inbox list contains registered aliases and **ownInbox: true**, meaning that omission of the alias selects the native workspace's original Inbox.

Inspect the original job IDs and current saved-output status:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "jobs",
  "operationsHandoffRequest": {
    "inbox_alias": "original-buyer",
    "offset": 0,
    "limit": 25
  }
}
~~~

Follow **value.nextOffset** until it is null. Job rows are the original queue's current summaries. A listed saved response is not a new verification of its content; the export performs that verification within the selected bound.

## Retain one exact source selection

Choose a stable handoff ID and the actual ordered original intent IDs. Save the complete request before dispatching it through the existing MCP client:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "export",
  "operationsHandoffRequest": {
    "id": "original-buyer-operations-20261012",
    "inbox_alias": "original-buyer",
    "intent_ids": ["EXISTING_ORIGINAL_INTENT"],
    "max_verify_bytes": 268435456
  }
}
~~~

Replace the example intent with an ID returned by the original Inbox. The exporter accepts 1–100 distinct original intents. Their ordering is part of the retained request. The default output-verification limit is 256 MiB per saved response; an explicit value from zero through 1 GiB is supported. The original capture also limits total selected verification to 1 GiB. A large or unavailable response retains its actual review status instead of being reported as verified.

Before capture, the native workspace saves the exact selection and the original native-workspace, Inbox-header and optional registration hashes. It then durably claims a create-only capture-attempt boundary before calling the original SF88 exporter and publishing its unchanged JSON to a private create-only file. Only that boundary's publishing caller may start capture. The packet remains limited to 8 MiB by the original contract.

Successful **value** fields include:

| Field | Meaning |
| --- | --- |
| id, requestSha256 | Stable handoff selection and its original source-binding identity. |
| inbox_alias, inboxSha256 | The selected original Inbox and exact header captured for the request. |
| source.bytes, source.sha256 | Exact complete handoff JSON identity. |
| source.captureStartedAt, source.capturedAt | Actual capture interval, separate from payment or delivery timing. |
| counts | Original jobs, established signed attempts, settled records, verified retained outputs and unresolved settlement observations. |
| canReceive | Whether every row passes the original receiver's source eligibility checks; case attribution and approval remain explicit. |
| receiptRecorded | Whether the compact native handoff receipt is present. A saved capture remains inspectable when a later receipt write was interrupted. |
| replayed | True when this export invocation reopens a previously published capture. |
| verifiedSavedFile, noExecution | The saved source has been checked; the action performed no buyer execution. |

The original packet contains its exact Inbox header and selected original request, attempt, terminal, recovery, finalization and evidence records, plus the native view and saved-output verification. It does not package the purchased response body or an execution configuration. Original records can contain private operator metadata and paths. Keep the full handoff with the private receiving case.

## Recover a lost reply without another capture

Use the same handoff ID and the same normalized selection after an uncertain export response. The module checks for the already-published source before opening the current source Inbox. If a capture exists, the original source and observation time remain unchanged even when the Inbox has since progressed.

The original request ID cannot be reused for different intent IDs, their order, a different Inbox alias or a different verification bound. Such a change needs a separately reviewed handoff ID; it does not replace the old capture.

For read-only recovery, inspect the same saved source:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "inspect",
  "operationsHandoffRequest": {
    "id": "original-buyer-operations-20261012"
  }
}
~~~

Inspection opens the saved handoff and applies the original full source contract. It does not open or recapture the original Inbox. Supply an optional **sha256** when the expected saved source identity is already known.

**list** pages the workspace's own retained handoff requests. Its presence states are:

| State | Receiving action |
| --- | --- |
| PENDING_CAPTURE | The capture-attempt boundary has not been claimed. Reuse the original export request; the retained original source binding must still match. |
| CAPTURE_IN_PROGRESS_OR_UNAVAILABLE | A capture-attempt boundary exists but its original source file is not currently available. The first capture may still be running, or its result may have been interrupted or lost. Inspect that same ID after the original caller finishes, or restore its exact saved source. A second capture never starts under this ID. |
| SAVED_NEEDS_INSPECTION | A handoff exists but the compact receipt is absent. Inspect the same source and read its exact bytes. Replaying export can finish the receipt without recapturing. |
| SAVED | A handoff and compact receipt are present. Inspect or read the selected SHA to verify current file content. |
| SAVED_FILE_UNAVAILABLE | A retained receipt exists but the corresponding source file is absent. Restore that exact saved source through its original custody; do not recapture under this ID. |
| REQUEST_NOT_PUBLISHED | A private request directory was created but its request record was not published. Repeating the same original export can finish that initialization. |

List rows set **verifiedSavedFile: false** because listing metadata alone does not read every handoff. Use **nextOffset** rather than assuming that a requested limit is the returned count; tool pages are also bounded by bytes.

A stop after the capture-attempt boundary does not prove that publication never happened. If the original source cannot be recovered, an operator can deliberately choose a separately reviewed new handoff ID for a new observation while preserving the unresolved original request. The module does not make that choice automatically.

If the capture-attempt boundary has not yet been claimed and its native-workspace/Inbox/registration binding changes, the original request reports a conflict. Preserve it and choose a separately reviewed new capture if that is the intended action. If a complete handoff was already published before the change, inspect continues to expose that actual older source.

## Review every original row

Pin the complete source SHA returned by export or inspect:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "rows",
  "operationsHandoffRequest": {
    "id": "original-buyer-operations-20261012",
    "sha256": "EXACT_64_CHARACTER_SOURCE_SHA256",
    "offset": 0,
    "limit": 25
  }
}
~~~

Each ordinary item contains its original **index**, complete interpreted **row** and **rowJson** byte identity. The row preserves the original intent, request/configuration, operator, atomic amount string, attempt and settlement observations, native output verification, saved SF36 finalization and source-file hashes.

The module applies no new order or commercial inference. The source's observation time is not substituted for a chain-settlement or output-completion time. A team-operated testnet purchase does not establish an independent paying customer, award, commercial acceptance or cash receipt.

Follow **nextOffset** until null. If one complete row would exceed the bounded tool response, its item contains **largeRow.bytes**, **largeRow.sha256** and **largeRow.operation: row** instead of a truncated record. Read that interpreted JSON through:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "row",
  "operationsHandoffRequest": {
    "id": "original-buyer-operations-20261012",
    "sha256": "EXACT_64_CHARACTER_SOURCE_SHA256",
    "row_index": 0,
    "row_sha256": "EXACT_64_CHARACTER_ROW_SHA256",
    "byteOffset": 0,
    "maxBytes": 65536
  }
}
~~~

The same operation also reads an ordinary row using its **rowJson.sha256**. Keep both source and row SHA across ranges. Decode **value.file.data** as base64 and append at **byteOffset** until **nextByteOffset** is null. The original raw handoff stays independently available below.

## Deliver the unchanged handoff

Use **read** to receive the complete original JSON without a new capture:

~~~json
{
  "action": "operations-handoff",
  "operationsHandoffOperation": "read",
  "operationsHandoffRequest": {
    "id": "original-buyer-operations-20261012",
    "sha256": "EXACT_64_CHARACTER_SOURCE_SHA256",
    "byteOffset": 0,
    "maxBytes": 65536
  }
}
~~~

The returned **value.file** is the original native saved-file reader's byte envelope: complete byte count and SHA, requested offset, returned byte count, base64 data and next offset. The reader verifies the full file hash and uses its existing per-process descriptor-stamp cache for subsequent ranges. Changed bytes or source identities are rejected. A restarted process verifies the original file again.

A receiving client should durably retain the expected source SHA/size, same handoff ID and its next byte offset before asking for the next range. Write into its private receiving directory, verify the final byte count and whole SHA, then publish that exact JSON. A partial local file continues from its saved offset; it does not call export again or substitute another capture. The original Node/Python **inspectOperations / inspect_operations** or buyer CLI **operations inspect** can independently inspect that exact completed private file without opening the Inbox.

On the operator host, the unchanged file is retained under the existing native workspace's **operations-handoffs/SHA256(handoff-ID UTF-8)/handoff.json**. Its **request.json**, **capture-attempt.json** and **receipt.json** remain alongside it. The directory layout is private implementation custody; a model supplies only the stable ID.

## Receive into the existing Operations case

Open the original grant workspace's **Native buyer receiving** pane, select this exact file, and review its SHA, rows, current case version and existing deployment/purchase identities. Use the existing purchase when intent or network/transaction identifies prior work. Choose the actual participant class, operator and receiving reason before the original atomic case save.

The maintained CLI and the grant agent's typed buyer-source preview/receiving actions consume the same file. Their request ID and expected case version remain separate from the capture request: capture observes an original Inbox; receiving records an explicit case association.

An exact already-received source association reopens its current purchase without overwriting later observations. A new capture preserves an independently recorded merchant order status, because this reader does not observe the merchant-order lifecycle. Full source metadata, original history and the other case purchases/deployments stay in the existing case export and reopen path.

Follow [Native buyer work in delivery Operations](../../stellar/scf_2026/sf47_budget_model/workspace/BUYER_OPERATIONS.md) for the complete browser, CLI, source-selection and export steps. The [same-case receiving journey](../../stellar/scf_2026/sf47_budget_model/workspace/BUYER_RECEIVING_JOURNEY.md) keeps its actual original case, Node/Python customer inspection, grant-agent receipt and final case reopen together.

## Installed source and operational limits

The action belongs to the existing buyer MCP tool. Ship **native-operations-handoff.mjs**, its pure schema, the existing native-workspace dispatch/shutdown join and the current SF43 tool schema together with their original SF88 dependencies. Keep the existing analysis, Request Collections, recovery and DuckDB modules in the complete installed source closure.

The original **native-workspace-cli.mjs call --dir ... --input ...** accepts the same arguments object from a private JSON file. The operator keeps the current MCP server and its original registration; no new service or queue is needed.

This guide describes the implemented source contract. A source merge or grammar check is not an actual native customer run. Retain the completed original worker/result and its source/workspace identities when that receiving journey is performed.
