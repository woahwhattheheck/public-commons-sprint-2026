# Encrypted Object backups in the recovery workspace

The recovery workspace carries a complete existing encrypted Object backup to another declared host. It keeps the original record, session, saved request and native verification together. Export and receive authenticate with the existing ObjectSessionRecovery SDK. Inspection checks the full archive and inventory without decrypting it. These actions never create a new Object session, obtain data, spend funds, create a new snapshot, or restore the source state.

## Configure the original host

Use the existing private recovery workspace configuration and its original profile. Keep `passEnv` as the name of an environment variable available only to the trusted host. Do not put its value in JSON, URLs, a case, or a handover.

Each existing `objectSessions` declaration selects the original canonical `directory` and `stateRoot`, full include selection, native `sessionId`, encrypted `bundle` location, and permitted original recovery kinds. The receiving declaration uses the original native session identity and canonical source paths even when that source is absent. Its `bundle` is the absent receiving destination for ciphertext; receiving does not populate `stateRoot`.

Add trusted archive inputs beneath that profile's existing `downloadRoot`:

```json
{
  "objectBundleArchives": [
    {
      "id": "received-backup",
      "label": "Original Object backup from Support",
      "path": "/private/recovery-downloads/original-object-backup.tar",
      "sha256": "REPLACE_WITH_THE_COMPLETE_ARCHIVE_SHA256"
    }
  ]
}
```

The SHA-256 must be the actual 64-character lowercase archive digest. Profiles permit at most 32 declarations. Archives cannot overlap source state, encrypted destinations, workspace controls or operation stores. A changed trusted configuration requires reopening the host through its existing configuration checks.

A browser, MCP client or CLI caller selects declaration IDs. It cannot supply an arbitrary source path, executable, passphrase, receiving destination or native session identity.

## Export a retained recovery request

In **Encrypted Object backup transfer**, select **Export existing encrypted backup**, a stable operation ID and an existing original Object recovery request. The source selection binds its exact request ID, prepared review hash and attempt count. It must contain an originally verified record or clean completed snapshot evidence.

Prepare the review, inspect the exact record/session/source selection, then confirm and start it. The workspace freezes the original complete request and every referenced immutable evidence body before publishing the outer review. If preparation is interrupted, reopen the same operation with the same input. It resumes from those retained bytes even if later work advanced the source request.

The original queue records the request before dispatch. Export authenticates the whole existing encrypted bundle, writes a standard uncompressed USTAR archive containing every selected member, and retains the complete native verification output. A clean published result is separate from a failed native process or cleanup result.

For CLI or MCP review/start, the selection is:

```json
{
  "profileId": "original",
  "action": "object-bundle-export",
  "id": "object-export-001",
  "sourceRequestId": "original-object-verify",
  "sourceReviewHash": "REPLACE_WITH_THE_ORIGINAL_REVIEW_SHA256",
  "sourceAttempt": 1
}
```

Use the existing `review` and `start` commands with this complete selection. Start requires the returned exact review hash. Reusing a completed request returns its original outcome; an interrupted request requires the existing explicit `resume` with its expected review hash and current attempt number.

## Inspect and independently receive

Move the complete archive by an authorized file transfer, verify its exact byte length and SHA-256, then register its path/digest on the receiving host. The browser's **Inspect archive** or CLI `bundle-inspection --profile PROFILE --archive ARCHIVE_ID` validates the complete archive structure and member inventory. Its result explicitly says `authenticated: false`; structural integrity alone is not native decryption/authentication.

Select **Receive declared archive**, the archive ID, the receiving Object declaration and a stable operation ID. Review shows the actual record and full native identity found in the archive. Confirm only the displayed selection.

```json
{
  "profileId": "receiver",
  "action": "object-bundle-receive",
  "id": "object-receive-001",
  "archiveId": "received-backup",
  "objectSessionId": "original-session"
}
```

Receive uses the original SDK to authenticate every native member and verify the exact original record/session binding. It publishes only to an absent destination, using a no-replace operation. An interrupted publication reopens only a destination carrying the original ownership receipt and exact retained files. An unrelated existing directory is never adopted. Complete and failed native results are retained verbatim.

Receiving ciphertext authenticates the original record and session; it does not accept the archive’s canonical state root for restoration or restore Object state. Canonical state-root acceptance occurs in the original separate Object restore review. If restoration is needed, prepare and confirm the original separate Object restore action. It retains the engine's canonical-state-root and same-record later-state preservation rules.

## Open results, continue, and download

Use the original request list and explicit continuation controls. Closing the workspace drains review, publication, owned native work and binary downloads before releasing its writer. A fresh review and a retained request outcome are different observations.

Useful commands are:

```text
bundle-report --profile PROFILE --id OPERATION --kind report
bundle-report --profile PROFILE --id OPERATION --kind verification
bundle-report --profile PROFILE --id OPERATION --kind publication
bundle-artifact --profile PROFILE --id EXPORT_OPERATION
```

Only present evidence kinds can be read. Interrupted native identity or publication failures retain their full evidence references; they are not reported as clean completions.

The browser streams the whole archive into a user-selected file when its file-system writer API is available. The original binary delivery handler checks complete bytes and SHA-256 before completing the stream. Browsers without that API show the retained native archive path and full identity for the existing authorized file-transfer route. No multi-gigabyte archive is buffered in a browser JSON response.

An embedded HTTP host must call the returned recovery handler's `close()`, then close the workspace using its original lifecycle. The standalone server already drains both. Keep existing loopback/origin/token protections; no private token is placed in a download URL.

## Attach actual bytes to an existing Support case

An exported archive is independently usable for standalone free Object recovery. A Support case's three-file recovery capture continues to label encrypted custody as external until an actual source-delivery attachment exists.

For a saved Support transfer with real commissioning terms, select that original transfer, the exported operation, the current exact case revision and the actor. Read the original saved transfer and confirm the selected attachment. The producer binds the archive's original source request, review, request digest and record to the saved Support transfer before invoking the original SF49 service.

```text
bundle-attach --profile PROFILE --id EXPORT_OPERATION --transfer-id TRANSFER \
  --expected-support-review REVIEW_SHA256 --case-revision REVISION --actor ACTOR
bundle-attachment --profile PROFILE --transfer-id TRANSFER --archive-sha256 ARCHIVE_SHA256
bundle-case-export --profile PROFILE --transfer-id TRANSFER --archive-sha256 ARCHIVE_SHA256
```

The archive is one actual binary source file with its complete byte/hash identity. The original SF49 workorder, upload, preparation and attachment records own all effects and continuations. Missing commissioning terms stop this optional attachment; no terms, entitlement or payment state are invented. Standalone archive receiving remains available.

An uncertain attachment response is reconciled through the original saved attachment request. Once it is saved, later case edits remain intact. Whole-case export selects the **actual attached case revision** and includes the encrypted binary through the existing complete source-package inventory, along with original case/source history. It does not export the earlier pre-attachment revision or mislabel a reference as included ciphertext.

## Limits and retained evidence

The transport's exact bounds and archive format are documented in [RECOVERY_BUNDLES.md](RECOVERY_BUNDLES.md). The original Object engine's cryptographic/member limits remain authoritative. Large inputs are rejected explicitly; they are never truncated.

Source recovery captures remain bounded at 64 MiB for the entire UTF-8 cohort, 2 MiB for its original request and 16 MiB per immutable evidence body. The ciphertext archive is transferred separately with streaming I/O. The whole original request, ordered evidence history and all native failures remain available behind their immutable identities.
