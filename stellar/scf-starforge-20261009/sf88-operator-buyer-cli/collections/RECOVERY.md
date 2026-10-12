# Complete collection backup and receiving

Request Collections uses the existing SF88 workspace recovery and SF101 encrypted storage. The original five-file results export remains a convenient customer index. This operating backup additionally retains the original collection manifests, prepared request bodies and tickets, inbox jobs, permanent attempt IDs, evidence, operator ledgers and operator authentication keys, and any saved response files.

## Use the browser

Open the existing `starforge buyer-collections-workspace --directory /absolute/private/collections` command and select **Backup and receiving**.

1. Enter the canonical private state root that contains the original collections, inbox, native operator workspaces and all selected inputs or delivery paths. Choose a new backup directory outside that root.
2. Set a passphrase environment variable in the server terminal before starting the host. The default name is `SF88_BACKUP_PASSPHRASE`; the value never enters the browser or the retained operation request. The native engine requires at least 16 UTF-8 bytes. Supply the same value on the receiver.
3. Review the actual collections, queued work, permanent attempt IDs, input hashes, saved or missing deliveries, and required installed runtime paths. Stop other writers to the same original inbox and operator workspaces and acknowledge their state. The controller drains its own admitted collection mutations using the original Linux kernel lease.
4. Create the backup. Capture, progress, cancellation and the exact operation ID stay in the pane. The native engine verifies its ledger checkpoints and source files before publishing the encrypted directory. Completed or failed results remain in recovery history after restart.
5. Verify the retained backup directory. Its original record SHA-256 and exact canonical state root identify the receiving selection. The native engine verifies the encrypted contents, original operator bindings, retained collection inputs and request/attempt identities.
6. Restore only where that exact original root is absent or empty. The receiver never overwrites a populated original workspace. Open the restored collections to inspect the same requests, attempts, results and run history. Restore does not start queued work, retry unresolved attempts, load a wallet signer, or make a payment.

A separate receiver can start before any collection store exists:

```sh
starforge buyer-collections-workspace \
  --receiving-directory /absolute/private/receiving-journal \
  --startup-format json
```

Keep this receiving journal outside the original state root and outside the encrypted backup. The startup JSON has schema `stellar-forge.sf88.collection-recovery-workspace-launch.v1`, state `LISTENING`, the retained journal path and private URL. The existing normal Applications launch schema remains unchanged.

The browser can save native encrypted members into a fresh local folder using its directory picker. Large files stream without loading the entire encrypted body into browser memory. On browsers without that API, individual files up to 32 MiB can be downloaded and checked in the tab; retain `manifest.json` at the root and numbered `.gcm` files under `objects/`. The original complete directory remains available on the host. Verify any transferred directory natively before restore; file receiving alone is not a restore.

## Original CLI

The commands are available through the existing `starforge buyer-collections` entrypoint, or by calling `collections/cli.mjs` directly with Node.

```sh
starforge buyer-collections backup-review \
  --directory /absolute/private/state/collections \
  --state-root /absolute/private/state

starforge buyer-collections backup-create \
  --directory /absolute/private/state/collections \
  --state-root /absolute/private/state \
  --out /absolute/private/handoffs/collection-backup \
  --review-sha256 ORIGINAL_REVIEW_SHA256 \
  --request-id ORIGINAL_NEW_UUID --quiesced

starforge buyer-collections backup-verify \
  --receiving-directory /absolute/private/receiving-journal \
  --bundle /absolute/private/handoffs/collection-backup \
  --request-id ORIGINAL_NEW_UUID

starforge buyer-collections backup-restore \
  --receiving-directory /absolute/private/receiving-journal \
  --bundle /absolute/private/handoffs/collection-backup \
  --record-sha256 VERIFIED_ORIGINAL_RECORD_SHA256 \
  --state-root /absolute/private/state \
  --request-id ORIGINAL_NEW_UUID
```

`--pass-env NAME` selects the existing environment variable. `--python /absolute/python3` selects the receiver's existing Python 3.11+ runtime. Keep original code/provider module paths available on the receiving host; they are shown as runtime requirements rather than copied as credential-bearing state.

History and recovery:

```sh
starforge buyer-collections backup-history --receiving-directory /absolute/private/receiving-journal
starforge buyer-collections backup-show --receiving-directory /absolute/private/receiving-journal --request-id ORIGINAL_UUID
starforge buyer-collections backup-resume --receiving-directory /absolute/private/receiving-journal --request-id ORIGINAL_UUID
```

A repeated request ID must carry the identical original selection. A definitive completed, cancelled or failed result stays immutable. After correcting a definitive failure, create a new explicit operation. An unfinished request can resume by its original ID: an already published backup is verified against that ID and source review; an interrupted restore is reconciled against every original file before reopening. No saved after-image overwrites current target data. SIGINT/SIGTERM drain this operation's cancellation and cleanup before closing its journal.

## Retained source and account boundaries

The entire original inbox is included, including requests shared by several collections. Each original request remains bound to its configured native operator; all required operator roots must fit the selected state root. The capture records separate native checkpoints for each operator, validates their original ledger/key binding, and keeps request/config/attempt hashes in the application record.

The same shared root lease is taken by every maintained collection mutation. Independent collections retain their existing per-collection locks and can still operate concurrently. A capture takes an exclusive root lease while the existing native recovery engine locks its operator ledgers. Separate legacy/direct inbox writers must be quiesced by their owner; this browser does not stop another owner's process.

A saved response reference whose file is absent remains an explicit missing original reference. Available saved responses must match their recorded length and SHA-256. The receiver retains that distinction and does not invent completed delivery bytes. Original recovery of an unresolved *request* remains the existing selected `recover` action after reopen; backup recovery never substitutes for it.

## Existing API composition

The existing host keeps its original collection, run, browser approval, result export and received-response endpoints. New authenticated routes are:

| Route | Native action |
| --- | --- |
| `GET /api/recovery` | First retained history page |
| `POST /api/recovery/history` | `{offset,limit}`, maximum 100 |
| `POST /api/recovery/review` | `{stateRoot}`, exact source profile and review SHA |
| `POST /api/recovery/start` | `{requestId,kind,options}` for SNAPSHOT, VERIFY or RESTORE |
| `GET /api/recovery/:requestId` | Exact current/retained result |
| `POST /api/recovery/:requestId/cancel` | Cancel that owned active operation |
| `POST /api/recovery/:requestId/resume` | Reconcile and continue that unfinished request |
| `POST /api/recovery/:requestId/open` | Open the restored original controller in receiver mode |
| `POST /api/recovery/:requestId/files` | Native encrypted member download descriptors |

The operation journal schema is `stellar-forge.sf88.collection-recovery-operation.v1`. The encrypted native application record schema is `stellar-forge.sf88.collection-workspace-recovery.v1`. Neither replaces original inbox or operator accounting.
