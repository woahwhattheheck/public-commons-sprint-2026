# WebDAV operator API and native integration

This contract describes the implementation in this directory. The browser and CLI
open the same private WebDAV workspace and use the same original dataset,
publisher, SF82 release, and buyer implementations. See [README.md](README.md) for
the full operator journey and [the original publisher guide](../socrata/PUBLISHING.md)
for its merchant and customer decisions.

## Runtime and ownership

Use the complete matching Stellar Forge source with Node 22+, Python 3 linked
against Expat 2.6 or newer, Linux `flock`, and the existing native merchant
dependencies. The WebDAV component adds no npm dependency. The XML parser imports
the maintained [XML source parser](../xml/xml_source.py); CSV/JSON/NDJSON processing
imports the original [SFTP formats](../sftp/formats.mjs).

`openWebDavWorkspace({directory, environment = process.env, python = "python3"})`
opens one normalized absolute private directory. It owns the original
cross-process workspace lease until `close()` finishes. A second CLI or server
cannot simultaneously own that directory. Use the running service for browser/API
commands, or close it before invoking the offline CLI. Different independent
directories retain separate state.

The native workspace returned by the factory exposes:

| Method | Input | Result |
| --- | --- | --- |
| `inspect()` | None | Current operator state |
| `act(action, payload)` | Original action plus `{operationId, expectedRevision, input}` | Original operation, retained result, current state |
| `operation(id)` | Original operation UUID | Hashed original intent/result, active flag, current state |
| `cancel(id)` | Original active operation UUID | Cancellation request and current state |
| `listing(options)` | `{sourceId,id,offset?,limit?}` | Page of an already retained listing |
| `capture(id)` | Original capture UUID | Retained capture state without finishing an active transfer |
| `mapping(id)` | Original mapping UUID | Exact saved public projection |
| `preview({editionId,query})` | Edition UUID and query string | Original CSV dataset response |
| `publisherState(id)` | Original product UUID | Unchanged Socrata publisher state |
| `publisherDownload(productId,kind,id)` | Original native export selector | Unchanged native export bytes and metadata |
| `download(kind,id,name?,sourceId?)` | Retained source file selector | Open file handle, byte count, SHA256, filename, content type |
| `close()` | None | Aborts source reads, drains owned work and native seller, releases leases |

Callers of `download` must close the returned handle. The HTTP server does so after
streaming, including interrupted responses.

`start({directory,port = 0,environment,python})` from `server.mjs` returns
`{url,directory,workspaceId,revision,token,workspace,close,pid}`. It listens on
`127.0.0.1`. Port zero selects an available port. `close()` drains this service's
workspace and original seller process.

## HTTP request boundary

The service serves its own three browser assets. It checks the exact loopback
Host and any supplied Origin, uses no CORS, and requires the process-specific
`X-Workspace-Token` header on all `/api/*` endpoints except health. Its HTML puts
that token in `meta[name="workspace-token"]`. The token belongs to this service
instance; do not put it in source declarations, query strings or handoffs.

Every POST uses `Content-Type: application/json`, with at most one MiB of input.
Downloads use authenticated fetch followed by the browser's normal file save.
Responses and assets use `Cache-Control: no-store`. Source bytes and payment
parameters are not logged by a new background service.

Errors have this shape:

```json
{
  "error": {
    "code": "WEBDAV_STALE_REVISION",
    "message": "The workspace changed. Your draft is retained; review the latest saved version.",
    "details": { "currentRevision": 12 }
  },
  "state": {}
}
```

The illustrative empty state above stands for the actual full current state.
Authorized POST failures and revision conflicts include it when it can be read.
Unauthenticated requests do not receive workspace state. An unreadable or missing
response does not establish whether the original mutation completed.

### Reads

| HTTP endpoint | Meaning |
| --- | --- |
| `GET /api/health` | Service readiness |
| `GET /api/state` | Current workspace state |
| `GET /api/operation?id=UUID` | Reopen one original operation and its retained result |
| `GET /api/listing?sourceId=UUID&id=UUID&offset=0&limit=200` | Page through one retained original PROPFIND response |
| `GET /api/capture?id=UUID` | Original byte capture and progress |
| `GET /api/mapping?id=UUID` | Exact original reviewed mapping input |
| `GET /api/publisher?id=UUID` | Original publisher, version store, release and buyer session state |
| `GET /api/file?kind=...&id=...&name=...&sourceId=...` | Exact retained WebDAV file |
| `GET /api/publisher-file?productId=UUID&kind=...&id=...` | Exact original native publisher export |
| `GET /api/handbook` | This component's complete README as plain text |

