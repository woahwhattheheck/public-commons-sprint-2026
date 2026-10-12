# Complete case packages in the Support workspace

The **Complete delivery** desk transfers the selected saved merchant case, every retained case revision, and every original native source bundle. It is the browser and installed MCP interface to the same `case-source-package.mjs` implementation used by `commissioning-cli.mjs`. The original Support Handoffs receiver creates or reopens the receiving case; the original SF49 source service receives its full native archives.

## Open the complete workspace

From the repository or installed source directory:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /absolute/private/merchant-cases \
  --source-dir /absolute/private/merchant-cases/source-bundles \
  --package-dir /absolute/private/merchant-packages \
  --port 8784
```

The original Node and Python runtimes remain the application dependencies. Source archives use the maintained trusted Python source engine. Set `SCF_PYTHON` to the existing Python executable if `python3` is not the selected runtime.

The defaults preserve existing starts: `sourceDir` is `casesDir/source-bundles`; the complete package directory is a sibling named `<cases-directory-name>-packages`. The case directory, native source directory and package directory have separate ownership checks. Package storage cannot contain or overlap the selected case or source store. Use the same actual directories when independently reopening the product. Managed application selection binds both source and package directory paths alongside the original incident-source selection.

For a source already configured through Handoffs, add its existing configuration:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /absolute/private/receiving-cases \
  --source-dir /absolute/private/receiving-cases/source-bundles \
  --package-dir /absolute/private/receiving-packages \
  --handoff-sources /absolute/private/handoff-sources.json \
  --port 8784
```

That is the original `stellar-forge.support-handoff-sources.v1` configuration. Its source aliases retain their original endpoint, token environment reference and private download directory. The Complete delivery desk selects an alias and export ID; it does not accept arbitrary endpoint or credential fields.

## Export a saved case

Open the original case in **Cases**, then choose **Complete delivery → Export and receive**. The desk shows the current case UUID, saved revision and whether the editor contains unsaved changes. **Save and export complete case** invokes the original case save first, then records the exact saved UUID and revision in one export operation.

Supply the accountable operator and retain the proposed operation ID. The operation records its request before starting. Selecting the same ID with different case, revision, actor or operation kind is a conflict. An acknowledged request remains available in **Operations** even if the browser disconnects.

The complete export contains:

- The selected workspace, runtime Support handoff and original flat Support export.
- The captured case head and every reachable retained case version, including the selected historical branch.
- Exact original version metadata, workspace bodies and runtime bodies under `original-case-store/`.
- Every native source manifest retained by every included case revision, including superseded editions and attachments that were never assigned to an implementation task.
- One original native archive for each distinct bundle/manifest identity, with all manifest members.
- The deterministic implementation report and task output associated with the selected case.

The completion manifest is `case-source-package.json`. It identifies the selected case, captured head, all original revisions, all native bundle identities and every delivered file. The original exporter writes that manifest after its complete file and native archive validation.

## Receive a package folder

Choose the original complete folder containing `case-source-package.json`. The browser selects the manifest-declared files and reports any missing member or wrong byte count before upload. It streams each original file to private package storage. The server owns the exact SHA-256 verification and create-only retention; a retry of an already retained file must match the original identity.

**Upload and inspect originals** preserves an input ID and the original manifest SHA in the browser. If the browser disconnects, select the same folder and input ID again. The native uploader reuses matching retained files. The input completion manifest is published after all original members arrive and the original package inspector verifies the complete case/source closure.

Open **Package contents**, select the input, then choose **Receive into this case desk**. The receiving operation:

1. Retains the complete original package in its private receiving directory.
2. Runs the original Support retained download and reopen path to create the receiving case with its native checkpoint.
3. Receives every distinct source archive through the actual SF49 begin/upload/receive/reopen operations.
4. Resolves and checks every native original member against the selected source manifest.
5. Records the receiving case, source directory and original case-history custody.

**Open received case** uses the normal Case desk transition. Unsaved case edits retain their existing save/discard handling. Reopening a completed receiving operation returns the same receiving case and preserves its subsequent local revisions.

## Receive from an installed source

Under **Export and receive**, select the existing Handoffs source alias and original export ID. **Inspect remote package** reads the source's complete manifest descriptor and retains its exact SHA. **Download and receive complete package** records that endpoint, export and manifest identity in one local operation.

The remote transport is the original retained MCP downloader. It uses `merchant_case_package_export_manifest`, `merchant_case_package_export_file` and the original file-release call. File ranges, read IDs, byte identities and interrupted progress remain with that existing engine.

The source's configured endpoint is checked on continuation. If the host configuration changes it, restore the original endpoint for that retained operation or prepare a separately selected new operation. A receiving operation cannot silently change source identity.

## Inspect all retained material

The desk pages each inventory and exposes its exact original identities:

| Inventory | What it shows | Original opening path |
|---|---|---|
| Complete package files | Every manifest member, role, byte count and SHA-256 | Original whole file download |
| Every native source bundle | Bundle/manifest identity, all case revisions and source edition IDs | Original native archive |
| Original bundle members | Every original path, role, byte count and SHA-256 | Exact member resolved by the existing native source service |
| Original case history | Each revision, previous revision, workspace/runtime identities | Original version, workspace and runtime files |

