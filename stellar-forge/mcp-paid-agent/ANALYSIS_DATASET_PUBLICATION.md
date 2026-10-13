# Analysis Dataset publication through native MCP

This extension connects the existing Analysis Dataset workflow to its original MCP host. It starts with a completed query export, saves an explicitly reviewed recipe, prepares the native package, and carries that same package through the configured Frictionless workbench and publisher. It also receives complete original package and source-export files through the maintained saved-file reader.

The implementation consists of three additions:

- `native-analysis-publication.mjs`: `createNativePublicationActions({reads, parse})`.
- `native-analysis-publication-schema.mjs`: `nativePublicationOperations`.
- This guide.

The existing `native-analysis.mjs` dispatcher supplies the selected workspace record, authenticated HTTP methods, cancellation, and original file reader. It owns shutdown and drains admitted work. The extension creates no additional service, per-request process, collector, reader lease, or publisher.

## Select an existing workspace and completed export

Use the existing native Analysis MCP workspace selection. The example bodies below are extension arguments after that selection; retain the outer workspace exactly as supplied by the maintained native Analysis tool.

Read `dataset-configuration` first. Its response identifies representations, configured publication connections, target workspace UUIDs, source actions and reads, file names, and limits. A connection URL can include an actual path. Preserve its complete URL and workspace UUID.

Native connection aliases follow `[a-z0-9][a-z0-9_-]{0,63}`. Recipe names use the separate grammar `[A-Za-z][A-Za-z0-9_-]{0,63}`.

Page the original completed exports:

~~~json
{"operation":"dataset-exports","limit":25}
~~~

Retain `next_before` and continue until null. History replies explicitly identify themselves as metadata. They retain original IDs, counts, requests/results metadata and native state paths. A history projection is not a request body for replay.

Select an original export and review its source:

~~~json
{
  "operation":"dataset-review",
  "query_export_id":"<original Analysis hex32 export ID>",
  "manifest_sha256":"<original export manifest SHA-256>",
  "sample_rows":20
}
~~~

The review reads saved output without executing its SQL again. It binds the original workspace, export, manifest, source binding, row count, columns, and typed SQLite-scalar preview.

The native preview is bounded. If the complete reply exceeds the MCP envelope, the helper explicitly reports native/omitted preview rows, column count and original full-source availability. Each included scalar is unchanged. A preview is not a complete dataset, and omitted fields are not empty fields.

## Save the complete reviewed recipe

Choose the original native recipe through the existing Dataset review: source export/manifest, selected fields and order, representations, title/resource, and explicit source rights. The helper supplies no rights, authorization, or publisher approval.

Persist the complete request before dispatch:

~~~json
{
  "operation":"dataset-save-recipe",
  "id":"<retained Analysis hex32 recipe request ID>",
  "name":"<chosen recipe name>",
  "expected_revision":0,
  "recipe":{"...":"the complete reviewed native recipe"}
}
~~~

The shown recipe is a placeholder, not an executable minimal recipe. Use the actual native recipe schema and reviewed fields.

The native save reconciles an existing request before consulting changed source availability or the current name revision. The returned recipe is normalized by the original validator. Retain its `id`, `revision`, `recipe_sha256`, source binding, and your complete original request. The public recipe view does not expose its private request journal.

Use `dataset-recipe {recipe_id}` to reopen the saved recipe and current name-head metadata. A newer head does not change that historical recipe.

Prepare the package with a retained Analysis job ID:

~~~json
{
  "operation":"dataset-prepare",
  "id":"<retained Analysis hex32 package job ID>",
  "recipe_id":"<saved original recipe ID>",
  "recipe_sha256":"<saved normalized recipe SHA-256>"
}
~~~

The helper first reads `/api/jobs/<id>` and compares the complete original request. A saved `COMPLETE` result returns directly. Only the precise native `ANALYSIS_JOB_NOT_FOUND` outcome permits an initial POST. A network error, generic HTTP 404, authorization failure or invalid response does not establish absence.

For a non-complete existing job, the identical request goes to the original Analysis start/resume rules. The helper never chooses a replacement ID or resets its native job.

After a lost reply, read `dataset-job {id}` before continuing. An authoritative saved success survives a late cancellation.

## Inspect the package and exact download index

