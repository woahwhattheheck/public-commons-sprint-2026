# Grants.gov research, publication and complete receiving

Operate the original Grants.gov workspace through the installed application,
browser, command line and merchant MCP. These surfaces retain one research model:
complete provider captures, immutable opportunity editions, qualification history,
source-backed workshares, native SF30 datasets, the original SF82 publisher and
original SF88 customer sessions.

The maintained source lives in
`stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov`.
[The research guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/README.md)
covers original source fields and browser operation;
[publication and customer delivery](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/PUBLISHING.md)
covers native merchant, release, facilitator and payer configuration.

## Install and open

Use a Node 24 runtime with the maintained Starforge distribution. The package
includes `grantsgov`, `grantsgov-receive`, the research browser, the merchant MCP
connection and the original source modules. Native paid publication uses the
same installed seller and buyer dependencies as the existing dataset publisher.

The installed registrations come from the source-owned
`distribution/contributions/grantsgov.json`. Inspect the original command and
module inventory through the same distribution CLI:

```sh
starforge registrations --source grantsgov
starforge registrations --command grantsgov-receive
```

Initialize a private original research workspace:

```sh
starforge grantsgov init --workspace /srv/grants/research
starforge grantsgov serve --workspace /srv/grants/research --port 0
```

The command prints the actual private browser URL. Save searches, start the
original capture, inspect every retained notice, create complete or selected
editions, save qualification and workshare revisions, and prepare the selected
edition as a dataset. Capture progress remains in that original workspace.

In the installed runtime console choose **Applications → New application →
Grants.gov opportunities**, select the initialized private research directory,
review and save, then review and start the application. Port `0` chooses an
available local port. The optional buyer bindings file contains only original
buyer IDs and directory references:

```json
[
  {"id":"existing-buyer","directory":"/srv/buyer/original-operator-workspace"}
]
```

Use the original private directory and a mode-0600 bindings file. The native
payer retains its signer, policy, intent, payment and accounting records.

Applications pins the installed source files, immutable research identity,
canonical directory and optional bindings. Its managed worker adopts the
selected runtime and starts that same original CLI. The startup observer checks
the original native announcement against those selections and the live
authenticated workspace identity before publishing **Open application**.
Ordinary source acquisition and review progress can change without changing the
saved original workspace identity. A source installation or buyer-binding change
requires a new review of the actual selection.

The original private URL is retained with the managed operation. Closing the
runtime browser leaves its managed application available. Stop it through that
saved operation; a later start retains the original workspace ID and opens a new
owned native process. This application is listed separately from SF47 grant
planning and delivery, which retains project allocations and delivery finances.

## Connect the original workspace to an agent

Create a private connection JSON. Each alias selects one existing canonical
private workspace directory. Retained input aliases carry the exact complete
file SHA-256, and can name an original `capture`, `edition` or `workspace`
packet.

```json
{
  "schema":"stellar-forge.grantsgov-workspace-connection.v1",
  "workspaces":{
    "research":{
      "label":"Federal opportunity research",
      "directory":"/srv/grants/research",
      "sources":{
        "original":{
          "label":"Complete original provider capture",
          "kind":"capture",
          "file":"/srv/grants/inputs/original-capture.json",
          "sha256":"REPLACE_WITH_THE_ACTUAL_64_CHARACTER_FILE_SHA256"
        }
      }
    }
  }
}
```

Omit `sources` when the original workspace will acquire provider data itself.
Relative paths resolve beside the connection file. Each of up to 32 workspace
aliases names a distinct original directory. Source files remain host-selected;
tool calls select an alias and the native packet reader verifies the complete
source bodies and bindings when they are imported.

Initialize the merchant host, then connect using either existing transport:

```sh
starforge merchant-mcp init-grants-workspaces \
  --dir /srv/grants/agent-host \
  --connection /srv/grants/grants-workspaces.json

starforge merchant-mcp serve \
  --config /srv/grants/agent-host/merchant-mcp.json --port 3211

starforge merchant-mcp-stdio \
  --config /srv/grants/agent-host/merchant-mcp.json
```

Initialization creates the new merchant host, its ordinary release store,
customer export directory and merchant configuration. It validates the original
connection before opening that new host. An existing merchant configuration can
instead add `grantsWorkspaceConnection` pointing to the same connection JSON.

For HTTP, configure the MCP client's Streamable HTTP URL from the actual startup
announcement and supply its existing bearer through `MCP_ACCESS_TOKEN` or the
host's selected `--token-env`. HTTP and stdio use the same original operator
and complete tool definitions. A Grants-only host accepts requests up to 512 KiB;
other attached products retain their larger configured limits where applicable.

Start with `merchant_grants_workspaces`, then call:

