# Resource collections and portable receiving

A collection is an ordered, named edition of selected delivered files and analyst
notes from the original buyer resource library. The edition retains the exact file
size, SHA-256, source identity, payment-term strings and reviewed annotation.
Later changes to the inbox, annotations or collection do not rewrite an older
edition. The complete files travel in one ordinary USTAR archive.

The original `openLibrary()` SQLite index, full-file verifier, private server and
native downloader remain the implementations. Collection tables use that same
index connection. Receiving has the explicit source kind `collection`; it does
not create or replay a buyer job.

## Use the original installed command

Initialize or refresh a library through its existing inbox adapter:

```sh
starforge inbox library scan --state /private/library \
  --inbox /private/inbox --files-root /private/downloads
starforge inbox library collections serve --state /private/library
```

Open the private URL printed by `serve`. The collection page and original
resource page share one foreground service and private browser session. The
ordinary `library serve` command also includes the collection page.

Search the original index, add individual resources or all matching results, and
review their source and exact content. Name the collection and save an edition.
Selected-file order is retained. `Use current review` explicitly selects a newer
annotation; otherwise editing a saved edition retains its original snapshots.
The browser retains drafts and operation IDs. Saving an old edition against a
newer current edition returns a revision conflict rather than silently replacing
it. Loading the latest saved edition replaces the displayed draft.

`Download saved rN` packages that exact saved edition. Unsaved changes must first
be saved or replaced with the saved edition. Full file bytes, rather than the
text-search prefix, are included in the archive. Binary files are preserved.

## Receive and continue on another machine

```sh
starforge inbox library collections export --state /private/library \
  --id customer-research --revision 2 --out /private/customer-research.tar

starforge inbox library collections inspect \
  --archive /private/customer-research.tar --sha256 EXPECTED_ARCHIVE_SHA256

starforge inbox library collections receive \
  --archive /private/customer-research.tar --out /private/received \
  --state /private/receiver --sha256 EXPECTED_ARCHIVE_SHA256

starforge inbox library collections serve --state /private/receiver
```

Use the `sha256` emitted by export or the browser download when checking a known
handoff. `inspect` hashes the entire archive and every complete object. Export
creates a new file in a private directory; it never overwrites an existing file.
The receiving parent must also be private. All paths supplied to native commands
are absolute.

Receiving publishes `manifest.json` only after the complete archive and every
object validate. An interrupted receive retains its package-bound `intake.json`
and completed content-addressed objects. Repeat the same command with
`--resume true`; it rechecks incoming bytes and reuses already verified objects.
A mismatched package or an occupied destination without the matching intake is
refused. A completed receive can also be repeated after a lost response.

The original source paths and source note remain visible under each imported
resource's `origin`. Receiver-local paths and IDs are separate. Inherited notes
start at local revision zero, with their original revision retained as
`inheritedRevision`; subsequent receiver edits use the original annotation
engine. The source collection is adopted as a local edition, while its original
collection revision remains in `origin.collectionRevision`. Further reopening
preserves local collection and annotation edits.

An archive carries private source metadata, original host paths and full file
content. Distribute it only to an intended recipient with the necessary rights.
Digest checks establish byte integrity, not the identity or trustworthiness of a
sender. Imported source material remains explicitly identified as received data.

## Native API

```js
import { openLibrary } from './library.mjs';
import {
  exportCollection, receiveCollection, openReceivedLibrary
} from './collection-package.mjs';

const library = await openLibrary({state: '/private/library'});
try {
  const selected = library.search({status: 'VERIFIED', limit: 200}).items;
  const edition = library.collections.save({
    id: 'customer-research', name: 'Customer research', note: 'Reviewed selection',
    expectedRevision: 0, operationId: 'customer-research-first-edition',
    members: selected.map(r => ({
      id: r.id, sha256: r.sha256, annotationRevision: r.annotation.revision
    }))
  });
  await exportCollection(library, {
    id: edition.id, revision: edition.revision,
    destination: '/private/customer-research.tar'
  });
} finally { await library.close(); }

const received = await receiveCollection({
  archive: '/private/customer-research.tar', destination: '/private/received'
});
const receiver = await openReceivedLibrary({
  directory: received.directory, state: '/private/receiver'
});
try { console.log(receiver.collections.list()); }
finally { await receiver.close(); }
```

Search and collection lists are paginated; follow `total`, `offset` and `limit`
when selecting more than one page. The example deliberately selects its displayed
page. The browser's `Add all matching` reads every page against one unchanged
index generation.

`collections.show(id, revision?)`, `list()` and `history(id)` expose saved
editions. `save()` uses `expectedRevision` and `operationId`. Replaying an exact
save returns the original edition even after subsequent edits. Reusing that
operation ID with different input is a conflict. Member selectors bind the SHA
and displayed annotation revision. `mode: 'current'` captures the current verified
resource; `mode: 'retain'` keeps the corresponding member from the previous saved
edition. A saved edition can still be exported after its source leaves the current
index, as long as its pinned original bytes remain within the declared roots.

The default archive limit is 16 GiB, selected through `maxBytes` or `--max-bytes`.
Individual files follow USTAR's size field limit. Metadata is limited to 64 MiB
and a collection to the original source limit of 10,000 resources. File content
is streamed in 128 KiB chunks; the whole payload is never held in a JavaScript
string or browser Blob. Identical object hashes share one archived object.

## Compose a customer application

`collectionExtension(library)` returns `additionalAssets` and
`authenticatedRoute` for the original `serveLibrary()` service. Combine customer
and collection asset arrays and authenticated handler arrays. Handlers receive
`request`, `response`, `url`, `send`, `signal`, `body(maximum?)` and
`registerDownload(produce)`. They return `true` only when handling their namespace.
The collection API is `/api/collections`; original `/api/resources` remains the
resource and annotation API.

`registerDownload` reserves capacity before invoking `produce(signal)`. Return a
native descriptor `{file, bytes, sha256, resource: {id, name}, dispose}`; the
original single-use transfer route streams it and owns disposal. Collection and
resource downloads share the original four transfer slots, cancellation, expiry,
origin checks and private-session check. Customer applications therefore do not
need another downloader, session or resource index.

`library.d.mts` and `collection-package.d.mts` describe the native API. The source
journey `collections-acceptance.mjs` exercises original indexing, revisions, exact
archive receiving, source-independent reopening and retry recovery with local
files. Native HTTP checks additionally exercise shared transfers and auth.

Format references: [GNU USTAR layout](https://www.gnu.org/software/tar/manual/html_node/Standard.html)
and [Node 22.16 file handles](https://nodejs.org/download/release/v22.16.0/docs/api/fs.html).
