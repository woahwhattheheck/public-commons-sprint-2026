# CKAN publisher workspace transfer

The workspace archive carries an existing CKAN data product project to a new private directory. It preserves retained editions, saved source selections, semantic reviews, publisher plans and candidates, publication history, dataset versions, complete merchant packages, seller release records and buyer configurations.

The receiving project uses the original workbench, dataset publisher, SF82 seller and SF88 buyer. An existing publication keeps its source hash, candidate digest, semantic review, dataset snapshot and saved release digest. A new publication can then be prepared, reviewed and published from the same retained source at the receiving location.

## Export and receive

Use the installed Stellar Forge distribution command, or this source directory's cli.mjs with Node 24 on Linux. Original private directories and util-linux flock are required.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/cli.mjs \
  archive-workspace \
  --project /private/ckan-project \
  --out /private/delivery/publisher-workspace.ckanw
~~~

The command uses the workbench's existing durable operation journal. Its result includes the archive's exact sha256, compressed bytes, manifestSha256, file count, unpacked byte count and retained project identities. Preserve the full result beside the archive. The output parent directory must already be private.

The snapshot contains the project state immediately before this export operation starts. It retains the previous completed or interrupted native operation; the original project records the new export operation and completed archive result.

Inspect every archive member before receiving:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/cli.mjs \
  inspect-workspace \
  --archive /private/delivery/publisher-workspace.ckanw \
  --sha256 COMPLETE_ARCHIVE_SHA256
~~~

Receive into a new directory whose parent is private:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/cli.mjs \
  receive-workspace \
  --archive /private/delivery/publisher-workspace.ckanw \
  --project /private/received-ckan-project \
  --sha256 COMPLETE_ARCHIVE_SHA256
~~~

Use the SHA-256 of the complete compressed archive. The embedded manifest digest is a different identity.

The receive result identifies the original project, new directory, relocated mutable bindings and installed seller handlers. Repeating this command with the same archive hash and directory resumes that receive. A completed receive returns its original completion with reused: true and preserves later work done in the received project.

Open the result through the same workbench:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/cli.mjs \
  serve --project /private/received-ckan-project --port 0
~~~

The existing CKAN Applications provider can enroll and open this directory. Bind a merchant MCP host to the received project and its own seller-releases store as described in [MCP_WORKFLOW.md](./MCP_WORKFLOW.md). The original project creation time and catalogue origin are retained; the directory identifies the installation.

## Workspace page

The original operator UI has a **Workspace** section.

**Create complete workspace archive** starts the original native export operation. Progress appears in the existing operation display. Its completed archive appears with creation time, file count, compressed size, full SHA-256, retained project summary and download.

**Receive a workspace** accepts an archive file, its complete SHA-256 and a new directory name beside the current project. The browser streams the file to the same authenticated loopback server. Once the exact upload is retained, the original workbench operation receives it and records its result. Completion displays the new directory for the original Applications provider or serve command.

The listener retains its bearer, Host, Origin and cross-site checks. Receiving uses application/octet-stream with an x-archive-sha256 header. The file is streamed rather than converted to a browser or server JSON/base64 buffer. The upload limit is the default 8 GiB workspace budget plus compression and manifest allowance.

| Request | Result |
|---|---|
| GET /api/workspace/archives | Completed archive descriptors from this installation |
| POST /api/workspace/archives with an empty JSON object | Original operation ID for a complete export |
| GET /api/workspace/archives/:id | Archive bytes, exact length and x-archive-sha256 |
| POST /api/workspace/receive?name=NEW_NAME | Original receive operation ID after checked binary upload |
| GET /api/status | Existing operation progress and final result |
| POST /api/cancel with an empty JSON object | Cancels the active workbench operation |

Use normal project close and owner shutdown. Receiving shares that owner.

## Source and semantic identity

| Retained object | Receiving behavior |
|---|---|
| Capture manifests, provider pages, metadata and CSVW responses | Exact original bytes and hashes |
| Saved source declarations | Exact original bytes and source hashes |
| Query semantic review | Original semantic and definition digests |
| Publisher plans, original/runtime source and capture copies | Exact original bytes and plan bindings |
| Candidate CSV, dataset schema and manifest | Exact original bytes and candidate digest |
| Dataset generations and state | Same snapshots, revision, retention settings and files |
| Merchant package, handler, dictionary, CSVW and capture | Exact package and manifest identities |
| Seller release.json, compiled source and activation history | Same release digest and selection history |
| Buyer configurations | Exact original bytes and configuration identity |
| Mutable workbench and publisher location settings | Explicit relocation, with prior bytes and before/after hashes |

New selections use relative capture references. Older selections may contain an absolute path from their original installation. Receiving leaves these declarations unchanged and creates one project-owned sources/source-locations.json.

The original declaration loader uses that record only for a saved source with a legacy absolute capture reference. It checks the source filename, exact source hash, original capture path, capture digest, source/edition membership and original project identity. The target must be the same edition's editions/ID/capture.json inside the received project, with private canonical directories and no symlink components. Duplicate or conflicting mappings fail.

