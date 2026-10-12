# Retained RSS and Atom feed workspace

Turn a feed into a retained, reviewed dataset and an original Stellar Forge merchant release. The product combines HTTP capture, RSS 2.0 and Atom 1.0 interpretation, explicit review choices, searchable records, immutable editions, a private operator console, complete project transfer, and the original SF82/SF88 seller and buyer workflows.

The feed tables share the maintained XML workspace's SQLite database and writer lease. Edition projection, CSV construction, native query admission, cursor paging, exact-cell comparison and receiving use that original workspace and SF30 dataset engine. The Python import shim loads the maintained modules by filename so the XML console and feed console keep their own routes.

## Open the console

From `sf30-seller-sdk`, with Python 3.11+ and Node 22+:

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-work init
node dataset-cli.mjs feeds --workspace /private/feed-work serve
~~~

Open the private URL printed by `serve`. The listener is `127.0.0.1` with an ephemeral port by default. Its capability travels in the URL fragment and stays in this browser's session storage. Restarting the process supplies a new private link.

The console has four working sections:

- **Sources:** register or revise a feed; acquire its URL or import original XML; inspect captures, source bytes and HTTP history; resume an interruption; review and apply changes.
- **Retained records:** search by title, original ID or summary; inspect current and deleted records; open the publisher link; save private notes, tags and a star with an expected review revision.
- **Editions:** select feeds at displayed revisions and exposed fields; build, query and page an immutable native dataset; compare editions with the same field selection.
- **Delivery:** download a dataset or complete project; receive and reopen a project; prepare the selected dataset for the original merchant and buyer commands.

Long operations expose their activity. Capture cancellation retains completed pages. A saved browser action can resume with its original operation ID after a lost response. CLI and console operations use the same model.

The managed distribution exposes `stellar-forge dataset-feeds`. Python and static console assets are included by the existing recursive seller-SDK component.

## Register and acquire a source

Create a configuration with the selected publisher's URL:

~~~json
{
  "url": "https://publisher.example/feed.atom",
  "label": "Publisher notices",
  "rssIdentity": "guid-or-link",
  "allowedOrigins": ["https://publisher.example"]
}
~~~

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-work register \
  --feed notices --config /private/feed.json --revision 0 --operation register-notices

node dataset-cli.mjs feeds --workspace /private/feed-work capture \
  --feed notices --operation capture-notices-20261012 --pages 100

node dataset-cli.mjs feeds --workspace /private/feed-work captures --feed notices
node dataset-cli.mjs feeds --workspace /private/feed-work review --capture CAPTURE_ID
node dataset-cli.mjs feeds --workspace /private/feed-work requests --capture CAPTURE_ID
~~~

Initial registration creates revision 1. Configuration changes and capture application require the current feed revision. Each apply advances that revision, including a reviewed unchanged capture.

Capture saves every completed page and every HTTP attempt, including errors and redirects. Successful source bytes enter the original XML store. Other bounded response bodies are retained separately by SHA-256. Validators belong to the exact registered feed and URL.

Later requests send retained `If-None-Match` and `If-Modified-Since` values. A 304 reuses verified XML and its paging metadata. `Retry-After` on 429/503 is retained and observed before another request to that source. Redirects and next links stay within the explicitly selected origins; HTTPS redirects cannot downgrade to HTTP.

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-work resume --capture FAILED_CAPTURE_ID

node dataset-cli.mjs feeds --workspace /private/feed-work capture \
  --feed notices --operation capture-notices-next --from-capture CAPTURE_ID --pages 100

node dataset-cli.mjs feeds --workspace /private/feed-work import \
  --feed notices --file /private/publisher-original.xml --operation import-notices-20261012
~~~

`--one-page` retains the declared next link for a later continuation. `--force` requests a full representation without validators. Resume uses the failed operation's original page policy.

Each response supports up to 32 MiB, 250,000 XML nodes and the original parser's depth limit. A capture selects 1–1,000 pages; the default is 100. The original parser rejects DTDs and external entities. Enclosures and content URLs remain metadata; source acquisition follows selected feed next links.

## Identity and review

