# Recover a paid Dataset page after local output loss

This workflow completes an existing SF88 Dataset purchase when the original buyer
attempt and SF36 reservation are retained, but its SF82 checkout output is absent,
empty or invalid JSON. The original transfer is selected explicitly, verified by
the maintained SF43 observer and finalized by the existing SF36 ledger. A saved
response can then continue through the same Dataset session, accounting and SF100
delivery.

## Retained inputs

Use the original private session and operator workspace. Keep their original
paths, request, attempt and source bytes:

| Input | Binding |
| --- | --- |
| session.json | Original session identity, selected configuration, snapshot and total limits |
| pages/NNNNNN/config.json | Exact file hash and original pageConfig result |
| pages/NNNNNN/attempt.json | Exact file hash, original page index and intent, canonical configuration hash and startedAt |
| Earlier page files | Original configuration, attempt, complete response and contiguous cursor chain |
| pages/NNNNNN/response.json | Separate response hash and length; the GET request body remains empty |
| session/evidence/INTENT_SHA.json | Its actual absent, empty or invalid JSON state |
| Original operator | Existing payer, signer, policy, ledger, accounting keys and transport |
| Approved-request JSON | Exact original 15-field approval preimage, authenticated by the original HMAC reservation |
| Transaction hash | The particular included transfer associated with this original approved attempt |

The approved-request file is the retained original preimage. Its fields are
request_id, actor, service, network, asset, scheme, max_amount, resource, pay_to,
max_timeout_seconds, method, body_present, body_bytes, body_sha256 and
accepted_terms_sha256. For a Dataset GET, body_present is false, body_bytes is
zero and body_sha256 is the empty-body digest. A downloaded response belongs in
the separate response binding.

Private directories use mode 0700 and private files 0600. Source validation
rejects symlink paths, substituted original workspaces, changed request inputs,
changed attempt hashes, changed evidence-loss state and changed saved responses.
The original Governor also enforces its audited receipt-reuse rule across the
existing ledger.

## Inspect and select the existing attempt

From the installed source, run:

    node sf88-operator-buyer-cli/dataset-cli.mjs inspect-lost-output \
      --session /private/original/session \
      --page 1 \
      --workspace /private/original/operator \
      --approved-request /private/original/approved-request.json

The output records the exact attempt and configuration file hashes, original
attempt time, expected payment terms, response state and expectedRequestSha256.
The source's canonical Dataset configuration digest remains distinct from the
SHA-256 of the stored config.json bytes. The selection never creates another
buyer intent.

Review the same native transaction and expectedRequestSha256, then run:

    node sf88-operator-buyer-cli/dataset-cli.mjs recover-lost-output \
      --session /private/original/session \
      --page 1 \
      --workspace /private/original/operator \
      --approved-request /private/original/approved-request.json \
      --transaction ORIGINAL_TRANSACTION_HASH \
      --request-sha ORIGINAL_APPROVED_REQUEST_SHA256 \
      --expect-attempt ORIGINAL_ATTEMPT_FILE_SHA256 \
      --expect-config ORIGINAL_CONFIG_FILE_SHA256

The optional --rpc-endpoint selects an endpoint from the existing SF86 network
allowlist. --rpc-proxy-env names the existing credential-free HTTP CONNECT proxy
used by that native observer. These are observation settings; the original
buyer, signer, merchant request and reservation are retained. The existing
SF36_OBSERVER_USE_SYSTEM_CA=1 option enables the original isolated observer's
system trust setting when the host requires it.

The worker verifies the exact network, native asset contract, payer, recipient
and atomic amount. Its RPC inclusion time must be at or after the original
attempt, at Stellar's whole-second resolution, and at or before the independently
observed time. It retains a sealed observation before original reconciliation,
then a separate sealed completion. A restart authenticates and reuses those
records and the same finalized ledger row.

## Recovery records

The original page gets one private lost-output directory:

| Record | Purpose |
| --- | --- |
| TRANSACTION.source.json | Immutable original Dataset selection, approved request, source hashes and actual loss states |
| TRANSACTION.proof.json | Original SF36 HMAC-sealed SF43 observation and verified transfer facts |
| recovery.json | Original SF36 HMAC-sealed completion and ledger binding |
| transfer.json | Separate source-bound transfer export for customer delivery and accounting |
| reports/ | Original finality worker reports |

The original SF82 file stays in its actual retained condition. The separate
transfer export uses schema stellar-forge.sf88.lost-output-verified-transfer.v1
and sourceKind dataset. It records the included transaction, ledger and transfer
event, exact original request and attempt, sealed completion hash, and separate
saved-response hash. Its association is an operator-selected transaction after
local output loss.