Individual native members become available after that bundle is present in the configured source store. The complete original archive is always part of the completed package inventory. Receiving that archive uses the native source engine; the browser does not unpack or reconstruct it.

Operation and input lists are paged independently, as are the complete file, source-bundle and historical-case inventories. A selection keeps its full original ID and SHA while the user changes pages.

### Save the complete folder

**Download complete folder** uses the browser's directory writer and the original streamed member route. Select an empty directory or the exact same package's retained browser-download directory. Files stream directly to their original relative paths; the original completion manifest is written last.

The browser marks the selected directory with its exact manifest identity. Retrying this folder action streams the same package again into that owned folder. For very large or interruption-prone transfers, use the installed MCP receiving operation, whose original retained-download engine keeps byte-range checkpoints. Individual original file downloads remain available in browsers without directory-write support.

The browser verifies each response's original digest header and declared length while writing; the receiving server performs the complete native hash and archive checks when that folder is uploaded. The browser does not buffer a multi-gigabyte native archive in memory.

## Retained operations and shutdown

Each operation has an immutable request and an observed status:

| Status | Meaning | Operator action |
|---|---|---|
| PREPARED | Original request exists | Run that operation ID |
| RUNNING | Its current process owns the operation | Observe progress or pause that owner |
| PAUSED | The original owner settled its work | Resume the same ID |
| NEEDS_CONTINUATION | A source, storage or provider step ended before completion | Read the recorded stage, resolve that concrete condition, then resume |
| COMPLETE | Original immutable result exists | Open the received case or original files |

The browser locks source and folder selection while an operation is being prepared. It retains an unacknowledged request body separately from later form edits. **Resume the original request** replays those exact bytes and ID. The server joins an already running operation or returns its original completed result. It never treats an uncertain response as permission to create another case. A complete native preparation rejection permits correction only after the original operation lookup confirms that no operation was retained. The rejected input and that exact lookup result remain in the browser's original attempt history. Invalid operation names are checked before preparing a new request.

An operation's native receiving substeps retain their original request identities. The controller reconciles an existing immutable completion if its final status write was interrupted. Completed receiving continues to use the original local case and native bundle records.

**Pause this process's operation** settles only work actually owned by this server. It cannot stop an unrelated receiver. Closing the Support server first cancels and settles its accepted package work and retained readers, then releases original Handoffs and source service resources. A late request cannot start a new worker after closure.

## Installed MCP configuration

Keep the application's existing merchant host configuration and Support connection. The Support connection accepts these optional host paths:

```json
{
  "schema": "stellar-forge.merchant-support-connection.v1",
  "casesDirectory": "/absolute/private/merchant-cases",
  "sourceDirectory": "/absolute/private/merchant-cases/source-bundles",
  "packagesDirectory": "/absolute/private/merchant-packages",
  "packageSourcesFile": "/absolute/private/handoff-sources.json"
}
```

All existing Support connection fields remain available. The new paths select the same case, native source and package records used by the browser. `packageSourcesFile` is the original Handoffs configuration described above.

The installed Support provider exposes sixteen package tools:

| Tool | Purpose |
|---|---|
| `merchant_case_package_catalog` | Current configured directories, source aliases and original limits |
| `merchant_case_package_operations` | Page retained operation summaries |
| `merchant_case_package_inputs` | Page original folder inputs |
| `merchant_case_package_status` | Read one original request, status and native result |
| `merchant_case_package_prepare` | Retain one export, inspect, receive or remote request |
| `merchant_case_package_run` | Start or join that retained operation |
| `merchant_case_package_pause` | Pause an operation owned by this process |
| `merchant_case_package_inventory` | Page files, bundles, native members or case revisions |
| `merchant_case_package_remote_inspect` | Inspect an existing source/export |
| `merchant_case_package_open` | Reopen a completed receiving case |
| `merchant_case_package_file` | Read a manifest-bound original file range |
| `merchant_case_package_original_file` | Read a native source member by exact bundle identity |
| `merchant_case_package_file_release` | Release the original retained read |
| `merchant_case_package_export_manifest` | Serve a source export's original manifest descriptor |
| `merchant_case_package_export_file` | Serve its original file range to the retained downloader |
| `merchant_case_package_export_file_release` | Release that source export read |

A typical installed export uses:

```json
{
  "id": "case-export-20261012-01",
  "kind": "export",
  "actor": "Current accountable operator",
  "caseId": "<actual saved case UUID>",
  "revision": "<actual saved revision SHA-256>"
}
```

Pass that object to `merchant_case_package_prepare`, then pass its unchanged ID to `merchant_case_package_run`. Poll its status until the original result completes. An inspect or receive request selects `source: {kind: "input" | "operation", id: "<retained ID>"}` and `expectedManifestSha256`. A remote request selects `profile`, `exportId` and the SHA returned by the original remote inspection.

