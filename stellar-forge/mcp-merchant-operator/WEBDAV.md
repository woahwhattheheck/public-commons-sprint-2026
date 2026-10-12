# WebDAV merchant and customer operations over MCP

This companion gives an MCP caller the complete original WebDAV source workspace:
saved collection profiles, original file discovery and version selection, conditional
capture, public projection, reviewed native dataset, merchant publication, customer
acquisition, exact file delivery and source receiving.

It opens the original WebDAV service once and uses that service's workspace.
The returned browser URL and MCP tools share the same saved revisions, operation
UUIDs, captures, editions, publisher and owned seller process. The [native source
guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/README.md) and
[API contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/API_CONTRACT.md)
describe the underlying source and browser.

## Configure the host

Use the complete matching source or maintained merchant distribution with its
native dependencies installed. WebDAV requires Linux flock, Node 22.16 or newer,
and Python 3.11 or newer linked against Expat 2.6 or newer. The companion adds no
dependency. The existing source parser, dataset, Socrata publisher, SF82 releases
and SF88 customer engines perform the work.

Create a private connection JSON file, owned by the service user and mode 0600.
The connection resolves relative paths from its own directory. Workspace
directories and existing parents use mode 0700 and canonical paths. A fresh
receiving destination must be absent; declare its existing private parent.

The following host script assembles the connection from two actual reviewed
documents: a native WebDAV source declaration and merchant terms containing
origin, path and payment. Use the source declaration format in the native guide.
Payment retains the original scheme, explicit Stellar network, asset contract,
payee, decimal-string atomic amount and maxTimeoutSeconds. Credentials remain
in the process environment under the original source declaration's environment
names.

~~~js
import { readFile, writeFile } from 'node:fs/promises';

