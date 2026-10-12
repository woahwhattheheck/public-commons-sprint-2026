# Datasette: complete merchant receiving on the original workspace

This program receives a finished Datasette workspace through the same source-owned merchant provider. It does not open the source, publisher, seller, payer or Analysis workspace. The original native server stays open and retains its own lease.

The native source owner should finish source capture, edition review, publisher/customer work and its ordinary full workspace export before running this attachment. Keep the original workspace idle during the receiving snapshot. The receiver writes its own private MCP configuration, file inventory, download and operating journal. When given the original completed upload declaration, it also submits that same native upload's zero-byte replay; no new file bytes, source action or upload identity are created.

## Existing source and input

Use a complete repository-shaped installed source directory containing both stellar/ and stellar-forge/. Its Datasette provider must contain the 17-tool upload/receiving composition and the original 31 native operations, with the two original request-history operations when that source join is present. The source-owned provider has privateExports: true, uses the original provider concurrency policy and loads the maintained Datasette receiving leaf. No npm dependency or MCP SDK is required by this receiving program; Node builtins and the original Linux flock helper are sufficient.

The source owner supplies:

- Its existing private Datasette launch JSON or URL file, already used by its browser/CLI.
- The persistent original workspace ID.
- The reviewed edition ID and exact edition JSON SHA-256.
- The original capture operation ID and, when available, exact capture JSON SHA-256.
- The expected complete source row count.
- The relative path, exact byte count and SHA-256 of its already-exported original workspace archive.
- The optional exact completed source upload declaration `{uploadId,name,bytes,sha256}`. Supply it for the original raw-upload customer journey; all four values come from the existing native upload receipt.
- Any additional expected native files, such as the source edition archive or a customer/publisher handoff, that must be present in this complete receiving.

The program verifies the edition and capture through every original native page. It preserves the original ordered columns, cell values and explicit cell types; it does not convert exact number tokens through JavaScript arithmetic. The WRI geothermal operation uses 189 rows and 26 ordered columns. Its original metadata supplies the column order because the captured pages omit columns. The observed unique gppd_idnr values remain a reviewed key rather than an invented database primary key.

## One callable attachment

Import runDatasetteMcpReceiving from this directory's run-receiving.mjs and call it inside the same invocation that already owns the native workspace:

~~~js
await runDatasetteMcpReceiving({
  sourceRoot: absoluteInstalledSource,
  connectionFile: originalPrivateLaunchFile,
  outputDirectory: distinctPrivateReceivingDirectory,
  workspaceAlias: 'portfolio',
  expectedWorkspaceId: originalState.workspaceId,
  editionId: reviewedEdition.id,
  expectedEditionSha256: reviewedEdition.editionSha256,
  captureId: originalCapture.operationId,
  expectedCaptureSha256: originalCapture.captureSha256,
  expectedRows: 189,
  workspaceArchive: {
    path: originalArchive.retainedFile.path,
    bytes: originalArchive.retainedFile.bytes,
    sha256: originalArchive.retainedFile.sha256
  },
  requiredNativeFiles: [],
  originalUpload: {
    uploadId: originalUploadedSource.uploadId,
    name: originalUploadedSource.name,
    bytes: originalUploadedSource.bytes,
    sha256: originalUploadedSource.sha256
  }
});
~~~

These values come from the original native results. A receiving directory must be distinct from the original native workspace and must either be empty or contain this same program's saved journey. Do not select the native owner's journal directory.

For command-line use, save those exact fields as a private JSON input and run:

~~~sh
node operations/scf-datasette-mcp-receiving-20261012/run-receiving.mjs --input /absolute/private/receiving-input.json
~~~

The program does not start or stop the native Datasette server. On completion the original owner can continue its ordinary shutdown, publisher or independent archive restore procedure. The receiving program closes its own two successive merchant listeners, original provider attachments, retained file readers and output lease.

## What is operated

The receiver validates the actual HTTP tool catalog, not just a count from source. It verifies all 17 advertised merchant tool names. With originalUpload it invokes all 17, including status and the exact completed upload's zero-byte replay. A source captured without an upload uses the 15 applicable tools and records that distinction. The report separately records the original 31 or 33 native operation names; catalog presence is not a claim that every native action ran. Source/edition/operation inspection and original file reads do not repeat publication or payment.

The operating sequence is:

1. Attach the host-declared original workspace, verify persistent identity and idle state, then retain the complete source/native operation catalog. If originalUpload is supplied, read its COMPLETE status, zero-byte replay that same upload, and require the unchanged original outcome.
2. Page through every original capture and reviewed edition row, preserving ordered columns, numeric lexemes, nulls and cell types, and verify their complete equality.
3. Read every page of the original retained-file catalog and verify the required edition, capture, full workspace archive and any additional declared publisher/customer files.
4. Open and release a real native retained file handle, then prepare a content-addressed receiving manifest after two complete original inventories agree.
5. Receive every manifest-declared file through the existing chunk reader and original durable downloader. No native export is recreated.
6. Close only the merchant attachment. Reopen the same merchant endpoint and original workspace, select the exact saved manifest, and resume the complete download in its original directory.
7. Re-read original file and workspace identities, close the second merchant attachment, and verify every local received file through the original offline reopen engine.

The downloaded directory contains Datasette-Download.json, the generated complete native-manifest.json and all original retained bytes under files/. The generated native inventory is labeled as a representation of native file-list results; original capture/request/response bytes travel separately and unchanged.

The original workspace archive is one of those exact native files. It remains the artifact for the owner's normal editable restore. A merchant receiving manifest is not substituted for that original archive.

## Durable outputs

journey.json retains the exact input binding, original source/status identities, receiving export and manifest hashes, all tool invocations with input and returned-result hashes, listener close results, errors and complete outcome.

observed/ contains the complete actual tool catalog, native operation catalog, capture and edition pages, original operation record, full native and receiving file inventories, original and resumed download results, native state before and after, and offline full-file verification.

received/ contains every manifest-declared original file and the existing durable download checkpoints. merchant-exports/ contains only the original provider's private receiving records.

Preserve the entire receiving directory with the source owner's final customer package before an ephemeral host exits. The program does not claim external artifact custody.

## Interrupted receiving

Run the same input against the same directory. The original config hash, source state, file inventory, capture, edition, archive and receiving manifest must still match. Read-only native calls can be reissued. A supplied originalUpload permits only its same COMPLETE zero-byte replay; no new source, review, publisher, buyer or upload-body mutation is issued.

An original native state/file change produces an explicit stop. Inspect the native owner and the saved journey before deciding whether a new, separately reviewed receiving snapshot is needed. An occupied old merchant port is also explicit: the program will not silently change the endpoint bound to an existing download checkpoint.

A stopped chunk reader is process-local. The original downloader resumes its verified local byte prefix using the same export, manifest and file SHA. Already completed files are rehashed and reused.

When journey.json is already COMPLETE, rerunning the program verifies all recorded evidence and the received files locally. It does not open either listener. The original complete result stays intact.

## Source ownership

The source/capture/edition/publisher/archive engines and native HTTP owner remain the original Datasette contribution. The additional code lives in stellar-forge/mcp-merchant-operator/ and this receiving directory. The one original provider imports its pure catalog and lazily loads the receiving leaf. Its existing withWorkspace connection latch, cancellation concurrency and close/drain stay authoritative.

The customer Analysis workflow remains in datasette-analysis/. If the operator wants those customer artifacts in this same merchant receiving, its original source owner must first retain them within the complete native file inventory or identify the separate complete Analysis package. This receiver never invents external files or truncates an unavailable customer artifact into a link.
