# Original Request Collections recovery through MCP

The native MCP buyer can operate the existing Request Collections recovery service and receive its complete encrypted backup. It keeps the original SF88 collection, inbox, request IDs, attempts, results and SF101 recovery operation. The browser and agent read the same journal.

The installed commands are `starforge mcp-native`, `starforge buyer-collections-workspace` and `starforge mcp-collection-recovery-download`. The source-owned contribution is `collection-recovery-agent`; inspect it with `starforge registrations --source collection-recovery-agent`.

## Host setup

Start or reuse the original collection listener. Its existing `--startup-format json` output is the private connection description. Save that exact one-line JSON with owner-only permissions. The MCP adapter reads its original schema, directory, inbox, PID and private listener URL; it does not start or stop that listener.

For receiving, use the existing separate recovery journal:

```sh
starforge buyer-collections-workspace \
  --receiving-directory /private/receiving-journal \
  --port 0 --startup-format json
```

Keep the receiving journal outside the original restoration target. The native MCP directory and its existing SF88 buyer workspace must also remain outside that target. Opening the existing native MCP buyer opens its original buyer; this adapter does not turn an absent buyer into a new walletless recovery host. Use an independently retained existing native buyer for restoration.

The host places the backup passphrase in the original collection listener's environment. Profiles carry only the environment variable name, never its value. SF101 requires its existing uppercase variable-name format and passphrase policy. Recovery calls do not load signing custody or approve payments.

Write a private capture profile using actual absolute original paths:

```json
{
  "schema": "stellar-forge.mcp-native-collection-recovery-profile.v1",
  "label": "Original monthly collection",
  "stateRoot": "/private/original-customer-state",
  "bundle": "/private/customer-backups/monthly",
  "passEnv": "SF88_BACKUP_PASSPHRASE",
  "python": "/usr/bin/python3",
  "kinds": ["SNAPSHOT", "VERIFY"]
}
```

A receiving profile names the same original restoration root and the received encrypted bundle. Its optional `afterRestore` object uses the existing collection registration contract:

```json
{
  "schema": "stellar-forge.mcp-native-collection-recovery-profile.v1",
  "label": "Receive original monthly collection",
  "stateRoot": "/private/original-customer-state",
  "bundle": "/private/received-monthly",
  "passEnv": "SF88_BACKUP_PASSPHRASE",
  "python": "/usr/bin/python3",
  "kinds": ["VERIFY", "RESTORE"],
  "afterRestore": {
    "name": "monthly_restored",
    "sources": {
      "monthly": "/private/original-customer-state/inputs/monthly.json"
    },
    "buyers": {
      "primary": "/private/original-customer-state/buyer"
    }
  }
}
```

Those source and buyer paths are host-selected existing inputs. Use the original descriptions and the actual restored layout. The adapter does not invent request bodies or reconnect a different operator.

Register each original listener with a private description:

```json
{
  "name": "monthly_receiver",
  "connectionFile": "/private/receiving-listener.json",
  "profiles": {
    "monthly": "/private/monthly-receiving-profile.json"
  }
}
```

```sh
starforge mcp-native collections-recovery-register \
  --dir /private/existing-native-mcp \
  --description /private/monthly-recovery-registration.json
```

Registration retains the exact profile bytes and SHA-256 alongside the original recovery header identity. An alias is immutable. A deliberate profile change receives a new alias; it cannot reinterpret earlier operation IDs. Source and receiving profiles use separate registered listeners.

The listener must expose the current authenticated recovery API and `GET /api/connection`. That route returns the current original launch object after a restore is opened, including its actual process identity. It is consumed privately and is not returned in model-visible tool results.

## Agent operations

Use the existing `sf43_discover_review_and_pay` tool with this action:

```json
{
  "action": "collection-recovery",
  "recoveryWorkspace": "monthly_receiver",
  "recoveryOperation": "profiles",
  "recoveryRequest": {"offset": 0, "limit": 25}
}
```

Results use `stellar-forge.mcp-native-collection-recovery.v1`. Workspace-specific results are `{schema, workspace, operation, value}`; `workspaces` returns its page directly. Preserve the exact profile SHA returned by `profiles`.