| Source fact | Result |
|---|---|
| Atom `id` | Preserve the exact absolute IRI, without case folding, URL normalization or numeric coercion. |
| RSS `guid` | Preserve its exact value and `isPermaLink`. A missing GUID uses an item link only under the explicit `guid-or-link` policy. |
| Newer Atom `updated` | Offer an update; rank fractional timestamps with exact decimal arithmetic. |
| Equal Atom time, different content | Require a choice. Unrankable dates and leap-second comparisons also remain explicit choices. |
| Changed RSS item | Require a choice; `pubDate` describes publication, not modification order. |
| Atom deleted-entry | Apply its original referenced identity and deletion time through review. |
| Older item absent from a page | Preserve the retained record. A rolling page is not a deletion list. |
| Repeated observations | Coalesce identical payloads; review distinct versions of an identity. |
| Atom author and URI inheritance | Resolve entry → source → containing feed; apply `xml:base` at the actual URI element. |
| Publisher markup | Retain normalized content and exact XML; display source content as text in the console. |

Review identifies ADD, UPDATE, DELETE, UNCHANGED, STALE and CONFLICT. It also shows a changed Atom feed identity. Choose every conflict and explicitly accept an identity change before applying.

The CLI decisions file maps each conflicting identity hash to its selected captured content hash, or to `"keep"`. Use the full hashes returned by `review`. `--accept-identity` accepts the reviewed new Atom feed identity.

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-work apply \
  --capture CAPTURE_ID --revision CURRENT_FEED_REVISION \
  --decisions /private/decisions.json --operation apply-notices-20261012
~~~

An operation ID binds the complete action and arguments. An unchanged retry returns its retained result. Reusing an ID for a different payload fails before altering records. Applying a capture, advancing its revision and retaining its result are one SQLite transaction.

