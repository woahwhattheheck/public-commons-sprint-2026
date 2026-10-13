# Complete original receiving and private save

This command runs the original Tiptap/Hocuspocus receiving programme, closes its actual application and browser owners, packages the completed private operation, and saves that exact ZIP through the unchanged Library workflow. The existing native NDJSON-gzip handovers remain the product's application handover format.

The component remains the complete original application: its projects, uploaded sources, tenant and document grants, frozen source editions, migration review/apply, native Yjs editing, resumable jobs, deployment rollback, checkpoints, fresh/same/forward/older receiving and historical revisions. The save wrapper contributes process ownership, private case packaging and durable save continuation. It does not implement another domain API or generate document state.

## Select the installed original source

Use Python 3.10 or newer for the wrapper and the three unchanged Library helpers. Use the actual Node 24 executable selected by both installation receipts. The original application pins Hocuspocus 4.7.1, Tiptap 3.31.4, Yjs 13.6.33 and esbuild 0.28.2. Its shared schema is reference-v1 with field default.

Retain two independent installed directories containing the same full selected component source. The source manifest uses schema `tjlabs.tiptap-source-manifest.v1`, repository `woahwhattheheck/commons`, a nonempty sourceRef and complete files with relative path, bytes and SHA-256. If a row includes gitBlob, the full Git blob identity is checked as well. Include the complete original 47 files and every integrated addition, including receiving/private_case.py, receiving/run_and_save.py and this guide. Do not write the manifest inside its own inventoried source tree.

Keep the package and resolved package-lock unchanged. Run the original scripts/install.mjs for each selected installation; the original --prepared-runtime route can adopt an already complete retained runtime. It verifies the selected source and regenerates the installation-specific ready receipt. A browser build must match the selected integrated web source and actual runtime. The source and receiving ready files must name their respective source directories and the same Node executable and version.

The following directories are separate:

| Location | Contents |
| --- | --- |
| Source installation | Complete selected application, installed original dependencies and browser build |
| Receiving installation | Independently installed identical selected source |
| Operation directory | Original receiving.json, workspaces, browser journeys and native deliveries |
| Save directory | Frozen selection, process logs, private ZIP, Library attempts and provider state |
| Helper directory | Exact three unchanged Library helper modules |

Use absolute real paths, without symlink traversal. The operation, save and helper directories remain owned and private. The wrapper creates its private state with umask 077.

## Prepare once

Substitute actual available paths in the following command. The selected Chromium executable and Playwright module must be from the retained installed browser runtime.

```bash
python3 -B /installed/source/receiving/run_and_save.py prepare \
  --source /installed/source \
  --source-manifest /private/selection/source-manifest.json \
  --operation-directory /private/tiptap/operation \
  --node /runtime/node24/bin/node \
  --runtime-ready /private/selection/source-ready.json \
  --playwright /runtime/playwright/index.mjs \
  --chromium /runtime/chromium/chrome-headless-shell \
  --receiving-source /installed/received \
  --receiving-runtime-ready /private/selection/received-ready.json \
  --helpers /private/library-helpers \
  --directory /private/tiptap/save
```

Preparation writes NATIVE_INPUT.json and SAVE_INPUT.json, freezes the full selected source and executable/helper identities, and returns the exact SAVE_INPUT descriptor. Repeating preparation with the same paths and bytes retains the same case ID. A changed selection cannot silently replace an existing case.

The exact helper selection is:

| Original helper | Bytes | SHA-256 |
| --- | ---: | --- |
| library_hosted_apps.py | 12,576 | 97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59 |
| library_file_transfer.py | 11,084 | 5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378 |
| library_upload.py | 44,876 | 5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767 |

## Run the complete course and save

```bash
python3 -B /installed/source/receiving/run_and_save.py run \
  --input /private/tiptap/save/SAVE_INPUT.json
```

The wrapper invokes the original receiving/receive.mjs with the exact source, operation directory, manifest, ready receipts, Playwright and Chromium paths. For an existing receiving.json it passes the original --resume option. The receiver retains its native operation ID TIPTAP-HOCUSPOCUS-WORKSHARE-0C7A-20261012; the enclosing delivery keeps TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012. Both are explicitly bound in the save selection.

The original full programme executes the three-document, two-tenant migration, concurrent editors, deletion persistence, offline merge, tenant/read-only isolation, old-epoch isolation, configuration rollback, original request replay, complete native handovers, independent receiving, historical reads, native reopen and desktop/mobile journeys. These actual producers and their results are retained.