| Operation | Original behavior |
| --- | --- |
| `workspaces` | Page host registrations without starting a service. |
| `profiles` | Page exact retained profile names, hashes and allowed kinds. |
| `history` | Page the original recovery journal; offline results explicitly contain only previously retained terminal outcomes. |
| `review` | Read original capture selection and its review hash. |
| `start` | Start the original snapshot, verification or restore with an explicit UUID. |
| `inspect` | Read that original UUID and its durable result. |
| `cancel` | Ask the original journal to cancel the selected operation. |
| `resume` | Explicitly resume the same unfinished original operation. |
| `open` | Open an already successful original restore and optionally register its original collection. |
| `files` | Page exact encrypted manifest/member names, lengths and hashes. |
| `file` | Read a verified range from an exact encrypted member. |

The input schema declares each operation's required fields. Paths, environment values and new source definitions cannot be provided through an agent operation. Pages accept `offset` and `limit` up to 100; inspect/review collection lists expose their own next offset. The existing `collections` action remains the full operator for the restored collection.

### Capture

Call `review` with `profile` and `expectedProfileSha256`. Then use `start` with:

```json
{
  "profile": "monthly",
  "expectedProfileSha256": "PROFILE_SHA256",
  "requestId": "ORIGINAL_UUID",
  "kind": "SNAPSHOT",
  "expectedReviewSha256": "ORIGINAL_REVIEW_SHA256",
  "quiesced": true
}
```

Replace the placeholders with the actual returned hashes and a stable UUID. `quiesced:true` is the explicit source-owner assertion required by the original snapshot engine; it does not itself pause someone else's work. Original collection/inbox locks and the complete original source review still govern capture.

After a lost reply, inspect that UUID. Repeating `start` with the same reviewed selection reconciles it. Do not generate a new UUID merely because the HTTP response was lost.

### Verify and restore

On the receiving listener, start `VERIFY` with the receiving profile, its SHA and one original UUID. An optional `expectedRecordSha256` pins a previously selected record. The native result authenticates the bundle and reports the original record hash.

Start `RESTORE` with a different explicit operation UUID, that exact record hash and `verifiedRequestId` naming the completed verification in the same original journal. The profile must match both operations. Original restoration allows only its absent or empty target at the exact original root. A populated target remains an error; this adapter does not erase, relocate or substitute it.

Cancellation and explicit resume use the original UUID. Terminal outcomes remain terminal. If the listener is unavailable while only a request is retained, inspection reports `LIVE_STATE_UNOBSERVED`; an unavailable HTTP observation is not reported as a completed, failed or cancelled operation.

### Open and continue the same collection

Call `open` with the successful restore UUID and its exact record hash. A verification alone cannot open or create a collection. The adapter checks the successful native restore, actual reopened header/inbox, original collection manifests and current listener launch.

The actual connection object is retained privately. If `afterRestore` is present, the original collection registration runs against that connection and the selected source/buyer aliases. A registration failure is returned separately from the successful Open; retry the same Open to finish registration. Restoration and queued requests are not repeated.

To obtain the private retained connection filename for manual host registration:

```sh
starforge mcp-native collections-recovery-opened \
  --dir /private/existing-native-mcp \
  --name monthly_receiver --request-id ORIGINAL_RESTORE_UUID
```

The command reports the private filename and its hash, not the listener token. Continue with the existing `collections` action and registered collection alias. Original queued/cancelled states, attempts, consent, execution and export rules remain in that original adapter.

## Complete encrypted receiving

The receiver uses the existing retained-download engine: one private directory, its native lease, durable partial prefixes, exact manifest selection, full-file SHA-256 checks and offline reopening. It downloads `manifest.json` and every original `objects/NNNNNN.gcm` file.

```sh
starforge mcp-collection-recovery-download inspect \
  --url ORIGINAL_MCP_ENDPOINT --token-env MCP_ACCESS_TOKEN \
  --workspace monthly_source --profile monthly \
  --profile-sha256 PROFILE_SHA256 --request-id ORIGINAL_SNAPSHOT_UUID \
  --record-sha256 ORIGINAL_RECORD_SHA256

starforge mcp-collection-recovery-download download \
  --url ORIGINAL_MCP_ENDPOINT --token-env MCP_ACCESS_TOKEN \
  --workspace monthly_source --profile monthly \
  --profile-sha256 PROFILE_SHA256 --request-id ORIGINAL_SNAPSHOT_UUID \
  --record-sha256 ORIGINAL_RECORD_SHA256 \
  --dir /private/received-monthly --manifest-sha256 ORIGINAL_MANIFEST_SHA256
```