```json
{"workspace":"research"}
```

on `merchant_grants_open`. The returned browser URL belongs to the very same
native workspace object as the agent. Use that browser for the original
industrial research interface while the tools operate its saved model.
Opening the alias again reuses the owned instance.

An independently running standalone browser or managed application already owns
its native writer. Stop that original owner before opening the same directory
through a different host. Within one MCP host the browser and tools already
share their owner and require no copy or parallel workspace.

## Acquire and qualify complete opportunities

Save a native query with `merchant_grants_query_save`:

```json
{
  "workspace":"research",
  "requestId":"ai-query-v1",
  "expectedRevision":0,
  "name":"Current AI opportunities",
  "definition":{
    "keyword":"artificial intelligence",
    "statuses":["posted","forecasted"],
    "pageSize":25
  }
}
```

Keep its original ID and revision. Call `merchant_grants_capture` with
`workspace`, a stable `requestId`, that `queryId`, `expectedRevision` and
a stable `operationId`. The original acquisition captures the complete search
page chain and every notice's full detail. Inspect
`merchant_grants_capture_status` with the returned `captureId`.
To continue an interrupted acquisition, call capture with that same capture ID
and a new stable request for the continuation. Pause retains all pages and
details for that acquisition.

For an already retained original source packet, call
`merchant_grants_source_import` with `workspace`, `requestId` and its
configured `source` alias. The original packet remains authoritative.

Create an edition using `merchant_grants_edition_create` with `workspace`,
`requestId`, `name` and either the complete `captureId` or an existing
`sourceEditionId`. An optional `opportunityIds` list selects actual retained
notice IDs; `parentId` preserves the comparison lineage. The edition is
immutable and carries its original source identity and coverage.

Use `merchant_grants_opportunities` with `workspace` and `editionId` to
page all rows. Keep its returned `snapshot`, pass it as `expectedSnapshot`
with each subsequent `offset: nextOffset`, and finish when `nextOffset`
is null. Filters include text search, status, agency and retained closing-date
range. The native source fields, qualification summaries and total count are
returned together. `merchant_grants_opportunity` adds the exact
`opportunityId` and returns the full original notice, description, eligibility,
funding, dates, current synopsis, forecast, attachment/package manifests,
revision history and complete analyst review.

The source distinguishes actual posted dates and amounts from their retained
forecast values. Raw source strings remain available when normalization yields
null. Eligibility and forecast narratives travel with the original notice.
Qualification can therefore cite the exact notice without substituting a
forecast deadline or turning an unknown amount into zero.

Save `merchant_grants_review_save` with the original edition/opportunity,
stable `requestId`, current `expectedRevision` (zero for its first review),
and a `review` object. Supported fields are:

| Field | Use |
| --- | --- |
| `status` | `researching`, `qualified`, `preparing`, `ready` or `passed`. |
| `owner` | Person or delivery team responsible for the opportunity. |
| `fit` | Concrete relationship between the original need and the proposed work. |
| `eligibilityAssessment` | Applicant assessment against the retained program requirements. |
| `partner` | Applicant, research or delivery partner selection. |
| `workshare` | The proposed implementation contribution. |
| `deliverables` | Complete outputs and handover scope. |
| `acceptance` | Observable completion conditions. |
| `schedule` | Source deadline and delivery calendar. |
| `fee` | Current reviewed commercial terms or the actual case reference. |
| `nextAction` | The current original case or application action. |
| `notes` | Supporting analysis and retained source references. |

Each text field accepts up to 32,000 characters. Native revision checks preserve
concurrent edits and retain complete history. Reuse the same request ID only
with exactly the same mutation inputs; inspect the original current state after
a lost response.

`merchant_grants_compare` takes original `before` and `after` edition IDs
and returns exact added, absent and changed source records. Page every change or
export the complete comparison. `merchant_grants_workshare` returns the full
native Markdown or HTML for one qualified opportunity.

## Prepare, publish and receive the original dataset

Call `merchant_grants_merchant` for an immutable edition with a stable
`requestId`. Without a merchant profile, the native SF30 dataset is ready for
local query and preview. `merchant_grants_preview` takes its `merchantId`
and the original dataset `query` object. Follow the native page cursor to
retrieve the complete selected edition; original raw source fields remain
available in the dataset.

For publication, the host connection's optional `merchants` map declares
named public merchant profiles. Each includes `origin`, the original
`payment` object and optional `path`, `defaultLimit` and `maxLimit`.
Use the actual HTTPS public origin and existing original payment configuration
from the publishing guide. A tool call selects that alias as `profile`;
the native SF30 compiler validates its exact public terms.