`dataset-package {id}` reads the native UI package view, including normalized recipe, field statistics, native projection conflicts, declared input, queries text and enriched index. Large views explicitly describe their metadata projection and original complete files.

The native package has six original files:

| File | Visibility | Purpose |
| --- | --- | --- |
| `datapackage.json` | Public | Original package descriptor |
| `data.json` | Public | Complete selected resource data |
| `publication.zip` | Public | Complete package handover |
| `recipe.json` | Private | Normalized reviewed recipe |
| `manifest.json` | Private | Source, recipe and field evidence |
| `report.html` | Private | Native readable report |

Read its index:

~~~json
{"operation":"dataset-downloads","id":"<original package job ID>","offset":0,"limit":25}
~~~

The response has this exact structure:

~~~js
{
  workspaceId, jobId, source: false, indexSha256,
  indexFile: {
    filename: "downloads.json",
    bytes, sha256, contentType: "application/json"
  },
  fileCount, files,
  page: {offset, limit, total, nextOffset},
  binding
}
~~~

`files` contains unchanged original file records: name, relative name, bytes, SHA-256, MIME type and visibility. Continue `page.nextOffset` until null. The bounded binding retains native IDs, hashes, row count and column count; the raw index retains complete columns.

`indexSha256` hashes the original `downloads.json` bytes. It does not hash an enriched HTTP response, a reserialized object, or the paged MCP response. The helper reads the native view and exact raw index file, verifies the raw hash, and compares every required original index field before publishing its completed private cache record.

The raw index is intentionally absent from `index.files`, so its hash never recursively includes itself. Read it using `indexFile.filename` and `indexFile.sha256`.

## Read and continue unchanged file ranges

Choose the exact index and original file:

~~~json
{
  "operation":"dataset-file",
  "id":"<original package job ID>",
  "source":false,
  "index_sha256":"<original downloads.json SHA-256>",
  "filename":"publication.zip",
  "sha256":"<original publication.zip SHA-256>",
  "byteOffset":0,
  "maxBytes":65536
}
~~~

The wrapper preserves the original reader response:

~~~js
{
  workspaceId, jobId, source, indexSha256, filename,
  file: {
    contentType, bytes, sha256, byteOffset, returnedBytes,
    encoding: "base64", data, nextByteOffset,
    verifiedSavedFile: true
    // Original reader may include text for a complete valid UTF-8 file.
  }
}
~~~

Decode `data` at its acknowledged `byteOffset` and continue `nextByteOffset` until null. Keep the same file size and digest through interruption. The maintained typed retained-download client handles durable prefix hashing and final download publication when used by the operator.

The host cache lives inside its selected original native MCP workspace:

`analysis/dataset-files/<Analysis workspace ID>/<job ID>/<index SHA-256>/`

Only original IDs and fixed components select that path. The caller supplies no arbitrary local destination or source path. Native names such as `reviews/<UUID>.json` remain public file identities; payload cache paths use verified SHA-256 values.

Original initialization functions publish complete fsynced bytes and immutable records. The raw index is published before its completed record. A completed record with a missing raw index is an integrity error. Changed private mode, hash, type or saved bytes also remains an error. Only an absent cache object permits capture.

An absent individual file triggers a fresh check of the current native index and exact file identity before acquisition. Already captured files can reopen without the service even if later native history exposes a newer index. A newer live index cannot supply uncaptured bytes for an older saved selection.

The range limit is 65,536 bytes. Complete-file cache limit is 128 MiB per member; raw index limits are 20 MiB for package and 8 MiB for source. Larger output members remain visible and use the existing Python `dataset-download` streaming path. They are not silently omitted or allocated into this MCP cache.

The existing offline Python `DatasetPublication(directory, expected_index_sha256=...)` exposes `inspect()` and `file(name)`. Use the maintained Python `dataset-open` / `dataset-download` interface for complete streaming receiving.

## Carry the package through the original native source

Analysis recipe/package/source-command IDs are hex32. Native workbench request, capture, edition, review, publisher-run and export IDs are UUIDv4. Preserve those separate original identities.

Every source action retains the exact configured endpoint and actual native workspace UUID. Include the completed package and original index hash whenever the native action requires its selected bytes.