This loader serves workbench semantic reads, the source SDK and the original publisher's new plans. It therefore selects the received capture even when the former directory remains readable on the same computer.

The transfers/ARCHIVE_SHA256 directory retains the archive manifest, original mutable workbench/settings bytes and completed receiving result. Earlier transfer history travels with later archives.

## Existing seller releases

SF82 saves a trusted handler's original absolute location and bytes in its release record. Changing that record would change the release digest.

Receiving adds a per-release installation.json. It binds the saved release ID and digest, original handler path/SHA-256/size/scope, installed store-relative handler, and retained source manifest.

For CKAN the installed target is the same ckan-packages/MERCHANT_MANIFEST_SHA256/handlers.mjs. The receiver first uses the complete original CKAN package inspector to check every member, generated handler, typed dataset, dictionary and capture.

Original releaseRecord verification resolves this installed handler while returning the saved record unchanged. Original runActiveRelease writes its mutable pilot settings from the effective installed location. Inspection, comparison and activation history retain the saved release digest.

The existing facilitator-derived release flow also carries the installation selection into its own new reviewed record. Its new digest is bound separately; the original release remains unchanged.

~~~js
const installed = await installReleaseHandler(store, releaseId, {
  expectedDigest: originalReleaseDigest,
  handler: "ckan-packages/" + merchantManifestSha256 + "/handlers.mjs",
  source: {
    schema: "stellar-forge.ckan-merchant-package.v1",
    manifestFile: "ckan-packages/" + merchantManifestSha256 + "/merchant-manifest.json",
    manifestSha256: merchantManifestSha256
  }
});

const current = await inspectReleaseInstallation(store, releaseId);
// current.release: original saved public release
// current.installation: separate checked location binding
// current.effectiveRuntime: installed handler selection
~~~

A source-specific caller inspects the complete package before installing its location. The installation helper checks bound handler and manifest bytes without importing the handler.

The received store retains its active selection. Starting it is the original explicit SF82 operation. Readiness, process birth, shutdown and lifetime ownership use unchanged SF82 mechanisms.

## Consistency and recovery

Export requires an idle native operation. The workbench owns its original project lock; export also takes existing publisher locks, dataset writer leases and SF82 run/state lifetimes. Finish or stop the original owner before exporting a busy store.

Project data and transfer history travel in the archive. Listener controls, process-owner files, kernel lock inodes and mutable pilot launch settings belong to an installation's lifetime. They appear in the manifest's excluded list. Completed archive/upload caches are also excluded so later exports do not recursively contain compressed copies. The native project operation and transfer history retain their corresponding results.

A receiver reserves a new private directory and uses its original publisher.lock. The .ckan-receive.json record binds the same archive, destination and phase. An incomplete receive cannot be opened by the workbench. Partial file copies resume under that owner; completed matching files are reused. A completed file with different bytes fails.

After all payload and compressed-archive hashes match, receiving relocates explicit mutable settings. Original bytes are retained before replacement. A reply lost during relocation is recovered from those same originals; other retained members are checked before completion.

A different archive cannot take over a reserved directory. An unrelated existing project is rejected before a receiver lock is created inside it.

## Format and limits

The .ckanw format is a streaming gzip-compressed workspace, implemented with Node's standard library. Its uncompressed stream has four parts:

1. ASCII magic SCF-CKAN-WORKSPACE/1 followed by a newline.
2. A four-byte unsigned big-endian manifest length.
3. Exact UTF-8 JSON manifest bytes.
4. Every file's exact bytes in the manifest's strict lexical path order.

The manifest lists private relative files, sizes, SHA-256 values, directories, project identity, totals and omitted runtime members. It has no link or executable extraction instructions; receiving creates private regular files.

Inspection and receiving stream every member, check lengths and digests, reject duplicate/unsafe paths, enforce compressed/expanded size budgets and reject trailing payload. Defaults are 8 GiB file bytes, 100,000 files and a 32 MiB manifest. Native APIs accept explicit maxBytes/maxFiles budgets for controlled larger transfers.

## Complete native example

[examples/workspace_transfer.mjs](./examples/workspace_transfer.mjs) operates on an existing reviewed and published merchant project with its real retained dataset and original payment offer.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/examples/workspace_transfer.mjs \
  --project /private/original-ckan-project \
  --received /private/received-ckan-project \
  --out /private/receiving-output
~~~

The single continuation exports and inspects the complete project, receives the archive, reopens source meaning and publisher history, and queries the original version store. It then prepares, reviews and publishes a continuation from the unchanged saved source in the received copy.

It starts the archived SF82 release through the installed handler, reads its actual 402 challenge and prepares the original SF88 buyer configuration. Authenticated original operator/source/dictionary routes are read before close and reopen. A repeated receive is checked against the original live owner and then reused after that owner closes.

The example saves receiving.json, the archive descriptor and buyer configuration in its output directory. Run it with a closed original project. Its saved record continues the same receiving directories and original operations after interruption.
