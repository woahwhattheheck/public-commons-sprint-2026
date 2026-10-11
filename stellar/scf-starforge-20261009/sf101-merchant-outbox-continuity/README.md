# SF101 | Original SF98 merchant continuity: backup, verify, compare, restore

Production operations for the **original SF98 native merchant settlement-event outbox**. This is not a separate payment verifier, receipt generator, background sender or ledger. It is a concrete recovery path for a merchant whose local disk or deployment fails while the original SF30/SF98 checkout is in service.

**What gets protected:** the exact bytes of SF98's private `events.ndjson` and `deliveries.ndjson`. A successful native x402 settlement may be recorded as an event; independent webhook attempts update the second journal. Neither journal by itself establishes an independently verified on-chain cash balance. SF101 preserves both journals and refuses inconsistent event/delivery relationships. It never initiates a native settlement or webhook.

## Operator workflow

Use the existing **full repository checkout** (Node 22+); no npm install or hosted GitHub Actions. All paths must be absolute, normalized POSIX paths. The output parent directory already exists. All source/out/restore directories must be private `0700`, their files private `0600`. No input/output paths may overlap or contain symlinks. The tool will not overwrite any existing destination.

```sh
S=stellar/scf-starforge-20261009
# Start with an actual private existing SF98 outbox produced by the original service.
node "$S/sf101-merchant-outbox-continuity/cli.mjs" backup \
  /private/merchant/sf98-outbox /private/merchant/backups/outbox-20261011-01
node "$S/sf101-merchant-outbox-continuity/cli.mjs" verify \
  /private/merchant/backups/outbox-20261011-01
node "$S/sf101-merchant-outbox-continuity/cli.mjs" compare \
  /private/merchant/backups/outbox-20261011-01 /private/merchant/sf98-outbox

# After independent owner review and stopping the ORIGINAL seller and outbox drain:
# paste the exact sourceFingerprint from a trusted, earlier backup receipt.
node "$S/sf101-merchant-outbox-continuity/cli.mjs" restore \
  /private/merchant/backups/outbox-20261011-01 \
  /private/merchant/RESTORED-NEW-EMPTY-DIRECTORY \
  --expected-fingerprint ORIGINAL_BACKUP_64_HEX_SOURCE_FINGERPRINT
```

The backup copies the two original journals to a **new** private directory and writes `manifest.json` last. It includes SHA-256 for each file and their byte lengths, a pairwise fingerprint, event/delivery counts, current native states and capture time. The input is read twice, then checked again after copying; a changing source fails rather than presenting a silently inconsistent snapshot. When a busy seller writes continuously, take a maintenance snapshot after existing writers quiesce; SF101 never obtains or deletes the original single-writer lock.

The tool imports the original `sf98-merchant-delivery/outbox.mjs` and calls its actual `openOutbox().rows()` and `status()` on the freshly copied snapshot and restored directory. It also checks event identity, receipt fingerprints, payment atomic strings, journal framing, file modes and orphan delivery status rows. This catches a backup that has valid file hashes but is unusable to the original merchant implementation. The original loader's treatment of same-ID byte-identical duplicate events is retained, and the pairwise manifest makes byte-level differences visible even when native status counts match.

**Restore is deliberately create-only.** A restored directory is not automatically pointed at a live service. It requires a trusted previously recorded 64-hex `sourceFingerprint`; matching an archived checksum does **not** establish it is the latest live state. Inspect `compare` first, stop the original seller and delivery worker, reconcile any post-backup settlements/delivery attempts with authoritative original records, then perform a manual operator cutover. If `compare` shows new events, missing events, changed event bodies or changed delivery states, do not replace live state with the older copy and lose paid events. The command will never destroy an existing live outbox. Restore does not mark undelivered events as delivered or unlock a webhook receiver.

`compare` returns summary counts only, not raw payment identifiers, order IDs or customer data: byte identity, events present only in the live directory, events missing from the live directory, and existing event/delivery state drift. For security, protect archived private outboxes like the original journals and store a fingerprint outside the archive for tamper detection. Unkeyed SHA-256 does not authenticate an archive if an attacker can rewrite both journals and manifest. The tool does not encrypt or export backups off-host; use the operator's approved encrypted backup system for that.

## Native focused exercise

The source was exercised in cloud Linux Node 22 with the **verbatim original** `sf98-merchant-delivery/outbox.mjs` Git blob `86193deae14aff384910b6c435f4f972198820a6`, confirmed with `git hash-object` before the run. Original `openOutbox().record()`, original delivery-state writes and original `openOutbox().rows()/status()` were invoked. Backup, verify, live drift compare and restore all passed, including one newly appended event, a changed delivery status, wrong expected fingerprint, existing-destination protection and corrupted backup rejection. This is a single focused native-journal I/O acceptance, not a fake facilitator, payment network or competition simulation. No separate test suite or hosted CI is added. For a real merchant rollout, use the existing original SF98 post-settlement flow and private operator backup procedure.

This is additive source that complements original SF30 seller, SF98 webhook sender/receiver, SF86 independent chain verification, SF97 merchant economics and the separate merchant accounting lane. The original source files remain unchanged.
