# Feed collections, publishing and receiving through merchant MCP

This adapter connects the **existing RSS/Atom/OPML console** to merchant MCP.
The console continues to own its Python workspace and SQLite writer. The adapter
uses its original source intake, subscriptions, capture/resume, conflict review,
edition/query and project receiver.

The maintained dataset publisher already used by Socrata and WebDAV owns draft
review, dataset versions, SF82 releases and SF88/SF100 customer sessions. The
feed merchant module supplies its native CSV contract and complete feed/XML
lineage. Connecting MCP starts no second feed parser, acquisition store, payment
engine or browser.

## Connect the running application

Use the existing RSS / Atom subscriptions Applications entry. For a manually
owned process, the original launcher is:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/feeds/cli.py \
  --workspace /private/research-feeds init

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/feeds/cli.py \
  --workspace /private/research-feeds serve \
  --startup-format json --landing subscriptions --port 0
~~~

`init` is only for a new workspace. Use the existing console's current startup
record when its writer is already open.

Keep the complete `stellar-forge.feed-workspace-launch.v1` / `FEED_WORKSPACE_READY`
JSON in an owned private file. Its capability fragment is a credential. The
connector reads its `feeds` URL and compares the live authenticated `/api/launch`
record with that exact workspace/source/Python/PID binding. A native restart
requires the new original launch record.

A connection can alternatively reference the original private URL text, or an
environment variable containing it. Raw URL references select the exact
loopback capability; full launch-record references additionally verify the
managed source/workspace binding. The adapter never returns or logs the token.

Minimal private connection:

~~~json
{
  "schema": "stellar-forge.feeds-workspace-connection.v1",
  "workspaces": {
    "research": {
      "label": "Research subscriptions",
      "consoleUrlFile": "/private/research-feeds-launch.json"
    },
    "receiving": {
      "label": "Receiving workspace",
      "consoleUrlFile": "/private/receiving-feeds-launch.json"
    }
  }
}
~~~

Use canonical, owned private paths and mode 0600 for connection/launch files.
Each alias accepts exactly one of `consoleUrlFile` or `consoleUrlEnv`.
A raw URL must be the original `http://127.0.0.1:PORT/#CAPABILITY` feed URL.
The structured record can have a subscriptions landing; its `feeds` field
still selects the original API origin.

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-feeds-workspaces \
  --dir /private/research-merchant-mcp \
  --connection /private/feed-connections.json

node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/research-merchant-mcp/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

An existing merchant configuration can set `feedsWorkspaceConnection` to that
same file. Ordinary merchant `init` accepts `--feeds-workspaces CONNECTION_JSON`.
Incoming MCP bearer/OAuth configuration is the existing merchant transport
configuration, separate from the feed console capability.

HTTP and stdio use the same original merchant operator and tools. Shutdown closes
this adapter's transport/read handles and drains its native publishers.
The managed feed console retains its accepted work and owns its stop/reopen.

## Host source, merchant and buyer configuration

An alias may additionally declare:

| Field | Original meaning |
|---|---|
| `files` | Up to 128 named input files: `path`, `kind`, `sha256`, optional `label`. Kinds: `feed`, `opml`, `feed-project`, `collection-project`. |
| `merchantProfiles` | Public terms: `origin`, canonical `path`, actual SF30 `payment`, optional `label`. |
| `buyerWorkspaces` | Named already configured SF88 workspaces: canonical private `directory`, optional `label`. |
| `runtime` | Original SF82 `port`, optional `facilitator` and explicit `allowLocalFacilitator`. This is separate from the source-console port. |

Input handles require the complete selected SHA256. The adapter verifies the
canonical regular file and streams it with that hash. The original console
verifies the full upload before starting its retained operation. Mismatching
incoming bytes do not start an intake/receive operation.

Tool callers select declared aliases, never host paths, signer values or
facilitator settings. The existing buyer workspace retains its independently
configured signer, approval, network and spending policy.
`merchant_feeds_workspaces` returns aliases, source hashes and public terms;
private capability references and values stay in the host.

## Original operations and recovery

`merchant_feeds_action` takes `workspace`, `action` and original `input`.
Its schema exposes the source fields; the original engine validates them.