The file tools use the original retained descriptor protocol: supply the exact expected manifest and file SHA, then keep the returned `readId`, `nextOffset` and original file identity until completion or explicit release. The warm reader retains its file descriptor and manifest selection; it does not reparse a large manifest for every chunk. Cold reopening validates the original manifest identity and native file source again. The descriptor's maximum native archive size comes from the maintained SF49 archive limit; existing unrelated readers keep their original default.

## Local HTTP surface

All routes belong to the existing loopback Support listener under `/api/case-packages`. It retains the host's exact origin and fetch-site checks. Mutation requests use the original listener origin.

- `GET /catalog`, `/operations`, `/inputs`, `/operations/ID`.
- `POST /operations` prepares and starts the exact request; `POST /operations/ID/run`, `/stop` and `/open` act on it.
- `PUT /inputs/ID/manifest?actor=…&manifestSha=…` receives the original bounded UTF-8 manifest.
- `PUT /inputs/ID/files?name=…` streams one original declared member.
- `POST /remote/inspect` reads a configured source/export.
- `GET /inventory`, `/manifest`, `/files` and `/original-files` select the retained input/operation and original manifest SHA.

Manifest size and native archive size follow the original package and SF49 constants. Whole file downloads stream through the original retained reader, support a single original byte range, and release their file lease when the client completes or disconnects.

## Portable files and independent reopening

The complete package engine and CLI remain documented in [CASE_SOURCE_PACKAGE.md](CASE_SOURCE_PACKAGE.md). The browser adds no new archive format.

The package operation directory keeps its immutable request, observed status and actual native receiving records. The completed package's `case-source-package.json` describes delivered originals; operation controls remain separate. Its `original-case-store/` is the full captured sender history. Its original Support handoff creates the receiving case in the configured receiving case store.

Keep the received case directory and native source directory together when moving the installed application. Open the same case UUID after restarting with those actual directories. If transferring the complete package to another host, run the original receiving workflow there; its native checkpoint creates and retains that host's receiving UUID.

A completed original archive and manifest are useful while a browser is unavailable. The original CLI commands `inspect-package` and `receive-package` operate on the same files and source service. Their request ID, actor and selected manifest remain unchanged on retry.

## Continue the completed original receiving case

`tools/receive_case_package_workspace.mjs` is the complete native continuation for this browser and installed MCP product. Run it after the original Support implementation journey has completed and all of its original owners have closed. It reads that existing `implementation-operation.json`, retains its exact bytes, and continues its actual `receivedCase.id` inside the original `receiver-cases` directory.

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/tools/receive_case_package_workspace.mjs \
  --source /absolute/selected-distribution/source \
  --source-map /absolute/private/complete-selected-source-map.json \
  --baseline-workspace /absolute/private/completed-support-native \
  --workspace /absolute/private/case-package-continuation \
  --modules /absolute/existing/node_modules \
  --browser /absolute/existing/chromium \
  --node /absolute/existing/node \
  --python /absolute/existing/python3 \
  --operation-id SCF-CASE-PACKAGE-WORKSPACE-20261012-7A2F
```

The complete selected source map must include this application, original Support/MCP dependencies, native SF49 archive/source engine and the receiving driver. Its literal file bodies or SHA-256 entries are checked against the installed source before the first application starts. Omitting `--source-map` uses the original completed baseline’s retained `source-map.json`.

The continuation performs seven connected stages:

1. Opens the exact completed receiving case in the original browser and verifies the configured case, source and package roots.
2. Prepares two original SF49 source editions from the same saved case, using the actual completed implementation artifacts. It retains the complete operating result as an unassigned original source attachment.
3. Exports through the browser, interrupts only its already-accepted response body, and reconciles the same original request. It checks the complete saved history and every native member inventory.
4. Uploads the complete package folder through the browser, inspects and receives it into a fresh original Case desk, then opens the actual received case and all source editions. Desktop and 390-pixel views are retained.
5. Opens the existing installed Merchant MCP, lists its sixteen package tools, exports the original selected case, and reads the complete manifest through the native descriptor protocol. An exact file read continues after explicit lease release.
6. Receives that complete export through the existing Handoffs transport and SF49 source receiver. It closes the source listener, records a real receiving observation in the resulting case, restarts the receiver, and reopens the same later revision while the source remains offline.
7. Produces the final complete case/source export through the original CLI and retains the full operating guide, inventories, screenshots, case histories and source receiving records.

Its result is `case-package-operation.json`, schema `stellar-forge.case-package-workspace-native-result.v1`. Each stage and exact mutation request are retained before proceeding. Completion requires `state: "completed"` and all four original closure fields—`closed`, `browserClosed`, `serversClosed`, `workersClosed`—to be true. A failed or interrupted stage keeps its actual original inputs and working case for continuation.

The automatic Support packager can select this driver as one sequential continuation after its completed baseline, inside the same maintained native admission. It preserves both native journals, complete donor and receiver directories, full native source archives, browser outputs and the final stopped-workspace package. The receiving owner saves that package through its existing file-preservation operation before the private process exits.

For a new receiver, the output `delivery/Complete_Received_Case_And_All_Sources/` is the final portable case/source package. The incoming original package is also retained because it contains the prior sender’s full history. Keep both packages and the native case/source directories with the receiving journals.
