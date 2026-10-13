# Managed configuration editions

Open **Managed releases → Configuration files and editions** in the original Runtime workspace. Select a registered managed home, refresh its files, and open a relative file. The editor uses the home's existing `config/` directory and the original managed operation worker and home lock.

## Work across several files

Each file has a separate entered draft in the current browser window. Editing one file and opening another keeps both complete drafts, their original reviewed file digests and any submitted requests. **Entered files in this window** reopens them. Reopening the same browser window and Runtime server restores that shelf. **Download entered drafts** exports every retained file, original comparison, pending request and earlier failed request. Keep that private file with the corresponding host configuration.

The old single-file browser draft is received once into its individual file entry. The new entry retains the exact original legacy record before the unchanged old slot is retired; a changed old slot is preserved for its own receiving. Browser storage failure is reported while the visible entered text remains available. Closing a browser window can remove its session storage; download entered drafts before moving to another window or host.

**Compare with current file** reads the actual native file and displays both complete texts and the changed line span. It leaves the entered draft and its reviewed digest unchanged. A native edit made since the draft was opened makes the original save fail its digest comparison.

## Save and recover the original request

**Save reviewed configuration** first retains the exact submitted request and its UUID in that file's draft, then sends it to the existing `/api/operation`. The draft remains until the original worker reports `SUCCEEDED`. **Continue original request** reopens that exact request and reads its actual current operation status. **Recover original worker** invokes the maintained managed recovery endpoint under its original lease.

When the native worker is authoritatively `FAILED` and inactive, **Keep failed request and review current file** retains the entire failed request and actual outcome beside the entered draft, reads the current file as its new comparison, and displays the difference. A subsequent save receives a new UUID. An uncertain or running operation remains with its original request.

## Complete history and restoration

Before replacing a file, the original writer durably retains an immutable intent containing:

- Original home, relative path, operation UUID, exact request binding and capture time.
- Complete original bytes and intended replacement bytes, their byte counts and SHA-256 digests.
- Exact UTF-8 text when the original is decodable, including a leading byte-order mark.
- Explicit file absence for creation or for restoration of a previously absent file.

After the original atomic save, a separate immutable result binds that intent. A crash after the intent or after the native file replacement reopens the same original operation. Replaying an accepted operation returns its retained result and leaves later native edits intact. A recovered legacy request whose target was already written retains those actual bytes and explicitly records that its earlier requested content was unavailable.

**Read saved editions** pages all retained configuration operations for the chosen file. Open an edition to inspect full before/after contents. **Restore before bytes**, **Restore after bytes** or **Restore … file absence** creates a new `managed-config-restore` operation. It uses the exact historical source and the current native digest observed when that edition was opened. The original worker and home lock perform the change and retain another complete edition. Restore never changes an older record. A file with an entered draft must be saved or explicitly discarded before its historical edition is restored.

Configuration content retains the existing 20,000-byte editing bound and JSON syntax validation. Files that require a native editor remain listed. Undecodable originals are still retained and exported byte-for-byte. Restoration through this text editor requires UTF-8 text. File absence can be restored only from an actual retained absent edition.

## Headless access

```sh
starforge runtime-workspace managed-config-history \
  --workspace /srv/starforge/operator --home-id HOME_ID \
  --path merchant-01/seller.json --limit 40

starforge runtime-workspace managed-config-history \
  --workspace /srv/starforge/operator --home-id HOME_ID \
  --operation-id ORIGINAL_OPERATION_UUID

starforge runtime-workspace managed-config-export \
  --workspace /srv/starforge/operator --home-id HOME_ID \
  --path merchant-01/seller.json --output /srv/private/configuration-history.jsonl
```

The export is create-only and streams every complete edition in its captured original roster. Its header retains every selected operation/intent digest, so concurrent new saves do not shift the exported selection. Its final `managed-configuration-export-complete.v1` line carries the edition count. An interrupted file retains its written prefix and lacks that final completion record; select a new output path when repeating an export. Browser **Download complete file history** supplies the same complete JSONL shape.

Use the existing `managed-operation --request PRIVATE_JSON` with a new request UUID:

```json
{
  "requestId": "NEW_UUID",
  "operation": "managed-config-restore",
  "homeId": "ORIGINAL_HOME_ID",
  "path": "merchant-01/seller.json",
  "historyOperationId": "ORIGINAL_OPERATION_UUID",
  "version": "before",
  "expectedSha256": "CURRENT_NATIVE_FILE_SHA256"
}
```

Use `expectedSha256: null` only when the currently reviewed file is absent. Values shown above are placeholders; actual UUIDs/digests come from the same original workspace.

Programmatic consumers use `model.managedConfigurationHistory({homeId,path,operationId,cursor,limit})`. A page returns `entries` and `nextCursor`; specifying `operationId` returns the complete validated intent/result. The authenticated read route is `GET /api/managed/config-history` with those same fields.

## Original backup and receiving

Records live under `managed-configuration-history/HOME_ID/OPERATION_UUID/` in the original Runtime workspace. Its complete backup includes those original bytes and receipts. The actual managed home's live `config/` directory remains an external binding covered by its original backup procedure. A new-host workspace receive retains history for reading/export; mutating a managed home still requires the original current-host review and registration. Configuration history never treats an imported path as a current writable host.

## Native operator continuation

The existing Runtime receiver can import `receiving/MANAGED_CONFIGURATION_RECEIVE.mjs` and call `receiveManagedConfiguration({page,model,outputDirectory,homeId,paths})` at its original saved boundary. Supply exactly two existing small UTF-8 configuration files in that receiver's isolated managed home. The course adds harmless trailing whitespace, operates the actual browser draft/save/history/restore/export flow, and returns both original files to their exact starting bytes through ordinary historical restoration. It retains all created native operations and original source identities.

The receiving operator must open and LOOK at its exact desktop and narrow screens, exercise the controls, inspect the downloaded original drafts/history, and reopen the same workspace. View the retained screenshots; screenshots alone do not replace observation. Follow the repository's full `AGENTS.md` and `docs/policies/rendered-product-inspection-policy.md`, including all attachments. Use the original receiver's complete workspace backup/reopen course with the returned history paths. No new server, background watcher, test suite or Actions run is required.
