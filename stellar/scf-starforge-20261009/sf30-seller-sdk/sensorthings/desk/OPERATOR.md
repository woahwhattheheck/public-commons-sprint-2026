# SensorThings Operations Desk

The Desk operates the existing SensorThings workspace, source queue, immutable editions, SF30 dataset publisher, SF82 release manager and SF88 buyer workspace. It supplies the complete browser workflow and the maintained Merchant Workspace application provider.

The source-owned application kind and installed command are both `sensorthings-desk`. The original CLI, MCP connection and normal source transfer remain usable against the same workspace.

## Start the installed application

Use the complete [SensorThings distribution and setup guide](../DISTRIBUTION.md). The standalone source recipe is `sensorthings-operator`; its full source guide is `distribution/selections/SENSORTHINGS_OPERATOR.md`. In Merchant Workspace, open **Applications**, choose **SensorThings Operations Desk**, and provide the original private workspace directory. Select the source inbox and buyer workspace if this installation will receive source archives or operate customer acquisition.

Review and save the application, review its start operation, then use the maintained **Start**, **Open** and **Stop** controls. The managed provider reads the original workspace UUID without opening another writer. Startup must return the actual Desk instance, source identity and private loopback listener; the provider verifies that listener before retaining its Open link. Existing application environment, port, executable, input, resource and process ownership checks remain in the shared Applications lifecycle.

The command can also run directly:

```sh
starforge sensorthings-desk \
  --workspace /absolute/private/sensorthings \
  --source-inbox /absolute/private/source-inbox \
  --buyer-workspace /absolute/private/original-buyer \
  --port 8768
```

From the selected source tree:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/desk/cli.mjs \
  --workspace /absolute/private/sensorthings \
  --source-inbox /absolute/private/source-inbox \
  --buyer-workspace /absolute/private/original-buyer \
  --port 8768
