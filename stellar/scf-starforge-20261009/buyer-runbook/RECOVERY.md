# Recover complete acquisitions and their original operators

A received merchant request owns an original buyer workspace and its own SF36
journal. An acquisition can contain several of those operators. The runbook
recovery workflow retains the entire original acquisition workspace, received
requests, source configurations, imported acquisitions, outputs and every
original operator in one encrypted archive.

The native SF88 recovery engine audits and checkpoints each original ledger.
The existing SF101 engine encrypts the complete capture. Recovery retains the
original absolute paths, operator keys, budgets, request bytes, attempts,
accounting records and receipts. Restoring and reopening perform no purchase,
signing, reservation or financial finalization.

## Use the existing browser workspace

Start the installed runbook workspace with the original operator settings and a
separate backup passphrase in its process environment. The passphrase must be at
least 16 bytes. Keep its value in your existing credential setup; the browser
accepts its environment variable name.

```sh
read -r -s -p 'Backup passphrase: ' SF88_BACKUP_PASSPHRASE
export SF88_BACKUP_PASSPHRASE
npx --no-install starforge buyer-runbook workspace --state /srv/stellar-buyer/workspace
```

Open **Back up acquisitions** in the existing navigation.

1. Enter the original private parent containing the workspace, configurations,
   operator settings, original operators and retained outputs. Review the
   complete operator list, acquisitions and selected paths.
2. Enter a new archive destination outside that parent. Its parent directory
   must already exist. Confirm that other programs writing the selected
   operators are stopped. This workspace acquires its original draft, intake
   and acquisition leases automatically.
3. Create the encrypted archive. Progress reports each original ledger's
   checkpoint and the encryption stage. The result retains the exact archive
   path and record SHA-256.
4. Select the created archive for verification. Verification authenticates
   every member and all original journals without needing the live state.

The archive result contains the restore and reopen commands. The browser also
retains archive selection records; those records contain paths and checkpoint
metadata, not the passphrase or operator key values. A local selection-record
write failure does not undo an already created archive.

## Use the installed command

Review the same workspace closure before capture:

```sh
npx --no-install starforge buyer-runbook backup-review \
  --state /srv/stellar-buyer/workspace \
  --state-root /srv/stellar-buyer
```

The result's `profile.reviewSha256` identifies the selected original operators,
configurations, request identities, run plans and retained state. Use that exact
value for capture:

```sh
npx --no-install starforge buyer-runbook backup \
  --state /srv/stellar-buyer/workspace \
  --state-root /srv/stellar-buyer \
  --out /srv/stellar-backups/acquisition-20261011 \
  --review REVIEW_SHA256 \
  --pass-env SF88_BACKUP_PASSPHRASE \
  --quiesced
```

The original inputs are inspected again after all acquisition leases are held.
Changed configurations or request/run identities require a current review.
`--quiesced` retains the original SF88 meaning: other programs writing these
operators are stopped. It does not terminate external programs.

SIGINT/SIGTERM cancel the current recovery operation and close every acquired
native ledger holder. The browser has the same cancellation control.

## What the capture retains

The selected state includes the original workspace and configuration directory,
every saved/imported acquisition, its frozen configs and bodies, accounting
bindings and finalization views, received merchant handoffs and review records,
operator settings, and existing configured downloads or partial outputs.

The workflow discovers retained native operator generations, including a
workspace created before its intake `ready.json` was published. Each original
operator is selected explicitly. An unselected native ledger causes collection
capture to fail rather than being copied as an ordinary file.

Every original ledger's SQLite writer reservation is acquired in canonical path
order. All holders remain active through the file copy and full source/plan
comparisons. SQLite's native backup produces a standalone database including
committed WAL contents; raw WAL and SHM files are excluded for every selected
ledger. Each staged database then passes the original SF36 HMAC audit and must
match its recorded checkpoint.

The runbook's immutable lease generations and historical release markers remain
in the archive. Before encryption, a narrow original-lease closure validates
this capture's exact source and staged generation/token and adds only its own
release marker in staging. The live source lease remains held until capture
finishes. The restored acquisition therefore opens with completed capture
leases and no stale backup owner.

Required state must fit under the selected original private parent. External
runtime executables and wallet/provider setup remain part of the original
installation, and their paths are listed during review. The capture supports
up to 64 original operators within SF88's existing limits of 9,500 state
entries, 2 GiB per file and slightly less than 4 GiB in total.

## Verify without the live state

```sh
npx --no-install starforge buyer-runbook backup-verify \
  --bundle /srv/stellar-backups/acquisition-20261011 \
  --expect RECORD_SHA256 \
  --pass-env SF88_BACKUP_PASSPHRASE \
  --python /usr/bin/python3
```

Use the record SHA-256 returned by the successful capture. The current trusted
Python executable audits the staged journals; an executable path stored inside
an archive is never executed while opening that archive. Temporary plaintext
is removed after verification.

Verification checks the authenticated native collection record, all files and
original operator bindings, each ledger checkpoint, the original runbook
workspace identity, every frozen run-plan digest and retained configuration
digest. It does not modify a live acquisition.

## Restore and reopen at the original location

Retain the original runtime and wallet/provider configuration at their declared
paths. The original state root's parent must exist. Stop previous writers and
keep one authoritative copy of the original state. The root itself must be
absent or an empty private directory.

```sh
npx --no-install starforge buyer-runbook backup-restore \
  --bundle /srv/stellar-backups/acquisition-20261011 \
  --expect RECORD_SHA256 \
  --pass-env SF88_BACKUP_PASSPHRASE
npx --no-install starforge buyer-runbook workspace --state /srv/stellar-buyer/workspace
```

Native restore authenticates the complete archive before publishing the original
root. It never merges into or overwrites populated state. When temporary storage
is on another filesystem, it copies and checks every file beside the destination
before atomic publication.

The restored workspace reopens every recorded acquisition through the original
model. Existing attempts stay attempted, reservations keep their original
state, finalized receipt references remain retained, and untouched operations
remain untouched. No execution, retained-output recovery or accounting refresh
runs automatically.

A backup describes state at its capture time. Preserve and reconcile later
original records before resuming from an older checkpoint. Keep the successful
archive/result if publication succeeded but a later local reopen needs attention;
the original populated-root protection remains in force.

## Native compatibility

The maintained single-operator SF88 commands and Node/Python recovery SDK keep
their existing version-1 interface. Explicit operator collections use the
version-2 native recovery record so older engines reject an unsupported
collection instead of validating only one ledger.

The original native CLI also accepts repeated `--operator /absolute/operator`
alongside its primary `--dir`. Complete acquisition capture uses the runbook
commands above, which additionally retain the reviewed application closure and
finish only their own staged capture leases. Both paths use the same SF88
ledger adapter and SF101 cryptography.
