# Complete recovery of a standalone Object session

The native Object API can receive a free response without creating a managed
operator workspace. Its session still owns an immutable definition, configured
chunk requests, original inbox attempts, evidence, response bytes, assembly
receipts and lease history. The configured payment ledger may never have existed.

Use this workflow to preserve and reopen that complete state. It extends
[the existing SF88 recovery engine](workspace-recovery.mjs) and
[SF101 authenticated encryption](../sf101-merchant-recovery/README.md).
The native capture uses the original Object BACKUP lease shared with acquisition,
assembly and finalization. The typed Node interface invokes those same commands.

## Select the original state

The selected session must have `workspace: null` and original
`maxAtomic`, `maxTotalAtomic` and `plannedMaxAtomic` equal to `"0"`.
Its configured ledger, WAL and SHM must be absent. A managed session or a session
with nonzero caps uses the existing Object Buyer workspace backup, which retains
its original SF36 journal and operator keys.

Choose an existing, private, canonical `stateRoot` containing:

- The complete native session directory and its inbox, configurations, chunks,
  assembly receipts and all prior lease generations.
- The original signer module, policy and complete evidence directory.
- Every file named by a recorded assembly destination.
- Any additional local source/configuration or application files selected with
  repeated `--include` flags.

Inspection resolves these original dependencies from the session and inbox.
An assembly outside the chosen root, a missing recorded assembly, a changed
original dependency or an unsafe file causes a specific error. Select a common
private ancestor containing the complete original state; the commands do not
rewrite stored absolute paths.

A report or Analysis export can preserve useful data and provenance while
omitting native session members. This workflow requires the actual session.
If only an earlier data export survives, receive those original data bytes
through the native Object API first and retain the resulting native identity
and original lineage.

Files must be owned by the current POSIX user, private, regular and singly
linked. Directory and parent symlinks are refused. The shared engine bounds
the selection to 9,500 file/directory entries, 2 GiB per file and less than
4 GiB total; the complete review is bounded to 4 MiB. Native runtime and
interpreter paths are reported as `retained: false`. Receive the maintained
application/runtime separately before using the restored session.

## Review, capture and verify through the existing Object CLI

Stop all writers of the selected state, including any direct inbox operator.
A stale or foreign native lease must use the original explicit Object recovery
procedure. `--quiesced` records that the operator has already stopped writers;
it does not terminate another process.

Keep the encrypted bundle and private command reports outside `stateRoot`.
The passphrase comes from a separately selected environment variable, with at
least 16 bytes. Store its value in the receiver's existing secret custody.
The command line contains the variable name only.

```sh
umask 077
OBJECT_CLI=/opt/starforge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs
STATE_ROOT=/srv/starforge/received-free-object
SESSION=/srv/starforge/received-free-object/state/sessions/events
RECEIVING=/srv/starforge/object-backups/receiving-20261012

mkdir "$RECEIVING"
: "${SF88_BACKUP_PASSPHRASE:?Load the separately held recovery passphrase}"

node "$OBJECT_CLI" session-backup-review \
  --session "$SESSION" --state-root "$STATE_ROOT" \
  > "$RECEIVING/review.json"
```

Review the full returned source inventory, session/configuration identity,
original native checkpoint and explicitly absent ledger. Save its
`reviewSha256`. Any changed selected file or original lease history requires a
fresh review. A checkpoint can retain a queued or unresolved native outcome;
capture does not convert that history into a completed acquisition or payment.

```sh
REVIEW_SHA=$(node --input-type=module -e \
  'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).reviewSha256)' \
  "$RECEIVING/review.json")

node "$OBJECT_CLI" session-backup \
  --session "$SESSION" --state-root "$STATE_ROOT" \
  --out "$RECEIVING/encrypted" --review "$REVIEW_SHA" --quiesced \
  --pass-env SF88_BACKUP_PASSPHRASE \
  > "$RECEIVING/snapshot.json"

RECORD_SHA=$(node --input-type=module -e \
  'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).recordSha256)' \
  "$RECEIVING/snapshot.json")

node "$OBJECT_CLI" session-backup-verify \
  --bundle "$RECEIVING/encrypted" --expect "$RECORD_SHA" \
  --pass-env SF88_BACKUP_PASSPHRASE \
  > "$RECEIVING/verification.json"
```

Capture acquires the original BACKUP lease, compares the complete reviewed
selection again, copies and hashes every selected member, and checks the
source before and after copying. Existing lease records remain byte-for-byte
in the review. The new backup claim and its sealed
`RECOVERY_SNAPSHOT_COMPLETED` release are additional authenticated capture
records. The live source gets the original normal release.

Verification decrypts through SF101, authenticates the complete record and
every member, parses the original native definition and all chunk
configurations, checks all assembly files, and validates the extra sealed
backup lease. It also verifies that the original configured ledger remains
absent within the capture. This is an independent archive check; it does not
contact the merchant, execute a buyer, load a wallet or query settlement.

## Restore and reopen the original session

The authenticated record chooses the original canonical `stateRoot`.
On the receiving host, that root must be absent or an empty private directory,
with its canonical parent already present. Keep any existing live original
state under its existing custody; the command refuses to replace it.

Transfer the complete encrypted directory and the retained record digest to
the receiver. Supply the passphrase separately and run:

```sh
node "$OBJECT_CLI" session-backup-restore \
  --bundle "$RECEIVING/encrypted" --expect "$RECORD_SHA" \
  --pass-env SF88_BACKUP_PASSPHRASE \
  > "$RECEIVING/restoration.json"

node "$OBJECT_CLI" status --session "$SESSION" \
  > "$RECEIVING/reopened-status.json"

node "$OBJECT_CLI" accounting --session "$SESSION" --offset 0 --limit 250 \
  > "$RECEIVING/original-accounting.json"
```

Continue an accounting reader using its actual `range.nextOffset` when present.
The restored native status and accounting results retain the original session,
request/attempt identities, zero-cap facts, complete body hash and recorded
outcome. A completed free response remains `NO_PAYMENT_REQUIRED`; unresolved
or untouched requests retain their actual native state. Restoring does not
run, retry, finalize, sign or purchase anything.

Publication is a whole-directory rename after complete authentication and,
when required, a verified copy onto the destination filesystem. The restored
root contains a private `.sf88-object-restorations/<recordSha256>.json`
marker identifying this exact selected record. A repeated restore of that
same record reopens the owned published root and reports `reused: true`.
It preserves later native state rather than copying the old snapshot over it.
Another record or an unrelated populated directory is rejected.

The result distinguishes publication from receiving checks:

| Field | Meaning |
| --- | --- |
| `status: OBJECT_SESSION_STATE_RESTORED` | The complete selected state was published, or that same owned publication was reopened. |
| `executionStarted: false` | Restore started no acquisition or financial action. |
| `current` | Actual reopened native checkpoint; a current native writer is reported separately when present. |
| `nativeReopenErrors` | Post-publication native reads that need attention. Published files remain available. |
| `publicationSyncError` | Directory publication occurred but its durability confirmation failed. |
| `cleanupErrors` | A temporary-copy cleanup did not finish. |
| `reused: true` | The exact saved output was reopened; no replacement capture/publication was performed. |

## Interrupted operations

Retain the original command input and any complete JSON result before taking a
following action.

- If capture lost its reply but the selected output is present, invoke the same
  `session-backup` with the same review, root, session and output. It verifies
  that exact existing bundle and returns it; it does not capture changed live
  state. A partial or unrelated output is rejected.
- If capture died before a complete bundle was published, inspect the original
  native lease and use its explicit proven-dead-owner recovery when eligible.
  Keep any incomplete operation files as evidence. A following capture needs
  a fresh full review and a new output selection.
- A `leaseReleaseErrors` result means the encrypted snapshot can already be
  complete while releasing the original live session requires attention.
  Inspect the native session before attempting any later writer.
- If restore lost its reply, verify the exact bundle and repeat the same
  original-root restore selection. A matching published marker reopens its
  current state. No missing marker is fabricated beside an unrelated root.
- Exit code 2 means a complete native result reports a release, sync, reopen
  or cleanup issue. Preserve that result and resolve the named stage.
  Absence of a complete stdout result does not establish absence of a
  published backup or restored directory.

## Typed Node application

Import from the existing Node entry. The constructor creates no Buyer,
application directory or operator ledger. New runtime instances default to
an 8 MiB private result limit; existing selected runtime limits remain explicit.

```js
import {
  ObjectSessionRecovery, ObjectSessionRecoveryError,
} from '/opt/starforge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/index.mjs';

const recovery = new ObjectSessionRecovery({
  runtimeDirectory: '/opt/starforge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  environment: process.env,
});

const selection = {
  directory: '/srv/starforge/received-free-object/state/sessions/events',
  stateRoot: '/srv/starforge/received-free-object',
};

const review = await recovery.inspect(selection);
// Present/save review.native before the operator chooses this exact capture.
const snapshot = await recovery.snapshot({
  ...selection,
  output: '/srv/starforge/object-backups/receiving-20261012/encrypted',
  expectedReviewSha256: review.native.reviewSha256,
  quiesced: true,
  passphraseEnv: 'SF88_BACKUP_PASSPHRASE',
});

const archive = {
  bundle: snapshot.native.bundle,
  expectedRecordSha256: snapshot.native.recordSha256,
  passphraseEnv: 'SF88_BACKUP_PASSPHRASE',
};
await recovery.verify(archive);

// On the receiving host, after arranging the original absent/empty root:
try {
  const restored = await recovery.restore(archive);
  console.log(restored.native.objectSession.sessionId, restored.native.current);
} catch (error) {
  if (!(error instanceof ObjectSessionRecoveryError)) throw error;
  // Save the structured result; completion and process outcome are separate.
  const {native, completionReported, process: nativeProcess} = error.result;
  console.error({completionReported, nativeProcess, native});
}
```

All four methods accept `signal`. `result.native` is the original JSON
returned by the native command, recursively frozen. `completionReported`
and `ok` are separate: a complete publication result can accompany a failed
process exit or a post-publication diagnostic. The existing NativeRuntime
owns the child, waits for its actual exit, and keeps its private logs outside
the selected state.

The direct engine exports in `workspace-recovery.mjs` are
`inspectObjectSessionRecovery`, `snapshotObjectSessionRecovery`,
`verifyObjectSessionRecovery` and `restoreObjectSessionRecovery`.
They accept the same selection and archive facts; direct-engine option names
are `passEnv` and `expected` where the typed SDK uses
`passphraseEnv` and `expectedRecordSha256`. The context accepts
`environment`, `signal` and `onProgress`. Application code should normally
use the typed wrapper or the original Object CLI so subprocess ownership and
structured receiving diagnostics remain explicit.