```

The workspace and inbox are separate private directories. Keep the same workspace path when reopening. The optional `--expected-workspace-id` binds an existing UUID; the managed provider supplies it for an existing workspace. An optional `--release-runtime /absolute/private/runtime.json` reads the host-selected original release runtime object. The original release manager consumes it.

The listener binds `127.0.0.1`. Its startup record contains the private Open URL. Treat that complete record as private application state. The session token remains in the existing workspace and, after Open, in browser memory; the browser removes the token fragment from its visible address. Open from the maintained application again after a browser restart.

**Stop** drains the original listener and workspace. Preserve its saved application, source inbox, workspace, original buyer directory and any native runtime dependencies. A new server must reopen the original state after the prior writer closes.

## The operating sequence

| Section | Complete operation |
| --- | --- |
| Sources & selection | Retain the actual service and license; capture an original catalogue page; select exact source rows and save the provider query. |
| Capture & continuation | Start the saved plan; inspect its original task/page/attempt history; pause, resume and seal the resulting source edition. |
| Editions & review | Inspect source bytes, units, value kinds, distinct time fields and warnings; record a responsible review; compare complete editions. |
| Publish & receive | Prepare the original dataset; query it; prepare and operate its original release; read the actual seller offer and retain a buyer configuration and acquisition limits. |
| Delivery & receiving | Upload or select a complete source archive; verify and import it through the original receiver; download source and customer files. |
| History & recovery | Reopen exact operation IDs and saved results; reconcile an interrupted browser request; keep earlier reviews, source editions and customer history. |
| Analysis & reports | Open the existing analyst interface on this same listener to select scalar or explicit component values, inspect original categorical events, compare editions and publish complete retained reports. |

**Analysis & reports** opens a separate private tab using the existing session. It starts no listener and creates no second store. Reconcile any saved Desk request first. The analysis tab keeps its own original request journal and shared workspace revision checks. After completing work there, refresh this Desk before the next operation.

### 1. Retain the source and review its catalogue

Enter the advertised HTTPS service root, a meaningful label, the original license name and URL, source attribution and the issuer's source record URL. Optional authorization is an **existing host environment-variable name**. The browser does not supply or persist its credential value. Host-selected loopback reference services must be explicitly allowed.

Select an entity collection and enter the original SensorThings query options. The native engine retains the exact service and catalogue responses. The catalogue table links to each original URL and exposes its complete record and source pointer.

Use **Next original page** to follow the retained opaque continuation. It operates the same original provider link. A catalogue page's original count is separate from the number of retained rows.

For Datastreams and MultiDatastreams, select the exact rows to include in the plan. Each selection retains the catalogue ID and RFC 6901 pointer. The browser displays the original unit and observation type without converting them. A MultiDatastream's original component ordering and units remain in its complete entity record.

Save a plan with all selected streams from the same source. Retain the exact time/filter/order expression, page-size request, optional FeatureOfInterest expansion and historical-location choice. Set source-request and byte capacity to cover the intended original query. The original queue reports a capacity limit as a source condition; the Desk does not silently narrow the query.

### 2. Capture, continue and seal

**Start capture** creates a new native capture for the saved plan. **Resume original capture** continues its existing ID. The request budget controls this invocation of the original queue; follow the displayed remaining tasks and retained source outcome.

The journal exposes summary, tasks, complete source pages, issues, and each task's attempts and parents. Later pages retain the first read's workspace revision. If that revision changes while a capture runs, read a new first page or pause the original capture before reviewing the full journal.

An interrupted original request remains attached to its task. Inspect its retained attempt/error before selecting the explicit failed-request retry. Completed original responses are reused. Provider nextLinks are not regenerated from offsets.

Seal the capture after reviewing the actual selected query. A partial edition requires an explicit choice and retained reason. Completed traversal covers that selected query; the provider response sequence does not become an atomic snapshot.

### 3. Review exact editions

Select an immutable edition and inspect its full metadata and summary. The Desk presents row counts, unique identifiers, repeated occurrences and conflicting duplicates. It also exposes original result types, source warning codes, row issues, time kinds and quality states.

Use observations, components or entities to inspect the complete native table. The main table shows useful source columns, and **Open** retains every field in the selected row, including original JSON and provenance. Source text is displayed as text, including exact identifiers, numeric lexemes, categorical strings, null and missing states.

An acceptance is a recorded operator decision about this exact edition. Supply the responsible reviewer, substantive source interpretation, and each displayed warning acknowledgment. The original engine requires every non-notice source warning and original row issue to be reviewed before acceptance. The receiving workspace records its own decision even when an imported archive contains another operator's earlier review.

**Compare complete editions** uses the original domain comparison, including duplicate occurrences and unkeyed source records. Its complete comparison JSON and change rows remain available through the original file reader.

### 4. Publish the reviewed source

Prepare observations, components or entities as the original SF30 dataset. The original engine requires the current local acceptance of the selected edition. Dataset preparation retains source files, the exact row table, native configuration and source receipt.

The local query form passes the original query string directly to the maintained dataset engine. Read the returned native query contract, result and cursor. The Desk does not run a separate query language or recompute native result values.

Prepare a merchant release with the actual public origin, resource path and **complete original payment terms object**. The original seller compiler and publisher validate that object. The release retains the accepted source, dataset snapshot, configured terms and host-selected release runtime.

Inspect the selected release to see its original generation, active selection and listener. Activate, start, stop/drain and rollback use that observed generation. A concurrent change requires reading the new selection before another action. Start applies to the active original release.

### 5. Review and operate the original customer acquisition

The seller must be running before its actual buyer offer is read. Select a retained published snapshot and a first-page query. The original engine returns the offer, query preview and offer hash.

Review the complete offered option before preparing an intent. The prepared configuration binds the original offer SHA, accepted option index, snapshot, query and stable intent ID. Saved buyer configurations have their own exact file identity and can be downloaded.

Create or reopen the original acquisition with explicit maximum pages, total atomic payment, result rows and page bytes. The host-bound original SF88 workspace supplies its actual buyer configuration. A reopened acquisition keeps these retained limits.

Before **Execute original acquisition**, the Desk reads and hashes the complete saved buyer configuration through the original held-file reader. It displays that exact request and its payment terms together with the retained acquisition limits. Execution uses the original buyer session. A later unpaid retry requires the original expected-attempt hash when the native recovery state demands it.

Use the original account/recover controls after an interrupted acquisition. Export completed acquisition files through the native publisher. Complete CSV/JSONL/review and manifest outputs are delivered through their original file selections.

**Inspect or receive original buyer intents** in Delivery uses the host-selected original buyer workspace. The actual native outcome determines whether customer files exist.

## Complete source receiving

### Browser receiving

The host binds `--source-inbox` to a separate private directory. Choose the complete source archive in Delivery. The browser calculates its complete SHA-256, then uploads chunks identified by filename, total byte count, complete SHA and chunk SHA.

The inbox keeps one original transfer record. Reopening the same file returns its committed byte offset. A tail written before its metadata commit is compared with the exact replayed chunk before the cursor advances. Completion verifies the entire file and publishes the actual source filename without replacing a different existing file.

The browser's hashing path accepts files up to 128 MiB. For larger files, use the original installed retained-file receiving command to place the complete archive in the same inbox; then choose **Verify and select**. The backend's explicit maximum source-file capacity is 2 GiB.

**Import original edition** invokes the maintained `edition.import` action with the selected filename, complete bytes and SHA. The original importer verifies the whole declared closure and preserves the source identity and incoming review record. File upload itself does not change the workspace edition or its acceptance.

### Manifest-selected output files

Open source, edition, dataset, comparison, transfer, buyer or publisher files through the original selection contract. Every selected file row contains its native name, bytes and SHA where already materialized. Original generated files obtain their identity from their first retained read.

Text previews read the complete selected file through the native held-file interface and verify its SHA. They are limited to 1 MiB. A generated publisher draft review has no physical identity in its file-list row: Download opens one original held snapshot, retains its first returned byte count and SHA, reads every chunk through the same read ID, verifies the complete browser hash and releases that read. Its native generated-view capacity is 16 MiB; it is never sent to the immutable-file download route with a guessed SHA.

Materialized downloads up to 256 MiB verify the complete browser bytes against the original manifest and the server's actual `X-Source-SHA256` response header. Larger files use the browser's available streaming file writer, original server-held descriptor hash and complete received length, or the installed resumable receiver. The file chooser opens from the initial Download gesture; its writer commits only after native EOF and the exact byte count. A failed or excessive stream aborts that writer.

The original server hashes its retained read-only descriptor before serving bytes. File selection never accepts an arbitrary host path.

## Browser request recovery

Before a mutation is sent, the browser commits its complete native request into IndexedDB: workspace UUID, operation ID, displayed expected revision, action and exact payload. The token is not included. There is one active outgoing request per browser/workspace. IndexedDB atomically compares the saved operation ID across tabs before a request is replaced or cleared.

Native API failures retain the original server error code, message and complete returned error object. A response from a different workspace UUID is rejected before its result or download is consumed.

If a response is lost:

1. Reopen the same private application link and browser profile.
2. Read **Saved request** and inspect its exact payload.
3. Use **Inspect original outcome** to read that original operation ID.
4. A completed operation restores its original saved result; a running operation keeps its current identity.
5. **Replay exact request** invokes the same native request. The engine reopens completed/retained operations before checking the current expected revision.
6. If the operation is positively absent and the workspace has advanced, review the latest state and explicitly rebind that still-unobserved request to the displayed revision.
7. A confirmed failed request can be kept in local history and cleared from the active browser slot. Its original failure remains in workspace history. An ended HTTP validation response can also be cleared after the original operation is positively absent; its full rejected request remains in local history. A transport timeout alone does not establish that outcome.

The browser does not create another operation after an uncertain reply. Saved source selection and payment terms are never altered during replay. When using multiple tabs, the workspace's original request/revision checks remain authoritative; use one active operator tab for each selected workspace.

## Original Hamburg receiving selection

The actual source operation is `SCF_SENSORTHINGS_HAMBURG_NATIVE_1B40_20261012`. Its owner delivered the full original source packet at public source merge `b602d5b5e220f8c9d06b82bcd55decbc9d013e1c`:

- Source folder: `stellar/scf-starforge-20261009/operations/sensorthings-hamburg-native-20261012`.
- Native recording: `native-recording.json`,2,965,230 bytes.
- Recording SHA-256: `34fb0322092a51525e94beda0d6c3b21548b7261d65d80909b27eb6fa6a2d466`.
- Original native recording contains 28 selected responses. All 29 original bodies and full connector receipts remain in the complete source package.
- Fixed query window: `2026-09-14T00:00:00Z <= phenomenonTime < 2026-10-12T10:31:58Z`.
- Both original seven-page captures contain 660 unique observation records. All 660 selected observation records are unchanged; the second closing stream metadata extends beyond the query window.

Run the original `sensorthings-receive-hamburg` command against the workspace assigned to that same operation, using its exact recording path, bytes and SHA. The full [native receiving guide](../../../operations/sensorthings-hamburg-native-20261012/NATIVE_RECEIVING.md) explains the original capture/action IDs, explicit operator review input, dataset preparation and source export.

The command returns actual native edition IDs. Use those IDs in the Desk and in any original review input; calculation/report IDs are separate. Reopening the command with its original recording and `--resume` continues that same capture.

The retained Hamburg stream is categorical. Its original `OM_CategoryObservation` values, status strings and null unit fields remain literal. Point observations do not establish state duration, uptime, availability, utilization or network latency. Missing intervals remain observed source gaps. A separate scalar or Helgoland analysis source keeps its own edition and meaning.

## Installed receiving and maintenance

Keep the complete source-owned `sensorthings` contribution, Desk browser asset manifest and Applications provider with their original SDK dependencies. The standalone selection includes the native writer, dataset compiler/publisher, release lifecycle, buyer operation and complete-file receiver.

The Desk source identity covers its UI, API transport, launch/inbox modules and the directly selected original native core. The existing installed runtime verifies the remaining package manifest. A Start/Open check does not accept a stale announcement from a different workspace, source tree, instance or listener.

For an upgrade, stop the original managed application, retain its workspace and source/buyer inboxes, select the newly reviewed installed runtime, and reopen the same saved application using the maintained migration/review controls. Preserve the original writer and active customer operation; complete its native recovery before moving those directories to another host.

The complete source packet, source selection and actual receiving outputs travel together in the original grant/customer handoff. The original operational report and its full source receipts remain available independently of browser operation.