| Action | Required original input |
|---|---|
| `register` | `feedId`, `config`, `expectedRevision`, `operationId`. A new feed uses revision 0. |
| `capture` | `feedId`, `operationId`; optional `followPages`, `pageLimit`, `force`, `fromCapture`. |
| `resume` | Original `captureId`. |
| `apply` | `captureId`, `expectedRevision`, `operationId`; optional exact `decisions` and `acceptIdentity`. |
| `annotate` | `feedId`, `identity`, original note `expectedRevision`, `operationId`; optional note/tags/starred. |
| `edition` | `feedIds`, `name`, `fields`, `expectedRevisions`, `operationId`. Fields include `key`. |
| `query` | `editionId`; optional scalar-string `params`. |
| `compare` | `beforeId`, `afterId`. The original mapping/key requirements still apply. |
| `collection-save` | `collectionId`, `title`, `members`, `expectedRevision`, `operationId`; optional `newFeeds`. |
| `collection-capture` | `collectionId`, `expectedRevision`, `expectedRevisions`, `operationId`; optional `pageLimit`, `force`. |
| `collection-resume` | Original `runId`. |
| `collection-edition` | `runId`, `name`, `fields`, `expectedRevisions`, `operationId`. |

An action normally returns **HTTP 202 / RUNNING**. That is accepted work.
Read `merchant_feeds_status` until the original activity ends. Its `id` is the
console job digest; `operationId` identifies the underlying native intent.

After restart, read `merchant_feeds_read` with `kind: "operation"`, the original
ID, and `family: "feed"` or `"collection"`:

- `INTENT_RETAINED`: original request saved, no complete ledger result retained.
  Its `run` exposes the original partial acquisition and retained child capture
  IDs. Use the returned native `continuation` (`resume` or `collection-resume`)
  with that exact capture/run; this lookup never starts a replacement acquisition.
- `RESULT_RETAINED`: original result available. Inspect that result's own capture
  or run status; a retained result does not alter its source meaning.
- `historyOnly: true`: original carried history for another edition. The native
  engine does not replay it as a new active operation.
- An unknown operation returns an actual 404, not a completion or a claim that
  a request was never dispatched.

`query` and `compare` retain their original edition/build identities; the adapter
does not invent new operation IDs for them.

A transport interruption does not trigger automatic mutation replay. Read the
original worker/operation and use its supported continuation with the same input.
Cancellation requires the current exact `jobId`; the native worker lock guards
that comparison before setting the cancellation event.

## Subscription-to-edition workflow

1. Declare the complete OPML file/hash. Call `merchant_feeds_intake` with its file
   handle and an original operation ID. Follow its activity or collection record.
2. Read `kind: "subscription-plan"` by the original source hash. The plan retains
   source entry IDs, outline paths, comments, URL errors and registration matches.
   `array: "entries"` gives snapshot pagination.
3. Save selected members with `collection-save`. Each member has exactly
   `sourceId`, `entryId`, `feedId`, `enabled`; use the actual plan IDs. Manual
   subscriptions have null source/entry IDs and an existing feed ID. Disabled
   entries remain saved. Native limits: 10,000 members, 1–100 enabled feeds.
4. Read the collection's actual feed revisions and capture the selected revision.
   Resume an incomplete acquisition using that same run ID.
5. Review each capture, then apply its actual feed revision and conflict choices.
   `decisions` maps record identities to `keep` or an exact candidate `contentHash`.
   Changed Atom identity requires its explicit native acceptance.
6. Create the collection edition from that run and those applied revisions.
   Its **binding ID** selects collection-project export; its **edition ID**
   selects dataset/feed export and merchant preparation.
7. Query, annotate and compare through the original engine. Imported XML keeps
   its actual source URL/hash; it does not claim an HTTP capture occurred.

`merchant_feeds_inventory` pages feeds, editions, subscription sources and
collections. Continue with its `expectedSnapshot`.
`merchant_feeds_read` also exposes operations, collections/runs, captures,
requests, reviews, records, editions and changes. An `array` selection pages a
complete original response array with a snapshot digest.

Native captures/review/records/changes routes keep their existing live
`nextOffset` semantics and revision checks. They are not relabeled as immutable
snapshots. Query an original retained edition when that is the required meaning.

Responses over 64 KiB are retained as complete `result.json`, with a compact
native identity and downloadable manifest. Source arrays, values and record
content remain available in full through the same chunked file tools.

## Native merchant and customer workflow

Call `merchant_feeds_publisher_prepare` with `editionId`, a declared merchant
`profile`, and a chosen durable `productId` UUID.

The adapter transfers the original four-file dataset under its native manifest.
The original feed merchant verifies CSV/config identity, XML/feed lineage,
native row count and exact columns, then writes the source package with both
provenance files. The maintained publisher adopts that package and owns the
draft, version store, release and customer state.

Preparation starts no seller or purchase. The same selection reuses its native
package/draft. A later edition in the same product uses the original guarded
publication contract.

Use `merchant_feeds_publisher` with the same product. Read
`merchant_feeds_publishers` for the original saved state.

