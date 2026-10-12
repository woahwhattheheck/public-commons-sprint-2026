# WebDAV source workspace

A complete local source-to-merchant workflow for a configured WebDAV or Nextcloud
collection: inspect original file properties, retain exact selected bytes, recover
an interrupted conditional transfer, review an explicit public projection, build
an immutable native dataset, and operate its existing seller and customer handoff.

The source adapter performs only PROPFIND and GET. Its file cache and projection
records feed the **existing** dataset loader, Socrata publisher, SF82 release
manager, and SF88/SF100 customer engines. Those engines retain their native
version, release, operation, buyer, approval and accounting identities.

This is useful when an organisation already maintains reports or data extracts
in an access-controlled document collection and wants to offer a reviewed subset
as a queryable merchant product. The collection remains the original source.
Publishing a new edition is an explicit operator decision.

## Start the original application

Use the complete matching Stellar Forge source or its maintained merchant
distribution. Linux, Node 22.16 or newer, Python 3.11 or newer with Expat 2.6 or
newer, and util-linux flock are required. Python is used for the existing hardened
XML parser and streaming source-packet reader. This component adds no npm
dependency. The full publisher and payment path uses the native dependencies
already declared by the selected merchant distribution.

From this directory:

~~~sh
node cli.mjs serve --directory /absolute/private/webdav-workspace --port 0
~~~

The process prints one WEBDAV_OPERATOR_READY JSON record with its actual
loopback URL, workspace identity, revision and PID. Open that URL on the same
computer. The page uses the same workspace instance and lease as its CLI/API.
SIGINT or SIGTERM closes source requests, drains accepted work and shuts down
only original seller processes owned by that instance.

The existing [runtime profile](../../distribution/RUNTIME.md) and
[runtime installer](../../distribution/RUNTIME_INSTALL.md) manage native
dependencies for the selected source archive. Use its native/operator profile;
keep its exact source, installed dependency lock and original buyer workspace.
The WebDAV field projector imports the maintained SFTP helpers, but it never
opens an SSH connection and does not need an SFTP account.

The shared source closure includes
[socrata/publisher.mjs](../socrata/publisher.mjs),
[socrata/PUBLISHING.md](../socrata/PUBLISHING.md), and
[SF82 release-dataset.mjs](../../sf82-seller-pilot/release-dataset.mjs).
The maintained SF82 dataset adapter uses the original authenticated loopback
controller, so the same seller can operate on hosts that do not support its
optional Unix-domain socket transport.

### Seven operator views

1. **Source connection:** create, load, edit, validate and download a source
   declaration; inspect the presence of its named host environment references.
2. **Collection and files:** read the actual multistatus document, browse
   immediate collections, examine each property outcome and select a file
   version.
3. **Captures and recovery:** inspect retained complete/partial bytes, pause the
   original read, resume its exact capture, and download original bytes and
   receipts.
4. **Public projection:** inspect actual record ordinals and field types, choose
   explicit public names/pointers/types/null rules, and save the capture binding.
5. **Dataset and merchant:** review and build an immutable dataset, opt into native
   query capabilities, preview real native pages, validate public merchant terms,
   and export the original publisher input.
6. **Publisher and customer:** prepare or update an existing merchant product,
   stage/select/start/drain its native release, publish reviewed candidates, read
   actual seller offers and operate retained original customer acquisitions.
7. **Handoff and history:** create a portable source packet, reopen original
   operation results, and continue an explicitly reviewed source decision after
   a lost response or revision change.

The interface uses neutral gray/white tables, visible labels, keyboard-accessible
controls, a mobile navigation strip and horizontally scrollable data tables.
Editing controls are suspended while a state-replacing operation is pending.
Local drafts remain available after revision conflicts, response loss and
unreadable completion responses.

## Declare one original collection

A source declaration uses schema stellar-forge.webdav-source.v1. The following is
a configuration template; replace the example collection URL and environment
names with the actual selected account and host references.

