# Commerce operating-state backup and recovery

The original SF66 commerce console can retain a complete operating session in an
encrypted backup and restore it at its original paths. This includes the merchant
configuration, saved setup packets, every selected original buyer inbox, request
bytes, response files, operator journals, signer configuration references,
availability state, usage history, and upstream idempotency state discovered from
the retained configuration.

The workflow uses the existing SF88 workspace recovery engine to lock and
checkpoint each original SF36 operator journal. The existing SF101 engine encrypts
and authenticates the resulting archive. A restore retains original intent IDs,
attempts, reservations, transaction records and file identities. Opening the
restored session does not dispatch a purchase.

## Configure the host

Keep the recovery configuration and encrypted backups **outside** the state root
being backed up. The recovery console must be able to read that configuration and
the backup after the original state is absent.

Choose one canonical private state root containing the original session,
operators, retained preparation and required operating files. Files and
directories must satisfy the original private-state permissions: owner-only
files, owner-only directories, canonical absolute paths, and no symbolic links.
Use the same operating-system user and original absolute paths when restoring.

Create a private backup directory, then save an owner-only JSON file such as
`/private/host/commerce-recovery.json`:

```json
{
  "schema": "stellar-forge.commerce-recovery-config.v1",
  "directory": "/private/merchant/continued-session",
  "stateRoot": "/private/merchant",
  "backupDirectory": "/private/backups/commerce",
  "preparation": "/private/merchant/prepared",
  "include": [],
  "passEnv": "SF66_BACKUP_PASSPHRASE",
  "python": "/usr/bin/python3"
}
```

`directory` selects the original running or retained commerce session.
`preparation` is optional: use it to include the retained original setup,
private request packets and earlier sessions under that preparation. Any other
original commerce sessions or operator workspaces in selected directories are
discovered before their journals are captured. `include` adds other required
private files or directories inside the same state root.

Required session dependencies outside the root produce a specific review error.
Choose the correct original common root; moving or rewriting a buyer ledger,
intent or signer configuration is not a recovery shortcut. Application code
outside the state root and the installed runtime remain explicit runtime
requirements. The review shows those paths.

Set the passphrase environment in the process that starts the console, using your
normal secret-input facility. SF101 requires a passphrase of at least 16 bytes.
Use a dedicated backup passphrase. The original engine rejects using the wallet
secret as that passphrase. The browser receives its environment-variable name,
never its value. Keep a durable copy of the encrypted backup and its passphrase
under your own backup procedures.

Wallet and provider environment secret values are not exported. Supply the
original wallet/provider environment, installed native dependencies, application
runtime and trusted Node/Python executables when reopening. Retained signer
configuration files remain in the encrypted state; their environment references
do not contain the secret values.

## Pause, review and capture in the same console

Start the original browser workspace with recovery enabled:

```sh
node commerce-console.mjs start \
  --directory /private/merchant/continued-session \
  --recovery-config /private/host/commerce-recovery.json
```

Open the complete local operator URL printed in the terminal. The existing
request, payment, response, stream and merchant controls remain in the same
workspace.

1. Select **Pause and review state**. The console stops its original buyer and
   merchant listeners, drains accepted native work and releases original process
   ownership. The review identifies all retained sessions, request states,
   operators, selected paths and runtime requirements.
2. Inspect the reviewed state closure. The review SHA-256 binds that selection,
   original session identities and configuration hashes.
3. Select **Create encrypted backup**. The original commerce leases are acquired
   for all discovered sessions; every original operator journal is locked and
   checkpointed. The original recovery engine compares source identity through
   capture, encrypts the private state and publishes a new backup directory.
4. Select **Verify selected backup**. This decrypts and authenticates the archive,
   reopens the mapped original operator journals and checks original request and
   configuration identities without changing the running state.
5. Select **Reopen original session** when you want to continue operating.

An active commerce process holds the same original operating-system lease used
by initialization and backup. A second session opener or snapshot is refused
while that original owner remains active. Accepted native payment work retains
ownership through its drain. A capture that observes changed state requires a
new review.

Capture, verification and restore are retained console jobs. Closing or reloading
a browser page does not duplicate or cancel an accepted job. Progress and its
result remain visible. **Cancel recovery task** signals the original engine;
existing completed archives remain available. Stopping the console process waits
for an accepted recovery job before closing its current commerce session.

Each backup has an owner-only selection record beside the original encrypted
bundle. A complete archive can still be verified if a process lost its connection
after encrypted publication but before updating that local selection record.
An incomplete unpublished capture is reported separately and is never restored.

## Restore when the original state is absent

Keep any existing original state separately before restoration. Restore accepts
an absent or empty original state root; it does not overwrite or merge a
populated working directory.

Start recovery mode with the same host configuration:

```sh
node commerce-console.mjs recover \
  --recovery-config /private/host/commerce-recovery.json
```

This starts only the local recovery console. It can open with the selected
commerce session and entire original state root absent.

1. Choose the retained backup and select **Verify selected backup**. The original
   authenticated manifest, all operator checkpoints, session documents and
   private request configuration hashes are inspected inside an isolated
   temporary restore tree. No source-state read is required.
2. Select **Restore original paths**. The existing engine verifies the archive
   before publishing the original state root. It then reopens the original
   journals and session metadata and reports any specific reopen diagnostics.
3. Select **Reopen original session**. The original commerce runtime reads the
   restored configuration, inbox, request bytes, attempt and response files.
   The same completed intent remains attempted; a cancelled request remains
   cancelled. No execution request is made by the recovery action.
4. Use the existing input inspection and saved-response download controls to
   continue investigating the original operation.

A result that reports successful state publication together with reopen
diagnostics is already a published restore. Read those diagnostics and correct
the runtime or environment at that original location before reopening. Do not
repeat a restore over the newly populated state.

## Original CLI workflow

Stop and drain the process owning the original session before using these
commands. The CLI cannot stop a different host process; the original OS lease
still protects capture.

```sh
node commerce-cli.mjs backup-review --recovery-config /private/host/commerce-recovery.json
node commerce-cli.mjs backup --recovery-config /private/host/commerce-recovery.json --review REVIEW_SHA256
node commerce-cli.mjs backup-status --recovery-config /private/host/commerce-recovery.json
node commerce-cli.mjs backup-verify --recovery-config /private/host/commerce-recovery.json --backup commerce-BACKUP_UUID
node commerce-cli.mjs backup-restore --recovery-config /private/host/commerce-recovery.json --backup commerce-BACKUP_UUID
node commerce-cli.mjs start --directory /private/merchant/continued-session
```

The backup command rereads the original closure and requires the exact SHA-256
from the previous review. Verify and restore select only a retained backup ID
under the host-configured backup directory. Neither command accepts a browser
supplied arbitrary file path or changes original transaction identity.

The installed package exports `@tokenjunkielabs/starforge-merchant/commerce-recovery`
and `@tokenjunkielabs/starforge-merchant/commerce-recovery-controller`.
The exported embedding interface is
`createCommerceRecoveryController(profile, {environment, pause, reopen, state})`.
Trusted hosts may pass `recoveryProfile` and a `reopen(directory)` callback to
`startCommerceConsole` when the original native facilitator is provided by the
embedding application. The callback returns the original `openCommerce` runtime.
The standalone CLI uses the saved configuration automatically.

## Original engine limits

The adapter retains up to 64 original commerce sessions and 64 operator
workspaces. The source closure and archive continue to use the original SF88 and
SF101 path, inventory, size, encryption and journal-validation limits. All files
in an explicitly included directory are private backup material; select that
directory deliberately. No parallel crypto, wallet, payment or journal engine is
introduced.
