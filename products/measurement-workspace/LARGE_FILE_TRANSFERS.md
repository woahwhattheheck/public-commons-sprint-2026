# Measurements: complete large-file transfer and receiving

This is the configured client for the original Measurements large-intake, original-source and complete-edition APIs. The existing managed Applications service remains the only scientific database owner. This client retains and moves the actual original bytes, pauses and resumes bounded transfers, preserves the first observed HTTP results, and invokes the existing preparation, reviewed commit or full-project receiver.

Use the installed command `starforge measurement-workspace-client`, or run `node products/measurement-workspace/client-cli.mjs` from the complete selected source. Node 22.16 or later and the existing managed Measurements connection are required. Follow [OPERATOR.md](OPERATOR.md) for Applications Review/Start/Open, authentication and private configuration.

## What is complete

| Selection | Complete output and next step |
| --- | --- |
| Upload of WQP CSV or station source | Every original byte is retained locally and acknowledged by native intake. Review the original preparation before an explicit native commit. |
| Upload of an original portable project | Every archive byte is retained and acknowledged. Invoke the original complete-project receiver in an appropriate empty recipient workspace. |
| Original source | All files in the native source descriptor, including the full original input, source metadata and rejection population when present. |
| Complete edition | Every file in the frozen native edition descriptor, including `project.zip`, populations, and zero-byte members. Export preserves their exact native filenames and hashes. |

`FILES_COMPLETE` describes transport completion. It does not mean the source has been scientifically committed, the archive has been received, or the customer-facing product has been operated and inspected.

The client accepts original uploads and complete file sets up to **8 GiB**, using the native **262,144-byte** chunks. It retains up to 1,000 distinct native filenames and never truncates a member to fit. The original native API's own limits and scientific validation still apply. A historical population edition without `project.zip` is explicitly incomplete for whole-project transfer: create a **new** native export edition in the workspace holding that original history. Keep the prior edition unchanged.

## Configure original files separately from commands

Keep scientific workspace, host-authored input files, client custody and ordinary exported deliveries separate. Use absolute regular files without symlink traversal. Configuration and custody are owner-only. The configured token environment variable authenticates the original managed service; do not put its value in commands, URLs, source or delivered reports.

The existing `inputs` alias map names complete JSON request documents. The additive `files` map names full CSV, station or native ZIP files, without converting those files to JSON or loading them entirely into an agent response.

Example host-authored maps:

```json
{
  "source-transfer": "/srv/measurements-input/source-transfer.json",
  "prepare-source": "/srv/measurements-input/prepare-source.json",
  "commit-source": "/srv/measurements-input/commit-source.json",
  "edition-transfer": "/srv/measurements-input/edition-transfer.json"
}
```

```json
{
  "original-wqp": "/srv/measurements-input/actual-original.csv"
}
```

Configure these existing files against the actual reviewed connection:

```sh
node products/measurement-workspace/client-cli.mjs configure \
  --config /srv/measurements-client/connections.json \
  --workspace study \
  --connection /srv/measurements-control/connection.json \
  --connection-sha256 ACTUAL_CONNECTION_SHA256 \
  --exports-directory /srv/measurements-custody \
  --label "Selected measurements study" \
  --inputs /srv/measurements-input/command-aliases.json \
  --files /srv/measurements-input/file-aliases.json \
  --out /srv/measurements-client/configured.json
```

All uppercase digest/UUID placeholders in this guide must be replaced with actual retained identities. Filenames and the label are illustrative, not supplied scientific inputs. Configuration is create-only: use a successor configuration filename when adding aliases or selecting a restarted instance. Preserve the same original custody for continuation. Existing configurations without `files` remain valid for their original operations.

Every command requires `--config` and `--out`; transfer commands also require `--workspace`. Except for `transfer-download` and `transfer-export`, `--out` is a complete immutable JSON output file. Use distinct output names for different progress observations. Exact repeated bytes can reuse a destination; changed bytes cannot overwrite it.

## Upload an actual source, prepare and commit

### Inspect and retain

Run `transfer-inspect --file original-wqp` to obtain the actual full byte count and SHA-256. This is a read of the host-declared original. Create the exact upload document in a declared input file:

```json
{
  "kind": "upload",
  "file": "original-wqp",
  "fileSha256": "ACTUAL_FULL_FILE_SHA256",
  "native": {
    "kind": "wqp",
    "label": "Actual original source label",
    "mapping": {},
    "origin": {"type": "file"}
  }
}
```

Use `kind:"stations"` for an original station source, or `kind:"portable"` for an actual complete native ZIP. Mapping and provenance are the original native objects; retain the actual reviewed fields. The client does not infer column roles, date formats, qualifiers, chemical basis, eligibility or thresholds. An optional native `id` must be the intended 64-character lowercase hexadecimal intake ID. When omitted, the client derives a stable native ID from the retained transfer UUID.

Use the existing `inspect --input source-transfer` command to hash the exact request JSON. Retain a new transfer UUID before starting:

```sh
node products/measurement-workspace/client-cli.mjs transfer-start \
  --config /srv/measurements-client/connections.json \
  --workspace study --transfer-id ORIGINAL_TRANSFER_UUID \
  --input source-transfer --sha256 ACTUAL_REQUEST_FILE_SHA256 \
  --out /srv/measurements-client/source-start.json
```

Start preserves the complete original request and makes a byte-verified private copy of the full source before any native dispatch. If interrupted during that capture, repeat the exact original start with the same UUID, alias and input digest. Keep the original source available for that capture retry. Once capture succeeds, continuation reads the retained copy; editing the external source does not silently change the transfer.

### Advance and recover

```sh
node products/measurement-workspace/client-cli.mjs transfer-run \
  --config /srv/measurements-client/connections.json \
  --workspace study --transfer-id ORIGINAL_TRANSFER_UUID \
  --run-id ORIGINAL_RUN_UUID --max-chunks 64 --until-complete true \
  --out /srv/measurements-client/source-uploaded.json
```

A run UUID retains its exact chunk budget. The CLI accepts 1–32,768 chunks per advance; the Merchant tool accepts 1–256. Without `--until-complete true`, one bounded advance returns its current status. A completed bounded run is immutable: select another explicit run UUID for the next advance. With the option enabled, subsequent bounded runs derive stable UUIDs from the original CLI run UUID and iteration, so the same command can resume the original sequence.

After an interruption, reuse the original transfer, run UUID and budget. The client performs the native idempotent begin and then a **fresh retained native intake read**. It reconciles the current contiguous offset with the original file and acknowledged chunk identities. A lost chunk response does not reset the upload to the first begin response's old offset. Previously accepted but locally unrecorded chunks are checked by their original hashes before the remainder is sent.

Each generated native call retains its request and first complete HTTP response in the existing client custody. An unknown transport result can retry only the supported original exact-replay contract. A completed HTTP error remains the first observed result for that transport request. Inspect it, correct the actual cause and use a new explicit run for a subsequent attempt; keep the original transfer and all earlier receipts.

Read paged history with:

```sh
node products/measurement-workspace/client-cli.mjs transfer-status \
  --config /srv/measurements-client/connections.json \
  --workspace study --transfer-id ORIGINAL_TRANSFER_UUID \
  --offset 0 --limit 25 \
  --out /srv/measurements-client/source-status-01.json
```

Continue at `nextOffset` to read the entire retained calls, progress and action history. Status includes the actual native and transport request identities. Original client `status`, `file-info` and `download` open any indicated transport request's full input, headers, response and attempts.

### Prepare the actual native source

The declared preparation file contains only:

```json
{"action":"prepare"}
```

Hash it through `inspect`, then use `transfer-apply --transfer-id … --action-id ORIGINAL_PREPARE_UUID --input prepare-source --sha256 ACTUAL_PREPARE_INPUT_SHA256`. The output is the complete original native preview inside `value`. Review its source SHA, byte count, current revision, normalizer pin, mapping, accepted/rejected source rows and findings through the original UI and exported source population.

The reviewed commit input is:

```json
{
  "action": "commit",
  "expectedRevision": 17,
  "expectedSourceSha256": "ACTUAL_FULL_FILE_SHA256",
  "expectedNormalizerPin": "ACTUAL_NATIVE_NORMALIZER_PIN"
}
```

