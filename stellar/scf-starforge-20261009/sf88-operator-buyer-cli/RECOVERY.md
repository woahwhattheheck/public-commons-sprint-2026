# Back up and restore the original buyer workspace

The buyer CLI can retain its original private workspace, SF36 spend journal and
three journal keys, durable inboxes, request bodies and operation tickets, saved
evidence and selected acquisition/output files in one encrypted backup. It uses
the existing SF101 recovery engine and the original SF36 audit. Restoring reopens
the same operator and inboxes at their original absolute paths; it does not
execute requests, clear pending reservations or create another payment attempt.

Run these commands from the complete public sprint checkout on a POSIX host with
Node 22+ and Python 3.11+. The normal distributed `buyer` command also accepts
these options. Keep the installed runtime and signer provider available through
the operator's existing setup.

## Select the original state

Use one private parent directory containing this operator's persistent state.
The directory, its selected subdirectories and files must belong to the current
operator, with no group/other permissions, symlinks or hard-linked files. For
example, `/srv/stellar-buyer` may contain `operator`, `inbox`, `acquisitions` and
`downloads`. Its encrypted backups belong outside that tree.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --inspect-workspace-backup \
  --dir /srv/stellar-buyer/operator \
  --state-root /srv/stellar-buyer \
  --inbox /srv/stellar-buyer/inbox \
  --include /srv/stellar-buyer/acquisitions
```

Repeat `--inbox` for another inbox belonging to the same operator. Repeat
`--include` for persistent dataset, object-acquisition, runbook or output state
that is not already inside a selected directory. The command selects:

- The original workspace, signer configuration, policy, three SF36 keys and
  evidence. The existing original ledger is required; a missing ledger is never
  initialized or replaced with an empty one.
- Each supplied inbox, including original request snapshots, tickets, permanent
  attempts, outcomes and financial-finalization records.
- Required body and ticket files referenced by the workspace and inboxes,
  existing configured response files and retained partial downloads. A missing
  output stays absent; an existing private output parent is retained.
- The original review configuration if it is still inside the selected state
  root, and every explicitly included file or directory.

Every required dependency must be inside the same state root. If an existing
configuration points elsewhere, select the original common private parent that
actually contains those files. Do not rewrite request paths or identifiers to
make a backup fit. The inspection reports selected paths and external runtime
paths so the operator can review the actual closure before capture.

## Capture an encrypted checkpoint

Stop the original workspace, inbox and acquisition writers before capture.
`--quiesced` confirms that operating condition; it does not stop another process.
An unresolved reservation remains reserved in the backup.

Use a separate backup passphrase of at least 16 bytes. Keep it through the
operator's existing credential setup, separately from the encrypted archive.
For an interactive Bash terminal:

```sh
read -r -s -p 'Backup passphrase: ' SF88_BACKUP_PASSPHRASE
export SF88_BACKUP_PASSPHRASE
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --backup-workspace \
  --dir /srv/stellar-buyer/operator \
  --state-root /srv/stellar-buyer \
  --inbox /srv/stellar-buyer/inbox \
  --include /srv/stellar-buyer/acquisitions \
  --out /srv/stellar-backups/buyer-20261011 \
  --quiesced
```

The output's parent must already exist at a canonical path; the output itself
must be new. Use `--pass-env NAME` to select another independent passphrase
variable. The encryption subprocess receives only that selected variable and
locale settings. The workflow does not load the wallet environment or import a
wallet provider. Explicitly included files remain the operator's responsibility.

Capture opens the existing SF36 database without its creation initializer,
holds its original SQLite writer reservation and audits its original HMAC
journal. SQLite's native backup captures committed WAL contents into a complete
standalone database. The source ledger inode remains bound throughout capture;
source-file and inbox changes cause capture to fail. Raw WAL/SHM sidecars are
not copied. The writer reservation is released once the private staging copy is
complete, before encryption.

The existing SF101 engine encrypts the state and its authenticated record with
scrypt-derived AES-256-GCM and authenticates its manifest. The CLI publishes the
complete encrypted directory only after encryption succeeds. Interrupted runs
clean up their private staging state and leave the original workspace intact.

Successful output includes `BUYER_STATE_BACKUP_CREATED`, the backup-record
SHA-256, original paths, network, file count/bytes and the original journal's
sequence, MAC and reserved/settled counts. Retain the record SHA-256 with the
operator's backup selection record. It identifies this exact checkpoint.

## Verify independently

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --verify-workspace-backup \
  --bundle /srv/stellar-backups/buyer-20261011
```