SIGINT or SIGTERM is recorded and forwarded once to the same original receiver child. The wrapper waits for that child and its output files to close. The receiving/browser lifetime controller stops admitting new work and drains its acquired owners. A completed result can still be packaged if the stop arrived after physical completion. An unfinished native operation retains its original receiving and browser journals for continuation.

Running again after a completed native result verifies and reuses that completed case. If the immutable original result was published but its final journal or post-lease closure publication was interrupted, the wrapper first verifies the exact result/input/files and invokes the original --recover-completed path. That path admits only local completion recovery, starts no application host or browser, and preserves the original immutable result. Changed inputs or result bytes still fail. A fully retained completed case is reused without a child process.

## What enters the private ZIP

The adapter first acquires the original receiver's directory-inode flock, the two actual workspace.lock files and both browser-directory flocks. It holds those exact leases while reading the closed operation. The immutable original result must equal receiving.json.finalCandidate and select the frozen input. All twelve original course checks, the original complete result files, both completed browser results and actual server closedAt records are checked.

The paired receiving controller publishes tjlabs.tiptap-receiving-owner-closed.v1 records under receiving-closures after its actual lease closes. Browser records use tjlabs.tiptap-browser-owner-closed.v1 under each browser's owner-closures. The adapter verifies their exact result descriptors, original input hash and every required closed flag. These records accompany the completed physical data.

The ZIP includes the original workspaces and native objects, original delivery files, receiving/browser journals, downloaded original handovers, actual response observations, immutable results and closure publications. Every member has a full SHA-256 and byte length in PRIVATE_CASE.json. The ZIP uses private member permissions; source permissions are also retained in the manifest. The entire source tree and member set are checked again after the copy.

Authentication and browser operating state stay with their original local owners. The excluded paths are private-auth.json, source-workspace/local-session-secret, receiving-workspace/local-session-secret, and both browser directories' profiles and tmp trees. Visual captures remain temporary internal inspection under browser tmp/screenshots and are excluded. Workspace lock files and incomplete atomic temporary files are excluded. Library provider requests, signed transfer state and helper modules are outside the operation tree.

The saved case contains completed document and application state. Original host authentication and session-signing keys are intentionally supplied afresh when opening a restored host. The application's own NDJSON-gzip handover remains the normal cross-host receiving input.

The ZIP and CLOSED_CASE.json live in the separate save directory at cases/<native-result-sha256>/. Original application databases, content objects and native handovers are read in place and kept unchanged.

## Save and inspect separately

To save an already completed original case:

```bash
python3 -B /installed/source/receiving/run_and_save.py save \
  --input /private/tiptap/save/SAVE_INPUT.json
```

To inspect the retained report, exact ZIP and original provider outcome locally:

```bash
python3 -B /installed/source/receiving/run_and_save.py inspect \
  --input /private/tiptap/save/SAVE_INPUT.json
```

The unchanged LibraryUploadWorkflow owns prepare, transfer and finalize. It receives one upload with purpose create_library_file and library_artifact_type other. The wrapper retains its ordinary {"results":[...]} return, including the actual file_id, library_file_id, filename, metadata outcome, optional nonnegative version number and warnings. Observers preserve provider calls and original native transfer logs without replacing the helper's return or exception.

Each exact archive has ordered attempt directories. INTENT.json precedes helper entry. ENTERED.json identifies the admitted attempt. OUTCOME.json preserves the complete ordinary returned or raised result. SOURCE_CLOSED.json records the same original archive's complete byte check and descriptor closure. RUN_AND_SAVE_RESULT.json relates that save to the actual closed native result. Public progress output exposes identifiers and hashes while full provider details remain private.

A saved archive is reused by its original file identity. An entered helper attempt without a complete outcome requires reconciliation of that same retained attempt; running the command again does not create a second file. An ordinary succeeded result remains visible even if a subsequent local receipt write failed. Source verification or report publication can therefore remain pending alongside an actual saved provider identity.

For a known returned failure whose cause has been resolved, use the exact retained OUTCOME.json hash and a concrete reason:

```bash
python3 -B /installed/source/receiving/run_and_save.py retry-save \
  --input /private/tiptap/save/SAVE_INPUT.json \
  --previous-outcome EXACT_RETAINED_OUTCOME_SHA256 \
  --reason "The observed provider retry interval elapsed."
```

The original failure and retry reason remain together. A raised or commit_unknown outcome cannot become a fresh create merely because the command is repeated.

## Integration and execution status

This adapter is an additive source contribution over the complete original 47-file application, paired with its original browser/server lifetime corrections. Keep the original whole application source and resolved lock together when publishing and installing it. Source parsing, complete source review and a completed original native run are distinct observations. The private ZIP is produced only by the actual complete receiving operation and its post-lease closure records; source publication alone does not create that ZIP.
