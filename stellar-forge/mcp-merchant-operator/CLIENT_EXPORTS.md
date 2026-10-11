# Deliver and recover the original customer SDK

The merchant exports its customer SDK through the existing SF30 generator. The
same JavaScript module, TypeScript declarations, OpenAPI document, package metadata
and README remain the five payloads. A `client-export.json` completion receipt is
published after those files are durable. The receipt records the original OpenAPI
SHA-256, saved origin and mode, operation IDs/methods/paths, and every payload's
byte count and SHA-256. MCP exports also retain the actual export, release, release
digest and process instance identities returned by the running merchant.

This lets an operator resolve a lost export response and deliver the exact saved
customer files after the seller stops or the MCP provider restarts. Exporting,
inspecting, adopting and downloading do not purchase a resource or execute the
saved JavaScript. A saved `NATIVE_X402` mode describes the captured configuration;
it is not a current availability or settlement observation.

## Export once, then inspect that export ID

Use the existing `merchant_catalog` on the process-owned instance to review its
original metadata. Call the existing tool with a new customer ID:

```json
{"instanceId":"<merchant_status.operator.instanceId>","id":"customer-1"}
```

`merchant_client_export` creates `customer-1` below the host's configured
`exportsDirectory`. Its existing `files` array still contains the five original
payload names. Additive fields return `state:"COMPLETE"`, `filesSha256`, the
original `manifest` and `manifestFile`. Publication remains create-only: another
export with the same ID cannot replace it.

After an interrupted response, call `merchant_client_export_status` with
`{"exportId":"customer-1"}` before deciding whether a new export is needed.

| Status | Meaning and continuation |
| --- | --- |
| `COMPLETE` | The completion receipt, original source and all five payload hashes agree. Deliver that retained export. |
| `LEGACY_FILES_RETAINED` | All five original payloads are present without a completion receipt. Inspect `filesSha256` and explicitly adopt those bytes as described below. |
| `INCOMPLETE` | A directory exists but has no completed receipt and some original payloads are missing. `missingFiles` and the present file identities identify the incomplete output. Preserve it for local recovery; a new generation uses a new ID. |
| `NOT_FOUND` | The named directory has not been retained. |

Changed source, missing files from a completed export, invalid package layout or
a changed completion identity produce a specific error rather than a successful
status. Inspection reads the original files; it never generates a replacement.

## Adopt an existing five-file export

Exports made before completion receipts were introduced remain usable. The status
operation reads their exact files and validates the retained OpenAPI through the
original generator's snapshot validator. It checks the generated module's original
source-hash header and the known package entrypoints without importing the module.
The complete digest is computed over the fixed, ordered file names, sizes and
hashes. It is a byte identity for operator review, not a signature of the seller.

After reviewing the original status, call `merchant_client_export_adopt`:

```json
{"exportId":"customer-1","expectedFilesSha256":"<status.filesSha256>"}
```

The operation rereads the files and requires that inspected digest. It retains a
create-only receipt with `completion:"ADOPTED_RETAINED"` and the current
`completedAt`. It does not backdate the receipt, recreate missing files, regenerate
code, or infer a previous release/instance from the currently selected merchant.
Its provenance contains only the known export ID. A retry returns the same saved
receipt with `reused:true`. Completed exports keep their existing receipt and time.

The same original exporter supports local host operation, including exports made
outside MCP:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs \
  status --dir /private/merchant/customer-exports/customer-1

node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs \
  adopt --dir /private/merchant/customer-exports/customer-1 \
  --expected-files-sha256 INSPECTED_COMPLETE_FILES_DIGEST
```

The existing `--openapi SAVED_JSON --out NEW_DIRECTORY` command is unchanged and
now publishes the completion receipt after its five payloads. A generic local
export has no merchant release provenance unless its caller supplies the original
known values. The maintained generator, declaration builder and buyer integration
are still the only authorities for generated client behavior.

## Inspect and download through the existing MCP endpoint

The operator chooses its existing authenticated HTTPS MCP endpoint, or its original
loopback listener during local development. Supply the bearer token through
`MCP_ACCESS_TOKEN` or the existing name selected by `--token-env`; do not put it in
the URL or command arguments. The client retains no token in its checkpoint.

```sh
starforge merchant-mcp inspect-client \
  --url http://127.0.0.1:3211 --export-id customer-1

starforge merchant-mcp download-client \
  --url http://127.0.0.1:3211 --export-id customer-1 \
  --manifest-sha256 REVIEWED_MANIFEST_DIGEST \
  --out /private/customer/client
