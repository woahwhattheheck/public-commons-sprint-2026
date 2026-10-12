# Receive a complete paid-job case

The paid-job receiving client brings an original merchant export into a private local directory and reopens the same case offline. It uses the existing merchant MCP connection and retained-file transport. A completed receive contains the exact job, completed output, declared input files, resolution case, buyer receipt, and selected accounting export recorded in the original manifest.

The installed command is **merchant-paid-jobs**. The same interface is available under **merchant-mcp jobs**. The JavaScript and TypeScript entry is **./merchant/mcp/paid-jobs/client** in the installed distribution. Use the original installed Node runtime and Linux flock support.

## Select the original export

An operator first selects a job and its current revision in the existing merchant workspace. Its original **merchant_jobs_export** operation accepts the configured workspace alias, request UUID, job ID, expected job revision, and expected case revision. Keep the returned exportId and manifestFile.sha256. The request UUID preserves the original export operation across a lost response.

The receiving commands consume that retained export ID. A configured alias selects the merchant already owned by the provider. It does not accept a customer-selected merchant directory, payment configuration, or application module.

Set the existing MCP bearer token through the environment used by the installed command. The default variable is MCP_ACCESS_TOKEN; --token-env selects another existing variable. Use the actual configured HTTPS endpoint or its original loopback HTTP listener.

~~~sh
merchant-paid-jobs inspect \
  --url "$MERCHANT_MCP_URL" \
  --workspace "$MERCHANT_WORKSPACE" \
  --export-id "$JOB_EXPORT_ID" \
  --manifest-sha256 "$JOB_EXPORT_MANIFEST_SHA256"
~~~

The INSPECTED result contains the complete parsed manifest and its SHA256. It identifies the original job revision, application and configuration digests, canonical input digest, output metadata, case revision, accounting selection, input policy, file list, and byte totals.

## Download and resume the complete case

Choose an empty private output directory whose parent already exists. The same directory is used for every continuation of this export.

~~~sh
merchant-paid-jobs download \
  --url "$MERCHANT_MCP_URL" \
  --workspace "$MERCHANT_WORKSPACE" \
  --export-id "$JOB_EXPORT_ID" \
  --manifest-sha256 "$JOB_EXPORT_MANIFEST_SHA256" \
  --out "$PRIVATE_RECEIVING_DIRECTORY"
~~~

--out and --dir are aliases for that one directory. The command prints COMPLETE after the original transport has saved every file and the native paid-job validator has joined all structured records. The response includes canonical local paths, original file sizes and digests, job and case identities, and resume information.

The transport writes chunks with bounded memory, fsyncs its partial bytes, and retains a rolling prefix digest in download-state. Repeat the same command after an interruption. It verifies the retained prefix, removes only an uncheckpointed suffix, and continues the same file at its original byte offset. An expired merchant read handle is reopened against the same export, manifest digest, file digest, and offset.

A directory retains its endpoint, configured workspace alias, export ID, and manifest SHA256. A conflicting selection returns a binding error. Preserve the original directory and select the intended export explicitly.

| Retained file | Application use |
| --- | --- |
| paid-job-export.json | Complete immutable selection and file inventory |
| job.json | Original purchased job, source, canonical input, history, and output metadata |
| result.bin | Completed output bytes; the job retains the original filename and content type |
| input-policy.json | Complete policy for functions with declared file inputs |
| input_SLOT.bin | Original file bytes for each selected declared input slot |
| resolution.json | Original merchant resolution export for the settled job |
| customer-receipt.json | Buyer receipt derived from that same original case |
| accounting.json | Selected unchanged original accounting export |
| download-state/ | Original receiving lease, manifest, and resumable checkpoint |

The manifest determines which files exist. A function with no declared inputFiles policy can use $files as ordinary application data. Such data remains in job.json. Declared file inputs retain their policy, slot, original filename and content type, whole-file digest, upload identity, and bytes.

