# Merchant order recovery

Capture the original SF101 merchant database together with every enrolled paid file, inspect the saved snapshot, and restore the complete order state into a new private directory. The same snapshot contains the existing orders and events, access policy and token hashes, purchased API allowance and reservation tables, retained results, and every other table present in the original database.

The snapshot is an operating copy. It preserves the original payment and usage identities, including unfinished reservations. The existing API-access application resumes those retained operations through its own recovery controls.

## Installed commands

The maintained Starforge package includes this entire source component. Use Node 22+ and Python 3.11+ on the merchant host.

```sh
starforge merchant-order-recovery snapshot \
  --state /private/merchant \
  --out /private/snapshots/merchant-001

starforge merchant-order-recovery inspect \
  --snapshot /private/snapshots/merchant-001

starforge merchant-order-recovery restore \
  --snapshot /private/snapshots/merchant-001 \
  --out /private/restored-merchant
```

Choose an existing private merchant state directory and new output directories. Keep the snapshot and restore destinations separate from the source. The snapshot and restore commands create their own private outputs exclusively. Add `--python /absolute/path/to/python3` to select an installed interpreter, or set `STARFORGE_PYTHON` in the process environment. The launcher suppresses Python bytecode cache writes and passes paths as separate process arguments.

Source checkout equivalents:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/recovery/cli.mjs --help
python3 -B stellar/scf-starforge-20261009/sf101-merchant-receiver/recovery/cli.py inspect \
  --snapshot /private/snapshots/merchant-001
