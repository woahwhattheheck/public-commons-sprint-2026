# Complete case and original source receiving

The implementation package carries the selected merchant case, its captured original case history, and every original SF49 source bundle referenced by that history. Each native archive includes its complete manifest, original handoff and owner terms, native workorder outputs, and every declared attachment. An attachment remains in the package even when no task, material, measurement or receiving note links to it.

The package uses the existing case store, Support Handoffs downloader and reopener, and native SF49 archive and receiving engines. The source manifest identity stays stable across machines. A source service transfer ID identifies the receiving store's local transfer.

## Export the saved case

Use the original case directory and the source delivery directory that already holds its prepared or received native bundles. Select the actual saved revision. Export to a separate private directory.

~~~sh
starforge merchant-implementation export \
  --cases-dir /srv/starforge/private/merchant-cases \
  --case 00000000-0000-4000-8000-000000000001 \
  --revision ORIGINAL_SAVED_REVISION_SHA256 \
  --source-dir /srv/starforge/private/case-sources \
  --out /srv/starforge/private/outgoing/merchant-implementation-01 \
  --export-id merchant-implementation-01 \
  --python /usr/bin/python3
~~~

The example case ID and revision are placeholders for the selected original case. The same command is available from the repository:

~~~sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/commissioning-cli.mjs export \
  --cases-dir /srv/starforge/private/merchant-cases \
  --case ORIGINAL_CASE_UUID \
  --revision ORIGINAL_SAVED_REVISION_SHA256 \
  --source-dir /srv/starforge/private/case-sources \
  --out /srv/starforge/private/outgoing/merchant-implementation-01 \
  --export-id merchant-implementation-01
~~~

An older case with only inline original files can use the original export command without `--source-dir`. A case containing native source references requires the actual source delivery directory. The exporter resolves and archives each distinct native manifest once.

The first export retains its chosen case revision, captured current head and generation time before writing the deliverable files. An interrupted export resumes with those same selections and files. A later save in the sender's case store does not silently change that package. Choose a new output directory and export ID to deliver a new selection. `--generated-at` is optional; when supplied it must be the original full UTC timestamp, such as `2026-10-12T12:00:00.000Z`.

The CLI keeps the original implementation inventory in its response. Its `caseSource.manifestSha256` identifies the complete `case-source-package.json` that the receiver selects. The implementation inventory also names all original case files and native source archives.

## What is retained

| Path | Content |
| --- | --- |
| `case-source-package.json` | Complete selected case, original history, every native bundle identity, and file byte counts and SHA-256 values. Written last. |
| `support-export.json` | The original flat Support export manifest, directly compatible with existing retained-file readers and Handoffs. |
| `case.json`, `merchant-workspace.json` | The selected original saved case metadata and byte-exact workspace. |
| `merchant-support.json`, `support.html` | The original complete runtime handoff and readable report, when the case has runtime support. |
| `merchant-commissioning.json`, `merchant-implementation.html`, `merchant-implementation-tasks.csv` | The selected implementation, readable operating report and editable task register. |
| `originals/` | Original inline workorder inputs, outputs and materials, with their retained names and bytes. |
| `source-bundles/<manifest-sha256>.zip` | Each complete native SF49 archive, including original members that were never selected for an implementation task. |
| `original-case-store/<original-case-id>/` | Original immutable version, workspace and runtime files, plus a head selecting the captured original head. |
| `implementation-export.json` | Original implementation export inventory extended with complete native source and case history references. |

The history inventory follows the captured original head through its saved revision chain. If the selected revision belongs to a different retained branch, the package also carries that branch through its shared original history. Every native source edition referenced by any of those saved workspaces is included.

A native manifest includes `manifest.json` and every declared source member. The receiving layer compares that inventory with the native archive's own manifest. It does not build an attachment list from the currently visible task table.

The export's `package-state/` directory retains its local writer request and lease. It is local continuation metadata and is excluded from the deliverable inventory. Transfer the manifest-declared files and `case-source-package.json` together. Files remain private: directories use mode 0700 and files use mode 0600.

## Inspect a received package

Inspection reads the original case history and selected files and runs the native archive inspector for every source archive.

~~~sh
starforge merchant-implementation inspect-package \
  --from /srv/starforge/private/incoming/merchant-implementation-01 \
  --sha256 COMPLETE_CASE_SOURCE_MANIFEST_SHA256 \
  --python /usr/bin/python3
~~~

The expected digest is the sender's complete package manifest digest. Without `--sha256`, inspection reports the observed digest so it can be compared with the sender's original handoff. Receiving always requires the selected digest.

The inspector reconstructs the expected inventory from the original saved case and all of its retained source editions. Missing history files, missing unassigned attachments, mismatched native manifests, or a selected workspace that differs from the original saved revision prevent the package from being treated as complete. It also verifies the exact original Support export and derived implementation outputs for the selected generation time.

Inspection produces no receiving case or source transfer. It returns the actual case revision count, source bundle and source member counts, and each inspected native archive identity.

## Receive into the original case and source stores

Keep the incoming package and receiving progress directories separate from the working stores. The source service can use its own directory or the original host default, `<cases-dir>/source-bundles`, outside individual UUID case directories. The receiver can join existing stores; the original Handoffs importer creates a new local case identity for this selected export. Existing cases and their current heads are retained.