const source = JSON.parse(await readFile('/srv/starforge/webdav-source.json', 'utf8'));
const terms = JSON.parse(await readFile('/srv/starforge/merchant-terms.json', 'utf8'));
const connection = {
  schema: 'stellar-forge.webdav-workspace-connection.v1',
  workspaces: {
    reports: {
      label: 'Reviewed reports',
      directory: '/srv/starforge/webdav-reports',
      python: 'python3',
      browserPort: 0,
      sourceProfiles: {
        files: { label: 'Reports collection', source }
      },
      merchantProfiles: {
        reports: {
          label: 'Reports merchant',
          origin: terms.origin,
          path: terms.path,
          payment: terms.payment
        }
      },
      buyerWorkspaces: {
        operator: {
          label: 'Existing original buyer',
          directory: '/srv/starforge/original-buyer'
        }
      },
      sourcePackets: {},
      runtime: { port: 0 }
    }
  }
};
await writeFile('/srv/starforge/webdav-connection.json',
  JSON.stringify(connection, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
~~~

A host can declare up to 32 workspaces and up to 32 profiles of each kind within
each workspace. Profile aliases use lowercase letters, digits, underscores and
hyphens, beginning with a letter or digit. A directory has one workspace alias.
Optional maps default to empty. Declare only the buyer workspaces used by this
operator. Those directories are existing original buyer workspaces.

Runtime may also contain the original facilitator URL and
allowLocalFacilitator setting. A facilitator is HTTPS; explicit local development
can select HTTP on 127.0.0.1. Runtime choices, interpreter, browser port,
credentials and filesystem paths are host configuration. Calls select the
declared aliases.

Initialize a new MCP host from the repository root:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-webdav-workspaces \
  --dir /srv/starforge/webdav-mcp \
  --connection /srv/starforge/webdav-connection.json \
  --name 'Reports operator'
~~~

For an existing merchant MCP host, add webdavWorkspaceConnection to its existing
merchant-mcp.json with the connection file path, then reopen that host. The
configuration reader validates all declared profiles without opening a remote
source account. The original native workspace opens when requested.

Run the standard authenticated HTTP transport:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/starforge/webdav-mcp/merchant-mcp.json \
  --port 8788 \
  --token-env MCP_ACCESS_TOKEN
~~~

Use the existing [merchant MCP setup](README.md) for the standard stdio transport
or generated client configuration. The maintained distribution exports the
companion as @tokenjunkielabs/starforge-merchant/merchant/mcp/webdav.

## Discover and open

Call merchant_webdav_status with an empty object to see configured aliases,
source and merchant profile choices, and available source packets. Values shown
for source authentication are environment reference names.

Call merchant_webdav_open with workspace set to reports. Save instanceId and the
returned native.id and native.revision. The browser.url opens the original
industrial operator UI on the same host. Calling open again returns that same
owned instance. Close an independently running original CLI/server before
opening its directory through MCP, because the original workspace owns one
cross-process lease.

Every changing source or publisher call includes:

~~~json
{
  "workspace": "reports",
  "operationId": "a caller-generated UUID for this one saved decision",
  "expectedRevision": 0
}
~~~

Use an actual UUID and the returned current revision. Persist the exact tool
name, arguments and operation UUID before sending. Successful actions return
the original operation, result and current state. Select the next saved revision
from state.revision. Browser changes participate in these same revisions.

## Collection to reviewed dataset

| Tool | Additional input | Original result to retain |
| --- | --- | --- |
| merchant_webdav_source | profile | Source revision id, sourceHash and fileSha256 |
| merchant_webdav_catalogue | href?, depth?, offset?, limit? | Original listing id, entries, nextOffset and source in state.lastListing |
| merchant_webdav_listing | sourceId, id, offset?, limit? | Saved listing page; this is a read and takes no operationId/revision |
| merchant_webdav_capture | action=start, selection | Original capture receipt, source hash and byte identity |
| merchant_webdav_capture | action=resume, captureId | Same selected capture and retained prefix |
| merchant_webdav_capture | action=sample, captureId, format, recordsPointer?, limit? | Original sampled record ordinals and values |
| merchant_webdav_mapping | captureId, expectedCaptureSha256, projection | Saved mapping id and projectionHash |
| merchant_webdav_edition | action=build, mappingId, dataset, review | Native edition id, row count and snapshot |
| merchant_webdav_preview | editionId, query? | Native query response; a read |
| merchant_webdav_merchant | editionId, profile, reviewer, note? | Native merchant terms id |
| merchant_webdav_edition | action=export, editionId, merchantId, reviewer, note? | Original merchant export id and complete file manifest |

A catalogue uses depth 0 or 1. Its offset/limit page the retained result;
merchant_webdav_listing continues that original listing without a second remote
request. Select accessible entries whose original kind is file, preserving
the exact href, etag, contentLength and lastModified:

~~~js
const selection = {
  id: crypto.randomUUID(),
  href: selectedEntry.href,
  etag: selectedEntry.etag,
  contentLength: selectedEntry.contentLength,
  lastModified: selectedEntry.lastModified
};
~~~

The capture UUID differs from the changing workspace operation UUID. Keep it
during resume. If an independently known file SHA256 is available, include
expectedSha256 in selection. The original reader retains strong/weak/missing
validators, conditional requests, exact bytes and interrupted prefixes.

For CSV, JSON or NDJSON, sample the retained capture before selecting fields.
Sampling returns up to 100 records and scans the source under its original
native limits. JSON decimal tokens and long identifiers remain exact strings
until an explicit projection conversion.

A projection for a reviewed source with fields named id, region and amount can
look like this:

~~~json
{
  "format": "json",
  "recordsPointer": "/records",
  "columns": {
    "id": { "pointer": "/id", "type": "string", "nullable": false, "missing": "error" },
    "region": { "pointer": "/region", "type": "string", "nullable": false, "missing": "error" },
    "amount": { "pointer": "/amount", "type": "string", "nullable": true, "missing": "null" }
  }
}
~~~

Use pointers and fields from the actual retained source. Set recordsPointer to
the original JSON record array; use the original CSV/NDJSON parser conventions
for those formats. The native projector validates 1–64 columns and retains
conversion errors with the source record ordinal.

Pass the saved mapping to edition build with dataset and review:

~~~js
const dataset = {
  name: 'Reviewed reports',
  filters: ['id', 'region'],
  ranges: [],
  sorts: ['id'],
  maxBytes: 67108864,
  maxRows: 250000,
  maxCellChars: 65536,
  defaultLimit: 50,
  maxLimit: 250,
  maxPageBytes: 921600
};
const review = {
  reviewer: reviewedBy,
  decision: 'approve',
  note: reviewNote,
  expectedCaptureSha256: savedMapping.captureSha256,
  projectionHash: savedMapping.projectionHash
};
~~~

Query capabilities are explicit dataset choices. The original dataset loader
validates them against the typed columns. Preview the actual edition before
saving its merchant profile and exporting. Every original export retains
dataset.csv, dataset.json, source.json, seller.json and manifest.json.

## Original publisher, release and customer

merchant_webdav_publisher forwards the native publisher action using the same
WebDAV operationId and expectedRevision envelope. The nested payload contains
that action's original parameters. Original publisher results remain nested
under the workspace result; inspect result.state for publisher state and
state.revision for the outer workspace revision.

First call action=publisher.prepare and
payload={exportId: retainedExportId, title: reviewedProductTitle}. Save the
returned result.productId. To prepare a later edition of that same product,
include productId in that prepare payload. Every other publisher call selects
productId as a top-level tool argument.

| Action | payload |
| --- | --- |
| publisher.status | {} |
| publisher.preview | target (draft:UUID or retained snapshot SHA256), query |
| publisher.reviewDraft | draftId, expectedSnapshot, expectedRevision |
| publisher.publish | draftId, expectedSnapshot, expectedRevision |
| publisher.activateSnapshot | snapshot, expectedSnapshot, expectedRevision |
| publisher.collect | {} |
| publisher.release.stage | draftId, id, label?; the adapter supplies the host-declared runtime |
| publisher.release.inspect | id |
| publisher.release.activate | id, expectedGeneration |
| publisher.release.rollback | expectedGeneration |
| publisher.release.start | expectedGeneration |
| publisher.release.stop | {} |
| publisher.buyer.review | snapshot, query |
| publisher.buyer.prepare | review, intentId, acceptIndex, offerSha256 |
| publisher.buyer.session | buyerId, buyerWorkspace, maxPages, maxTotalAtomic, maxRows?, maxPageBytes? |
| publisher.buyer.run | id, retryUnpaid?, expectedAttemptSha256? |
| publisher.buyer.recover | id |
| publisher.buyer.account | id |
| publisher.buyer.export | id |

The snapshot/revision inside a publisher payload belongs to the original
dataset version store. The outer expectedRevision belongs to the WebDAV
workspace. Release expectedGeneration belongs to the original SF82 release
store. Preserve each identity in its own field.

Use the [original publisher
guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/PUBLISHING.md)
for exact candidate review, native query, live seller offer and customer
selection. Read current publisher state through merchant_webdav_operation,
kind=publisher, id=productId.

A usable release follows the original sequence: prepare the reviewed export,
inspect/review the candidate and native version, stage its release, activate the
selected generation, and start it. Current publisher state reports the actual
listener and original running process. Close drains that owned process.

For a customer, review the actual started seller's offer for the selected
snapshot/query, preserve offerSha256 and the reviewed accept index, and prepare
the original buyer. Session selects an existing host-declared buyerWorkspace
alias and the original exact page/atomic-amount limits. The original buyer
workspace supplies its approval, signer and ledger. Acquisition runs, retained
attempt recovery, accounting and export use that same session id.

## Deliver complete files

merchant_webdav_file returns:

~~~text
{
  readId,
  file: {name, contentType, bytes, sha256},
  offset, bytesRead, nextOffset,
  encoding: "base64",
  data
}
~~~

| kind | id | Additional selection |
| --- | --- | --- |
| source | Original source revision UUID | None |
| listing | Original listing UUID | sourceId and filename=xml or json |
| capture | Original capture UUID | filename=body.bin or receipt.json |
| edition | Original edition UUID | filename=dataset.csv, dataset.json, source.json or edition.json |
| export | Original export UUID | One original export filename or manifest.json |
| packet | Complete source.packet operation UUID | None |
| publisher | Original draft, buyer or session UUID | productId and publisherKind |
| result | Returned completeResult.id or a completed original operation UUID | None |

Publisher kinds are draft-csv, draft-review, buyer-config, session-manifest,
session-csv, session-jsonl and session-review. The last three read the completed
original customer data room, checked by the native delivery manifest.

The first chunk can omit expectedSha256. Prefer supplying the original manifest
hash when it is already known. Save the first returned file identity, then send
the same selectors, readId, expectedSha256 and nextOffset for each subsequent
chunk. Default chunk size is 65,536 bytes; the maximum is 196,608. Complete at
nextOffset=null, verify the local byte count and SHA256, then publish the local
file under its intended name.

This complete client loop uses a connected standard MCP SDK client and writes
one create-only file. Keep the selected tool arguments and local partial if
transport stops. For a process restart, omit readId and resume from the exact
saved local offset with the original expectedSha256.

~~~js
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const value = result.structuredContent ??
    JSON.parse(result.content.find(item => item.type === 'text').text);
  if (result.isError) throw Object.assign(new Error(value.message ?? value.error?.message), value);
  return value;
}

async function download(selection, destination, expectedSha256) {
  const file = await open(destination, 'wx', 0o600);
  const digest = createHash('sha256');
  let identity, readId, offset = 0;
  try {
    while (true) {
      const part = await call('merchant_webdav_file', {
        ...selection, offset, limit: 65536,
        ...(readId ? { readId } : {}),
        ...(expectedSha256 ? { expectedSha256 } : {})
      });
      identity ??= part.file;
      expectedSha256 ??= identity.sha256;
      const bytes = Buffer.from(part.data, 'base64');
      if (part.encoding !== 'base64' || part.file.sha256 !== expectedSha256 ||
          part.file.bytes !== identity.bytes || part.offset !== offset ||
          bytes.length !== part.bytesRead ||
          part.nextOffset !== (offset + bytes.length < identity.bytes ? offset + bytes.length : null))
        throw new Error('Original file chunk identity differs.');
      await file.writeFile(bytes);
      digest.update(bytes);
      offset += bytes.length;
      readId = part.readId;
      if (part.nextOffset === null) break;
    }
    await file.sync();
    if (offset !== identity.bytes || digest.digest('hex') !== identity.sha256)
      throw new Error('Complete original file identity differs.');
    return identity;
  } finally {
    await file.close();
    if (readId) await call('merchant_webdav_file_release',
      { workspace: selection.workspace, readId }).catch(() => {});
  }
}
~~~

Native source files retain their original read-only handles while chunks are
delivered; even a maximum-size original source packet is streamed without a
second full archive buffer. Publisher exports and large JSON use the existing
retained-file snapshot transport. Each transport supports four unfinished reads;
idle reads expire after two minutes. Explicitly release an abandoned read with
merchant_webdav_file_release. Its underlying original artifact stays available.

When an action or query response is large, completeResult identifies its full
JSON. For a completed operation, that JSON contains the original operation record
(including its saved input) and result. It is available after process restart
by the same operation UUID.
Read-only preview/state responses use one of the eight most recent in-process
result slots; reissue the original read if its slot expires. A transport read
already opened against a result retains its complete selected bytes.

## Source packet receiving

Call merchant_webdav_packet with a retained operation UUID/current revision.
Download kind=packet using that same completed operation UUID and its returned
SHA256. On the recipient, declare the received original ZIP under a sourcePackets
alias in a closed destination workspace:

~~~json
{
  "sourcePackets": {
    "handoff": {
      "label": "Reviewed original source",
      "file": "/srv/starforge/incoming/webdav-source.zip",
      "sha256": "the exact 64-character lowercase SHA256 from the source packet"
    }
  }
}
~~~

Replace the displayed digest description with the actual hash. Declare a fresh
destination directory in that workspace's connection. Call
merchant_webdav_receive with workspace, action=inspect, packet=handoff and
expectedSha256. It invokes the original packet reader, verifies every declared
member and reports counts plus a manifest page. Page the manifest with offset
and limit; every page is an original whole-packet inspection and retains its
original source identity.

Use action=receive with the same packet alias/hash to invoke the original
create-only import. A completed repeated receiving call reads the original
import receipt and matching destination workspace, including its current
revision. An interrupted destination retains the original incomplete marker
and source files. Its native status and receipt remain available to the host;
select a fresh declared destination to start another reviewed receiving attempt.

Open the completed recipient through merchant_webdav_open. Its new workspace
identity retains the original source/capture/mapping/edition/export IDs.
Select an existing reviewed export and prepare it with the recipient's native
publisher. Original live publisher, release, buyer and account state stay under
their native receiving and recovery workflows.

## Continue and close

For a lost response, read merchant_webdav_operation with kind=operation and
the exact original operation UUID. A complete result is authoritative. Read an
active original operation while it completes. If the ID is absent, continue the
saved exact intent with that same UUID first. If the original source returns a
stale-revision error, review the current state and that original operation before
selecting its reviewed current revision.

Use kind=capture or kind=mapping to inspect the retained original records.
To interrupt active source work, merchant_webdav_cancel takes its original
operationId. Inspect the outcome and retain the same capture UUID on resume.
An uncertain publisher change is resolved by inspecting its native state and
using its original publication, release or buyer recovery action.

merchant_webdav_status pages all retained workspace arrays with offset/limit.
Native operation history shows the newest 100 operations; older records remain
readable by their UUID.

merchant_webdav_close requires the currently owned instanceId. It starts
native source cancellation, drains accepted publisher/customer work, closes
transport reads, and releases the original workspace lease. Closing the MCP
host also aborts an active source-packet inspector/importer and drains all
opened WebDAV workspaces. Reopen returns a new process instanceId with the
same durable native workspace records.