| Phase | Original action/input |
|---|---|
| Preview | `publisher.preview`: `target` (`draft:ID` or retained snapshot), original `query`. |
| Review/publish | `publisher.reviewDraft` or `publisher.publish`: `draftId`, exact `expectedSnapshot`, `expectedRevision`. |
| Stage | `publisher.release.stage`: `draftId`, native release `id`, optional `label`; runtime comes from host configuration. |
| Activate/start | `publisher.release.activate`: `id`, `expectedGeneration`; `publisher.release.start`: current `expectedGeneration`. |
| Drain/rollback | `publisher.release.stop`; or `publisher.release.rollback` with current `expectedGeneration`. |
| Review customer request | `publisher.buyer.review`: published `snapshot`, first-page `query` without cursor/snapshot parameters. Reads the actual offer and original private preview. |
| Prepare customer | `publisher.buyer.prepare`: exact returned `review`, native `intentId`, `acceptIndex`, `offerSha256`; original offer is re-read. |
| Bind session | `publisher.buyer.session`: returned `buyerId`, declared `buyerWorkspace`, explicit `maxPages`, `maxTotalAtomic`; optional native `maxRows`/`maxPageBytes`. |
| Run/recover | `publisher.buyer.run` or `publisher.buyer.recover`: original session `id`. Supported unpaid retry retains its original exact attempt selector. |
| Account/export | `publisher.buyer.account` or `publisher.buyer.export`: same session `id`, actual acquisition/page lineage. |

Atomic amounts, query values and high-precision identifiers remain strings.
No floating-point conversion is introduced.

After native customer export completes, `merchant_feeds_publisher_export` with
`kind: "customer"` retains **all four** native outputs: acquisition manifest,
CSV, JSONL, HTML review. It reads saved outputs and makes no purchase.
Complete `draft-csv`, `draft-review` and `buyer-config` are also available.

## Complete delivery, receiving and reopen

`merchant_feeds_export` takes an original `operationId`, `kind`, selected `id`:

| Kind | Actual selection |
|---|---|
| `collection-project` | Binding ID → complete selected collection, source history, registrations, operations and native edition. |
| `feed-project` | Edition ID → complete retained feed project. |
| `dataset` | Edition ID → native four-file dataset ZIP. |
| `opml` | Collection ID and optional exact revision → selected original OPML. |
| `opml-source`, `source`, `http-body` | Exact retained source/body hash. |
| `changes` | Original comparison ID → full JSONL changes. |

Each completed delivery has `feed-delivery.json`, exact filenames, byte counts,
SHA256 values and original selection. Feed/collection packets preserve their
native 1 GiB/1.5 GiB limits.

The shared native descriptor reader hashes a file once when opening it, checks
the descriptor around every bounded chunk, and retains at most four read
sessions. It does not reload or duplicate a full packet for every chunk.

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs inspect-feeds \
  --url http://127.0.0.1:3211/mcp \
  --workspace research --export-id ORIGINAL_EXPORT_SHA256 \
  --token-env MCP_ACCESS_TOKEN

node stellar-forge/mcp-merchant-operator/serve.mjs download-feeds \
  --url http://127.0.0.1:3211/mcp \
  --workspace research --export-id ORIGINAL_EXPORT_SHA256 \
  --out /private/received-research \
  --token-env MCP_ACCESS_TOKEN --chunk-bytes 65536
~~~

Use the actual MCP URL printed by the original listener.

The existing retained downloader saves exact files, manifest and verified prefix
checkpoints. Repeat the same download after interruption or MCP restart. It
resumes that prefix and reopens expired read handles without generating another
export; occupied/conflicting files are preserved.

`merchant_feeds_exports` exposes completed files and unfinished preparation
intents. A complete native response file is durable before its manifest.
An identical export can finish that original preparation without discarding
the response.

`merchant_feeds_receive` takes either a declared original packet file, or
`fromWorkspace` plus a retained `exportId`. It uses the selected existing
destination console. The original receiver validates/reconstructs the same
source/edition and retains operation history. Follow that worker and read the
original receiving operation.

Close/reopen the destination through its existing Applications owner, then read
the imported collection/edition and query it again. A host with only the
downloaded packet can use the original feed/collection CLI described in
`feeds/README.md` and `feeds/COLLECTIONS.md`.

## Source and lifecycle

- `feeds-workspace.mjs`: original console transport, source/collection operations,
  native publisher and complete result/file integration.
- `feeds-manifest.mjs` / `feeds-download.mjs`: complete manifest and the existing
  retained receiving client.
- `retained-source-files.mjs`: original WebDAV descriptor reader shared with feeds.
- Original `feeds/feed_workspace.py`: lookup of existing feed/collection intent,
  result and carried-history records.
- Original `feeds/server.py`: native export manifest/files, selected upload SHA,
  exact-job cancellation; original managed startup remains intact.
- Original `feeds/merchant.mjs`: package-only preparation from the same verified
  inputs; its standalone merchant CLI retains its original release behavior.

No hosted Actions or paid API call is required to connect, review, export or
receive source. Buyer execution uses the original configured payer and approval.
