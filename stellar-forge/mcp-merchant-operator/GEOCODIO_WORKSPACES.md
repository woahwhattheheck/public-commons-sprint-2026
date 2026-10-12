# Geocodio address workspaces over merchant MCP

These tools operate the original Geocodio address workspace, its original
dataset publisher and its existing customer sessions. The browser, CLI and MCP
use the same source, request, response, decision and edition formats.

The product keeps each source business record even when several records share
one exact address lookup. It retains provider candidates and original
coordinates beside explicit operator decisions. The native SF30 dataset engine,
SF82 release lifecycle and SF88/SF100 customer delivery remain their original
implementations.

## Connect an original workspace

Create the owned workspace directory with mode 0700. Write a private connection
JSON with mode 0600. Host paths are resolved relative to that connection file.

The following example declares an existing SimplyRETS source response. Replace
the paths with the actual original files and directories before initialization.

~~~json
{
  "schema": "stellar-forge.geocodio-workspace-connection.v1",
  "workspaces": {
    "listings": {
      "label": "Property address review",
      "directory": "/private/listing-addresses",
      "apiKeyEnv": "GEOCODIO_API_KEY",
      "timeoutMs": 900000,
      "imports": {
        "properties": {
          "label": "Original property response",
          "kind": "intake",
          "format": "simplyrets",
          "file": "/private/original-properties.json",
          "sourceURL": "https://api.simplyrets.com/properties",
          "provenance": "Original provider response selected by the operator"
        }
      }
    }
  }
}
~~~

Then initialize this existing merchant host:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-geocodio-workspaces \
  --dir /private/address-mcp --connection /private/geocodio-connection.json
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/address-mcp/merchant-mcp.json
~~~

Use the original host's documented stdio/HTTP configuration and authentication
options. An existing merchant can instead add `geocodioWorkspaceConnection` to
its private merchant configuration.

The connection supports 1–32 aliases, each with a distinct original directory.
Only the named startup environment variable supplies a provider key. A workspace
can open and import completed data when that variable is empty. An explicit
provider run reports the missing key through the original native operation.

The host can also declare:

| Field | Original binding |
| --- | --- |
| `imports` | Up to 32 existing canonical regular source/response/package files |
| `merchants` | Named public `origin`, `path` and `payment` profiles |
| `buyerWorkspaces` | Named owned original buyer directories |
| `runtime` | Original seller `port`, `facilitator` and explicit `allowLocalFacilitator` |
| `timeoutMs` | Original provider timeout, 1,000–900,000 milliseconds |

Import entries bind the original input rather than accepting arbitrary caller
paths:

- `kind: "intake"`: `file` and `format` (`intake`, `csv`, `json` or
  `simplyrets`), with optional original `sourceFile`, `sourceURL`,
  `provenance` and native `mapping`.
- `kind: "response"`: exact response `file` and `mode`. Keyed object batches
  require `requestFile`; array batches also require complete ordered
  `queryIds`; single-address responses require their original `queryId`.
  An optional `receipt` carries the actual public HTTP result.
- `kind: "package"`: the complete original portable workspace `file`.

Add a completed external response to the private connection after its original
files are present, then reopen this host configuration. The original address
workspace and all prior request/decision identities remain retained.

## Tool surface

| Tool | Complete original operation |
| --- | --- |
| `merchant_geocodio_status` | Declared aliases or opened source/customer state; paged histories |
| `merchant_geocodio_open` | One original process-owned operator instance |
| `merchant_geocodio_close` | Drain and close the exact current instance |
| `merchant_geocodio_intake` | Import original source through a declared alias |
| `merchant_geocodio_provider` | Prepare, inspect, run or import an original provider request |
| `merchant_geocodio_policy` | Save visible match-review thresholds |
| `merchant_geocodio_review` | List/query candidates, decide, or apply exact qualified selection |
| `merchant_geocodio_edition` | Build or activate native typed datasets |
| `merchant_geocodio_query` | Native filter, range, projection, sort and cursor query |
| `merchant_geocodio_merchant` | Configure a declared original merchant profile |
| `merchant_geocodio_export` | Complete native export and portable original workspace |
| `merchant_geocodio_restore` | Restore into an empty original address workspace |
| `merchant_geocodio_file` | Exact source, prepared-request or customer file chunks |
| `merchant_geocodio_file_release` | Release an unfinished retained file read |
| `merchant_geocodio_publisher` | All 20 existing publisher, release and buyer actions |
| `merchant_geocodio_browser` | Borrow a browser listener on the same operator |

