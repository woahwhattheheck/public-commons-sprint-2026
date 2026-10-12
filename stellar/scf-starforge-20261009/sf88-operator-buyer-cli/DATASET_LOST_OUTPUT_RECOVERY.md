# Recover a paid Dataset page after native output loss

The Dataset recovery path completes the original page reservation and reconnects its saved response to the existing Dataset session. It uses the original SF36 HMAC journal, SF43 transaction and SEP-41 transfer observer, sealed recovery records, and native Dataset page reader.

The operator selects the transaction for the already-retained page attempt. The original session, configuration, attempt, response and approval identities remain attached throughout finalization, authenticated reopening, Dataset accounting and export.

## Native source composition

Install these files together in the original `stellar/scf-starforge-20261009` source tree:

| Path | Role |
| --- | --- |
| `sf36-spend-governor/finalize.py` | Original worker and fixed Dataset dispatch. Its main entry restores the executing worker directory and aliases the executing module before companion imports. |
| `sf36-spend-governor/lost_output_finality.py` | Shared observation, inclusion-time association, sealed proof, original ledger reconciliation and sealed completion. |
| `sf36-spend-governor/lost_dataset_finality.py` | Original Dataset files, private workspace, response identity and HMAC-approved request binding. |
| `sf36-spend-governor/dataset_context.mjs` | Fixed offline entry calling the original complete retained-page reader. |
| `sf43-agent-commerce/verify.mjs` | Original verified transaction inclusion time and official SDK SEP-41 decoder. |
| `sf88-operator-buyer-cli/dataset-session.mjs` | Original Dataset engine with `readRetainedDatasetAttempt` and the existing receiving/accounting/export joins. |

The Node reader uses `readRetainedDatasetAttempt(directory,index)`. That original helper checks the saved session and every contiguous page through the selected index, recomputes each page using the original `pageConfig`, validates preceding responses using `inspectDatasetPage`, and preserves their cursor and snapshot chain. Its original JavaScript URL and canonical-JSON behavior supplies the page identities.

The Python adapter rereads the exact private files named by that native result and compares all hashes. Both this file check and the original HMAC reservation check run again after observation and before reconciliation. The recovery descriptor cannot select a custom Python module, observer, signer or reader.

For a thin source overlay, the executing `finalize.py`, its changed companions, `observe.mjs`, the composed SF43 observer and the current Dataset helper must resolve within the intended source closure. The worker entry pins its own Python companions; Node uses its normal module resolution for the explicitly installed source. Preserve that lexical source root when reopening the original operation.

## Selected source descriptor

The original Node Dataset workflow creates one private immutable selection at:

```text
<session>/pages/<six-digit-index>/lost-output/<transaction>.source.json
```

Its schema remains `stellar-forge.sf88.lost-output-source.v1` with `sourceKind:"dataset"`.

| Field | Original binding |
| --- | --- |
| `sessionDirectory` | Absolute normalized private Dataset session directory. |
| `pageIndex` | Original one-based page index. |
| `workspace` | Existing private operator workspace. |
| `intentId` | Exact intent from that page's original configuration and attempt. |
| `attemptId` | SHA-256 of the exact raw original `attempt.json` bytes. Dataset attempts use this retained identity. |
| `configSha256` | SHA-256 of the exact raw original page `config.json` bytes. |
| `requestSha256` | Original SF36 canonical approved-request digest. |
| `transaction` | Selected 64-character lowercase transaction hash. |
| `approvedRequest` | Exact original 15-field request preimage, authenticated against the original HMAC reservation. |
| `sourceHashes` | Complete raw file identities described below. |
| `evidenceState` | Actual state and identity of the original SF82 file. |
| `responseState` | Actual state and identity of the original response file. |

`sourceHashes` contains these exact keys:

- `session`: original session.json.
- `configuration`: selected page config.json.
- `attempt`: selected page attempt.json.
- `response`: original selected response.json SHA-256, or null when absent.
- `workspaceConfig`: original operator.json.
- `workspaceManifest`: original workspace.json.
- `body`: null for the original GET request.
- `evidence`: actual original evidence SHA-256, or null when absent.
- For every preceding page: `previous.NNNNNN.configuration`, `previous.NNNNNN.attempt`, and `previous.NNNNNN.response`.

Raw file hashes and native canonical hashes have separate purposes. The selected attempt's `configurationSha256` is the original JavaScript canonical configuration digest. `configSha256` in the recovery descriptor is the raw file digest. The native reader checks both relationships through their original contracts.

`evidenceState` is `{condition,bytes,sha256}` with condition `ABSENT`, `EMPTY` or `INVALID_JSON`. Existing empty or invalid bytes remain in their original location. A parseable original evidence record uses the existing original evidence finalizer.

`responseState` is `{condition,bytes,sha256}` with condition `ABSENT`, `EMPTY` or `SAVED`. Payment reconciliation and response acceptance are separate native operations. The selected response hash is retained even when the response cannot yet be accepted as a complete Dataset page.

## Original workspace and request checks

The selected page uses its session's evidence directory, while the original operator configuration retains the workspace's evidence directory. The adapter checks that distinction explicitly.

It verifies the original workspace manifest, operator executable/actor/service, ledger and policy paths, signer module, trusted payer, buyer transport, network, asset and recipient. The exact approved request must authenticate in the existing HMAC ledger and match the original page URL, GET method, intent, actor, service and approved terms.

For the original GET request, `body_present` is false, `body_bytes` is zero, and `body_sha256` is the digest of empty bytes. The returned Dataset response is bound separately through `responseState` and `sourceHashes.response`.

