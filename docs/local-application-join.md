# Join a complete application into the original customer programme

This local helper receives a built application through the maintained lead CLI. It reads the original application directory and the already-owned workspace on the same authorized computer. It saves complete file revisions, an immutable application package and a complete working-record export.

The helper performs no network operations. It contains no customer records and does not upload the workspace, application files or exports. Installing this public helper does not authorize access to another person's workspace.

## Installed dependency

The lead CLI is an **already-installed private dependency**, not a file supplied by this public repository:

`/authorized/commons/tools/revenue_owner_console_20261010/lead_fulfillment_cli.mjs`

Choose its real local path with `--cli`. Keep that private checkout and the original customer workspace on their authorized seat. The helper invokes the installed CLI's existing `state`, `prepare-customer-files`, `prepare-customer-package`, `apply` and `export` commands. It does not implement a second lead store or copy the private Core.

A recent supported CLI exposes these commands in `--help` and supports the native package `supersedes` and `reason` fields. The workspace must already contain the customer pack and the selected active lead edition. This operation neither creates another customer programme nor changes its lead selection, price, correspondence or sender.

Node.js 20 or newer is required. Only Node standard-library modules are used by this helper. The private CLI retains its own installed dependencies.

## Build the whole application locally

Use the application's own published CLI/builder to write its complete files into a dedicated directory. Keep its original `Files.json`, source modules, source data, operating guide, editable record and standalone HTML. An original ZIP can be present beside these members.

The helper checks every manifest-listed member against its exact byte length and SHA-256. It includes the manifest itself and every extra ZIP in that directory. It rejects missing or changed members, unlisted non-ZIP files, symbolic links, duplicate or case-colliding names and unsafe relative filenames. It does not rewrite, fragment or recompress an application member.

An extra ZIP's exact bytes are retained as supplied; its internal member equivalence is the responsibility of the application's builder. The immutable customer package generated later is a separate archive over the saved customer file revisions.

Use a dedicated directory so unrelated local files cannot enter the selected package.

## First application package

Run from the public source checkout. Replace the example paths and IDs with the original local workspace values.

```sh
node host/local_application_join.mjs \
  --cli /authorized/commons/tools/revenue_owner_console_20261010/lead_fulfillment_cli.mjs \
  --workspace /authorized/original-sales-workspace \
  --pack ORIGINAL_PACK_ID \
  --edition ORIGINAL_ACTIVE_EDITION_ID \
  --directory /authorized/built-application \
  --out /authorized/receiving/Working_Record.json \
  --operation ORIGINAL_APPLICATION_JOIN_ID \
  --package-id ORIGINAL_PACK_ID:application-v1 \
  --prefix Application \
  --title "Complete editable application" \
  --instructions "Read START_HERE.md and open the standalone workbench. Keep the complete source folder." \
  --source-url https://github.com/OWNER/PUBLIC_REPOSITORY/commit/REVIEWED_COMMIT
```

The output parent directory must already exist. Keep the output and its checkpoint directory outside the built application directory.

The `--prefix` becomes part of each customer filename. Keep the original prefix for later revisions. Exact filenames determine whether a file retains its existing ID. If an earlier programme used a different name or folder, review that existing record and choose the corresponding prefix before running. The helper will not guess aliases between differently named files.

Some existing programmes place application members under a folder but keep the original complete ZIP at the customer root. Use `--prefix Application --archive-prefix .` to preserve that exact layout. The archive override applies only to extra ZIPs outside the original manifest, not to ordinary source members. Its default is the same prefix as the other files.

New file IDs are deterministically derived from the original pack and complete relative customer filename. Existing filenames reuse their actual IDs. Existing metadata is retained; a changed file may receive the supplied public source URL. A byte-identical file keeps its current revision and seal, including its original metadata.

## Revised application

Build the complete successor edition in another dedicated local directory. Use a new output, operation and package ID, and give the actual revision reason:

```sh
node host/local_application_join.mjs \
  --cli /authorized/commons/tools/revenue_owner_console_20261010/lead_fulfillment_cli.mjs \
  --workspace /authorized/original-sales-workspace \
  --pack ORIGINAL_PACK_ID \
  --edition ORIGINAL_ACTIVE_EDITION_ID \
  --directory /authorized/revised-application \
  --out /authorized/receiving/Working_Record_v2.json \
  --operation ORIGINAL_APPLICATION_JOIN_V2_ID \
  --package-id ORIGINAL_PACK_ID:application-v2 \
  --prefix Application \
  --title "Complete editable application" \
  --instructions "Read START_HERE.md and use this complete application edition." \
  --source-url https://github.com/OWNER/PUBLIC_REPOSITORY/commit/REVIEWED_SUCCESSOR \
  --supersedes ORIGINAL_PACK_ID:application-v1 \
  --reason "Describe the actual source or operating correction."
```

