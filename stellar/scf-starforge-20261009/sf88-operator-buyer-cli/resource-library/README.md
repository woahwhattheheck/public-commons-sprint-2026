# Buyer resource library

Find and use files delivered by the original SF88 buyer. The library connects
cross-intent content search, source inspection, exact file downloads and durable
analyst reviews in one private workspace. Its native CLI and browser share the
same implementation and SQLite index. Node 22.16 or newer supplies the runtime;
the library adds no external dependencies.

## Open your existing inbox

Use the installed original inbox command. Choose a separate private state
directory and explicitly declare the directories containing your delivered files.

```sh
starforge inbox library serve \
  --state /private/buyer-library \
  --inbox /private/buyer-inbox \
  --files-root /private/downloads
```

From a source checkout, replace `starforge inbox library` with
`node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/cli.mjs`.
Open the private loopback URL printed by the command. Choose **Refresh source**,
search for words in your delivered files, select a resource, and use **Verify and
preview** or **Download exact file**. Notes, tags, stars and selection survive
restarts. Reopen with just the same state directory:

```sh
starforge inbox library serve --state /private/buyer-library
```

`--port 8769` chooses a specific loopback port. The default selects an available
port. The private session credential rotates on every launch. Keep the printed
URL within your operator session. Stop the foreground server with Ctrl+C.

The source and file roots are pinned when the library is created. Supply multiple
`--files-root` arguments for multiple delivery directories. Initial optional
`--max-file-bytes` and `--index-bytes` values select maximum verified file size and
searchable UTF-8 prefix size. Defaults are 1 GiB per file and 1 MiB of indexed
text; the text prefix can be increased to 16 MiB. Limits and roots are retained
with the workspace. A separate state directory supports a different declaration.

## Use an original list export

The original inbox list command also provides a portable inspection interface
for environments where the queue has already been read:

```sh
umask 077
starforge inbox list --root /private/buyer-inbox > /private/inbox-list.json
starforge inbox library serve --state /private/export-library \
  --snapshot /private/inbox-list.json --files-root /private/downloads
```

Snapshot mode consumes this exact JSON array. Its refresh reads the current file
at that declared path; update the export to pick up newer inbox records. File
paths continue to refer to operator-accessible original deliveries. Each completed
refresh records its source SHA-256, resource coverage and excluded-record reasons.

## Review and reuse

Search matches words across source labels and the verified text prefix. Results
show `COMPLETE`, `PREFIX` or `BINARY` coverage with explicit indexed-byte counts.
JSON is displayed as original decoded text, preserving large integer literals
and formatting. Seller-supplied HTML and scripts are displayed as text.

A completed refresh publishes one complete generation. Search remains available
against the prior generation during another refresh. Cancellation preserves that
prior generation. After a process interruption, the next scan detects a stopped
same-host writer and reclaims its derived staging generation; Linux also checks
process start identity to distinguish PID reuse. An active writer continues to
own its current scan. The original inbox, delivery files and payment records stay
under their existing implementations.

Every preview hashes the complete current file against the original delivery's
size and SHA-256. Downloads stream a private verified copy of those same bytes,
so later changes to the original path cannot change the download. POSIX temporary
copies are unlinked while open and reclaimed by the operating system if the
process ends. The browser receives a short-lived, single-use file transfer and
streams through its native download facility. Four file transfers may be prepared
or active concurrently. Failed and partial deliveries remain visible as
`INCOMPLETE`; changed, missing and outside-root files remain `UNAVAILABLE`.

Analyst reviews use append-only revisions and explicit expected revisions.
Replaying the same operation ID and payload returns its saved result after a lost
reply. Concurrent edits produce `ANNOTATION_REVISION_CONFLICT` and retain the
browser draft. **Load saved review** retrieves the current saved version. The
revision history can copy a prior review into the draft for another explicit save.
**Export review** includes current source references and every saved review
revision, including reviews whose resource has since left the current inbox.

The displayed buyer status and HTTP status are copied from the original outcome.
The file's verification and the analyst's notes occupy their own fields. Request
URL query strings, fragments and user information are omitted from the derived
view. The original intent ID and config SHA-256 identify the source request.

## Native commands and API

```sh
starforge inbox library scan --state /private/buyer-library
starforge inbox library search --state /private/buyer-library --query 'copper conduit'
starforge inbox library search --state /private/buyer-library --starred true --offset 0 --limit 50
starforge inbox library show --state /private/buyer-library --id RESOURCE_ID
starforge inbox library preview --state /private/buyer-library --id RESOURCE_ID
starforge inbox library download --state /private/buyer-library --id RESOURCE_ID --out /private/copy.json
starforge inbox library export --state /private/buyer-library --out /private/review.json
```

Output files are create-only in an existing private directory. CLI annotations
use `annotate --id RESOURCE_ID --annotation /private/note.json`, where the JSON
object contains `expectedRevision`, `operationId`, `note`, `tags` and `starred`.

```js
import { openLibrary } from './library.mjs';
const library = await openLibrary({
  state: '/private/buyer-library', kind: 'inbox',
  source: '/private/buyer-inbox', roots: ['/private/downloads'],
});
try {
  await library.scan();
  const matches = library.search({ q: 'copper conduit' });
  const resource = matches.items[0];
  if (resource) {
    const preview = await library.preview(resource.id);
    console.log(preview.text);
    library.saveAnnotation(resource.id, {
      expectedRevision: resource.annotation.revision,
      operationId: 'supplier-review-2026-10-11-01',
      note: 'Compare these quantities with the current order file.',
      tags: ['supplier-review'], starred: true,
    });
  }
} finally { await library.close(); }
```

`download()` returns an open verified `file` handle and a `dispose()` function;
call `dispose()` in a `finally` block after consuming its stream. The companion
`library.d.mts` describes the native API. `serveLibrary(library)` in `server.mjs`
embeds the same browser and returns `url`, `origin` and `close()`.

Run the local source/file/HTTP/review/restart journey with:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/acceptance.mjs
```