Listing pagination reads a previously saved response. It does not cause another
remote PROPFIND and is not a claim that the WebDAV server supports remote paging.

### State

`GET /api/state` returns:

```text
{
  schema: "stellar-forge.webdav-workspace.v1",
  id, directory, revision, createdAt, updatedAt,
  activeSourceId, activeMerchantId, activeProductId,
  sources: [], mappings: [], editions: [], merchants: [],
  exports: [], products: [], operations: [],
  source: <normalized selected source declaration or null>,
  environment: [{name, configured}],
  captures: [],
  running: [{id, action, startedAt}],
  lastListing?: {id, sourceId, sourceHash, href, capturedAt}
}
```

IDs are original UUID strings. Revisions and declared byte/count limits are safe
nonnegative integers. Monetary amounts, source identifiers and exact decimal text
stay strings. `environment` reports only required variable names and whether
each is configured, never their values.

Sources, mappings, editions, merchant terms and exports are retained revisions.
Saving a new one does not rewrite the original capture or previous edition.
State shows the newest 100 operation records in reverse order; older operations
remain available by their original ID. Private intent/result files are separate
from this state document so full sample/native results are not repeatedly
embedded in workspace metadata.

## Mutation identity and response recovery

The single mutation endpoint is:

```text
POST /api/act
{
  action: <one action from the table below>,
  operationId: <new UUID for one reviewed intent>,
  expectedRevision: <the displayed saved revision>,
  input: <the exact action input object>
}
```

A new operation requires the exact current revision. The server persists the
original action/input and their hash before dispatch. The operation ID is part of
the operator's retained intent, not a retry counter. Input identity includes all
semantic action fields; expectedRevision is a concurrency condition and is not
part of that input hash.

A successful response is:

```text
{
  operation: {id, action, intentSha256, intentFileSha256, createdAt,
              sourceId, status, reservedRevision, ...},
  result: <the exact original action result>,
  state: <current state>,
  replayed?: true
}
```

Reopening a complete same-ID/same-input operation returns its already retained,
hash-checked result. It does not repeat the native mutation. Reusing that ID with
different action/input returns `WEBDAV_OPERATION_ID_REUSED`. A still-active
same-ID operation may return `{operation,state,pending:true}`; read its existing
operation while it completes.

Recorded statuses are `RUNNING`, `COMPLETE`, `INTERRUPTED`, and `FAILED`.
An interrupted capture keeps its original capture ID and verified prefix.
A recorded failed operation retains its outcome; corrected input uses a new
reviewed intent. Inspect the original native publisher after a publisher failure
because a reporting failure can follow an already completed native change.

For an uncertain HTTP outcome:

1. Preserve the original operation ID, original input and original expected
   revision. Block a second new submission of that same unresolved decision.
2. Read `/api/operation?id=...`. A complete result is authoritative. An active
   operation is the same execution; do not start another.
3. If this ID is not recorded, explicitly continue a source decision using the
   same original ID, body and revision first.
4. A genuine `WEBDAV_STALE_REVISION` requires review of the actual current state.
   Re-read the original operation before continuation. If it is still absent
   and the reviewed state is still current, the operator may explicitly use that
   reviewed revision with the same original ID and unchanged input.
5. An abandoned reserved source decision that could change an active selection
   can return `WEBDAV_OPERATION_REVIEW` after other saved revisions advanced.
   Review that current state before continuing the same decision.
6. An uncertain native `publisher.act` is not blindly replayed. Inspect the
   existing publisher/release/session and select its original recovery operation.

`NOT_RECORDED`, `NOT_RECORDED_STALE`, and `REVIEW_REQUIRED` are browser recovery
states for a retained local intent. They are not invented native operation
outcomes. The browser preserves form drafts and original intents in its
workspace-specific session storage. It locks editing while a replacement or
mutation is in flight, and preserves the original intent on unreadable 2xx
responses.

`POST /api/cancel` takes `{operationId}`. It requests cancellation of that
service's active operation and returns `{operationId,cancelling,state}`.
It does not delete a capture, remove a native operation, cancel another service,
or assert that its original work rolled back.

## Source declaration

```json
{
  "schema": "stellar-forge.webdav-source.v1",
  "connection": {
    "rootUrl": "https://files.example.org/remote.php/dav/files/operator/reports/",
    "auth": {
      "type": "basic",
      "usernameEnv": "WEBDAV_USERNAME",
      "passwordEnv": "WEBDAV_PASSWORD"
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
```