Every address mutation supplies the current native `expectedRevision`. Read
it from the returned state before the next change. Publisher revisions, release
generations and buyer operation bindings remain separate native contracts.

Status histories use `offset` and `limit` (up to 100) with independent totals
and next offsets for addresses, duplicates, responses, requests, editions and
exports. Candidate review uses its native `offset`/`limit` (up to 500).
Those page markers distinguish a returned page from the complete retained set.

## Source and original provider request

Open and import the declared original source:

~~~json
{"workspace":"listings"}
~~~

Pass that object to `merchant_geocodio_open`. Then call
`merchant_geocodio_intake` with:

~~~json
{"workspace":"listings","sourceImport":"properties","expectedRevision":0}
~~~

An optional `mapping` uses the original explicit address/coordinates/identity
schema. The supplied SimplyRETS mapping preserves separate `mlsId` and
`listingId` values. The shared original JSON parser retains numeric literal
text before mapping, including int64 identifiers.

Prepare the chosen missing queries through `merchant_geocodio_provider`:

~~~json
{
  "workspace":"listings",
  "action":"prepare",
  "payload":{"expectedRevision":1,"maximumLookups":65}
}
~~~

Use the actual number of unique queries from the imported source. The example
limit is an operator choice, not a statement about another feed. Preparation
retains the keyed JSON body, lookup count, request ID and SHA-256. Selected query
IDs and an explicit refresh are supported by the original native operation.

Inspect that same request with action `request` and
`payload:{"id":"REQUEST_ID","offset":0,"limit":50}`. Its response includes a
page of the original keyed body and the original complete file identity.
Use `merchant_geocodio_file` with `kind:"provider-request"` and that request ID
to retrieve the exact complete body for an authorized external worker.

Run only the reviewed prepared request:

~~~json
{
  "workspace":"listings",
  "action":"run",
  "payload":{
    "expectedRevision":2,
    "id":"REQUEST_ID",
    "expectedRequestSha256":"ORIGINAL_64_HEX_BODY_DIGEST"
  }
}
~~~

The original workspace sends the Geocodio v2 request using its private
environment credential. It records SENDING before HTTP, preserves the original
body and complete response, and keeps provider or uncertain outcomes attached to
that request. Its lookup count and explicitly selected maximum remain visible.
Current provider allowance and billing belong to the actual account.

For externally completed work, add a response import alias and call action
`import` with `expectedRevision`, `sourceImport`, and the original `requestId`
when reconciling an existing prepared request. The native importer binds every
returned candidate to the original request queries and retains the exact bytes.

## Review and build the selected data

`merchant_geocodio_review` forwards these native payloads:

| Action | Payload |
| --- | --- |
| `list` | Optional `status`, `search`, `offset`, `limit` |
| `query` | Original `queryId` |
| `decide` | `expectedRevision`, `queryId`, `action`, optional `candidateId`, `coordinateChoice`, `note` |
| `acceptQualified` | `expectedRevision`, exact ordered current `queryIds`, `coordinateChoice`, `note` |

Decisions select `accept` or `keep-source`. Coordinate choices are
`preserve-source`, `fill-missing` and `use-provider`. The original source
coordinates, provider candidates and previous decisions remain retained.
Provider accuracy is a match score; the policy and reviewer determine the
actual acceptance requirements.

Use `merchant_geocodio_policy` to change the original visible threshold object:
minimumAccuracy, allowedAccuracyTypes, maximumDisplacementMeters,
ambiguityScoreGap, requireStableAddressKey and requireCountryMatch.

