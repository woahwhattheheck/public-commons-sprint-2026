# Recover a customer workspace from Node

The maintained Node SDK exposes the original SF88 workspace recovery commands.
The original SF101 engine encrypts and authenticates the archive; the original
SF36 worker verifies the ledger and its checkpoint. This API does not initialize
an empty ledger, move a recovered account to another path, or repeat a purchase.

Use the complete current native runtime alongside this package. Recovery requires
POSIX private files and directories and the original Python ledger dependencies.
The native [workspace recovery guide](../RECOVERY.md) defines the archive,
original-state closure, source limits and canonical restore semantics.

## Run the maintained customer example

The package includes [examples/recover_workspace.mjs](examples/recover_workspace.mjs).
From this package directory, run `node examples/recover_workspace.mjs --help`.
Choose one explicit stage: `inspect`, `snapshot`, `verify`, `restore` or `reopen`.
Supply `--runtime` with the complete original SF88 runtime directory. Snapshot
requires `--quiesced`; verification and restoration require the selected
`--expect` record digest. `--pass-env` accepts the existing private environment
variable's name.

An existing `--app-dir` is automatically included in inspection and capture.
After restoration, `--app-dir` reopens that original Node application; repeated
`--object` and `--dataset` IDs optionally inspect its existing native bindings.
Include those native session directories explicitly when taking the backup.
The example keeps the native recovery result visible if a later application
read fails, and leaves any populated restore destination for the operator to
preserve under the original recovery procedure.

## Inspect the whole existing customer state

Keep the operator, inbox and customer application state under one private root.
Existing Node and Python applications retain their own application formats and
separate directories while sharing the original native operator and ledger.

An existing Buyer's recovery handle automatically includes that Buyer's
application directory. Explicitly include other application, dataset, object or
runbook directories that need to travel with the same backup. Every selected
path and dependency must already be inside stateRoot.

~~~js
import { Buyer, WorkspaceRecovery, WorkspaceRecoveryError } from '@stellar-forge/native-buyer';

const runtimeDirectory = '/srv/forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli';
// The selected backup passphrase variable is already present before this runtime
// is constructed. The existing Node runtime copies its environment at construction.
const buyer = new Buyer({
  runtimeDirectory,
  stateDirectory: '/private/customer/node-app',
  environment: process.env,
});
const recovery = buyer.workspaceRecovery();
const selection = {
  directory: '/private/customer/operator',
  stateRoot: '/private/customer',
  inboxes: ['/private/customer/inbox'],
  include: ['/private/customer/python-app'],
};
const inspected = await recovery.inspect(selection);
console.log(inspected.native.selected);
console.log(inspected.native.inboxes);
~~~

Inspection reads the existing original workspace and inbox. It reports selected
roots, missing optional outputs, runtime dependencies, original job identities
and states. It does not export wallet values or execute an operation. A standalone
new WorkspaceRecovery({ runtimeDirectory }) provides the same methods when
there is no live Buyer object; its constructor creates no state.

## Stop writers, capture, and independently verify

Stop the real inbox, CLI, browser, SDK and other writers before capture. The
quiesced flag records that operating action; it does not stop processes.
The native worker additionally holds its original reservation while taking a
consistent SQLite snapshot and rejects a source that changes during capture.

Set the passphrase in a selected environment variable through the host's private
secret mechanism before constructing the runtime. The API accepts only its
NAME: passphraseEnv defaults to SF88_BACKUP_PASSPHRASE. It never accepts the
passphrase as a method argument, command argument or result. The native engine
requires a separate 16–65536-byte passphrase and refuses the configured wallet
variable and the original three SF36 key variable names.

The output must be a new directory outside stateRoot; its existing parent must
be canonical. Node's temporary native logs are private directories beside
stateRoot for inspection/capture and under the existing OS temporary directory
for verification/restore. The bundle parent can remain read-only. Logs are removed
after the original process finishes. No SDK operation
log is written into the quiesced source.