```

## What is captured and restored

`merchant_snapshot.py` uses a consistent SQLite backup of the original `merchant.sqlite3`. It reads the order bindings from that captured database and includes each approved paid file with its original SHA-256 and byte count. A file whose current bytes disagree with its enrolled binding cannot become part of a valid capture.

Each snapshot contains:

| Path | Contents |
| --- | --- |
| `snapshot.json` | Snapshot schema, capture time, original state-path digest, database digest and size, and each original order-to-file binding. |
| `merchant.sqlite3` | Consistent original database, including all existing order, event, access, allowance, usage and result tables. |
| `assets/*.bin` | The original enrolled file bytes retained by the snapshot. |

Restoration verifies the retained database and paid-file bindings before reopening the new merchant state. It rebases `orders.file_path` to the restored files, so original checkout inspection and authenticated delivery can resolve their source after the old host directory is absent. The order references, event identities, token hashes, payment terms, access decisions and reservation states remain in the same original tables.

Point the original receiver, purchased API application, and their operator view at the returned `state` directory. Use their original configuration and separately managed runtime credentials. A merchant snapshot covers the selected database and its enrolled files; configuration, delivery outbox, catalog, external application data and other required operating roots belong in the merchant's explicit broader recovery plan.

## Reopen the original merchant applications

The database and enrolled files form the portable state needed by the original receiver and API allowance core. The actual `api-access/pass_store.py` stores plans, reservations, reconciliation actions, execution-owner hashes and exact response bytes in that same database. Its plan records contain no additional source paths. Existing `IN_FLIGHT` and `RECOVERY_REQUIRED` calls retain their reservations; `COMPLETED` and `CONSUMED` retain their consumed units; `RELEASED` retains its released outcome. The original API application interprets deadlines and serves retained results under its current token and access checks.

The host's wider recovery plan also retains these original operating roots:

| Original host state | Reopening action |
| --- | --- |
| Checkout configuration | Point its `state` and `outbox` at the selected restored directories and select the installed Python runtime. Keep the purchased route and payment terms associated with the original service. |
| SF98 delivery outbox | Reopen the retained native journal through its existing sender lifecycle. |
| Desk `desk.json` and desk exports | Select the retained configuration and output locations, or create a new desk descriptor using the original command below. |
| Approved product directory | Keep a separate private directory for files the merchant will enroll in future orders. |
| API gateway and backend configuration/data | Reopen the original application against the restored merchant state and its retained backend source and data. |
| Private runtime credentials | Restore the existing credential references through their original private custody. |

The desk requires its approved product, output, merchant-state and outbox directories to be separate. The restored `paid-files/` directory belongs inside the restored merchant state and serves existing enrolled orders. Choose a separate `filesRoot` for future enrollment, and an output directory outside the restored state.

After preparing the restored checkout configuration and the separate product directory, the original desk command creates its new private descriptor and exports directory:

```sh
starforge merchant-desk init \
  --dir /private/restored-desk \
  --config /private/checkout-restored.json \
  --files /private/products \
  --claim-env SF101_CLAIM_TOKEN \
  --actor merchant-operator
starforge merchant-desk start --workspace /private/restored-desk
```

The manifest's `sourceStateDigest` is the SHA-256 of the original normalized absolute merchant-state path. The desk uses it to reopen its own named snapshot receipt. The restore command accepts the complete snapshot after that original path is absent and returns the new state path.

## Command receipts and interrupted commands

Successful commands write one JSON receipt to stdout and exit zero. `snapshot` returns `schema`, `snapshot`, `manifestSha256`, `databaseSha256`, `orders`, and `uniquePaidFiles`. `inspect` returns the verified `manifest` and its `manifestSha256`; its manifest contains the database path, SHA-256 and size plus the order/file bindings. `restore` returns `schema`, the new `state`, `snapshotManifestSha256`, `orders`, and `restoredAt`.

The Python command reports source validation, filesystem and SQLite errors on stderr with exit code 2. Argument errors use the same exit code. Interrupts are forwarded to this command's own child process. If a terminal loses the final snapshot reply, run `inspect` on that chosen snapshot directory to recover its current result. Restore outputs are create-only; retain the returned state path and operate it through the original receiver.

Unfinished API operations retain their current state after restoration. Use the application's retained operation and result reconciliation controls before an additional execution. This keeps the original quota reservation attached to the same attempted work.

## Encrypt with the existing merchant recovery engine

The installed `starforge merchant-recovery` command runs the maintained [SF101 encrypted merchant recovery](../../sf101-merchant-recovery/README.md). Supply the completed, immutable snapshot as an original recovery-plan root. Keep the passphrase in private environment storage and retain it separately from the encrypted bundle.

Example private plan at `/private/recovery-plan.json`:

```json
{
  "schema": "stellar-forge.merchant-recovery-plan.v1",
  "roots": [
    {"name": "merchantOrders", "path": "/private/snapshots/merchant-001"}
  ]
}
```

```sh
starforge merchant-recovery snapshot \
  --plan /private/recovery-plan.json \
  --out /private/backups/merchant-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE --quiesced

starforge merchant-recovery verify \
  --bundle /private/backups/merchant-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE

starforge merchant-recovery restore \
  --bundle /private/backups/merchant-001 \
  --out /private/decrypted-merchant-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

The completed snapshot root is quiescent. Any additional original merchant roots in this plan must follow their own coordinated writer shutdown before the encrypted snapshot command. The original engine handles authenticated encryption, verification and new-destination extraction.

After extraction, locate the returned `merchantOrders` logical root and pass that restored snapshot directory to `merchant-order-recovery inspect`, then `restore --out /private/restored-merchant`. The second operation installs the original merchant database and rebinds its paid-file paths to their actual restored location.

The existing encrypted engine accepts up to 20 roots, 10,000 entries and 4 GiB total plaintext, with a 2 GiB per-file maximum. Its operating guide describes the complete plan, passphrase and storage contract.

## Python integration

The command delegates directly to these functions in `merchant_snapshot.py`:

```python
created = create_snapshot(state, destination)
checked = inspect_snapshot(snapshot)
restored = restore_snapshot(snapshot, destination)
```

An operator integration can call those functions in its existing trusted Python process and return the same receipts. Their `ValueError`, `OSError` and `sqlite3.Error` outcomes identify a failed native operation. The CLI adds argument handling and process integration; SQLite capture, file verification and restoration remain implemented by the original module.