Semantics follow [RSS 2.0](https://www.rssboard.org/rss-specification), [Atom RFC 4287](https://www.rfc-editor.org/rfc/rfc4287.html), [feed paging RFC 5005](https://www.rfc-editor.org/rfc/rfc5005.html), [Atom tombstones RFC 6721](https://www.rfc-editor.org/rfc/rfc6721.html), and [HTTP RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html).

## Build and query editions

The revisions file contains exact selected revisions, for example `{"notices":2}`.

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-work edition \
  --feeds notices --name "Morning notices" \
  --fields key,id,title,link,published,updated,summary,feed_id,source_sha256 \
  --revisions /private/revisions.json --operation edition-notices-morning

node dataset-cli.mjs feeds --workspace /private/feed-work query \
  --edition EDITION_ID --params /private/query.json

node dataset-cli.mjs feeds --workspace /private/feed-work compare \
  --before EARLIER_EDITION_ID --after LATER_EDITION_ID
~~~

Native query parameters are scalar strings:

~~~json
{"fields":"id,title","where_feed_id":"notices","sort":"title","limit":"25"}
~~~

Continue with the exact returned `page.nextCursor` and the same fields, filters, page size and sort. The native engine enforces its cursor contract. Source IDs, numeric-looking values and dates remain strings. Sorting source date columns uses the original dataset's string ordering.

The mandatory `key` derives from the registered feed and original item identity. It supports stable joins across editions while distinguishing the same item ID in two registered feeds. Editions with the same fields use one stable mapping regardless of display name. Comparisons use the original keyed exact CSV-cell comparison.

Content, authors, categories, enclosures and source URL are explicit field selections. Default fields expose titles, links, original source dates, summary, registered feed ID and source SHA-256. Private notes stay in the full project.

## Export and receive

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-work export \
  --edition EDITION_ID --out /private/feed-dataset

node dataset-cli.mjs feeds --workspace /private/feed-work project \
  --edition EDITION_ID --out /private/feed-project.zip

node dataset-cli.mjs feeds --workspace /private/received-feed init
node dataset-cli.mjs feeds --workspace /private/received-feed receive \
  --file /private/feed-project.zip --operation receive-feed-project
~~~

A dataset export contains original `data.csv`, `dataset.json`, `xml-lineage.json` and `feed-lineage.json`.

A project carries the selected edition's original native build plus the selected feeds' **current** records and complete capture history: source XML, HTTP attempts, explicit applications and private annotations. The selected edition may be older than present feed state. Hash and byte-length descriptors cover every packet member.

Receiving checks original XML observations, reconstructs the selected edition's normalized XML from exact lineage, and reopens the build through the maintained importer. Existing identities are compared before insertion; receive a divergent feed into a separate workspace.

The selected edition's completed operation replays normally. Operations for other historical editions remain history when their native builds are outside the selected packet. They cannot replay as successful missing editions. Packets support 1 GiB expanded content, a 256 MiB project body and bounded original source members.

## Prepare and run the original merchant

Use the selected dataset export, public SF30 payment terms in a JSON file, and separate private directories:

~~~sh
node dataset-cli.mjs feeds merchant prepare \
  --dataset-export /private/feed-dataset \
  --state /private/feed-versions \
  --payment /private/public-payment-terms.json \
  --origin https://api.example --path /feed \
  --out /private/feed-merchant-source \
  --release /private/feed-merchant-release

node dataset-cli.mjs feeds merchant serve \
  --release /private/feed-merchant-release --port 8423
~~~

Preparation loads the original dataset, generates its seller contract and snapshot selector, initializes/reopens the native version store, and calls maintained SF82 prepare/stage/inspect. The five original release inputs retain CSV, configuration, seller terms, source descriptor and controller binding. Original source-file descriptors carry complete feed/XML lineage into the staged release.

An unchanged retry checks retained inputs and returns the same release. Different existing contents remain distinct selections. A failed new-file write removes only that operation's partial inode so retry can recover.

The running seller reports its actual mode, snapshot, health, offers and developer-docs addresses. Configure the existing native facilitator with `--facilitator HTTPS_URL` for the native x402 runtime. Payment terms and native dependencies follow the existing seller distribution.

For another edition with the same fields, use original version continuity and its current snapshot **and** revision:

~~~sh
node dataset-refresh/cli.mjs status --state /private/feed-versions
node dataset-refresh/cli.mjs refresh \
  --state /private/feed-versions --dataset /private/new-feed-dataset/dataset.json \
  --expect CURRENT_SNAPSHOT --expect-revision CURRENT_REVISION
~~~

## Prepare buyer acquisition

Read the running original seller's actual offer and select its published snapshot:

~~~sh
node dataset-cli.mjs feeds buyer review \
  --seller http://127.0.0.1:8423 --resource https://api.example/feed \
  --snapshot PUBLISHED_SNAPSHOT --query 'fields=id,title&limit=25' \
  --out /private/feed-offer-review.json

node dataset-cli.mjs feeds buyer prepare \
  --review /private/feed-offer-review.json \
  --intent UNIQUE_BUYER_INTENT --accept-index 0 --out /private/feed-buyer
~~~

Preparation reloads the offer, compares its digest with the selected review and calls original SF88 preparation. `buyer.json` retains the original `operation` structure, payment expectations and snapshot-bound URL. The handoff retains the offer review and exact configuration hash.

Continue with the original dataset acquisition commands:

~~~sh
node ../sf88-operator-buyer-cli/dataset-cli.mjs init \
  --session /private/feed-acquisition --config /private/feed-buyer/buyer.json \
  --snapshot PUBLISHED_SNAPSHOT --max-pages 20 --max-total-atomic SELECTED_TOTAL_CAP

node ../sf88-operator-buyer-cli/dataset-cli.mjs run --session /private/feed-acquisition
node ../sf88-operator-buyer-cli/dataset-cli.mjs deliver \
  --session /private/feed-acquisition --out /private/feed-customer-delivery
~~~

SF88 supplies per-page quote review, durable reservations, continuation, receipt accounting and customer delivery.

## Native journey performed

One source-native journey used an RSS/Atom loopback protocol fixture and the actual XML/SF30/SF82/SF88 implementations on 2026-10-12:

| Operation | Observed result |
|---|---|
| Paged source interruption | HTTP 200, retained 503, resumed 200 |
| Conditional reread | Two 304 responses reused original pages |
| Interpretation | Exact large IDs/text, author/URI inheritance, retained older items |
| Changes | Atom update and tombstone; explicit RSS conflict choice |
| Original datasets | Four initial rows, then three; native cursor continuation |
| Comparison | Two changed, one removed, one unchanged |
| Receiving/reopen | Native build, current records, tombstone and private note retained; missing historical-edition replay rejected |
| Console and actual CLI | Authenticated native action completed; full-repository feed route opened with the original XML console present |
| Merchant/buyer | Two original provenance files; exact preparation replay; original CHALLENGE_ONLY seller returned 402; SF88 config retained the selected snapshot |

Native dataset engine blob: `7496dd29c59c23b3bc16c7d24a327a30b867625f`.
Selected snapshot: `8de319521173acaeaf88fbec8415413515a4fdd447b226b4480651c051482da4`.
Original SF88 configuration SHA-256: `2daf53a83ed2b76d84dae4ba94cf1beb459679cd3b31528f5b1dfdcb1fc02ccd`.