~~~json
{
  "schema": "stellar-forge.webdav-source.v1",
  "connection": {
    "rootUrl": "https://cloud.example.com/remote.php/dav/files/account/reports/",
    "auth": {
      "type": "basic",
      "usernameEnv": "WEBDAV_USERNAME",
      "passwordEnv": "WEBDAV_APP_PASSWORD"
    },
    "allowLocalHttp": false
  },
  "limits": {
    "maxListingBytes": 4194304,
    "maxEntries": 10000,
    "maxFileBytes": 67108864,
    "timeoutMs": 30000,
    "maxCaptureMs": 600000
  }
}
~~~

Authentication is one of:

| Type | Host references |
| --- | --- |
| none | No Authorization header |
| basic | usernameEnv and passwordEnv |
| bearer | tokenEnv |

The connection can also declare caFileEnv, an environment name whose value is the
absolute path of the host's additional CA bundle. TLS certificate verification
remains enabled. Credential values, cookies and authorization headers are not
written into source declarations, HTTP receipts or public exports. The host
environment is consulted for each request, allowing its existing credential
management to renew values without rewriting source data.

Collection URLs must be HTTPS with an explicit final slash. A local native server
can use HTTP only when allowLocalHttp is true and the host is localhost,
127.0.0.1 or ::1. URL user information, queries, fragments, path traversal and
encoded path separators are rejected.

Every resource and redirect must remain on the configured origin and below the
configured collection. Up to four same-scope 301/302/307/308 redirects are
supported. Temporary object-store download URLs returned as unrelated WebDAV
properties are not followed. This preserves the original collection and its
authorization boundary.

### Limits

| Field | Default | Supported range |
| --- | ---: | ---: |
| maxListingBytes | 4 MiB | 1 KiB–16 MiB |
| maxEntries | 10,000 | 1–20,000 |
| maxFileBytes | 64 MiB | 1 byte–256 MiB |
| timeoutMs | 30,000 | 1,000–120,000 |
| maxCaptureMs | 600,000 | 1,000–3,600,000 |

timeoutMs is the connection inactivity timeout. maxCaptureMs also bounds the
overall request/redirect duration. Limits are explicit source configuration,
not estimated provider quotas.

## Preserve collection semantics

PROPFIND requests Depth 0 or 1 and the named DAV properties displayname,
resourcetype, getcontentlength, getcontenttype, getetag and getlastmodified,
plus Nextcloud/ownCloud fileid, id and metadata_etag properties.

The complete bounded XML is saved first. It is parsed by the existing
[XML source parser](../xml/xml_source.py), including its namespace handling and
DTD/entity restrictions. Every response and propstat status is retained.
Only successful individual properties supply the selected file metadata:

- a missing content length remains unknown, not zero;
- a weak ETag remains weak;
- the exact DAV ETag property is retained separately from its HTTP encoding;
  a bare opaque property, as returned by WsgiDAV, is quoted for If-Match and
  must still equal the actual HTTP response's strong ETag;
- a 404 property is not treated as a missing resource if the other successful
  resource properties identify a usable file;
- duplicate response hrefs are marked unselectable on both occurrences;
- off-collection or ambiguous hrefs remain visible as individual issues;
- original file IDs are strings and are retained without numeric coercion.

The UI pages a retained listing. It does not imply that the remote PROPFIND
server supplied pagination or that Depth 1 recursively enumerated a whole tree.
Browse a child collection explicitly to inspect its children.

The original XML and normalized property receipt can both be downloaded.
A failed XML parse still retains the original XML plus its parse-error receipt.

## Capture and continue the original file

Selecting a file creates an explicit capture UUID bound to:

- the normalized source declaration;
- original href;
- the selected HTTP ETag, with its exact reported DAV property retained;
- known content length and last-modified value;
- an optional separately known expected SHA-256.

