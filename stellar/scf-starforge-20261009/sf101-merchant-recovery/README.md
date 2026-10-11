# SF101 Merchant Recovery: private encrypted seller-state continuity

A Node 22+ dependency-free, offline recovery tool for existing **original** SF30 Stellar x402 merchants. It does not start a new payment server, grant wallet authority, automate transactions or replace any of the shipped source modules. It protects an operator-selected, *quiesced* combination of original SF30 merchant configuration/private SQLite data, original SF60 durable catalog journal and SF98 post-settlement delivery outbox, including related deployment manifests or merchant onboarding material.

## Production runbook

**Before creating a backup:** stop the merchant HTTPS proxy from accepting requests; stop the original SF30 seller and operations observers; finish/reconcile SF98 outbox drains; close the original SF30 SQLite source workers and checkpoint/close any SQLite writers and WAL. Stop writers to the original SF60 journal and associated trust/admission files. **Never call `--quiesced` while these original state writers are running.** The CLI verifies file metadata before/after reading but cannot atomically freeze a live set of unrelated files; consistent service shutdown is the source-of-truth.

Create an operator-private JSON plan (not in public Git):

```json
{
  "schema": "stellar-forge.merchant-recovery-plan.v1",
  "roots": [
    {"name":"sellerConfig","path":"/private/merchant/seller-service.json"},
    {"name":"catalogJournal","path":"/private/merchant/catalog"},
    {"name":"deliveryOutbox","path":"/private/merchant/sf98-outbox"},
    {"name":"sqliteSource","path":"/private/merchant/query-source"}
  ]
}
```

Plan roots are operator-owned real absolute **file or directory** paths, not URL endpoints or guesses about internal SF60 folder layouts. Every descendant is backed up, including relevant SQLite WAL files only after quiescing; only include state you own and intend to restore together. Symlinks, hardlinked files, devices, nested/overlapping roots, unsafe paths, oversized inputs and bundle-under-source layouts fail before capture. No automatic discovery of secrets, directories, accounts or files. Maximum 20 roots, 10,000 entries, 4 GiB plaintext total; for larger live databases use a storage-native snapshot and coordinated maintenance window.

Supply a strong private passphrase as an **environment value**, not an argument or Git file. On your private machine:

```sh
export SF101_RECOVERY_PASSPHRASE='SET_LOCALLY_USING_YOUR_SECRET_MANAGER'
node stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs snapshot \
  --plan /private/merchant/recovery-plan.json \
  --out /private/backups/merchant-20261011-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE --quiesced
node stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs verify \
  --bundle /private/backups/merchant-20261011-001 --pass-env SF101_RECOVERY_PASSPHRASE
```

Each file is AES-256-GCM authenticated and the key derives from a random per-bundle salt using scrypt; each file has its own random IV. Explicit 0700 directories/0600 files, exclusive-create output, original content SHA-256 plus ciphertext integrity digest, complete authenticated re-read and fast fail on corruption. The manifest contains only named logical roots/relative paths and metadata, no original absolute directories or secret values. **Do not expose, check into Git, or upload private backup bundles;** secret loss makes encrypted recovery impossible. Encrypt volume storage and control access to the passphrase separately.

## Dry recovery drill / controlled restore

```sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs restore \
  --bundle /private/backups/merchant-20261011-001 \
  --out /private/drills/restore-20261011-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

The entire backup is authenticated **before** any restore directory is created. Restore goes only into a **new** private directory, never over an existing merchant, running SQLite DB or production journal. Failed restores remove the tool-created destination. Review original merchant root names and file layout, bring up original SF60/SQLite source on the isolated restored state with original operators, reconcile SF98 event IDs against the real authoritative facilitator/merchant backend, and only then use normal merchant change-management to switch over. This tool does not claim restored state proves settlement or prevent webhook duplicate delivery; the original SF98 receiver must deduplicate event IDs and original SF60 catalog retains its own head semantics. Restored files are conservatively private (0600), directories 0700; adjust service-user ownership/execute permissions with normal deployment tooling.

## Integration & commercial handoff

SF99 deploy owner can add quiesced-backup and restore-drill steps to the original HTTPS launch runbook without copying seller secrets into deployment source. SF49 paid merchant owner can use the recovered original SF30/SF60/SF98 state as a concrete continuity deliverable and specify RPO/RTO after measuring original full-source shutdown, actual dataset size and native recovery time. SF93 support snapshots remain a separate *operational diagnostics* product, not a database backup. SCF SF10 founder should list this as pre-award engineering if merged, not future grant-funded work or an adoption claim.

No scheduled background tasks, outbound calls, payment signing, hosted Actions, test-suite expansion or merchant data shipped in this source.