The URL above illustrates configuration, not a live source or completed
connection. Use the operator's actual collection URL. Authentication may instead
be `{type:"none"}` or `{type:"bearer",tokenEnv:"WEBDAV_TOKEN"}`. Optional
`connection.caFileEnv` names a host environment variable containing a CA file
path. The normalized source includes defaults when auth or limits are omitted.

The root is an HTTPS collection with a final slash. Explicit
`allowLocalHttp:true` permits a loopback HTTP development service. Credentials,
URL userinfo, query/fragment, parent traversal, encoded slash/backslash and
off-root responses are rejected. Redirects stay inside the same origin and
configured collection. TLS certificate verification stays enabled.

| Limit | Default | Supported range |
| --- | ---: | ---: |
| maxListingBytes | 4,194,304 | 1,024–16,777,216 |
| maxEntries | 10,000 | 1–20,000 |
| maxFileBytes | 67,108,864 | 1–268,435,456 |
| timeoutMs | 30,000 | 1,000–120,000 |
| maxCaptureMs | 600,000 | 1,000–3,600,000 |

### Source actions

| Action | Exact input | Retained result |
| --- | --- | --- |
| `source.save` | `{source}` | Original source revision, its file SHA256 and normalized source hash |
| `source.catalogue` | `{href?,depth?,limit?,offset?}` | Exact PROPFIND XML receipt and selected page of normalized entries |
| `capture.start` | `{selection}` | Complete original file receipt or retained interrupted progress |
| `capture.resume` | `{captureId}` | Continue the same original selection and verified prefix |
| `capture.sample` | `{captureId,format,recordsPointer?,limit?}` | Retained rows with original ordinals and lossless values |
| `mapping.save` | `{captureId,expectedCaptureSha256,projection}` | Exact saved public projection and projection hash |
| `edition.build` | `{mappingId,dataset,review}` | Immutable native CSV edition, snapshot, counts and review |
| `merchant.save` | `{editionId,origin,path,payment,reviewer,note?}` | Original native-compatible merchant terms |
| `edition.export` | `{editionId,merchantId,reviewer,note?}` | Complete original four-file merchant export and manifest |
| `source.packet` | `{}` | Create-only portable source ZIP with byte/hash receipt |
| `publisher.prepare` | `{exportId,productId?,title?}` | Original publisher preparation plus product UUID |
| `publisher.act` | `{productId,action,input}` | Unchanged original publisher result and publisher state |

`source.catalogue` uses depth 0 or 1, default 1. The display limit is 1–1,000,
default 200. The offset is 0–20,000. Relative or absolute hrefs must remain under
the configured root. A new catalogue is an explicit new remote read; paging an
old listing uses the GET endpoint.

A normalized listing has
`{schema,id,requestedAt,capturedAt,href,finalHref,depth,status,headers,redirects,
bytes,sha256,originalFile,total,offset,limit,entries,nextOffset}`.
Each entry has:

```text
{
  href, originalHref, relativeHref, name,
  kind: "collection" | "file" | "unknown",
  etag, contentLength, contentLengthText, lastModified, contentType,
  fileId, instanceFileId, propertyStatus, properties, issues, accessible
}
```

Properties use expanded namespace names such as `{DAV:}getetag`. Each property
keeps its response status; only successful property values become normalized
fields. Absent lengths remain null, while exact length text is retained even
when it exceeds a safe JavaScript integer. Failed resources, duplicate hrefs,
duplicate properties and malformed metadata stay visible with issues and cannot
be selected as accessible file versions. Original XML remains downloadable even
when parsing fails.

### Capture binding and continuation

A selection is:

```text
{
  id: <new capture UUID>,
  href: <the selected original resource URL>,
  etag: <its opaque quoted ETag, weak ETag, or null>,
  contentLength: <its safe byte count or null>,
  lastModified: <its original value or null>,
  expectedSha256?: <independently known 64-character lowercase SHA256>,
  restarts?: <prior capture UUID for an explicit new capture>
}
```

The capture ID is separate from the workspace operation ID and remains unchanged
during capture continuation. It binds the normalized source and exact selection.
HTTP metadata and ETags are retained as received; an ETag is not treated as a
content hash.

The reader requests identity encoding. It uses the original strong ETag for
conditional reads and verified nonempty-prefix resume. Range, Content-Range,
Content-Length, observed bytes, the selected validator and any independently
supplied SHA256 must agree. It does not append a full 200 response to an existing
prefix. A changed validator or source requires an explicit new capture.