The number 17 is illustrative; use the actual reviewed native revision. Commit uses a separate retained action UUID and exact hashed input through `transfer-apply`. The native writer checks this complete preparation binding. The transfer layer does not substitute another source, refresh a stale scientific decision, or declare rejected rows accepted.

An accepted action result reopens by its original UUID and exact input without another native write. If an action returned a definite refusal, retain it and author a new reviewed action with a new UUID. If its outcome is unknown, reconcile or retry the original supported operation before replacing its identity.

## Download a complete frozen edition

Create an input with a deliberate native edition ID:

```json
{
  "kind": "edition",
  "id": "ACTUAL_RETAINED_NATIVE_EDITION_ID",
  "create": true,
  "filters": {}
}
```

`create:true` calls the original native export once under that ID and retains the frozen file descriptor. The native complete project is preserved alongside its selected populations. For an already retained complete edition, use `create:false` and omit `filters`. The previous edition's original filters remain authoritative.

Start the edition transfer with a new retained transfer UUID and the exact declared input digest, then use the same `transfer-run` continuation. Every member's size, complete SHA-256 and ordered chunk hashes are checked. Corrupt or truncated chunks cannot publish a completed file. Empty populations remain zero-byte files in the complete file set. A transfer does not finish after downloading only the first convenient CSV.

Export all members to an ordinary private directory outside client custody:

```sh
node products/measurement-workspace/client-cli.mjs transfer-export \
  --config /srv/measurements-client/connections.json \
  --workspace study --transfer-id ORIGINAL_EDITION_TRANSFER_UUID \
  --out /srv/measurements-delivery/selected-edition
```

This creates each exact native member plus `edition.json`, `transfer-request.json` and `transfer-complete.json`. All outputs are create-only and verified on exact replay. The directory is the full delivery; `project.zip` is the original full-project receiving input. Transport request/status files are distinct from the ZIP archive.

For an original source, use `{"kind":"source","id":"ACTUAL_NATIVE_SOURCE_ID"}`. The same course downloads every original source member and exports its native descriptor as `files.json`.

To retrieve an individual completed member, first use `transfer-file-info --part member --name project.zip`, then `transfer-download` with those same selectors and `--out /absolute/delivery/project.zip`. Other parts are `input`, `request`, `complete`, `descriptor`, `original` for an upload, and `action` with `--name ORIGINAL_ACTION_UUID`. A file-info receipt is metadata; download writes the actual complete file.

## Receive on another original workspace

Move the complete exported delivery by the authorized existing file route. Compare actual received bytes with the sender's descriptor. Preserve the whole delivery and open its reports, original populations and contained project as a recipient.

Create or select a separate recipient managed workspace through the original Applications course. Declare the delivered `project.zip` as a `files` alias **outside the recipient's custody**. Do not give the sender transfer a different physical binding. The recipient has its own new upload transfer UUID and its own original receipt history.

1. Inspect the actual delivered ZIP bytes and pin their SHA-256.
2. Retain an upload request with `native.kind:"portable"`, the actual label, file alias and SHA.
3. Start and fully advance the recipient transfer.
4. Hash a declared action input containing exactly `{"action":"receive"}`.
5. Invoke `transfer-apply` with the recipient transfer's retained receive action UUID.
6. Preserve its complete accepted native result. The original receiver validates and admits the full archive under its own empty-workspace and exact-archive replay rules.

Complete receiving can change the native workspace UUID. The managed connection intentionally becomes stale when that happens. Use **the same managed Applications owner** to Stop, Review and Start the same physical recipient directory. Review the new instance receipt and create a successor client configuration with the **same recipient custody and alias**. Preserve both old and new configurations.

For an interrupted receive that accepted before losing its response, rebind the retained transfer explicitly:

```sh
node products/measurement-workspace/client-cli.mjs transfer-rebind \
  --config /srv/measurements-client/received-connections.json \
  --workspace recipient --transfer-id ORIGINAL_RECIPIENT_TRANSFER_UUID \
  --original-instance-id ORIGINAL_RECIPIENT_INSTANCE_UUID \
  --connection-sha256 ACTUAL_NEW_CONNECTION_FILE_SHA256 \
  --out /srv/measurements-client/received-transfer-binding.json
```