`inspect` returns the original encrypted manifest SHA. Pass it explicitly to `download`. An interrupted receive resumes the same selected directory and original source identity. The endpoint identity also binds workspace/profile/profile SHA/original UUID/record SHA, so a changed selection cannot inherit another download's checkpoint.

Reopen the completed received bytes without a live server:

```sh
starforge mcp-collection-recovery-download reopen \
  --workspace monthly_source --profile monthly \
  --profile-sha256 PROFILE_SHA256 --request-id ORIGINAL_SNAPSHOT_UUID \
  --record-sha256 ORIGINAL_RECORD_SHA256 \
  --dir /private/received-monthly --manifest-sha256 ORIGINAL_MANIFEST_SHA256
```

This verifies complete encrypted member bytes and their original metadata. Native SF101 verification later authenticates and decrypts them with the host's passphrase. A completed download is not a restore or a payment result. SF101 selects only its original manifest and encrypted members; the receiving engine's separate `download-state` directory is not an input to restoration.

Large original manifests use the maintained range transport with host-declared byte limits, up to 32 MiB in this adapter; the original SF101 parser retains its own source-defined bound. The general download engine's existing 65,000-byte defaults remain unchanged for other adapters. File chunks are at most 65,536 bytes. No full backup or plaintext keys are returned in one tool result.

## SDK

Package exports are `./buyer/mcp/collection-recovery` and `./buyer/mcp/collection-recovery-download`.

The control adapter exports `createNativeCollectionRecovery({manifest, registerCollections, isClosed})`. Existing native workspace construction provides these original collaborators.

The receiver exports `openNativeCollectionRecoveryClient`, `inspectNativeCollectionRecovery`, `downloadNativeCollectionRecovery` and `reopenNativeCollectionRecovery`. Their selection fields are `recoveryWorkspace`, `profile`, `profileSha256`, `requestId` and `recordSha256`; downloads/reopen also require `expectedManifestSha256` and `directory`. Online calls accept the existing MCP URL/token-environment or one original client, plus the existing cancellation signal and progress callback.

No archive format, queue, signer, payment decision, restoration policy or managed application is reimplemented here. The added host metadata retains original profile and terminal-result identities so the same original work can be found after a listener restart.


## Standalone collection and receiving MCP host

The original SF88 buyer validates its exact directory and config/ledger child paths. A backup's relocated buyer copy is not an independently relocated buyer. The standalone host composes the same original collection and recovery engines without selecting a second buyer, discovery origin, signer or generic purchase broker.

Use a private MCP directory outside every selected restore target. Keep the original receiving listener running through its normal Applications/CLI owner, and retain its exact private launch JSON and recovery profile as described above.

```bash
starforge mcp-collection-receiver init --dir /private/collection-mcp
starforge mcp-collection-receiver register --dir /private/collection-mcp --description /private/recovery-registration.json
starforge mcp-collection-receiver serve --dir /private/collection-mcp --port 0
```

The host uses the existing MCP_ACCESS_TOKEN or MCP_OAUTH_CONFIG and prints its actual loopback MCP URL. It exposes only the original sf43_discover_review_and_pay tool with collections and collection-recovery actions. The existing encrypted receiving SDK and mcp-collection-recovery-download CLI work unchanged against that URL.

After the original successful restoration, recoveryOperation:"open" can register the profile's afterRestore collection alias. Its sources and buyers are explicit original paths; an omitted buyers map is empty in the standalone host. Register a restored buyer only at its original directory. Subsequent collection authoring, saved results and native execution go through the separately owned original collection listener and its normal approval lifecycle.

Host-only commands also provide inspect, call --input, collections-register --description and opened --name --request-id. They use the same saved registrations and original operation identities as MCP. No model-facing tool accepts a filesystem path or passphrase value.

Closing this MCP host ends its own HTTP requests, authenticators and readers. An incomplete admitted HTTP body is closed before drain. The original collection listener and its retained recovery operations remain with their original owner; shutdown does not restart, repeat or automatically cancel them. After reopening, inspect the same original UUID.

The separate native receiver manifest is stellar-forge.mcp-native-collection-receiver-workspace.v1. Normal native buyer workspaces retain their existing buyer-outside-restore-target rule; the standalone manifest has no buyer binding to substitute or rewrite.