The optional connection `runtime` selects the original seller's `port`,
`facilitator` and explicit `allowLocalFacilitator` setting. Optional
`buyerWorkspaces` aliases each contain `label` and the original private
`directory`. Source, merchant and buyer aliases support up to 100 entries
each. Payer directory aliases remain distinct within a workspace.

The publication tools delegate to the original Grants.gov publisher, Socrata
dataset controller, SF82 release store and SF88 buyer:

1. `merchant_grants_publisher_prepare` selects the prepared `merchantId`
   and reuses its original matching draft.
2. Read `merchant_grants_publisher_status`, preview the original draft and
   retain its draft ID, snapshot, revision and release generation.
3. `merchant_grants_release` with `action: "stage"` selects that
   `draftId`, a new release `id` and optional label. Host runtime settings
   are supplied by the connection. Inspect, activate, start, stop and roll back
   through the same tool using the original IDs and expected generation.
4. For a later draft, use `merchant_grants_publisher_review`, then
   `merchant_grants_publish` with the exact reviewed `draftId`,
   `expectedSnapshot` and `expectedRevision`. Existing dataset cursors
   retain their original snapshot through publication.
5. `merchant_grants_buyer_review` retrieves the actual offer and first page
   for the selected `snapshot` and native query. Prepare the buyer with its
   original `review`, `offerSha256`, `acceptIndex` and stable
   `intentId`.
6. `merchant_grants_buyer_session` joins the prepared `buyerId` to a
   host-declared original `workspaceId` and explicit `maxPages`,
   `maxTotalAtomic`, optional `maxRows` and `maxPageBytes`.
7. Run or recover that same saved session through `merchant_grants_buyer`.
   Its existing unpaid retry uses `retryUnpaid` and the inspected
   `expectedAttemptSha256`. Complete its original accounting and export
   using the same session ID.
8. `merchant_grants_publisher_export` retains the original draft, buyer
   configuration or actual customer manifest, CSV, JSONL and review for the
   common complete download workflow below.

Publication, payment and accounting continue from their own saved operation
records after interruption. Opening or exporting research does not start those
operations. Use the original publisher status to recover the existing action
before issuing another publication or buyer request.

## Download every byte and reopen the source

`merchant_grants_export` retains one complete original `workspace`,
`edition`, `capture`, `merchant`, `comparison`, `workshare-md` or
`workshare-html` file. Supply the corresponding retained IDs: edition,
capture, merchant, before/after or edition/opportunity. A selected edition
export can include qualification with `includeReviews: true`.

The returned export ID is its complete file SHA-256. Save that ID immediately;
if the response is lost, inspect the original exports inventory for the existing
descriptor before creating another export. `merchant_grants_manifest`
returns its original filename, length, file digest and completion-manifest
digest. The stored native export is used directly by the common reader.

Inspect and download through the same MCP endpoint:

```sh
starforge grantsgov-receive inspect \
  --url http://127.0.0.1:3211 --workspace research --export-id ORIGINAL_EXPORT_SHA

starforge grantsgov-receive download \
  --url http://127.0.0.1:3211 --workspace research --export-id ORIGINAL_EXPORT_SHA \
  --manifest-sha256 REVIEWED_MANIFEST_SHA --out /srv/grants/received-package

starforge grantsgov-receive receive \
  --directory /srv/grants/received-package --into /srv/grants/received-research \
  --request original-research-receiving
```

`starforge merchant-mcp grants-download` exposes these same inspect, download
and receive commands. HTTP bearer selection uses `--token-env`; the existing
token remains in the host environment. The optional `--chunk-bytes` is an
integer from 1 through 196,608.

The shared downloader saves each exact prefix and checks its SHA-256 when
resuming. Repeating the download with the same original URL, workspace, export
and output directory continues it after a connection or MCP restart. It verifies
the full original payload and publishes `grants-export-manifest.json` last.
An explicit reviewed manifest SHA prevents adopting a different export
selection. Read leases last 120 seconds; an expired lease reopens the same
retained file at its verified offset. Manual chunk callers retain both expected
hashes and the read ID, and can release an unfinished lease with
`merchant_grants_file_release`.

The current complete-file receiving limit is 256,000,000 bytes per export.
Large original files use the shared temporary file reader; the persistent
payload remains in its original workspace. The transport includes all source
bytes, qualified notice data and original file identities.

The `receive` command accepts a complete capture, edition or workspace
download. The native reader verifies the completed manifest, full file and
original packet before import. A full workspace backup restores its original
workspace ID, queries, retained captures, immutable editions and full
qualification history into an empty receiving workspace. A selected edition
carries the source and referenced review/parent edition lineage needed by that
packet. Stable receive request IDs reuse the original completed import.

Merchant packages and workshare/customer documents can be downloaded through
the same command. Their own original runtime, publisher or receiving tools open
those formats as described in the research and publishing guides.