Rebind verifies the original and live instance identities and the same physical workspace binding. A changed native UUID is allowed only for this portable upload with its retained receive request. An ordinary source upload cannot be silently rebound to a different native project. Rebinding itself does not receive or commit scientific data.

Retry the **same receive action UUID and exact input** after that binding. The native archive identity reconciles the first accepted receive; it does not create another project write. If the accepted action was already retained, it reopens offline without another dispatch. For an ordinary service restart without a native UUID change, the same explicit binding procedure can resume its prior transfer.

Open the received scientific UI, inspect all original source/history and selected scientific results, make the actual attributed recipient edit and save it through the original writer. Export a **new** complete native edition ID for the recipient successor. A restored historical population descriptor is not automatically a newly materialized complete project ZIP.

## Merchant tools

The original eight configured Measurements tools remain available. Eight additive tools cover this whole transfer course:

| Tool | Operation |
| --- | --- |
| `merchant_measurement_transfer_inspect` | Hash and size a host-declared original file. |
| `merchant_measurement_transfer_start` | Retain the pinned request and full original source. |
| `merchant_measurement_transfer_advance` | Continue one bounded original run. |
| `merchant_measurement_transfer_apply` | Prepare, commit or receive through the original native writer. |
| `merchant_measurement_transfer_rebind` | Review an original transfer against the current same-directory instance. |
| `merchant_measurement_transfer_status` | Page complete retained progress, calls and actions. |
| `merchant_measurement_transfer_file_info` | Select an exact complete original member or receipt. |
| `merchant_measurement_transfer_file_read` | Read all selected file bytes in bounded pages under its SHA. |

Every tool selects the configured workspace alias and exact current `instanceId`. Inputs and files are host-declared aliases; tools do not accept arbitrary destination URLs or unreviewed filesystem paths. Use the existing `merchant_measurement_file_release` for either kind of retained read. Continue the returned byte pagination until the complete original file is obtained; a first page is not a delivery.

The CLI additionally provides whole-file `transfer-download` and whole-directory `transfer-export`. These write complete recipient artifacts instead of requiring an agent to concatenate base64 pages.

## Custody and shutdown

The client uses the existing Measurements directory-lock helper around its private transfer directory. It never opens a second scientific SQLite store. Source copies, request bytes, run definitions, chunk receipts, descriptor, completed files, actions and binding history remain under that original private custody. Normal adapter shutdown waits for active transfer work, then closes the original client and retained-file readers.

An interrupted create-only file publication can leave the original reserved sibling hardlink. The existing custody reader checks the same regular inode, removes only recognized same-inode reserved siblings and verifies the expected original bytes. It does not accept arbitrary extra hardlinks or replace a conflicting delivery.

Keep full custody until the original operation and recipient course are reconciled. Removing a local output file is not a native rollback or cancellation. Actual native locks, requests and managed process ownership remain with the original service.

## Source and acceptance record

This delivery extends the installed client and Merchant adapter and selects the current complete scientific source through `original-source.json`. The original native large-file command implementation, accepted-input recovery and complete export/receive rules remain in their existing maintained modules.

Focused actual-code execution with injected filesystem and native-response adapters covers interrupted source publication, native chunk acceptance followed by response loss, same-run offset recovery, corrupt chunk refusal, full and empty members, create-only export, exact reviewed commit, received UUID replacement and replay of the accepted receive. These are source-function results. No unavailable native process, simulated adapter or peer source review is described as a rendered or equipped-host acceptance.

Before declaring an outgoing customer product or its attachments ready, apply the complete [standing producer instruction in OPERATOR.md](OPERATOR.md#standing-rendered-product-and-attachment-instruction). Operate the exact installed source through the existing equipped owner: open and look at the actual original Measurements screens at desktop and narrow widths, use meaningful populated/empty/loading/error states, operate upload/prepare/commit and full export/receive/reopen, and literally open/use the final archive and every contained deliverable or working project. Repair what the actual course reveals. Keep source integration and actual native/visual acceptance distinct.
