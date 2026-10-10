# SF63 | Operator-safe backups for the original SF60 catalog journal

**Original-source addon** to `../sf60-durable-catalog-transaction/journal.mjs`. Read-only on the operator's live source directory. No hosted service, network fetch, wallet, key handling or payment. Node 22+ on a private local POSIX filesystem.

## Why this exists

SF60 already fsyncs and atomically replaces the current catalog journal. But before SF63 there was no integrated operator command to *produce a reversible, validated backup*, to independently verify a portable copy, or to restore into an **empty** directory without clobbering an existing live catalog. A backup that merely copies JSON can silently miss file corruption or transitive identity failures. SF63 **reopens the copied bytes through SF60's real three-module native reconstruction**, not just a checksum comparator.

## CLI

```sh
node stellar/scf-starforge-20261009/sf63-catalog-backup/cli.mjs backup /private/live-catalog /private/backups/catalog-2026-10-10
node stellar/scf-starforge-20261009/sf63-catalog-backup/cli.mjs verify /private/backups/catalog-2026-10-10
node stellar/scf-starforge-20261009/sf63-catalog-backup/cli.mjs restore /private/backups/catalog-2026-10-10 /private/RESTORED-FRESH-DIRECTORY
```

Source path must be a regular local directory, not a symlink. `backup` and `restore` require target parents to already exist and the target directory not to exist; no existing directory or journal is overwritten. The backup captures the complete original byte snapshot using a no-follow open, validates the SF60 hash chain, runs a full *native* SF60 replay against a private temporary copy, and writes a byte-exact journal plus `backup-manifest.json` containing the source SHA-256, head, record count and byte length. The manifest is written last. `verify` rehashes and replays; incomplete copies fail. `restore` checks the backup before copying into the new target, fsyncs restored data, and checks original-native replay again. All commands print machine-readable JSON and fail nonzero on errors.

**Writer ownership:** a running SF60 writer is allowed; its atomic journal rename means a reader's open file descriptor sees a complete committed version. The tool **never** removes `.catalog-writer.lock`. Restored directory is not auto-started. An operator must confirm the former process has been stopped and reconcile the restored head before manually pointing any real service at it. A new write process is still mediated by SF60's single-writer lock. Do not use network filesystems whose rename/fsync semantics differ or place backups in a web root. Protect or encrypt backup content at rest according to seller/operator policy.

**Integrity is not authenticity.** A SHA-256 checksum and unkeyed chain cannot prove that a malicious person with edit permission did not rewrite *both* the journal and the manifest. Copy the reported checksum into independent operator custody, use trusted storage permissions and versioned offsite backup. Seller/signer authority is still established upstream, not by SF63. For an empty operator journal that SF60 has not written to disk yet, an explicit valid zero-record journal is backed up.

## Acceptance

`node --test stellar/scf-starforge-20261009/sf63-catalog-backup/test/focused.test.mjs` is a **small** local file-I/O check with an injected no-network replay adapter. This does **not** replace live original SF60 import validation. The actual CLI imports SF60's unchanged module; on the full repository, run backup, verify, and restore against a real original SF60 journal. Existing Muse source-corpus owner should expand this with genuine 27/27 Vellar catalog/retire corpus, same original source pins, first-party faults and restart/recovery; do not stand up another generator or paid hosted CI. No customer adoption, production settlement or SCF grant application is implied.