A prefix checkpoint is flushed, fsynced and hashed. Reopen validates that exact
prefix before requesting more bytes; an uncheckpointed crash tail is retained
separately before truncation. A complete transfer receipt is durable before final
publication of `body.bin`. If all original bytes already completed, reopen
verifies and finalizes those retained bytes locally without another HTTP GET.
A server without a strong validator can be captured once, but a nonempty
interrupted prefix cannot be safely resumed as that same selected version.

### Projection and native edition

`format` is `csv`, `json` or `ndjson`. `recordsPointer` is an RFC6901 pointer
to the selected JSON record array; use the original parser's CSV/NDJSON rules for
those formats. Sampling verifies and scans the full retained source, with at most
one million records, and returns up to 100 sample rows under a two MiB retained
sample budget. Each row is `{ordinal,raw}`; skipped oversized sample rows do not
renumber later rows. JSON numeric tokens remain exact strings until an explicit
mapping conversion. CSV headers remain available for a valid zero-row table.

The projection is:

```text
{
  format,
  recordsPointer: "",
  columns: {
    <public column name>: {
      pointer: <original field pointer>,
      type: "string" | "integer" | "number" | "boolean",
      nullable: false,
      missing: "error" | "null"
    }
  }
}
```

Use 1–64 public columns. Keep long identifiers and exact monetary/decimal text as
strings. Integer conversion uses the original native safe-integer contract.
The saved mapping includes `captureSha256`, `projection`, `projectionHash` and
its own file SHA256. Conversion failures retain the original parser/encoder error code and add the
actual one-based source record ordinal and capture ID; values are not coerced.

An edition's dataset input has:

```text
{
  name,
  filters: [], ranges: [], sorts: [],
  maxBytes: 67108864, maxRows: 250000, maxCellChars: 65536,
  defaultLimit: 50, maxLimit: 250, maxPageBytes: 921600
}
```

The arrays contain selected public column names and remain subject to the
original CSV dataset query budget and type rules. The review is:

```text
{
  reviewer,
  decision: "approve",
  note: "",
  expectedCaptureSha256: <the selected capture SHA256>,
  projectionHash: <the selected saved projection hash>
}
```

Build uses the exact completed capture and the original SFTP projection/CSV row
encoder, then reopens the result with the unchanged native CSV dataset loader.
The review, source fields, output column observations, source hash, output bytes,
row count and native snapshot are retained. An interrupted incomplete edition
remains available for inspection; a new build uses a new reviewed edition ID.

`POST /api/preview` takes `{editionId,query:"limit=10"}`. It runs the unchanged
native admission/handler on the selected immutable edition. The response
contains `editionId`, `snapshot`, and the original native response shape. Use
[DATASET_API.md](../DATASET_API.md) for `where_`, numeric range, sort, projection,
limit and cursor syntax.

## Merchant export and original publisher

`merchant.save` passes its selected edition, origin, path and exact payment
object to the original `buildDatasetSellerConfig`. Keep atomic amounts as JSON
strings. The original compiler remains authoritative for network, asset,
destination and price rules.

`edition.export` writes these original files, plus a manifest containing their
exact relative paths, byte lengths and SHA256 values:

- `dataset.csv`: reviewed public values;
- `dataset.json`: original native typed schema and query limits;
- `source.json`: original WebDAV capture/projection/review lineage;
- `seller.json`: original compiled merchant terms.

`publisher.prepare` passes the retained export directory directly to the
unchanged Socrata publisher. A new product defaults to the operation UUID;
`productId` selects an existing original product for its next prepared source.
The original native dataset/version store and review rules are preserved.

`publisher.act` does not rename or translate its nested original command
parameters. Its `result` is the native `{result,state}` returned by
`openSocrataPublisher().act()`. The browser exposes exact JSON parameters and
prefills from current selected native records.

Supported original actions are:

```text
publisher.status
publisher.preview
publisher.reviewDraft
publisher.publish
publisher.activateSnapshot
publisher.collect
publisher.release.stage
publisher.release.inspect
publisher.release.activate
publisher.release.rollback
publisher.release.start
publisher.release.stop
publisher.buyer.review
publisher.buyer.prepare
publisher.buyer.session
publisher.buyer.run
publisher.buyer.recover
publisher.buyer.account
publisher.buyer.export
```

The original publisher state contains `target`, `drafts`, `releases`,
`sessions`, `running` and `ownsRelease`. In particular,
`releases.state` contains generation and activation history;
`releases.runtime` contains actual process readiness. Do not treat a staged
release or browser declaration as a running merchant.