WsgiDAV's documented `get_etag`/HTTP convention is [described in its original
provider API](https://wsgidav.readthedocs.io/en/latest/_autosummary/wsgidav.util.checked_etag.html).
The complete original XML remains the source for this normalization.

A strong selected ETag is sent as If-Match. A complete bounded response can also
be captured without a strong ETag; its receipt identifies that weaker
complete-response condition explicitly. A remote metadata checksum is never
silently promoted into a verified content digest.

Each capture retains intent.json, progress.json and body.part. At every receive
interval of at least one MiB, the partial file is synced before its prefix length
and SHA-256 are atomically recorded. A pause or transport interruption retains
the same original capture and transfer attempts.

On continuation:

1. The durable prefix is hashed again.
2. Bytes written after the last durable checkpoint are retained as a separately
   named uncheckpointed tail before the receiver returns to its verified prefix.
3. A strong original validator is required for a nonempty partial.
4. The same GET uses If-Match and an exact Range starting at the retained offset.
5. The actual ETag, Content-Range, known size and byte count must match the
   original capture before the transfer can complete.

A server that ignores Range, changes the original file or cannot provide a
strong content validator leaves the partial intact. Read the new file version
and create a new capture when needed. A complete original checkpoint can be
recognized from an exact matching 416 range response without discarding its
bytes.

transfer.json records the completed byte hash before final publication as
body.bin. Reopening a completed capture uses its local original bytes and needs
no HTTP request. Mapping, dataset creation and downloads verify those retained
bytes. Read-only status polling does not finalize an active transfer.

Content encoding is identity. Automatically decompressing a response would
change its byte identity and range meaning, so an unexpected Content-Encoding
is rejected.

## Review a lossless public projection

CSV, JSON and NDJSON use the unchanged
[SFTP formats](../sftp/formats.mjs) and original dataset encoder. JSON selects an
array with a JSON Pointer; CSV and NDJSON use an empty recordsPointer. A maximum
of one million source records is supported.

The complete file is read and hashed while sampling. At most 100 selected sample
records and two MiB of displayed record bytes are retained in a sample.
Each displayed record retains its actual original ordinal, including when
the display byte limit skips a larger sample record. A legitimate header-only
CSV can still provide the original column names and build a zero-row edition.

The saved projection explicitly names one to 64 public columns:

~~~json
{
  "format": "csv",
  "recordsPointer": "",
  "columns": {
    "record_id": {
      "pointer": "/record_id",
      "type": "string",
      "nullable": false,
      "missing": "error"
    },
    "quantity": {
      "pointer": "/quantity",
      "type": "integer",
      "nullable": true,
      "missing": "null"
    }
  }
}
~~~

This is a projection template, not a source observation. Use the actual sampled
field pointers. Public types are string, integer, number or boolean. IDs and
exact decimal lexemes can remain strings. Native numeric conversion is explicit;
unsafe integers and ambiguous nullable CSV output are rejected by the maintained
encoder rather than rounded or silently merged.

The mapping records both the completed capture SHA-256 and the canonical
projection hash. Dataset approval binds those exact hashes plus a reviewer and
note. An interrupted incomplete edition remains retained and is not presented
as a completed native dataset; build a new reviewed edition from the same
completed capture.

The original dataset supports explicit equality filters, ranges, sorts, selected
fields, limits and continuation. Filters, ranges and sorts are each opt-in and
name at most eight exposed columns. Its original compiler enforces the query
parameter budget and rejects unsupported boolean ranges.

See the existing [dataset query guide](../DATASET_API.md) and the actual selected
edition's native description for query names. The WebDAV workspace sends query
text to loadDatasetConfig().admit()/handle() unchanged. It implements no second
query evaluator.

## Export and operate the native merchant

Save public merchant origin, route and the original payment fields:

- scheme;
- network;
- asset;
- amount as an exact atomic **string**;
- payTo;
- maxTimeoutSeconds.

The existing buildDatasetSellerConfig validates and compiles these terms against
the actual selected dataset. No key, payer or account is generated here.

The reviewed merchant export contains:

| File | Meaning |
| --- | --- |
| dataset.csv | Exact public dataset bytes |
| dataset.json | Original native dataset configuration |
| source.json | Original file/capture/projection/review provenance plus the explicit shared sourceFiles inventory |
| seller.json | Original compiled seller definition |
| webdav/ | Exact original declaration, capture and transfer history, collection XML/property receipts, mapping, merchant review, and complete reviewed edition |
| manifest.json | Export identity, review, source-closure totals and every file's byte length and hash |

Prepare the export into a new or existing product. The existing Socrata publisher
holds its original draft store, dataset version store, release packages and buyer
sessions beneath publishers/PRODUCT_UUID. This use is independent of the source
protocol: the four original entrypoints remain compatible. The shared sourceFiles extension, merged through PR1409, carries the declared original provider bytes into the same publisher package and SF82 release. It requires the current matching source runtime; keep the complete exported directory together. The edition's unmodified source.json remains under webdav/edition/source.json.

The publisher view provides the original command set and current native
parameters. Useful sequence:

1. Prepare the reviewed export.
2. Stage its original dataset candidate through SF82.
3. Activate the displayed release selection using its exact generation.
4. Start the original seller.
5. Preview and publish later candidates using the displayed original
   expectedSnapshot and expectedRevision.
6. Read the actual seller offer for the chosen published snapshot and query.
7. Prepare that reviewed original buyer request.
8. Bind an existing original operator workspace and explicit page/atomic limits.
9. Run, recover, account or export that existing acquisition explicitly.

The UI exposes a readable parameter form for every original publisher command,
plus direct preparation and download controls. Its JSON editor retains exact
atomic strings. Customer requests, native dataset CSV, draft reviews and
acquisition manifests are downloadable through the original publisher's
readExport methods. The original acquisition export also reports its retained
delivery directory and native report.

No scheduler, autonomous payment retry, replacement ledger or synthetic offer
is introduced. A source packet is not a funded buyer workspace. Existing
terminal approval and original operator policy remain authoritative for the
selected acquisition.

## Original operation continuity

Every source-workspace mutation carries:

~~~json
{
  "action": "source.catalogue",
  "expectedRevision": 4,
  "operationId": "the-original-uuid",
  "input": {"href": "", "depth": 1, "limit": 200, "offset": 0}
}
~~~

The example UUID is descriptive and must be replaced by the real retained ID.
The service persists the original intent before dispatch. The intent and result
are separate hashed files; large source samples and native results do not
accumulate inside workspace.json.

A completed identical ID returns its original result. The same ID with different
semantic input is rejected. Source operations serialize under the existing
Linux workspace lease. The original publisher maintains its own native
operations and writer ownership.

The browser saves its intended ID, parameters and original expected revision
before sending. If the response is lost or unreadable:

- Read that original operation.
- If it completed, reopen its saved result.
- If it is still active, observe or explicitly pause the original source read.
- If the ID is not yet recorded, continue the same original source intent with
  its original expected revision.
- If the service reports a genuine stale revision, inspect the current state.
  The explicit reviewed-revision continuation first reconciles that exact ID
  again, then uses the same original body and ID at the revision actually
  reviewed.
- If a native publisher mutation has an unknown result, inspect the existing
  original publisher and use its native recovery path.

A second new submission of the same unresolved source decision is prevented.
A recorded failure or interruption is a known outcome and does not permanently
disable new corrected source work. Exact completed or partial captures remain
available for their existing continuation.

Source selections that were reserved before an interrupted process can be
continued under the same ID. When other saved work has advanced since that
reservation, the continuation requires explicit review of the current revision.
It cannot silently reassert an older active-source selection over newer work.

## Portable source packets and new-host reopening

Create a source packet in the Handoff view or run:

~~~sh
node cli.mjs export-source --directory /absolute/private/webdav-workspace
~~~

The completed archive is created under packets/ORIGINAL_OPERATION_UUID.zip.
Its manifest declares schema stellar-forge.webdav-source-packet.v1 and every
retained member's original path, size and SHA-256.

The packet includes the source projection of workspace.json and these existing
source families:

- sources and exact source declarations;
- cache/listings XML and property receipts;
- cache/captures original intent, checkpoints, bytes, transfer receipts and tails;
- mappings;
- completed and retained incomplete editions;
- merchants and complete source-bearing exports, including every declared webdav/ member.

Source packets exclude native publisher directories, operation journals, active
leases, packet archives and transient atomic-write files. They do not move an
absolute release-store binding or buyer workspace. Keep the original host's
native publisher, keys, ledger, policy and acquired result directories with its
normal host backup.

A receiver uses the same source code:

~~~sh
node cli.mjs inspect-source --input /absolute/webdav-source-packet.zip
node cli.mjs import-source \
  --input /absolute/webdav-source-packet.zip \
  --directory /absolute/new-private-workspace
node cli.mjs serve --directory /absolute/new-private-workspace --port 0
~~~

Inspection streams and hashes all original members. Import creates a new private
directory and a new workspace identity, while preserving original source,
capture, mapping, edition, merchant and product-reference IDs. The exact incoming
workspace projection remains in imported-workspace.json; the import receipt
retains its original source workspace/revision and archive hash.

The archive's exact declared set is checked, including duplicate paths,
traversal, member type, compression, file limits and actual expanded bytes.
Limits are 8,000 source files, 256 MiB per member and 512 MiB expanded content.
The entire archive is hashed and checked for change during reading. A failure
keeps the original workspace and any newly created incomplete destination.
It never overwrites an existing recipient directory.

After import, inspect retained source and edition bytes, then prepare an existing
merchant export through the original publisher at that host. Reusing a completed
capture needs no live WebDAV service. Continuing an incomplete capture requires
its actual source connection and original strong validator.

## CLI and JavaScript API

~~~sh
node cli.mjs --help
node cli.mjs state --directory /absolute/private/workspace
node cli.mjs operation --directory /absolute/private/workspace --id ORIGINAL_UUID
node cli.mjs act source.save \
  --directory /absolute/private/workspace \
  --input /absolute/private/save-source.json
~~~

For source.save, save-source.json contains the input wrapper
{"source": SOURCE_DECLARATION}. Other actions take their exact input object.
Input JSON files are private regular files; use mode 0600.

act accepts --operation-id and --expected-revision. Without them, a new command
reads the current revision once, allocates a UUID, prints that exact intention
to stderr, then dispatches one operation. It does not automatically retry a
revision conflict. Keep the ID and original input for recovery.

Starting publisher.release.start through publisher.act retains the CLI process.
SIGINT or SIGTERM drains its owned original seller. Other commands close their
workspace and return their JSON result.

~~~js
import { openWebDavWorkspace } from './workspace.mjs';

const workspace = await openWebDavWorkspace({
  directory: '/absolute/private/workspace',
  environment: process.env,
  python: '/absolute/python3',
});
try {
  const saved = await workspace.inspect();
  const result = await workspace.act('source.catalogue', {
    expectedRevision: saved.revision,
    operationId: crypto.randomUUID(),
    input: { href: '', depth: 1, limit: 200, offset: 0 },
  });
  console.log(result.operation.id, result.result.total);
} finally {
  await workspace.close();
}
~~~

Additional maintained entrypoints:

| Module | Exports |
| --- | --- |
| source.mjs | openWebDavSource, buildDatasetEdition |
| config.mjs | source/projection validation and canonical content identity |
| workspace.mjs | openWebDavWorkspace |
| server.mjs | start |
| packet.mjs | exportSourcePacket, inspectSourcePacket, importSourcePacket |
| cli.mjs | main |

openWebDavSource owns its original cache lease and exposes inspect, catalogue,
captureFile, capture, sampleFile, exportDataset and close. Its close operation
aborts source activity, waits for accepted operations and releases that lease.

See [API_CONTRACT.md](API_CONTRACT.md) for exact operator shapes and endpoint
semantics. The implementation contains no provider-specific API key or native
account data.

## Protocol and source references

- [RFC4918: WebDAV](https://www.rfc-editor.org/rfc/rfc4918.html), especially
  PROPFIND, multistatus responses, property status and resource identification.
- [RFC9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html), including
  ETags, If-Match, Range, Content-Range and representation content.
- [Nextcloud WebDAV basics](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html),
  including the original DAV, ownCloud and Nextcloud namespaces.
- [Original SFTP source formats](../sftp/formats.mjs) and
  [publisher row encoder](../sftp/publisher/plan.mjs).
- [Original PostgreSQL publisher file/lease helpers](../postgres/publisher/files.mjs).
- [Original XML parser](../xml/xml_source.py).
- [Original publisher and complete-source workflow](../socrata/PUBLISHING.md).

The product does not claim a deployment into a user's Nextcloud instance merely
because a standards-compatible WebDAV server or local source workflow completes.
Native receiving results identify the actual server, exact original source and
original merchant/customer outcome that were exercised.
