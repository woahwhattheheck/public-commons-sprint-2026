# Complete object acquisition through the native MCP buyer

An agent can now receive a complete merchant file through the existing
`sf43_discover_review_and_pay` tool. The operator registers the merchant's original
S3 `objects.json`; the agent selects one declared product, prepares a stable
acquisition with a whole-object budget, and runs the original SF88 object buyer.
The same acquisition supports interruption, recovery, accounting, assembly and
bounded reads of the verified complete file after restart.

The implementation uses the original object session, descriptor selector, inbox,
SF62 terminal approval, SF36 ledger, native signer, SF31 response writer and
accounting commands. It adds their MCP application interface. There is no new
wallet, alternate payment engine or automatic purchase authorization.

## Connect an existing operator

Use an existing native testnet operator and the original MCP setup described in
[NATIVE_WORKSPACE.md](NATIVE_WORKSPACE.md). Its configured resource must be the
selected object's exact HTTPS origin and pathname, method `GET`, with no query
or hidden request body. Its current per-request cap, payer, asset, recipient,
signer, ledger and explicit CONNECT transport remain the operator's settings.

Register the actual merchant-provided descriptor on that same host:

```sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs objects-register \
  --dir /private/commerce/native-mcp \
  --description /private/commerce/merchant/objects.json

node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs serve \
  --dir /private/commerce/native-mcp --port 3210
```

The original `MCP_ACCESS_TOKEN` remains required. For a desktop or editor client,
use the existing [stdio launcher](STDIO.md) with the generated trusted
`MCP_OPERATOR_MODULE` and native workspace settings. Run from the operator's
controlling terminal so the original approval can open `/dev/tty`.

Registration copies the complete original UTF-8 descriptor into private storage,
identified by its SHA-256. It validates selectable rows using the original SF88
selector and restricts them to this workspace's route. Other products in that
same source document remain retained but are not selectable through this
operator. A different route uses its own correctly configured original workspace.
Registration reads no wallet key and makes no merchant request.

The tool cannot register a file, choose a local path, replace a signer or change
the operator's transport. These are host operations. Registering an updated
descriptor creates another source ID; earlier acquisitions retain their exact
original source edition. An identical registration reuses its original record.

## Select the original product

Call the existing MCP tool with the following argument objects. For local CLI
operation, put an argument object in a private JSON file and pass it to
`native-workspace-cli.mjs call --dir ... --input ...`.

```json
{"action":"object-sources","limit":25}
```

Use the returned `sourceId` in:

```json
{"action":"object-list","sourceId":"SHA256_FROM_OBJECT_SOURCES","offset":0,"limit":25}
```

The response preserves each selected original object ID, route, filename, content
type, byte count, mode, snapshot, source hash and optional complete digest. It
does not infer a file size or version from a filename. The source document supplies
product facts; the original live buyer still reviews the actual payment challenge.

The original seller supports two modes:

| Original mode | Native request plan |
| --- | --- |
| `chunks` | Consecutive fixed `offset` and `length` queries, each within the descriptor's maximum. |
| `whole` | One GET with no query, including an explicitly declared zero-byte file. |

Whole files keep their fixed length. An empty file uses positive writer capacity
while its expected content length remains zero. Chunked responses retain the
native range, snapshot, byte-count, digest and continuity checks.

## Prepare and review a complete acquisition

```json
{
  "action":"object-prepare",
  "sourceId":"SHA256_FROM_OBJECT_SOURCES",
  "objectId":"archive",
  "acquisitionId":"monthly-archive-2026-10",
  "maxAtomic":"1000",
  "maxTotalAtomic":"3000"
}
```

Replace these values with the actual listed product and chosen budget. The
example permits three requests at up to 1,000 atomic units each; it is not a
statement of a merchant's price. An optional `chunkBytes` can lower a chunked
product's requested length. A smaller chunk may require more paid requests, so
inspect the resulting `chunkCount` and `limits.plannedMaxAtomic` before running.

`maxAtomic` may lower the existing workspace's per-request cap. If omitted, the
current workspace cap is saved. `maxTotalAtomic` is always explicit. Preparation
rejects a plan whose request count multiplied by the saved per-request ceiling
exceeds that total. Actual charges remain the original native outcomes and ledger
records; an allocated ceiling is not a charge. The original cumulative ledger
and current lower workspace cap still apply at execution.

Preparation snapshots the original configuration and calls
`createObjectSession` to create its original queue jobs. It does not request the
merchant file, approve a payment or sign. The result contains the original session
ID, selected source, budget, exact request plan and initial state.

Use the same `acquisitionId` for retries and later operations. An identical
preparation returns the saved acquisition; changed source, object, length or
budget fields for that ID are rejected. Choosing a new ID starts a separate
acquisition and must be an intentional purchase decision.

## Run, stop and resume

```json
{"action":"object-run","acquisitionId":"monthly-archive-2026-10"}
```

This starts the original object CLI in a child process with the original operator
workspace. Native prerequisite checks, terminal approval, reservation, signing,
response delivery and durable queue attempts retain their normal behavior. The
MCP response separates the child's exit/signal/error from the original session
report. An HTTP `NO_PAYMENT_REQUIRED` outcome remains unpaid.

