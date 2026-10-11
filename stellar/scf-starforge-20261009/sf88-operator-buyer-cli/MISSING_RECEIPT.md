# Recover a settled payment after a lost seller receipt

Use this workflow when an original SF88 inbox attempt signed a payment and kept
its SF82 reservation metadata, but the seller response timed out before a
settlement receipt reached the buyer. Keep the original inbox, operator
workspace, and its private journal keys. Select the transaction that belongs to
that attempt; the worker verifies it through the original SF43 Stellar RPC and
SEP-41 transfer decoder before finalizing the original SF36 reservation.

The original attempt, request, body, evidence, and buyer outcome remain the
historical record. Recovery adds its own completion time and transfer facts.
The merchant console can then use this authenticated settlement for its
separately timed response retrieval.

## Inspect and select the original attempt

Run these commands from `stellar/scf-starforge-20261009`. Replace the absolute
paths and identifiers with the existing private workspace and inbox.

```sh
node sf88-operator-buyer-cli/queue-cli.mjs inspect-missing-receipt \
  --root /absolute/session/inbox --workspace /absolute/operator \
  --intent original-intent
```

The read returns the original attempt ID, configuration hash, reservation digest,
start and capture timestamps, source hashes, and the reserved amount, network,
asset, payer and recipient. Review the selected transaction alongside those
terms. Copy `expectedRequestSha256`, `attemptId` and `configSha256` from this
same inspection into the recovery command:

```sh
node sf88-operator-buyer-cli/queue-cli.mjs recover-missing-receipt \
  --root /absolute/session/inbox --workspace /absolute/operator \
  --intent original-intent --transaction lowercase-64-character-transaction-hash \
  --request-sha original-reservation-digest \
  --attempt original-attempt-id --config-sha original-configuration-hash
```

`--transaction` and `--request-sha` are mandatory. The attempt/configuration
arguments detect a changed selection before any provider work. A configured
explicit CONNECT proxy is resolved from the original workspace; an embedded
caller supplies its captured `environment` to both recovery APIs. Node must
have the original Stellar SDK dependencies and trust the configured transport's
certificate chain. `--node /absolute/trusted-node-launcher` selects the operator's
existing Node runtime, including an approved system-CA launcher when required.
The fixed Python worker receives only its three original SF36 journal keys and
the explicitly configured proxy; the Node observer receives the verification
request through its private input pipe.

On success, the returned `manualFinalization` contains the selected transaction,
original source and reservation identities, native transaction ledger/event ID,
actual atomic amount, canonical settlement reference, and completion timestamp.
The verified network/asset/payer/recipient/amount must match the retained
operator terms and HMAC-audited reservation. The existing SF36 atomic reconcile
method prevents the same network transaction settling a different reservation.

## Reopen the completed recovery

```sh
node sf88-operator-buyer-cli/queue-cli.mjs read-missing-receipt \
  --root /absolute/session/inbox --workspace /absolute/operator \
  --intent original-intent --request-sha original-reservation-digest
```

This returns `null` until a manual recovery completes. For an existing
completion it verifies the recovery's HMAC, all retained source bindings, and
the original ledger's authenticated finalization. It makes no provider request.
A changed or invalid existing record raises an error instead of appearing as
an absent recovery.

The original queue's attempt state remains its recorded execution outcome.
Use the manual recovery view to display settlement alongside that history;
use a distinct response-read timestamp for any later provider content.

## Recovery records and interruption

Each job adds one private `manual-finality` directory:

| File | Meaning |
| --- | --- |
| `<transaction>.source.json` | Immutable selection bound to the original request, attempt, capture, body and workspace hashes. |
| `<transaction>.proof.json` | HMAC-sealed native SF43 transfer facts, synced before accounting finalization. |
| `recovery.json` | HMAC-sealed completion, synced after the original atomic ledger finalization. |
| `reports/` | Restartable worker result views for diagnosis. |

Successful source/proof/completion records are created atomically without
replacing prior records. If execution stops after observation or ledger commit,
repeat **the same explicit recovery selection**. The worker reuses its
authenticated observation, checks the journal, and completes the saved recovery
without a payment retry. If the first selected transaction failed verification,
inspect the reason and select the correct observed transaction; the failed
candidate does not occupy the successful completion record.

A reservation digest authenticates the original ledger identity. When the
complete approved request preimage is retained, the worker also verifies its
hash and fields. When the timeout capture contains only the original digest,
the recovery records `ORIGINAL_HMAC_RESERVATION_DIGEST_AND_FROZEN_OPERATOR_INPUTS`
and `OPERATOR_SELECTED_TRANSACTION` as its binding/association. The transfer
verification and ledger accounting remain the same original components.

An existing native seller receipt belongs to the normal `finalize` workflow.
Existing settled conflicts, changed source hashes, invalid HMAC records, or a
transaction already used by another reservation require inspection of that
original state before choosing another action. Preserve the existing records
and journal so the operator can reopen and resolve the exact attempt.

## Embedded API

Import from `sf88-operator-buyer-cli/missing-receipt.mjs`:

```js
const selection = await inspectMissingReceiptAttempt({root, intentId, workspace});
const job = await recoverMissingReceipt({
  root, intentId, workspace, transaction,
  expectedRequestSha256: selection.expectedRequestSha256,
  expectedAttemptId: selection.attemptId,
  expectedConfigSha256: selection.configSha256,
  environment, signal,
});
const settlement = await readMissingReceiptRecovery({
  root, intentId, workspace,
  expectedRequestSha256: selection.expectedRequestSha256,
  expectedAttemptId: selection.attemptId,
  expectedConfigSha256: selection.configSha256,
  environment, signal,
});
```

`recoverMissingReceipt` returns `{...job, manualFinalization}`.
`readMissingReceiptRecovery` returns the manual finalization directly, or
`null` before completion. Both accept `environment = process.env`, `signal`,
and optional `node`. Inspect opens no keys. Recovery and completed readback
use the original workspace's accounting-only key loader. `result` includes
`actual`, `receipt_ref`, `request_sha256`, `proof_sha256`, and `verifiedFacts`:
`transaction`, `network`, `asset`, `payer`, `recipient`, `atomicAmount`, `ledger`,
`eventId`. Call authenticated readback immediately before using this settlement
for an existing paid operation's separate response recovery.
