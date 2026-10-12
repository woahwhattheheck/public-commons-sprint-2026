# Recover a payment after local output loss

This operation completes the original SF36 reservation when an approved payment
reached the network but the local SF82 output could not be saved completely.
It joins the original inbox attempt, frozen execution files, exact approved
request, HMAC journal, and the original SF43 transfer observer.

The operator supplies the transaction hash and the exact approved-request
preimage. The worker authenticates that preimage against the existing
reservation, observes the selected transaction on the approved network, and
settles that same reservation. The original attempt and payment identity remain
the continuation point.

## Select the original operation

Use the existing inbox and operator workspace. Keep their original configuration,
request, request body, attempt, manifest, ledger, policy, and key files together.
The workspace loader supplies the original ledger keys to the fixed worker.

The approved-request file is the exact JSON object used for the reservation.
Its canonical SHA-256 must equal the original request digest. The worker checks
all 15 original fields: request ID, actor, service, network, asset, scheme,
maximum amount, resource, recipient, timeout, HTTP method, body presence, body
length, body digest, and accepted-terms digest. A file reconstructed from retained
approval bytes must reproduce that original digest exactly.

Inspect the frozen operation and supplied preimage:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  inspect-lost-output \
  --root /absolute/original-inbox \
  --intent ORIGINAL_INTENT_ID \
  --workspace /absolute/original-operator-workspace \
  --approved-request /absolute/original-approved-request.json
```

Inspection reports the attempt ID, configuration hash, expected request digest,
transfer terms, original source hashes, and current evidence state. It reads the
frozen files and computes the supplied preimage's digest. The privileged recovery
worker subsequently authenticates the reservation against the HMAC journal.

## Preserve the original loss state

The evidence path stays at its original inbox-derived location. Recovery
classifies and retains the exact state:

| Condition | Bytes | SHA-256 |
| --- | ---: | --- |
| `ABSENT` | 0 | `null` |
| `EMPTY` | 0 | SHA-256 of the empty file |
| `INVALID_JSON` | Original byte count | SHA-256 of the original bytes |

An existing evidence file is read as a private, regular, operator-owned file.
Its bytes stay intact. Any successfully parsed original JSON value returns the
operation to the existing finalization or missing-receipt recovery path.

The immutable selection, sealed observation, and sealed completion all bind the
same `evidenceState` and `sourceHashes.evidence`. The worker checks those bytes
and the other frozen sources before observation, again before ledger
reconciliation, and on every completed reopen.

## Recover the selected transaction

Pass the request digest returned by inspection after reconciling it with the
original approved reservation. Pin the original attempt and configuration when
continuing a reviewed operation:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  recover-lost-output \
  --root /absolute/original-inbox \
  --intent ORIGINAL_INTENT_ID \
  --workspace /absolute/original-operator-workspace \
  --transaction ORIGINAL_TRANSACTION_HASH \
  --request-sha ORIGINAL_REQUEST_SHA256 \
  --approved-request /absolute/original-approved-request.json \
  --attempt ORIGINAL_ATTEMPT_ID \
  --config-sha ORIGINAL_CONFIGURATION_SHA256
```

The caller can select the installed Node executable with `--node /absolute/node`.
The original workspace transport and RPC selection feed the original observer.
The existing system-CA option and isolated accounting environment remain part
of the fixed finality worker.

The worker requires the original approved network, successful transaction, asset
contract, payer, recipient, atomic amount, ledger, and matching SEP-41 event.
It preserves the complete original SF43 observation and its verified facts.
The operation then invokes the original SF36 reconciliation transaction, which
audits the ledger, enforces the original reserved amount, and prevents a receipt
from settling another reservation.

The command returns the original inbox projection plus
`lostOutputFinalization`. The original attempt's terminal projection and its
separate recovered finality are both retained; consumers should use the returned
recovery or the explicit read command to inspect the completed charge.

## Continue after an interrupted recovery

Recovery publishes these create-only files inside the original job's
`lost-output/` directory:

| File | Purpose |
| --- | --- |
| `TRANSACTION.source.json` | Exact selection, approved-request preimage, and original source hashes |
| `TRANSACTION.proof.json` | HMAC-sealed original SF43 observation and verified transfer facts |
| `recovery.json` | HMAC-sealed completion bound to the settled original ledger row |
| `reports/` | Worker invocation reports |

The proof is fsynced and published before the ledger commit. The completion
is fsynced and published afterward. An interrupted invocation continues with the
same transaction, request digest, original files, and command. A saved proof is
authenticated and reused. A previously completed ledger commit is reconciled
idempotently, allowing the completion record to finish after a storage error.

Authenticate a completed recovery:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  read-lost-output \
  --root /absolute/original-inbox \
  --intent ORIGINAL_INTENT_ID \
  --workspace /absolute/original-operator-workspace \
  --request-sha ORIGINAL_REQUEST_SHA256 \
  --attempt ORIGINAL_ATTEMPT_ID \
  --config-sha ORIGINAL_CONFIGURATION_SHA256
```

Before a completed recovery this read returns `null`. After completion it
checks the immutable selection, exact original loss state, sealed records,
and audited settled row, returning `IDEMPOTENT_FINALIZED`. It uses the original
worker's verification-only branch without another network observation or
reconciliation write.

## Carry the verified transfer into accounting

Export the authenticated transfer to a distinct file in an existing private
directory:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  export-lost-output \
  --root /absolute/original-inbox \
  --intent ORIGINAL_INTENT_ID \
  --workspace /absolute/original-operator-workspace \
  --out /absolute/private-proof-directory/lost-output-transfer.json
```

The export retains the selected transaction, actual verified transfer facts,
matching event ID, original attempt/configuration/request hashes, loss state,
observation and completion times, and sealed completion digest. It uses schema
`stellar-forge.sf88.lost-output-verified-transfer.v1` and authority
`ORIGINAL_SF36_HMAC_JOURNAL_AND_SEALED_LOST_OUTPUT_RECOVERY`.

Where the original SF98 event survived the storage interruption, resume its
existing signed delivery and join this proof to the same merchant ledger row.
The customer statement workflow consumes that original delivery, transfer
verification, and complete native API usage export.

## Programmatic interface

Import the four functions from `sf88-operator-buyer-cli/lost-output.mjs`:

```js
import {
  inspectLostOutputAttempt,
  recoverLostOutput,
  readLostOutputRecovery,
  exportLostOutputProof,
} from "./lost-output.mjs";
```

The common options are `root`, `intentId`, and `workspace`. Inspection and
recovery take either `approvedRequestFile` or the exact `approvedRequest`
object. Recovery also requires `transaction` and `expectedRequestSha256`.
Optional selection pins are `expectedAttemptId` and `expectedConfigSha256`.
Read accepts the same optional pins. Export requires `output`. The mutation
and verification calls accept the existing `signal`, `node`, and
`environment` options.

The Python seam is `finalize.py --lost-output-source`, mutually exclusive with
the existing evidence and missing-receipt sources. Its retained observation
schema is `stellar-forge.sf36.lost-output-proof.v1`; its retained completion
schema is `stellar-forge.sf36.lost-output-recovery.v1`. Both use the dedicated
lost-output HMAC domain and retain the complete original source binding.