Read the authenticated existing result:

    node sf88-operator-buyer-cli/dataset-cli.mjs read-lost-output \
      --session /private/original/session --page 1 \
      --workspace /private/original/operator

Export an additional copy into an existing private directory:

    node sf88-operator-buyer-cli/dataset-cli.mjs export-lost-output \
      --session /private/original/session --page 1 \
      --workspace /private/original/operator \
      --out /private/customer/original-page-transfer.json

Repeating recover-lost-output with the same selection finishes an interrupted
proof export or returns the original finalized result. A changed transaction,
approval, attempt, source hash or existing export is a selection conflict.

## Continue the original customer acquisition

If the original run was interrupted, use the existing recover command after
that process exits. It reconciles the original session's lock and reads its
retained files:

    node sf88-operator-buyer-cli/dataset-cli.mjs recover \
      --session /private/original/session

A complete response is admitted through the original inspectDatasetPage
contract. Its declared columns and cell types, selected fields and filters,
snapshot, row limits, query hash, page offsets and exact continuation cursor
must match the original request and preceding pages.

The recovered page carries evidenceKind ORIGINAL_SF36_LOST_OUTPUT_RECOVERY and
nativeBuyerStatus PAID_OUTPUT_RECOVERED. Its actual missing HTTP headers remain
represented by httpStatus null; the saved response is identified by its
independent retained-file hash. The existing SF82 capture schema is reserved
for an actual original checkout observation.

With that page admitted, the original run command creates only the next new
page. It retains the original total cap and normal per-page approval:

    node sf88-operator-buyer-cli/dataset-cli.mjs run \
      --session /private/original/session --workspace /private/original/operator

An absent or incomplete response may have completed payment finality while its
Dataset receiving remains unresolved. The original files and authenticated
transfer remain available for the corresponding source recovery. A paid
lost-output page never enters the separate unpaid-attempt retry path.

## Accounting and original SF100 delivery

The existing accounting command reads the authenticated recovered ledger entry
beside ordinary page finalizations. It reports the original amount, receipt,
request hash and completion, with the recovery's exact source references:

    node sf88-operator-buyer-cli/dataset-cli.mjs accounting \
      --session /private/original/session --workspace /private/original/operator

Finish remaining original page reservations with the normal finalize command:

    node sf88-operator-buyer-cli/dataset-cli.mjs finalize \
      --session /private/original/session --workspace /private/original/operator

When the same session is COMPLETE:

    node sf88-operator-buyer-cli/dataset-cli.mjs deliver \
      --session /private/original/session --out /private/customer/data-room

The native delivery preflight authenticates a recovered page against the same
SF36 completion and exact saved response, then sends its separate transfer
export as the original SF100 evidence input. Other pages retain their original
SF82 evidence. SF100's page archive, response hashes, cursor chain, dataset.csv,
dataset.jsonl, review.html and manifest remain the existing receiving format.

Preserve the original operator through the existing SF88 encrypted workspace
backup and receiving workflow. The customer data room is an offline data
artifact; reopening original operator accounting also requires the original
authenticated ledger and accounting keys.

## JavaScript integration

dataset-lost-output.mjs exports:

- inspectDatasetLostOutput(options)
- recoverDatasetLostOutput(options)
- readDatasetLostOutputRecovery(options)
- exportDatasetLostOutputProof(options)
- recoveredDatasetPage(options), used by the original session and native exporter

The first four use directory, index and workspace. Inspection/recovery accepts
approvedRequestFile or the exact approvedRequest object, plus optional
expectedAttemptSha256 and expectedConfigSha256. Recovery also requires
transaction and expectedRequestSha256, and accepts the original signal,
environment, node, rpcEndpoint and rpcProxyEnv observation options. The export
accepts output, defaulting to the same page's transfer.json.

The shared SF36 source descriptor keeps schema
stellar-forge.sf88.lost-output-source.v1 with sourceKind dataset,
sessionDirectory, pageIndex, workspace, intentId, exact attemptId/file hash,
configSha256/file hash, requestSha256, transaction, sourceHashes,
approvedRequest, evidenceState and responseState.

The original Dataset module exposes validateDatasetDefinition,
datasetPageConfiguration and readRetainedDatasetAttempt for the fixed native
source validator. HMAC sealing, transfer observation, ledger finality and
receipt reuse remain the original shared SF36 implementation.