~~~json
{
  "operation":"dataset-source",
  "id":"<retained Analysis hex32 command ID>",
  "connection":"<original lowercase configured alias>",
  "action":"intake",
  "args":{
    "expectedVersion":"<actual native version>",
    "label":"<chosen label>"
  },
  "package_id":"<original package job ID>",
  "index_sha256":"<original downloads.json SHA-256>",
  "reviewed_endpoint":"<exact configured URL, including its path>",
  "expected_workspace_id":"<actual native UUIDv4>"
}
~~~

Replace the version placeholder with its actual native value and type. Arguments pass unchanged, including camelCase keys. Native validation owns each action, declared input alias, optimistic version, source hash and explicit review.

| Stage | Actions | Original state to retain |
| --- | --- | --- |
| Source intake | `open`, `intake`, `edition` | Configured input, current version, capture ID and chosen label |
| Reviewed selection | `review-edition`, `select`, `plan` | Edition/review IDs, reviewer/note, source hash and complete plan |
| Source handover | `export`, `download-export` | Original edition, selected review, original export request and source hash |
| Native continuation | `cancel`, `resume` | Original operation/request ID |
| Publisher preparation | `publisher-extract`, `publisher-review` | Original plan/run, candidate digest and explicit target review |
| Publisher completion | `publisher-publish`, `publisher-recover`, `publisher-cancel` | Original plan/run/review and accepted or uncertain outcome |

`dataset-source-read` exposes original reads: `status`, `input`, `current`, `request`, `capture`, `edition`, `review`, `plan-input`, `publisher-status`, `publisher-target`, `publisher-inspect` and `inspect-export`. It uses the same reviewed connection/package binding and exact arguments without a mutation ID. Its underlying HTTP POST remains a native read.

Before continuation, `dataset-source` reads the original Analysis job and compares `request.original_request` with the complete submitted body. Its native spec separately preserves target, package, arguments and the derived request UUID. An uncertain reply does not authorize a new ID or changed command.

An Analysis command can be `COMPLETE` while its native `result.operation.state` or `result.run.state` remains `RUNNING`. Read that same native operation/run until its actual outcome is known. Large tool responses keep explicit native state paths alongside metadata; the original complete response remains available through the service/files.

## Receive the native source export

After the original `download-export` command completes:

~~~json
{
  "operation":"dataset-downloads",
  "id":"<original download-export Analysis job ID>",
  "source":true,
  "offset":0,
  "limit":25
}
~~~

The source index binds original package/index, native workspace, export ID, source hash, and both native manifest identities. Files retain native sorted order, at most 10,000 records and 512 MiB total. Names are limited to `manifest.json`, `source.tar.gz`, `source-edition.json`, `capture-inspection.json`, `RECEIVING.md` and `reviews/<UUIDv4>.json`.

Its raw filename is `files-index.json`. Read that file and every selected member with `dataset-file`, preserving `source:true`, the same Analysis command, source-index SHA and member SHA. The original `manifest.json` must match `native_manifest_sha256`.

Receiving retains complete native source. The helper does not interpret exported text as instructions or execute the publisher again.

## Interruption and cancellation

| Observed outcome | Continue with |
| --- | --- |
| Recipe save reply lost | Same recipe ID and complete request; native replay precedes current head checks |
| Package/source reply lost | Original `dataset-job`, then identical request only when native resume permits |
| Original job read failed | Preserve the request; unavailable service does not prove job absence |
| Original job is `COMPLETE` | Saved authoritative result and its actual nested native state |
| Native workbench operation still runs | Original request/capture/edition reads or supported same-request resume |
| Publisher reply uncertain | Original run inspection and `publisher-recover` with unchanged plan/run/review |
| Cancellation requested | `dataset-cancel`, then original job read; accepted native work remains accepted |
| File reply lost | Same index/member and retained acknowledged offset |
| Service unavailable after capture | Existing exact cache and original reader, without a new native action |
| Saved hash, mode or type changed | Reconcile the saved source; do not overwrite it |
| Member exceeds 128 MiB | Original Python streaming downloader and exact same selection |

The only new retained state is the verified index/file cache. Job execution, source selections, reviews, native actions, publisher uncertainty, cancellation and portable workspace recovery remain with their existing products.