A later merchant case revision can be exported separately. Its original export ID, manifest, and receiving directory keep that later selection distinct while both complete cases remain available.

## Reopen and consume the original files

Keep the complete receiving directory, including download-state, when moving it to another private location on the same supported filesystem.

~~~sh
merchant-paid-jobs reopen \
  --dir "$PRIVATE_RECEIVING_DIRECTORY" \
  --workspace "$MERCHANT_WORKSPACE" \
  --export-id "$JOB_EXPORT_ID" \
  --manifest-sha256 "$JOB_EXPORT_MANIFEST_SHA256"
~~~

Reopen uses the local bytes. It acquires the original download lease, rehashes every complete file, and revalidates the job, input policy, resolution, buyer receipt, and accounting selection. REOPENED includes the same original artifact identities and their current local paths.

Use result.bin with job.result.filename and job.result.contentType when saving or displaying a completed application result. The stable local names also allow a downstream process to select declared inputs by their original slot without trusting an uploaded filename as a path.

A missing complete manifest or checkpoint indicates an unfinished or incomplete receiving directory. Continue its original download first. A changed file is reported with its original name; retain the original source export and recover the matching bytes through that same receiving selection.

## Use the JavaScript client

The functions accept either an existing structured MCP client or a configured URL. The existing client supplies a stable endpoint and call(name, arguments, options). Its returned structured result is the provider's flat native response with the workspace field. The receiving adapter checks that alias and then forwards the original native result to the shared file transport.

~~~js
import {
  inspectPaidJobExport,
  downloadPaidJobExport,
  reopenPaidJobExport
} from './paid-jobs-client.mjs';

const selected = {
  workspace: process.env.MERCHANT_WORKSPACE,
  url: process.env.MERCHANT_MCP_URL,
  exportId: process.env.JOB_EXPORT_ID,
  expectedManifestSha256: process.env.JOB_EXPORT_MANIFEST_SHA256,
  signal: control.signal
};

const inspection = await inspectPaidJobExport(selected);
const received = await downloadPaidJobExport({
  ...selected,
  directory: privateDirectory,
  onProgress: progress => updateProgress(progress)
});
const reopened = await reopenPaidJobExport({
  directory: received.directory,
  workspace: selected.workspace,
  exportId: selected.exportId,
  expectedManifestSha256: inspection.manifestSha256
});
~~~

Each function uses the caller's AbortSignal. Standalone CLI interruption aborts the current request and lets the original writer drain and release its file handle and directory lease. Embedded callers own their connection and task lifetime. File-read cleanup uses the original bounded release operation even after the request signal is aborted.

## Receive the original case into another configured merchant

The provider uses readPaidJobCaseSource with the selected source alias, existing structured client, retained export ID, and exact expected manifest SHA256. The helper reads the full resolution document and its structured companions through original retained chunks, verifies each chunk's identity and byte count, hashes each complete document, and calls the native paid-job record validator.

~~~js
import { readPaidJobCaseSource } from './paid-jobs-client.mjs';

const originalCase = await readPaidJobCaseSource({
  workspace: sourceAlias,
  client: originalSourceClient,
  exportId,
  expectedManifestSha256,
  signal
});
const receivedCase = await targetMerchant.resolution.receive(originalCase);
~~~

The helper returns the parsed original resolution export unchanged. The target's existing resolution.receive remains responsible for adopting that original case into its own current job and accounting state. Its ordinary recovery and conflict behavior continue to apply. Active source file handles are released when reading finishes or fails.

## Embed the command in the maintained CLI

runPaidJobClientCommand accepts either ['jobs', command, ...options] or [command, ...options]. It returns true after handling inspect, download, reopen, or selected help. An unrecognized unprefixed command returns false so the existing merchant CLI can continue its normal dispatch. A selected jobs command reports its own argument or native receiving error.

Supply the shared command's signal, environment, and print callback when embedding it. This preserves one original command lifetime and keeps the structured result available to its existing user interface.