## Worker call

The existing native Node Dataset operation opens the original workspace and supplies the original operator environment. The permanent page attempt marker and immutable selected source identify the continuation; the worker checks the same bytes again before reconciliation. It invokes the same fixed finalizer used by the Inbox recovery:

```text
<original-python> <source>/sf36-spend-governor/finalize.py
  --lost-output-source <page>/lost-output/<transaction>.source.json
  --ledger <workspace>/reservations.sqlite
  --policy <workspace>/policy.json
  --payer <original-trusted-payer>
  --node <original-absolute-node>
  --expected-request-sha <original-approved-request-digest>
  --reports <existing-private-report-directory>
```

The worker selects the fixed Dataset reader from `sourceKind:"dataset"`. The explicit alias `--lost-output-dataset-source` accepts the same descriptor. Existing `--node-use-system-ca`, approved-network `--rpc-endpoint` and explicit `--rpc-proxy-env` options retain their original meanings and normal source validation. The worker obtains its original SF36 keys from the existing private operator environment.

Use the same source and add `--verify-only` for authenticated completed-state reopening. Reopening checks the original source bytes, native page lineage, HMAC reservation, sealed proof and sealed completion.

## Original Node and CLI entrypoints

The existing `dataset-lost-output.mjs` module exposes:

- `inspectDatasetLostOutput(options)`: inspect the retained page, original workspace, approved preimage, source hashes and response identity.
- `recoverDatasetLostOutput(options)`: persist the exact selected source, invoke the original finalizer and export the authenticated transfer proof.
- `readDatasetLostOutputRecovery(options)`: authenticate the completed original recovery and ledger.
- `exportDatasetLostOutputProof({output,...options})`: export or reopen the same public transfer proof.

The native options use `directory`, `index`, `workspace`, `approvedRequestFile`, `expectedRequestSha256` and `transaction`. The inspection result also exposes the raw `attemptId` and `configSha256`; pass those as `expectedAttemptSha256` and `expectedConfigSha256` when continuing a reviewed selection.

```js
import {
  inspectDatasetLostOutput,
  recoverDatasetLostOutput,
  readDatasetLostOutputRecovery,
  exportDatasetLostOutputProof,
} from "./dataset-lost-output.mjs";

const original = {
  directory: originalSessionDirectory,
  index: originalPageIndex,
  workspace: originalWorkspaceDirectory,
  approvedRequestFile: originalApprovedRequestFile,
  expectedRequestSha256: originalApprovedRequestDigest,
};

const selected = await inspectDatasetLostOutput(original);
const recovered = await recoverDatasetLostOutput({
  ...original,
  expectedAttemptSha256: selected.attemptId,
  expectedConfigSha256: selected.configSha256,
  transaction: selectedOriginalTransaction,
});

const reopened = await readDatasetLostOutputRecovery({
  directory: original.directory,
  index: original.index,
  workspace: original.workspace,
});
const transfer = await exportDatasetLostOutputProof({
  directory: original.directory,
  index: original.index,
  workspace: original.workspace,
  output: originalTransferExportPath,
});
```

The original `dataset-cli.mjs` routes `recover-lost-output` and `read-lost-output` to these same module operations. Completed proof admission goes back through the existing `nativePage`, `accountDatasetSession`, Dataset manifest and data-room delivery paths.

The fixed offline reader takes no session lease and makes no writes. This allows the original accounting and page inspection operations to reuse it while retaining their own native session lease.

## Retained result and continuation

The shared engine retains:

```text
<page>/lost-output/<transaction>.source.json
<page>/lost-output/<transaction>.proof.json
<page>/lost-output/recovery.json
```

The full original SF43 observation is sealed before reconciliation. The selected transfer must match the original network, transaction, asset, payer, recipient and amount. Its original transaction inclusion time must fall between the original attempt and observation at the provider's whole-second resolution.

Original SF36 reconciliation enforces the reservation and network receipt reuse guard. The completion is sealed afterward. A restart with a saved proof completes the same reconciliation; a restart with a saved completion authenticates it against the current original ledger.

The shared result remains `stellar-forge.sf36.finalization.v1`. Its recovery remains `stellar-forge.sf36.lost-output-recovery.v1`, with authority `ORIGINAL_SF36_HMAC_JOURNAL_AND_SEALED_LOST_OUTPUT_RECOVERY`. Its binding preserves the complete selected Dataset descriptor fields and original source/attempt/evidence references.

The original Dataset receiving workflow uses that authenticated result together with the exact retained response. It runs the original page contract, cursor, snapshot, row and query validation, then exposes the completed original page through the existing session accounting, recovery and export operations.

## Current source-bound operation

The first receiving operation uses original page one of the FD06 retained Dataset session:

- Intent: `dataset:0d2f38b615baa565eb1916a48de4534b9789a914a654d5a94e1237fd04dd5ac6`.
- Approved-request digest: `c47ff497b359ab4eb73c30d4b09462050c74f1a7eb0cf7550a2b7ef2b78a4935`.
- Selected transaction: `5a67bdf59bb8700d07f19a1fa98e35069b63edc9529d3902dc942ee0b27ca468`.
- Original attempt start: `2026-10-12T00:46:41.736Z`.
- Retained response: 49,586 bytes.
- Original approval carrier: `chain-recovery/page-one-approved-request.json` in the same private paid-operation root.

The original Dataset operator owns this receiving continuation and retains its native finalization and page results in that same operation.