Ordinary native requests and object commands share one approval-terminal gate in
this MCP workspace. A competing operation receives `MCP_NATIVE_OPERATOR_BUSY`;
it is not queued for a later automatic purchase. Repeating the same active
object run joins that operation and returns the caller's requested report page.
Finalization joins only the same active accounting page. The original object session also preserves
its own process lock and each original queue job's one-attempt ownership.

```json
{"action":"object-cancel","acquisitionId":"monthly-archive-2026-10"}
{"action":"object-status","acquisitionId":"monthly-archive-2026-10","offset":0,"limit":25}
{"action":"object-recover","acquisitionId":"monthly-archive-2026-10"}
```

`object-cancel` stops this host's active object command and waits for it to close.
It does not erase attempts, reverse a payment, or permanently disable untouched
requests. A later explicit `object-run` may continue those untouched requests.
If there is no active command, cancellation reports that fact without dispatch.

Recover uses the original saved native outcome/evidence and stale-lock recovery.
It never sends a paid request again. A previously attempted uncertain response
remains subject to original reconciliation; changing the ID or deleting a ledger
is not recovery. A saved prefix resumes from its remaining untouched requests.

Status returns a bounded chunk page. Follow `report.chunkRange.nextOffset` for
later chunks. The original inspector verifies retained chunk bytes; inspecting
a large completed object therefore performs whole-object I/O. For repeated
application reads, assemble once and use `object-read`, which shares the native
saved-file reader's verified descriptor cache.

`object-history` pages acquisition identities and source/budget bindings without
rehashing every object. Its `SESSION_RETAINED` label means only that the original
session exists; `executionInspected:false` directs callers to `object-status`
for current execution state. Source/history cursors are the returned opaque hashes.

## Assemble and consume the actual file

```json
{"action":"object-assemble","acquisitionId":"monthly-archive-2026-10"}
{"action":"object-read","acquisitionId":"monthly-archive-2026-10","byteOffset":0,"maxBytes":32768}
```

Assembly streams the original contiguous, verified chunks into a private
create-only destination selected by the host. The MCP delivery retains the exact
native session/assembly binding, filename, content type, length and complete
SHA-256. An existing successful assembly is verified and reopened. It is never
overwritten or reacquired from the merchant.

Read returns base64 bytes, total length, complete digest, the actual range length
and `nextByteOffset`. Continue until that value is null. A complete valid UTF-8
response also includes `text`; arbitrary binary ranges do not pretend to be text.
Each call returns at most 65,536 bytes. Clients decode and append the returned
ranges in order; they should compare their final length/digest with the saved
result before using it as a complete file.

The first read in a process hashes the complete saved file through a fixed
64 KiB buffer. Later reads reuse that verification only while device, inode,
size and nanosecond change/modification times remain identical. Each read uses
one descriptor and checks it before and after reading. Restart or changed file
metadata requires fresh verification; symlinks and changed bytes are rejected.

If a crash occurred after the native complete file was written but before the
MCP delivery record, `object-assemble` checks the file against the original
complete session and retains the recovered delivery. If the native assembly
receipt itself was not saved, the result explicitly retains
`nativeReceiptStatus:NOT_RECORDED`; it does not fabricate that receipt or make
another purchase. Missing output and mismatching bytes are reported explicitly.

## Complete the existing accounting

```json
{"action":"object-accounting","acquisitionId":"monthly-archive-2026-10","offset":0,"limit":25}
{"action":"object-finalize","acquisitionId":"monthly-archive-2026-10","offset":0,"limit":25}
```

Accounting reads the original per-request finalization views. Finalize invokes
the original object accounting command against the same workspace and ledger;
it performs original receipt reconciliation without another purchase. Follow
`accounting.range.nextOffset` until null and inspect unresolved entries. The MCP
call does not accept an outbox, routing file, evidence endpoint or replacement
financial policy. Use the original native command when an operator needs those
separately reviewed host settings.

## Restart, interrupted initialization and handover

Keep the native MCP directory together with its original SF88 workspace, ledger,
evidence, signer configuration and required external secret environment. The new
`objects/` subtree holds exact source descriptions, immutable acquisition inputs,
native session directories, native assembly receipts and private complete files.
The same absolute-path binding rules as the original object session apply.

Preparation uses the original private initialization lock, backed by an OS lock
in the configured Python process. A host crash releases it without deleting a
successor's lock. If native construction finished before the MCP binding was
published, a repeated identical preparation reopens that exact native session.
An earlier incomplete constructor remains intact at its original paths. A
following construction is allowed only after checking that the incomplete
original inbox has no recorded attempt; an observed attempt is retained for
original review. No partial source directory or payment record is discarded.

`inspect --dir ...` now includes registered object sources and retained acquisition
identities. Exporting or backing up the whole native directory preserves these
records; an operator should not transfer only the assembled file when the
receiving operator also needs execution/accounting history. The original
single-request history report remains available unchanged.