An edition build payload contains the current `expectedRevision`, `name`,
`scope` (`all-source` or `reviewed-only`), original `sourceColumns` mappings,
and optional `defaultLimit`/`maxLimit`. Activation chooses an existing
`editionId`. The native output preserves source identity columns, source
ordinals, review state, provider quality, both coordinate pairs, displacement
and review reasons.

Run query objects through `merchant_geocodio_query`, supplying
`expectedRevision`. For example:

~~~json
{
  "workspace":"listings",
  "expectedRevision":5,
  "query":{
    "where_review_state":"ACCEPTED",
    "gte_accuracy":"0.9",
    "sort":"-displacement_m",
    "limit":"50"
  }
}
~~~

Use the actual current revision and the returned original snapshot/cursor for
continuation. Successful query selection is retained with that edition.

## Publish and deliver through the original customer engine

Configure a host-declared merchant profile with
`merchant_geocodio_merchant`, then export using the current revision.
The original export contains adjacent dataset CSV/configuration, Geocodio
source provenance, query and review records, portable workspace, original raw
files, and seller configuration.

The `source.json.sourceFiles` descriptors carry auxiliary source paths, byte
counts and hashes through the managed release. The source keeps its original
Geocodio schema and exact dataset identity.

Call `merchant_geocodio_publisher` with an original action and payload:

| Action group | Original behavior |
| --- | --- |
| `publisher.status` | Read original drafts, releases and customers |
| `publisher.prepare` | Select `exportId` from this address workspace |
| `publisher.preview`, `publisher.reviewDraft`, `publisher.publish` | Review and publish the native versioned dataset |
| `publisher.activateSnapshot`, `publisher.collect` | Original snapshot activation and collection |
| `publisher.release.stage` | Original draft, release ID/label and host runtime |
| `publisher.release.inspect`, `activate`, `rollback`, `start`, `stop` | Original managed lifecycle and generation |
| `publisher.buyer.review`, `prepare` | Original offer, query and prepared buyer intent |
| `publisher.buyer.session` | Host `buyerWorkspace` plus original buyer ID and page/row/byte/payment limits |
| `publisher.buyer.run`, `recover`, `account`, `export` | Same retained acquisition, original ledger and customer outputs |

For session creation, choose the configured `buyerWorkspace` alias; the host
supplies its original directory. Release staging supplies the host runtime.
Other actions retain their original native inputs and validation, including
draft revisions, release generations and explicit unsigned-page continuation.
See the [original publisher guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/PUBLISHING.md).

## Complete file transport and reopening

`merchant_geocodio_file` supports source-export, provider-request, draft-csv,
draft-review, buyer-config, session-manifest, session-csv, session-jsonl and
session-review. Source-export also requires the original filename from that
export, including nested raw paths. Other kinds choose the original record ID.

The shared retained reader returns a base64 chunk, original SHA-256, read ID,
offset, next offset and EOF. Continue with the same read ID and SHA-256. Its
maximum chunk is 196,608 bytes; the original snapshot is released at EOF.
A file must match its native byte count and digest before the first chunk opens.
Use `merchant_geocodio_file_release` for a partial read that is no longer needed.

Exported `starforge-geocodio.json.gz` restores through a declared package alias
into an empty workspace. The original importer verifies retained bytes and
reproduces the native edition snapshots. Reopen the same populated directory
with `merchant_geocodio_open` to continue existing work.

`merchant_geocodio_browser` opens the existing industrial browser on the exact
MCP-owned operator. Closing the browser closes only its listener. Close the
workspace with its returned `instanceId`; repeated open retains the current
instance, and a later reopen acquires the original workspace lease again.

## Maintained source

- [Original address source, workspace, browser and CLI](../../stellar/scf-starforge-20261009/sf30-seller-sdk/geocodio/README.md)
- [Geocodio API documentation](https://www.geocod.io/docs/)
- [SimplyRETS API specification](https://docs.simplyrets.com/api/simplyrets-openapi.yaml)

MIT.