~~~sh
starforge merchant-implementation receive-package \
  --from /srv/starforge/private/incoming/merchant-implementation-01 \
  --sha256 COMPLETE_CASE_SOURCE_MANIFEST_SHA256 \
  --out /srv/starforge/private/receiving/merchant-implementation-01 \
  --cases-dir /srv/starforge/private/received-cases \
  --source-dir /srv/starforge/private/received-sources \
  --request-id receive-merchant-implementation-01 \
  --actor "Receiving operator" \
  --python /usr/bin/python3
~~~

The receiver completes these connected stages:

1. Inspect the whole original package against the selected manifest digest.
2. Stream its complete original files into `<receiving>/package/`. Publish the identical whole manifest after all files are retained.
3. Use the original Support retained-file protocol and downloader to receive the original flat handoff under `<receiving>/handoff/`.
4. Call the original Handoffs reopener to save the selected workspace and runtime into the receiving case store.
5. Resolve each complete native bundle by its original bundle ID and manifest SHA. Reuse an already available exact bundle, or register and upload its original archive through native SF49 `begin`, `upload` and `receive`.
6. Reopen each native bundle with the existing native source verifier and open every declared original member through the receiving factory's manifest-bound resolver.
7. Reopen the current receiving case and retain the complete result in `receiving-result.json`.

The Support client used for this local package is the maintained downloader's trusted local client interface. It serves the same original manifest and retained file ranges. It creates no new server and keeps native download checkpoints under the original downloader's control.

The completed result contains the receiving case ID, its first imported revision and current revision, original source case identity, native source transfer IDs, member counts and original native verification results. `sourceFilesVerified` counts the actual original members read from the receiving source service.

## Resume the same receiving operation

Repeat the same command with the same request ID, actor, complete manifest SHA and receiving/case/source directories. The first request binds all of those identities. A different selection requires a distinct receiving operation directory.

Each stage consults its original completed files and native records:

- Native file publication reuses exact complete files and finishes interrupted copies.
- The Support downloader continues its retained offsets and original manifest. Its reopener retains the new case ID before the first save, so a lost save response does not create another case.
- A completed original source transfer keeps its native descriptor and verification request. An interrupted upload or native archive receive continues the same transfer.
- The package receiver opens every source member from the receiving service before reporting completion.

After `<receiving>/package/case-source-package.json` exists, retries use that complete retained package. The original sender can be offline or move its outgoing directory. Continue supplying the same original input path in the command; it no longer needs to be present once the entire selected package is retained.

Legitimate edits to the receiving case are preserved. Repeating a completed receive returns its current head and the original imported revision; it does not restore the first import over later notes, implementation work or receiving decisions. Source registration uses the first imported revision and stable original bundle identities.

`package-state/receiving-state.json` records the actual stage, copy progress, completed native sources and any error. `receiving-result.json` is written when the connected receiving operation completes. Keep that receiving directory until the original request has settled.

## Open and continue the received work

Use the result's `case.id` and `case.revision` with the original installed CLI:

~~~sh
starforge merchant-implementation read \
  --cases-dir /srv/starforge/private/received-cases \
  --case RECEIVED_CASE_UUID
~~~

Reopen the browser with the same receiving stores:

~~~sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /srv/starforge/private/received-cases \
  --source-dir /srv/starforge/private/received-sources \
  --port 8784
~~~

Open the printed local address and select the received case. The server's source delivery factory reads its original native file links from the selected source directory. When `--source-dir` is omitted, the host uses `<cases-dir>/source-bundles`.

The existing read, prepare, apply and attach commands continue the same case. Use the current case revision for a new command. Original source links resolve through the same receiving source directory passed to the case source delivery factory.

The package also preserves the sender's complete original native case snapshot. It is independent of the editable receiving case:

~~~sh
starforge merchant-implementation read \
  --cases-dir /srv/starforge/private/receiving/merchant-implementation-01/package/original-case-store \
  --case ORIGINAL_CASE_UUID \
  --revision ORIGINAL_HISTORICAL_REVISION_SHA256
~~~

That snapshot retains its original case ID, exact original immutable versions and captured head. The new working case keeps its own local identity and subsequent revisions. Use the full package manifest to select historical source editions and native archive member names.

The existing Handoffs desk can continue to download and open `support-export.json` from the original merchant MCP server. The complete package command additionally receives the separate native source archives and retains the original history. A flat Support handoff therefore remains compatible with existing consumers while the full package provides the files needed to operate every native source reference.

## Module integration

The package module exports:

~~~js
exportCaseSourcePackage({
  store, casesDirectory, id, revision, directory, exportId,
  sourceDelivery, generatedAt, python, environment, signal
});

inspectCaseSourcePackage({
  directory, expectedManifestSha256, python, environment, signal
});

receiveCaseSourcePackage({
  directory, receivingDirectory, casesDirectory, sourceDelivery,
  requestId, actor, expectedManifestSha256, python, environment, signal
});
~~~

Create `sourceDelivery` with the maintained `createCaseSourceDelivery({store,directory,python,environment})` factory. The factory exposes its canonical `directory`, original `service`, exact `resolveBundle` and `resolveFile` functions, and `close()`. Close that same factory after the operation has finished. The CLI owns this lifecycle automatically.

Archive work uses the configured Python 3 interpreter and original native SF49 modules. File transfers use bounded streaming. The original per-bundle limits apply: up to 64 declared attachments, up to 8 GiB per original attachment, and the source engine's 16 GiB complete input ceiling. The whole package metadata limit is 64 MiB, with declared ceilings of 200,000 package files and 50,000 retained case revisions.

Provision storage for the retained package, the native source service's uploaded archives and receiving files, and the working case store. The receiver retains these concrete originals to make subsequent source reopening and interrupted transfer recovery possible.