## Compact source storage

New capture packets are retained losslessly as deterministic gzip members with
explicit stored and decoded byte lengths and SHA-256 values. Existing plain
JSON capture packets remain readable. Merchant source manifests bind the
actual compressed member, its decoded identity and the original packet identity.

Complete capture, edition and workspace exports reconstruct the original
decoded packet. Readers enforce the encoded and decoded limits while checking
both digests. Native SF82 source retention uses a forced reflink when the
filesystem supports it and the verified streaming copy otherwise; the source
manifest describes the retained bytes on either filesystem.

The [source storage guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/SOURCE_STORAGE.md)
includes the retained layouts, complete decoding and source-copy behavior.

## Complete tool inventory

All scoped tools take `workspace`. Original IDs, request IDs, revisions,
snapshots, generations and source digests retain their native meanings.

| Tool | Complete operation |
| --- | --- |
| `merchant_grants_workspaces` | List configured research, source, merchant and payer aliases. |
| `merchant_grants_open` | Open the original workspace and its borrowed browser. |
| `merchant_grants_close` | Drain the exact owned native instance. |
| `merchant_grants_status` | Read original identity, revision, counts, jobs and browser URL. |
| `merchant_grants_inventory` | Page saved queries, captures, editions, reviews, merchants or exports. |
| `merchant_grants_query_save` | Create or revise an original native search. |
| `merchant_grants_query` | Read its original definition and revision. |
| `merchant_grants_capture` | Start or continue the same full source acquisition. |
| `merchant_grants_capture_status` | Inspect original page/detail progress and coverage. |
| `merchant_grants_pause` | Pause that acquisition while retaining its source. |
| `merchant_grants_source_import` | Import an exact host-declared capture, edition or workspace packet. |
| `merchant_grants_edition_create` | Create a complete or selected immutable edition. |
| `merchant_grants_edition` | Read its original metadata and source coverage. |
| `merchant_grants_opportunities` | Page and filter original rows with qualification summaries. |
| `merchant_grants_opportunity` | Read one complete notice, review and history. |
| `merchant_grants_review_save` | Save a complete qualification/workshare revision. |
| `merchant_grants_compare` | Compare original source editions and page every change. |
| `merchant_grants_workshare` | Read the original workshare as Markdown or HTML. |
| `merchant_grants_merchant` | Prepare the original SF30 dataset and selected public terms. |
| `merchant_grants_preview` | Query the prepared native dataset and continue its cursor. |
| `merchant_grants_export` | Retain a complete source, research, merchant or workshare file. |
| `merchant_grants_manifest` | Inspect that export's exact receiving manifest. |
| `merchant_grants_file` | Read every exact byte through resumable pinned chunks. |
| `merchant_grants_file_release` | Release a temporary read snapshot. |
| `merchant_grants_publisher_status` | Reopen drafts, dataset versions, release and customer state. |
| `merchant_grants_publisher_prepare` | Prepare the original native publisher draft. |
| `merchant_grants_publisher_preview` | Query a saved draft or dataset snapshot. |
| `merchant_grants_publisher_review` | Review a draft at the actual snapshot and revision. |
| `merchant_grants_publish` | Publish that original reviewed draft. |
| `merchant_grants_snapshot` | Activate a retained snapshot or collect native versions. |
| `merchant_grants_release` | Stage, inspect, select, run, stop or roll back the original seller. |
| `merchant_grants_buyer_review` | Review the actual native offer and source page. |
| `merchant_grants_buyer_prepare` | Prepare the original buyer intent from that exact review. |
| `merchant_grants_buyer_session` | Join an existing original payer with explicit acquisition limits. |
| `merchant_grants_buyer` | Run, recover, account or export the same customer session. |
| `merchant_grants_publisher_export` | Retain full publisher and customer delivery files. |

## Native source-to-receiving journey

The maintained `grantsgov/examples/agent-native.mjs` uses one complete original
capture, the actual merchant MCP transport and the same research/publisher
modules. It receives every source row, revises a qualification twice, creates
and compares selected editions, queries the native SF30 dataset to its final
cursor, interrupts and resumes the full workspace download across an MCP
restart, restores full and selected-edition receivers, and closes/reopens the
original managed CLI with authenticated instance checks.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/examples/agent-native.mjs \
  --capture /srv/grants/inputs/original-capture.json \
  --directory /srv/grants/original-agent-journey \
  --operation original-grants-agent-journey
```

Its persistent `agent-operation.json` binds the original input, workspace,
source IDs, receiving endpoint, exports and step results. Continue the same
directory and operation after interruption. The companion research-native
journey covers desktop/mobile browser receiving; publisher-native covers the
existing original seller and paid customer lifecycle.
