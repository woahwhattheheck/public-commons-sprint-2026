# Receive the original OpenCage operation's accounting export

This named receiving example exercises the merged Node Buyer accounting API against the existing completed OpenCage response. It preserves the producing operation, configuration, attempt, evidence and response, and uses the selected current SDK to call the original financial implementation.

The public API is documented in [the Node buyer guide](../README.md). The ordinary command example is [operation_accounting.mjs](../examples/operation_accounting.mjs). This receiving launcher composes those existing commands with the maintained Commons native foreground runtime.

## Selected source and response

The receiving selection has three distinct identities:

| Selection | Role |
| --- | --- |
| Original Buyer operation | Retained configuration, ended attempt, evidence, response and producing runtime |
| Node SDK at c8e546df7fa468a02a1d48999aaab6c277b159cd | The loaded Operation accounting adapter, worker and example CLI |
| Original financial runtime at b52c196dbeb270aa0ea16eaf95d8f6a4770f86e4 | Existing configuration, checkpoint, unpaid-result and SF36 finalization implementation |

The selected source manifest records every implementation file's repository path, commit, Git blob, byte count and SHA-256. It also pins the installed dependency package metadata. The input records the five original Buyer files with their exact paths, sizes and hashes. Both files are prepared in the receiving project and retained by the native request.

This fixture selects intent `scf-opencage-native-customer-a39c-20261011`, whose original successful GET returned 2,785 bytes and `NO_PAYMENT_REQUIRED` with a reviewed maximum of zero. Its producing runtime remains recorded in the original operation. The example expects the original unsigned-response outcome; paid finalization has its own approved request, reservation and accounting-workspace requirements.

## Run through the existing native foreground owner

Select an already installed, verified Commons native host and existing worker/temporary directories. Keep the input private because it contains local operation locations. The launcher expects the input schema `commons.scf-node-accounting-receiving/v1` and source schema `commons.scf-node-accounting-receiving-source/v1`.

```sh
python3 -B launch-opencage-accounting.py \
  --input /absolute/receiving-project/receiving-input.json \
  --input-sha256 EXACT_INPUT_SHA256 \
  --host-root /absolute/maintained-native-host \
  --records-root /absolute/receiving-project/native \
  --peer original-a39c-receiving-owner \
  --worker-root /absolute/existing-worker-directory \
  --temp-root /absolute/existing-temporary-directory
```

The input supplies canonical `project`, `node`, `example`, `runtimeDirectory`, `stateDirectory`, `sourceManifest`, `sourceManifestSha256`, `intentId` and `original` selections. The manifest's `files` inventory supplies relative `path`, `sourcePath`, `sourceCommit`, `gitBlob`, `bytes` and `sha256`. The original inventory identifies `operation`, `configuration`, `attempt`, `evidence` and `response`, with a private output filename for each.

The launcher retains one operation ID, `scf-node-operation-accounting-free-a39c-20261012`, and the exact inline JavaScript command in the original native request. It declares 256 MiB memory plus 64 MiB reserve, 2 MiB of project growth, 2 MiB of original-state growth and 1 MiB reserve. The existing native runtime owns admission, lifecycle, artifacts and finalization.

## Receiving behavior and recovery

The receiver verifies the complete selected source and all original bytes before invoking the published CLI. It first recovers the existing accounting view. If no accounting command exists, it calls finalize once. If a complete command already exists, it consumes that result. An unfinished saved command remains selected for explicit original reconciliation.

The expected result is `UNPAID_RESPONSE` / `NO_PAYMENT_REQUIRED`, with no approved payment request. A fresh CLI process then reopens that exact accounting command. The original export includes the saved accounting context, complete result, original attempt and original evidence. Existing exports are checked against the original schema, recomputed context hash, result and complete source bytes.

The receiving output contains:

- `Accounting_Receiving.json`: the complete source, operation, command and five-stage receiving result.
- `Accounting_View.json` and `Operation_Accounting.json`: the reopened native view and original private accounting export.
- `Original_Operation.json`, `Original_Configuration.json`, `Original_Attempt.json`, `Original_Evidence.json` and `Original_Response.json`: exact retained source bytes.
- `Source_Manifest.json`: the complete selected implementation inventory.

A native transport interruption is resolved through the same original record's status, supported handoff and foreground resume. After a command begins, retain its accounting command ID and inspect its saved view before any continuation. The receiver independently checks that all five original files remain unchanged after export.

The receiving source is reviewable independently of its eventual native completion. A successful run is established by the original terminal native result, artifact manifest and `Accounting_Receiving.json` together.