```

`inspect-client` returns `{manifest,manifestSha256}` from the original saved
receipt. `--manifest-sha256` is an optional exact-review pin; if it differs, the
download stops before creating or changing the local output. Every download also
pins the actual manifest digest in its own checkpoint, regardless of that option.
The source command is `node stellar-forge/mcp-merchant-operator/serve.mjs` with the
same subcommand and arguments. The output's parent must already exist.

The downloader creates a private directory (`0700`), payloads (`0600`) and its
`download-state` subdirectory. That subdirectory retains the exact original
receipt, verified per-file byte offsets/digests and the existing Linux `flock`
lease from util-linux. SDK and support downloads use the same persistence code
but distinct receipt names and checkpoint schemas. An unrelated directory or a
changed endpoint/export/receipt cannot silently replace the selected download.

Progress is JSON on stderr. Final stdout JSON reports `COMPLETE`, five payloads,
total bytes, exact source and manifest identities, saved mode/origin/operations,
completion provenance and whether this invocation resumed. The five payloads
appear at their normal names; `client-export.json` is published at the output root
only after every payload has been verified and durably published. Completion
receipts are published atomically through a private staging file, so a stopped
write cannot expose a partial final receipt.

### Continue an interrupted delivery

Run the same command with the same output directory. Completed payloads are
verified locally and reused. A partial payload is hashed through its checkpointed
prefix before resuming at that exact offset. Only an uncheckpointed suffix of the
owned partial file may be discarded after a killed write. An edited completed
file, changed durable prefix or missing checkpointed partial file is reported
instead of overwritten. Correct the actual disk/connection issue, then resume.

The default chunk is 196,608 bytes; `--chunk-bytes` can select any smaller positive
size. A live server's verified file snapshot serves all subsequent chunks without
rereading the original source. After a server restart or idle expiry, the client
opens the same original filename with the same manifest/file digests and saved
offset. A changed source cannot be substituted mid-download. SIGINT/SIGTERM leaves
the durable prefix available and releases the current read when possible; process
exit automatically releases the local kernel lease. Closing the provider releases
only its owned temporary snapshots and keeps every retained export.

## Use the recovered original customer module

The downloaded directory is the original generated package, ready for the same
local JavaScript import and adjacent TypeScript declarations:

```js
import { source, operations, buildRequest, createSellerClient } from './client/seller-client.mjs';

const request = buildRequest(yourOperationId, yourOriginalInputs, {
  intentId: yourStableBusinessOperationId,
  acceptIndex: yourSelectedOriginalPaymentOption,
  maxAtomic: yourExplicitAtomicSpendCeiling,
});
const api = createSellerClient({ buyer: yourExistingConfiguredBuyer });
```

Import and `buildRequest` remain offline. Calling `api.call` is the separate
explicit action that delegates to the existing buyer, with its normal approval,
wallet, spend and receipt handling. Read the downloaded README for the original
method, input, multipart/streaming and payment-flow requirements. The recovered
SDK preserves its captured origin and all original payment choices. Delivery
neither rewrites those terms nor establishes that an old seller is still live.

## Original retained-file tools and embedding APIs

| Tool | Input and result |
| --- | --- |
| `merchant_client_export_status` | `exportId`; full original-file verification, completion/legacy/incomplete status and active read information. |
| `merchant_client_export_adopt` | `exportId`, `expectedFilesSha256`; explicit byte-preserving adoption and retained receipt. |
| `merchant_client_export_manifest` | `exportId`; `MANIFEST_RETAINED`, exact `manifestFile`, original `manifest` and read information. This reads the receipt without hashing every payload. |
| `merchant_client_export_file` | `exportId`, one fixed `file`, `expectedManifestSha256`; optional `expectedSha256`, `readId`, `offset`, `limit`. Returns base64 bytes and exact export/manifest/file/offset identities. |
| `merchant_client_export_file_release` | `exportId`, `readId`; idempotent release of the temporary snapshot without deleting original files. |

Select only `client-export.json`, `seller-client.mjs`, `seller-client.d.mts`,
`seller-openapi.json`, `package.json` or `README.md`. A later offset or `readId`
requires `expectedSha256`. Continue until `nextOffset:null`; after
`CLIENT_READ_NOT_FOUND`, omit the expired read ID and retain both digests and the
same offset. The original reader permits four snapshots totaling 256,000,000
bytes per owner, uses memory up to 32 KiB per file and an immediately unlinked
private descriptor above that size, and expires an idle read after 120 seconds.
Customer payloads are limited to 64 MiB each and 128 MiB total; the original
OpenAPI input remains limited to 16 MiB and receipts to 65,000 bytes.

`client-download.mjs` exports `inspectSellerClientDownload(options)` and
`downloadSellerClientExport(options)`. The download options match the support
transport: `url`, `exportId`, `directory`, optional `tokenEnv`, `environment`,
`signal`, `chunkSize`, `expectedManifestSha256` and `onProgress`. The shared
`retained-download.mjs` owns transport/persistence; `retained-file-reads.mjs` owns
the original verified server snapshots. Accounting, support and customer exports
retain their own scopes and close behavior. No extra service, dependency, signer
or payment implementation is installed.

## Existing release console and retained inventory

Open the original SF82 console with `--client-exports` selecting this merchant's
existing `exportsDirectory`. Its Customer SDK handover section uses the same
canonical exporter, completion/adoption functions and `RetainedFileReads`
authority as these MCP tools. The complete guide is
[CLIENT_HANDOVER.md](../../stellar/scf-starforge-20261009/sf82-seller-pilot/CLIENT_HANDOVER.md).

The additive `merchant_client_export_list` tool returns paged retained entries
without reloading each SDK payload; use optional `after` and `limit` (1–50).
`merchant_client_export_status` retains its full-file verification and defaults;
add `includeOffers: true` for the original canonical snapshot with every operation
and payment alternative. The original client tool signatures, completion receipt,
chunk transport and downloader remain compatible. The single shared implementation
lives in `client-exports.mjs`; each MCP or console owns only its temporary readers
and retains the same host-selected customer files across shutdown.
