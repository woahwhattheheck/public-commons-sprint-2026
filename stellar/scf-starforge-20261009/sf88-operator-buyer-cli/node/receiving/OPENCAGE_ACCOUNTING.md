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

The launcher retains one operation ID, `scf-node-operation-accounting-free-a39c-20261012`, and the exact inline JavaScript command in the original native request. The explicitly linked continuation uses `scf-node-operation-accounting-free-02-a39c-20261012`, a separate `run-02` output and the complete `financial-source-02` selection. It declares 256 MiB memory plus 64 MiB reserve, 2 MiB of project growth, 2 MiB of original-state growth and 1 MiB reserve. The existing native runtime owns admission, lifecycle, artifacts and finalization.

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

## Retained missing-asset continuation

The first native receiving record, `048feb905cca77f447fa3f877708d2d036f38bf4d2d68847b721c33f9bb5300b`, ended with exit 1 after the original accounting command `finalize-Hoj0mD` returned an `ENOENT` error. Its source installation omitted the original `sf86-rpc-transfer-reconcile/networks.json` file, which `terms.mjs` reads at module evaluation. The selected original asset is Git blob `2f92b8e3f8498fd07136c7f9b741c9e8fe3c3aa8` at the same b52 financial source revision.

The linked continuation retains the first native request, result, artifacts, input and source manifest, plus all eight accounting command files. It requires the original completed failure and closed accounting child, empty original stdout, the exact error, unchanged original attempt/evidence and a complete source comparison. All 69 previous source files remain unchanged; the new financial directory adds that one original JSON asset. The producing operation and original financial installation are preserved.

The private input's optional `previousReceiving` selection contains the exact original operation and command IDs, paths, byte counts and hashes. Its `native` selection identifies `request`, `result` and `artifacts`; `commandFiles` identifies `context.json`, `completion.json`, `invocation.json`, `process.json`, `attempt-source.json`, `evidence-source.json`, `stdout.json` and `stderr.log`. The original input and manifest are separately pinned. `receiverSha256` binds the earlier native inline command, and the sole accepted reason is `SELECTED_FINANCIAL_NETWORKS_ASSET_MISSING`.

Before a new accounting command, this receiving path exports its verified lineage to `Receiving_Continuation.json`. It creates that command only when the original view still selects the exact closed failed command and has no complete result. If a later complete accounting result already exists, the original recovery API reopens it. A different unfinished command remains selected for explicit reconciliation. No Buyer execution, signer, payment, workspace initialization or Governor policy edit occurs in this receiving example.

`financialSourceDirectory` and `outputDirectory` select the explicit successor directories. Both native requests keep their own immutable inline receiver and source hashes. A final completion is reported only after the original accounting result, fresh-process reopen, complete export and all unchanged original source checks succeed.

## Completed receiving of the original free response

The linked receiving operation `scf-node-operation-accounting-free-02-a39c-20261012`
completed on 2026-10-12 at 12:57:11 UTC with exit code 0. Its original native
record is `ce79e07251f1a637be41421268824dd6fc27d2f5a627249da03f33e96bdb8203`.
The native artifact collector retained 25 files / 182,772 bytes with no collection
errors. All 25 files were independently read and compared with that manifest.

This operation consumed the existing intent
`scf-opencage-native-customer-a39c-20261011`. Its original attempt, configuration,
evidence and 2,785-byte response remained unchanged. The response SHA256 is
`94831ba4c34acf608585d242baa998c4ee58a190bf1e4ed3040897800f5797dd`.

The original accounting command `finalize-o4ICVV` completed with
`kind: UNPAID_RESPONSE`, `outcome: NO_PAYMENT_REQUIRED` and
`recordAuthority: ORIGINAL_UNSIGNED_RESPONSE`. It has no approved payment
request. This is an observed free resource result; it is not evidence of a paid
reservation or financial settlement. The receiving command reopened the result
through a fresh original CLI process, exported the complete accounting record,
then verified the exported context and original source bytes.

| Retained file | Bytes | SHA256 |
| --- | ---: | --- |
| Native request.json | 30,777 | `899c52bf1db15da532f0c6e5568722adf6cdd48e111e2cbf0a2ebce2f5a604b9` |
| Native result.json | 2,213 | `26a909693b61743748f053025e4e7d9a5f409eb47405137dfeac57d5918ac706` |
| Native artifacts.json | 10,461 | `67023612d2c670df5617d859a8dc802a32a78cebe915af6c4d192c6915731f62` |
| Operation_Accounting.json | 13,091 | `ce131cd54fa451222ece006ffae9c22a9139f2f9877ca91bc35450876b5b2297` |
| Accounting_View.json | 7,246 | `04b0ade8ed9696ff56c7e6f0c111a637c9e4391b6a7d6fbbc44b5577b93b2e78` |
| Receiving_Continuation.json | 1,822 | `5364fb2c376f096b1bfa96c2a5183156327b25636d3cb0fa535629e915e5bb23` |

The SDK selection is `c8e546df7fa468a02a1d48999aaab6c277b159cd`; the selected
financial source is `b52c196dbeb270aa0ea16eaf95d8f6a4770f86e4`. Their complete
70-file receiving manifest has SHA256
`6748889172993a61dd7b44e203bd68704dfadafa2c3d698365911ce4bcf77f20`.

The prior native operation `048feb905cca77f447fa3f877708d2d036f38bf4d2d68847b721c33f9bb5300b`
and closed accounting command `finalize-Hoj0mD` remain retained. That command
ended before financial work because its selected installation omitted the original
SF86 `networks.json` runtime asset. The continuation preserved its entire
69-file source selection and closed command evidence, added only the exact
original asset, and created a new accounting command for the same existing
response. It did not repeat the Buyer execution.