Verification authenticates and decrypts through SF101 into a private temporary
directory, checks every member and file digest, validates the original workspace
bindings and runs the original SF36 HMAC audit against the complete SQLite
snapshot. The recorded checkpoint must match exactly. No request executes and
the live workspace is not needed or changed. Temporary plaintext is removed.

Use `--expect RECORD_SHA256` to require the checkpoint selected earlier. Restore
and verification use the current trusted `/usr/bin/python3` by default; pass
`--python /absolute/current/python3` when necessary. A Python executable recorded
inside the archive is never executed as part of opening that archive.

## Restore at the original location

Stop the previous writer and select the latest applicable backup. Recovery must
leave one authoritative operator: an older checkpoint cannot reveal payments
made later by a host that has been lost. Preserve and reconcile any later
original records before resuming work from that checkpoint.

Reinstall the buyer runtime and its pinned dependencies, configured Python and
wallet/provider setup at their original configured paths. Retain the original
state root's parent directory. The state root itself must be absent or an empty
private directory. Restore never merges into or overwrites a populated root.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --restore-workspace \
  --bundle /srv/stellar-backups/buyer-20261011
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review-workspace --dir /srv/stellar-buyer/operator
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  list --root /srv/stellar-buyer/inbox
```

The command authenticates the whole backup before publishing the entire original
state directory with an atomic rename. If temporary storage is on another
filesystem, it first copies and checks the complete state beside the destination.
Successful output is `BUYER_STATE_RESTORED` with `executionStarted: false`.

The original SF36 keys, request/configuration bytes, intent IDs, evidence,
attempts and receipt references survive unchanged. Existing settled requests
remain settled; the original inbox financial finalizer can reopen their saved
canonical receipts without another transfer. Pending reservations stay pending.
An attempted inbox item retains its permanent attempt and cannot be executed
again through the normal inbox command. Previously unattempted items remain
queued. Use the existing inbox and acquisition recovery commands for those
original jobs after reviewing their actual retained state.

The closure is limited to 9,500 state entries, 2 GiB per file and slightly less
than 4 GiB in total to leave room for metadata within SF101's existing limits.
Large independent data collections can use the original SF101 archival workflow;
retain their actual files and bindings alongside this operator recovery plan.

## Original operator collections

The native recovery API also accepts `operators`, an explicit array of additional original SF88 workspace directories sharing the selected private `stateRoot`. Passing this array selects the `stellar-forge.sf88.workspace-recovery.v2` collection record, with at most 64 operators including the primary `directory`. The source CLI accepts repeated `--operator /absolute/original-workspace` for inspect and backup. Omitting the array and flags preserves the original single-operator v1 contract.

A collection holds every original ledger in canonical order through both inventory comparisons, excludes each ledger's WAL and SHM sidecars, verifies every staged SQLite backup with its original journal key, and authenticates every checkpoint in the existing SF101 encrypted archive. An undeclared native ledger is rejected rather than copied as an ordinary file. Verification and restore reopen every declared operator through the maintained native engine. `optionalInclude` retains existing selected outputs or the parent metadata of absent optional outputs without recursively selecting unrelated siblings.

[The buyer-runbook recovery workflow](../buyer-runbook/RECOVERY.md) composes this collection with the original workspace, every received operator generation and exact frozen acquisition plans. Its trusted staging hook seals only the leases owned by that capture after source comparison and checkpoint verification. Historical lease generations and original native engines remain intact; restore reopens saved acquisitions without running them.