~~~js
const saved = await recovery.snapshot({
  ...selection,
  output: '/private/backups/customer-2026-10-11',
  quiesced: true,
  passphraseEnv: 'SF88_BACKUP_PASSPHRASE',
});
const expectedRecordSha256 = saved.native.recordSha256;
// Retain this exact digest in the application's existing backup inventory.
const verified = await recovery.verify({
  bundle: saved.native.bundle,
  expectedRecordSha256,
  python: '/usr/bin/python3',
});
console.log(verified.native.checkpoint, verified.native.inboxes);
~~~

Verification independently authenticates and decrypts the archive, checks the
original file inventory and the original SF36 journal, and removes its temporary
plaintext. python selects the current trusted absolute verification interpreter,
not a program named by archive contents. It does not rewrite saved runtime paths.
Install the retained runtime dependencies at their original locations before
resuming normal operator work.

## Restore first, then reopen the original applications

Select the verified archive and its independently retained record digest. The
original canonical state root must be absent or an empty private directory.
The original engine refuses populated state; preserve and reconcile any newer
history through the existing operating process before choosing a backup.
There is no destination override or automatic deletion/merge.

Construct the standalone recovery handle before a Buyer or any other initializer
can recreate missing state. The example below belongs to that recovery process;
it does not move or remove a currently operating workspace.

~~~js
const recovery = new WorkspaceRecovery({ runtimeDirectory, environment: process.env });
const restored = await recovery.restore({
  bundle: '/private/backups/customer-2026-10-11',
  expectedRecordSha256, // Loaded from the existing trusted backup inventory.
  python: '/usr/bin/python3',
});
console.log(restored.native.stateRoot, restored.native.checkpoint);

const reopened = new Buyer({
  runtimeDirectory,
  stateDirectory: '/private/customer/node-app',
});
const operation = reopened.operation('the-original-saved-intent');
const status = await operation.inspect();
const response = await operation.recover(); // Saved local result; no new attempt.
~~~

The native restore publishes the complete original state and reopens its operator
and inbox. Pending jobs stay pending. Permanent attempts, request fingerprints,
keys, evidence, outputs and accounting history retain their original identity.
Restoring does not execute a queue, finalize an attempt or load a wallet secret.

The same restored Python application directory can be reopened with its existing
Python Buyer and saved intent IDs; do not point it at the Node application
directory. Native dataset/object/runbook directories reopen through their original
client APIs. The recovered directory names and source pointers are not rewritten.

## Process outcomes and interruption

Successful calls return WorkspaceRecoveryResult with native completion metadata
and a separate process receipt. An invalid result, native error, timeout or
cancellation throws WorkspaceRecoveryError. Its result retains recognized native
metadata, exitCode, exitSignal, errorCode, whether a process started, and any
temporary-log cleanup error. No raw stdout, stderr or environment values are
included in the error message.

~~~js
const controller = new AbortController();
try {
  await recovery.verify({
    bundle: '/private/backups/customer-2026-10-11',
    expectedRecordSha256,
    signal: controller.signal,
  });
} catch (error) {
  if (!(error instanceof WorkspaceRecoveryError)) throw error;
  console.log(error.code, error.result.process, error.result.completionReported);
  // Inspect the reported native completion and actual original state before
  // deciding how to continue. Never delete or repeat a restore automatically.
}
~~~

The existing NativeRuntime sends SIGTERM on AbortSignal or timeout, allows its
configured cleanupGraceMs, then uses SIGKILL if necessary. The original snapshot,
verification and restore engine honors its native cancellation signal. Inspection
is read-only and does not poll that signal internally; its process still remains
under the runtime's deadline and termination control.

A process can be interrupted after an atomic archive or state publication.
completionReported means the original completion was received; false means it
was not received, not that the filesystem is unchanged. If the original completed
result is present despite a process/cleanup error, it remains in error.result.native.
The SDK never rolls back, deletes, merges, re-executes or blindly retries that
state. Use the original inspection/reopen path and the selected archive to resolve
the actual outcome.
