# Recover a customer workspace from Python

WorkspaceRecovery calls the existing SF88 CLI through the maintained Runtime.
The original SF101 encryption, original SF36 HMAC journal verification, private
file checks and original-root restore remain the implementations. The Python
wheel requires the matching complete native runtime; it does not contain that
runtime or create another ledger.

Read the native [recovery operating contract](../RECOVERY.md) for exact source
limits and archive behavior. All selected state must be POSIX-private and live
under a single canonical state_root. The original ledger must already exist.
Do not initialize a Buyer or workspace to repair a missing ledger.

## Run the maintained customer example

The matching source distribution includes
[examples/recover_workspace.py](examples/recover_workspace.py). With the maintained
Python SDK installed, run `python examples/recover_workspace.py --help` from this
source directory. Its explicit stages are `inspect`, `snapshot`, `verify`,
`restore` and `reopen`. Supply `--checkout` with the complete original native
source/runtime root. Snapshot requires `--quiesced`; verification and restoration
require the selected `--expect` record digest. `--pass-env` accepts only the
private environment variable's name.

An existing `--app-dir` is included in inspection and capture. After restoration,
that option reopens the original Python application. Repeated `--object-session`
and `--dataset-session` options inspect existing native session directories;
include them explicitly when taking the backup. The example verifies the
existing application path before constructing a Buyer and retains the original
recovery result if a subsequent application read fails. It leaves populated
restore destinations for the operator to preserve under the original procedure.

## Inspect and capture the existing application

An existing buyer.workspace_recovery() reuses that Buyer's Runtime and includes
its existing application directory automatically. Supply the native operator and
state root, the original inboxes, and any other application/session directories
that must be retained. Paths refer to real existing state.

~~~python
from stellar_forge_buyer import Buyer, WorkspaceRecovery, WorkspaceRecoveryError

checkout = "/srv/forge"
# The passphrase variable has already been supplied through the host's private
# environment. Its value is not an SDK argument or command-line option.
buyer = Buyer(checkout=checkout, state_dir="/private/customer/python-app")
recovery = buyer.workspace_recovery()
selection = dict(
    directory="/private/customer/operator",
    state_root="/private/customer",
    inboxes=["/private/customer/inbox"],
    include=["/private/customer/node-app"],
)
inspected = recovery.inspect(**selection)
print(inspected.native["selected"], inspected.native["inboxes"])
~~~

Inspection returns the existing native closure: selected paths, missing optional
outputs, original jobs and attempts, and runtime dependencies that must remain
installed separately. Node and Python application directories retain their
different formats; the same backup can include both without converting either.

Actually stop all writers before passing quiesced=True. This includes the original
inbox runner, CLI, SDK, browser and external jobs. The native worker additionally
takes its original writer reservation and consistent SQLite backup, audits the
journal and checks that source bytes and identities did not change.

~~~python
saved = recovery.snapshot(
    **selection,
    output="/private/backups/customer-2026-10-11",
    quiesced=True,
    passphrase_env="SF88_BACKUP_PASSPHRASE",
)
selected_record = saved.record_sha256
# Keep selected_record in the application's existing trusted backup inventory.
verified = recovery.verify(
    bundle=saved.native["bundle"],
    expected_record_sha256=selected_record,
    python="/usr/bin/python3",
)
print(verified.checkpoint, verified.native["inboxes"])
~~~

The output is a new directory outside state_root with an existing canonical
parent. passphrase_env is an environment variable NAME, defaulting to
SF88_BACKUP_PASSPHRASE. The original engine requires a separate 16–65536-byte
passphrase and refuses the wallet and original SF36 key variable names. It
passes only the selected passphrase and locale into the encryption child.
No secret value, wallet or approval key is returned by this API.

The existing Python Runtime inherits its normal environment unless an explicit
environment mapping was supplied. A handle obtained from a Buyer retains that
exact Runtime behavior and limits. Recovery uses bounded in-memory pipes and
does not create log files in the source or restore destination.

Verification authenticates/decrypts the archive, verifies its exact file closure
and the original SF36 journal, and removes temporary plaintext. python is the
current trusted absolute interpreter used for this verification, never an
interpreter selected by the archive. Saved runtime paths remain unchanged.

## Recover before constructing a Buyer

The original authenticated record chooses its canonical root. Restore requires
that root to be absent or an empty private directory. It cannot overwrite or
merge populated state, relocate ledger pointers, reconcile later history, or
rerun payments. Preserve and reconcile any newer state through the original
operating process before selecting a backup.

Create the standalone recovery object before any Buyer initializer. Python
Buyer.__init__ creates its application directory immediately; constructing it
first would repopulate a restore destination. The following runs only after the
operator has independently selected the archive and prepared the original root:

~~~python
recovery = WorkspaceRecovery(checkout=checkout)
restored = recovery.restore(
    bundle="/private/backups/customer-2026-10-11",
    expected_record_sha256=selected_record,
    python="/usr/bin/python3",
)
print(restored.state_root, restored.checkpoint)
assert restored.native["executionStarted"] is False

reopened = Buyer(checkout=checkout, state_dir="/private/customer/python-app")
operation = reopened.operation("the-original-saved-intent")
response = operation.recover()  # Read the retained result, without another attempt.
~~~

The native restore reopens the original operator and inbox while preserving keys,
request/body/ticket fingerprints, pending jobs, permanent attempts, saved outputs,
evidence and journal history. Resume each application with its original directory
and stable IDs. Reopen the Node state with Node's Buyer and native acquisition
state with the existing dataset/object/runbook APIs. Install the required native
runtime at its retained paths before normal operator use.

## Typed results, failures and cancellation

WorkspaceRecoveryResult contains operation, native and a
WorkspaceRecoveryProcess with returncode, error, interrupted and started.
Convenience properties expose record_sha256, state_root, directory and checkpoint.
Successful methods return only after the expected original completion and a
successful process result.

A native failure, wrong selected digest, invalid result, deadline or interruption
raises WorkspaceRecoveryError, a NativeError subclass. error.result retains the
recognized native completion and the original process receipt. Error messages
contain only stable codes, never raw stderr, passphrases or signer output.

~~~python
try:
    checked = recovery.verify(
        bundle="/private/backups/customer-2026-10-11",
        expected_record_sha256=selected_record,
    )
except WorkspaceRecoveryError as error:
    print(error.code, error.result.process, error.result.completion_reported)
    # Resolve the actual original state before continuing; never delete or
    # retry a restore automatically from this exception.
~~~

This integration retains the existing synchronous Runtime's KeyboardInterrupt
and timeout handling: SIGTERM, its original 15-second cleanup grace, then
termination if necessary. It does not add an asynchronous cancellation/Event API
or another process loop. A standalone handle can set timeout and output_limit
through the existing Runtime limits; a Buyer handle keeps its Buyer's limits.

The native snapshot/verify/restore honors cancellation; read-only inspection
does not poll the signal internally, while process termination remains bounded.
A process may stop after an atomic archive/state publication. A true
completion_reported means the native completed result was received. False does
not prove that no state was published. Always preserve the original root and any
returned metadata until the original inspection/reopen path resolves the outcome.