Buyer configuration, terminal approval, signatures, payment, recovery and
settlement remain in the existing original buyer workspace. Source review or
merchant preparation does not spend funds. A native release started by this
service remains owned by it and is drained when it closes.

## Exact downloads

`GET /api/file` uses these combinations:

| kind | id | name | Additional field |
| --- | --- | --- | --- |
| source | Source revision UUID | Omit | None |
| listing | Listing UUID | `xml` or `json` | `sourceId` is required |
| capture | Capture UUID | `body.bin` or `receipt.json` | None |
| edition | Edition UUID | `dataset.csv`, `dataset.json`, `source.json`, `edition.json` | None |
| export | Export UUID | One original four-file name or `manifest.json` | None |
| packet | Complete source.packet operation UUID | Omit | None |

Source downloads are hash-checked against their retained declaration/receipt
where one is available. They include `Content-Length`,
`X-Content-SHA256`, a safe attachment filename and the appropriate content type.
The implementation streams the opened file rather than serializing binary data
into state.

`GET /api/publisher-file` preserves the original native selectors
`draft-csv`, `draft-review`, `buyer-config` and `session-manifest`, with the
corresponding original candidate, buyer or session ID.

## Portable source handoff and fresh import

The packet interface is available without a running workspace:

```js
exportSourcePacket({directory, output, python, signal});
inspectSourcePacket({input, python, signal});
importSourcePacket({input, directory, python, signal});
```

Export through the workspace's `source.packet` action so its existing lease,
serialized mutation and original operation result remain authoritative.
`inspectSourcePacket` is read-only. Import requires a fresh normalized absolute
destination and creates a new private workspace identity and revision zero.

A `stellar-forge.webdav-source-packet.v1` ZIP retains selected source
declarations, original listing XML and metadata, captured bytes and progress,
saved mappings, native editions, merchant terms and original merchant exports.
The manifest specifies each exact file, byte count and SHA256. Packet inspection
checks the exact member set, path scope, entry type, sizes and every retained
hash. Encrypted, duplicate, symlink, traversal and out-of-scope members fail.

The limits are 8,000 members, 256 MiB per member, 512 MiB expanded bytes and
512 MiB plus 16 MiB archive bytes. The writer streams ZIP members and publishes a
create-only output after fsync; it does not materialize a second whole archive
buffer in the JavaScript process.

A fresh import retains the original source workspace projection as
`imported-workspace.json` and writes a separate `source-packet-import.json`
receipt. It preserves original source/capture/mapping/edition/export IDs.
Incomplete imports remain at their create-only destination with an incomplete
receipt so the operator can inspect them. Existing recipient directories are
never replaced.

Native publisher, release, buyer, account, key and ledger directories stay with
their original host/workspace and are not transplanted by this source packet.
Original product references remain in the handoff. At a fresh recipient, select
a retained reviewed export and prepare it through the original publisher.
Use that publisher's existing native receiving/recovery workflow for a customer
or release transfer. This packet makes source preparation portable without
pretending that an active paid session moved with it.

## CLI parity

```text
node cli.mjs serve --directory ABS --port 0 [--python PYTHON]
node cli.mjs state --directory ABS
node cli.mjs operation --directory ABS --id UUID
node cli.mjs act ACTION --directory ABS --input PRIVATE_JSON
  [--operation-id UUID] [--expected-revision INTEGER]
node cli.mjs export-source --directory ABS
node cli.mjs inspect-source --input ABS_ZIP
node cli.mjs import-source --input ABS_ZIP --directory NEW_ABS_DIRECTORY
```

`act` reads one private UTF-8 JSON object containing the exact action input.
It prints an original intent record to stderr before executing and its native
result as JSON to stdout. Save that record. An explicit same-ID continuation
must use the retained original input and expected revision; use the same
read/review process described above after a genuine stale revision.

The serve command prints `WEBDAV_OPERATOR_READY` with URL, directory, workspace
ID, initial revision and PID. The token remains in the served HTML and returned
in-process object, not the CLI readiness record. SIGINT/SIGTERM close the owned
source and seller lifecycle. A one-shot `publisher.release.start` command keeps
its process alive while that original seller is running.

## Source authority

The protocol decisions derive from the original
[RFC4918 WebDAV](https://www.rfc-editor.org/rfc/rfc4918.html),
[RFC9110 HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html), and
[Nextcloud WebDAV documentation](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html).
Native parsing, dataset query, publisher, release and buyer behavior derives
from the maintained linked source in this same repository. Actual receiving
results belong to their retained native operation receipts; this API contract
does not itself claim a completed purchase or deployment.