If there is exactly one current package on this lead edition that overlaps these file IDs, the helper can select it without `--supersedes`; it still requires `--reason`. If several current packages overlap, select the intended predecessor explicitly. A predecessor that already has a successor is rejected. Core also validates the original customer and lead-edition ancestry.

Only changed or new files are submitted. Current byte-identical files keep their revision. The new package uses the **actual native file revision seals returned in the saved working-record export**, not a seal reconstructed from a filename or content hash. Original packages remain immutable and usable with their original file versions. Every member of the previous package outside the selected application files is inherited into the successor at its exact saved revision. This preserves customer briefs, lead CSVs, earlier companion files and any previously selected application members omitted from the new directory. Later current revisions of unrelated files do not silently replace those frozen references. The completion summary reports the inherited-member count.

To intentionally remove a previous package member, use the maintained CLI's explicit reviewed package selection instead of this additive helper. Review that selection with the original owner. An application-directory update alone is not an instruction to remove other parts of the customer package.

## Interruption and concurrent work

Each output has a companion checkpoint directory named `Working_Record.json.join`. It retains:

- original input identities, complete source manifest and selection plan;
- the original customer working record;
- complete file input and prepared native request files for every batch;
- each distinct CLI result, including retained-request or replay responses;
- package selection and its original native request;
- current-source snapshots and the final completion summary;
- the complete selected customer package ZIP.

To resume, run **the same command with the same paths, bytes and stable operation IDs**. Existing requests are replayed through the CLI's original journal. A saved preparation log is not treated as evidence that apply succeeded. The helper actually invokes `apply` on the retained request again; the maintained store decides whether it is a replay or an unapplied mutation.

Before preparing each new batch, the helper reads the current workspace seal and checks the exact preceding file IDs, revisions and seals. It checks that the newly prepared request uses that reviewed root seal. Core guards apply with that same root seal. If the source changed during preparation, the helper saves `Concurrent_Change.json` and does not apply that request or automatically rebase it on a later state. Reconcile the current source with its owner before preparing a new operation. Preserve the rejected request and its original inputs.

Completed output is never silently overwritten. The helper verifies the final record retains every original non-file field, all earlier packages and complete earlier file versions. Reopening the completed helper run checks both its saved working-record and customer-archive bytes. Native filesystem/database receiving remains the installed CLI's responsibility.

## Complete outputs

On success, standard output gives actual paths, counts and SHA-256 values for:

1. The complete original customer working record with its new application file/package revisions.
2. `Complete_Customer_Package.zip` inside the checkpoint directory.
3. The immutable package's native seal and the changed, unchanged and inherited file counts.
4. The retained native request directory for continuing the same operation.

A raw file's content SHA-256 and its native revision seal are different identities. The former identifies bytes; the latter seals the full saved file document, including its metadata. Both are preserved.

The maintained CLI has an 8 MiB ordinary-request limit. The helper batches complete files below a 7 MiB estimated request budget. A single file too large for that budget is rejected intact. The installed CLI also offers a separate complete retained-archive route with its own 64 MiB limit; use that documented original route when appropriate, rather than splitting or disguising the file.

## Review and receiving

This helper joins and exports local records. It does not send messages or perform external delivery.

Before a human-facing application or profile edition is sent, open the exact output in a real browser, look at desktop and narrow layouts, operate the main workflow, download the complete bundle and reopen its saved record. Keep that receiving work in the existing company operation. A source or callback execution is not a rendered-browser result.

The exported pure functions `planApplicationFiles`, `assertFilePredecessors`, `packageSelection` and `validateFinalJoin` let an existing application receiver use the same selection rules around the maintained Core. Production filesystem and process boundaries are explicit standard Node adapters in `runLocalApplicationJoin`.

The implementation was exercised with complete retained application files and the real maintained Core: initial receiving, exact file revisions, package selection, source-preserving reopen and an actual complete application successor. The local Node filesystem/subprocess invocation still needs execution on the authorized equipped seat when the authoring carrier has no Node process. Keep that distinction in the original receiving record.
