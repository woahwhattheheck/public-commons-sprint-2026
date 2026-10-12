# WordPress source and merchant workspace

The WordPress operator turns an original WordPress REST source into reviewed, versioned data products. It discovers the source's native collections, retains resumable HTTP captures, projects records into the original SF30 dataset engine, compares editions and carries the complete source into the existing publisher, seller release and customer acquisition.

The same operator can export and receive a complete source workspace. A separate complete-source product uses the existing SF88 file projection and customer delivery implementation.

## Open the installed operator

Use the merchant package's installed Node and Python runtimes:

~~~sh
starforge wordpress init --dir /absolute/private/wordpress-source
starforge wordpress serve --dir /absolute/private/wordpress-source --port 0
~~~

The direct source entrypoint is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/wordpress/cli.mjs serve \
  --dir /absolute/private/wordpress-source --port 0
~~~

The command prints one JSON startup record containing the actual local URL, process ID, instance ID and stable workspace identity. Keep that command open while using the browser. Closing it drains its own source requests, publisher and seller process before releasing the workspace lease.

The source-owned **WordPress source and merchant workspace** application appears in the maintained Applications catalog through `distribution/contributions/wordpress.json`. Select an initialized private workspace or a freshly received packet. Applications uses the original runtime selection, command ledger, private environment, startup observer and resource lifecycle. Its preparation binds the installed source files and workspace UUID/creation identity. Launch checks those identities under the original workspace lock and verifies the actual HTTP listener.

Node must support the original exact JSON parser from `sftp/formats.mjs`; use the current merchant installation's Node runtime. Python uses the standard library for packet creation and receiving. Private mutable directories use mode 0700 and files use mode 0600. Source code belongs to the installed package.

## 1. Save the original source

In **Source & discovery**, enter the REST root advertised by the actual WordPress site. Both canonical forms are supported:

~~~text
https://the-selected-site.example/wp-json/
https://the-selected-site.example/index.php?rest_route=/
~~~

These are URL-shape examples. Use the actual selected site's URL.

Save the source's context, native page size, timeout and response-byte ceiling. Native page size is between 1 and 100. The declaration is immutable; changing the account, context or endpoint creates another source identity.

Public access uses:

~~~json
{
  "schema": "stellar-forge.wordpress-source.v1",
  "label": "Selected WordPress site",
  "apiRoot": "https://the-selected-site.example/wp-json/",
  "context": "view",
  "authentication": {"mode": "none"},
  "perPage": 100,
  "timeoutMs": 30000,
  "maxResponseBytes": 16777216,
  "allowLoopback": false
}
~~~

For authorized private content, select application-password access and give two environment references:

~~~json
{
  "mode": "application-password",
  "usernameEnv": "WORDPRESS_USERNAME",
  "passwordEnv": "WORDPRESS_APP_PASSWORD"
}
~~~

Configure those names in the original host environment or its private Applications environment file. The username and application password are resolved when the native request is sent. Saved source records, response descriptors and exported packets carry the references. Edit context requires this account selection.

HTTPS is required for remote sources. A local WordPress installation can use HTTP only when its source explicitly selects `allowLoopback: true`. Redirect responses are retained and require selection of the original destination root; the request transport does not forward authorization to a different host.

## 2. Discover collections and capture their original responses

**Discover native collections** reads the actual REST index, post types and taxonomies. The discovered index supplies each collection's native namespace, route, supported query arguments and type metadata. Posts, pages, media, enabled custom post types and REST-enabled taxonomies therefore use the source's own routes.

Open the completed discovery. Select its collections and review the capture-selection JSON:

~~~json
{
  "collections": [
    {"key": "type:post", "query": {}},
    {"key": "type:page", "query": {}},
    {"key": "type:attachment", "query": {}},
    {"key": "taxonomy:category", "query": {}}
  ],
  "maxPages": 10000,
  "maxRecords": 250000,
  "maxBytes": 536870912
}
~~~

Include only keys returned by that source's discovery. Use its actual query arguments to select status, dates, search terms or other supported filters. Capture owns context, page, page size and offset; field omission and embedded-response transforms are excluded from the retained full-record capture.

The capture uses native ascending ID order when the route advertises it, original page numbering and the native `X-WP-Total` / `X-WP-TotalPages` headers. It records the original totals and any change observed during pagination. Each completed capture has an observation window, source digest, discovery digest, exact selection and complete response inventory.

A live website can change during a multi-request capture. Missing pagination headers, changing totals and repeated native IDs remain visible as original source findings. These captures describe the responses observed during that window. Edition building requires completion of the same selected capture.

### Continue after an interruption

The source response is atomically saved **before** its progress cursor advances. If a process stops between those two writes, reopening and resuming the same capture reads the saved response at that sequence and advances it once. The original HTTP body does not need to be requested again.

The browser exposes:

- The same job ID, native collection/page cursor and response counts.
- The actual retry time for retained rate-limit or service responses.
- Pause and resume over the original capture.
- Paged native records, each linked to its original response sequence and body digest.
- A source response preview and download of its complete retained response record.

A capped capture keeps its original ceiling. When the native source exceeds that declaration, open the source selection and start a new capture with the required larger limits. Repeating the same capped intent preserves the original response and cursor.

Discovery and capture actions return their job identity immediately in the browser API. The direct CLI waits for that launched job before closing its workspace. A completed discovery can be reused for another capture with its same source identity.

## 3. Project and review an edition

In **Projection & review**, choose a completed content capture and load the native content projection.

The default fields include native identity, collection, status, title, source URL, dates, parent/author/media IDs, original HTML content, MIME type, media URL and taxonomy values. All source HTML is displayed as text in the operator.

Projection pointers have two roots:

| Pointer root | Meaning |
| --- | --- |
| `/record/...` | Uniform WordPress fields assembled from the original record |
| `/native/...` | Exact original JSON fields, including custom registered REST fields |

Each column declares its native dataset type, nullability and missing-field behavior. Example:

~~~json
{
  "schema": "stellar-forge.wordpress-projection.v1",
  "label": "Selected editorial records",
  "collections": ["type:post"],
  "duplicatePolicy": "last",
  "mapping": {
    "key": {"pointer": "/record/key", "type": "string", "nullable": false, "missing": "error"},
    "native_id": {"pointer": "/record/native_id", "type": "integer", "nullable": false, "missing": "error"},
    "title_html": {"pointer": "/record/title_html", "type": "string", "nullable": false, "missing": "error"},
    "source_url": {"pointer": "/record/url", "type": "string", "nullable": false, "missing": "error"}
  }
}
~~~

Choose first, last or error for any repeated native ID captured from a changing source. The choice becomes part of the immutable projection.

The original source JSON parser preserves numeric tokens. String columns can retain an exact custom decimal or large integer without binary floating-point conversion. Choosing an integer or number column invokes the original dataset type rules. Null and empty text use the existing CSV encoder.

Preview the typed rows and observed source types, then save the mapping. Building an edition requires a reviewer, an explicit approve decision and the exact displayed capture and projection hashes. The dataset configuration selects its original name, filters, ranges, sorts and page/row/byte ceilings. If a custom projection omits a field used by the displayed default configuration, remove that filter, range or sort before building.

The edition retains:

- Original source and projection identities, reviewer and decision.
- Native dataset configuration, CSV, snapshot and typed-column observations.
- The original capture's window, findings and collection metadata.
- A native-record index binding each projected row to its source response and original/projected record digests.

An interrupted build reuses the same immutable intent and capture. It does not contact WordPress.

## 4. Compare editions and operate the original publisher

**Editions & changes** compares native collection/record identities. Results distinguish additions, removals, source-content changes, projection-only changes and unchanged records. Each change links its before/after source response and record digest. The comparison also states whether source, projection and collection selection are equivalent.

Preview the selected edition through the original native dataset query. Configure the merchant's actual origin, route and full payment object, then save its review. Copy that payment object from the original merchant configuration; amounts and alternative payment choices retain the existing seller schema.

Export the edition to a new product, or to the same product for a compatible query-contract update. This produces the original `dataset.csv`, `dataset.json`, `source.json` and `seller.json`, together with declared WordPress source files.

The complete source closure includes the selected connection, discovery, exact raw responses, mapping, review and edition. The original `readDatasetSourceFiles` implementation verifies it. Original publisher preparation and SF82 staging preserve that closure in their own manifests and release identities.

The browser embeds the maintained publisher panel from `socrata/public/publisher.mjs`. Its actions remain:

1. Prepare the selected exported edition through the original dataset publisher.
2. Review and publish a retained draft against its actual snapshot and revision.
3. Stage and select the original seller release, then start its owned runtime.
4. Read the customer's actual offer, select its payment choice and retain the original intent.
5. Run or recover the same original buyer session and export its completed delivery.

Version retention, release generation, rollback, facilitator configuration, payment attempts, acquisition limits and complete customer pages stay in their original implementations. The WordPress workspace returns their original results and retains the encompassing operator action.

Each product owns one original publisher directory. A different query contract can use another product without replacing the first product's versions or customer history.

See [the original publisher operating guide](../socrata/PUBLISHING.md) for the complete version, release and customer workflow.

## 5. Export, receive and continue complete source

After pausing active source captures, **Create complete source packet** writes a ZIP with `wordpress-source.json`. That manifest lists every included original file, exact byte count and SHA-256 and binds the source workspace identity and revision.

The packet includes saved source declarations, native discoveries and responses, paused capture progress, mappings, editions, merchant public terms and content exports. Host-owned publisher processes and buyer state remain with their original workspaces. Packet history and earlier complete-source projection exports are excluded to avoid recursive copies.

A packet creation interrupted after its ZIP completed adopts that same operation's exact packet on retry. It does not rebuild it from a later source revision.

Receive the packet into a new private directory:

~~~sh
starforge wordpress packet-inspect --input /absolute/wordpress-source.zip
starforge wordpress receive --input /absolute/wordpress-source.zip --dir /absolute/received-wordpress
starforge wordpress serve --dir /absolute/received-wordpress --port 0
~~~

The browser's receiving form performs the same receiving operation using a packet path already on its host.

Receiving validates the full source inventory, copies only declared regular files and retains an atomic receiving identity. Repeating it validates completed files and resumes missing members. A conflicting destination file is preserved and reported. Once the received operator has changed its mutable state, reopen it directly instead of replaying an older packet over that state.

The received workspace keeps its stable UUID and original creation identity. Applications binds that identity together with the new canonical directory. Reconfigure its saved credential references on the receiving host before continuing an authenticated capture. Existing completed captures, previews, comparisons and source downloads operate from retained bytes.

### Complete source through the original customer acquisition

**Offer the complete source through the original buyer** creates another dataset product over a selected complete packet. It uses the original source-file field layout with 49,152-byte chunks and one additional `workspace_id` field.

The source-file capture ID is the SHA-256 of the complete manifest bytes. Every row binds its path, whole-file length/hash, chunk index/count and chunk hash. The original native dataset limits still apply: at most 256 MiB of CSV, one million rows and the selected existing page-byte ceiling. Ordinary source packet export supports its own larger total-source budget.

Prepare, publish and acquire this product through the same publisher and buyer panel. Then receive the original completed `DatasetDelivery` with:

~~~python
from wordpress.source_files import restore_wordpress_source

received = restore_wordpress_source(
    original_dataset_delivery,
    "/absolute/private/received-wordpress",
    expected_capture_id=reviewed_manifest_sha256,
    expected_workspace_id=reviewed_workspace_uuid,
)
print(received.workspace_directory)
~~~

Use the installed SF30 source directory on Python's import path, as with the existing source-file consumers. The adapter delegates complete-page, payment, chunk and manifest verification to `source_file_delivery.py`. It then checks the restored WordPress workspace binding. Open that received directory with the same WordPress operator.

## Original action recovery and API

Every mutating workspace action has a caller-retained UUID, action, input and expected workspace revision:

~~~json
{
  "action": "source.discover",
  "operationId": "CALLER_RETAINED_UUID",
  "expectedRevision": 2,
  "input": {"sourceId": "SAVED_SOURCE_UUID"}
}
~~~

The endpoint is `POST /api/act`. Use the local page's `x-workspace-token` header. The browser retains pending envelopes in its tab and exposes the original action in workspace history.

The result is saved with its exact state mutation before that mutation is committed. After an interrupted commit, retrying the same UUID and unchanged input joins the already-completed outcome into the current workspace. A different input cannot reuse that UUID.

Original publisher actions that stopped before their result was retained are reconciled through their own publisher, buyer intent or session. Use the panel's existing status/recovery operations. A saved WordPress result can be adopted without dispatching the publisher again.

| Operation | Input |
| --- | --- |
| `source.save` | `{source}` |
| `source.select`, `source.discover` | `{sourceId}` |
| `capture.start` | `{sourceId, discoveryId, selection}` |
| `capture.resume`, `capture.pause` | `{sourceId, captureId}` |
| `mapping.save` | `{sourceId, captureId, expectedCaptureSha256, projection}` |
| `edition.build` | `{mappingId, dataset, review}` |
| `merchant.save` | `{editionId, origin, path, payment, reviewer, note}` |
| `edition.export` | `{editionId, merchantId, productId? or productLabel, reviewer, note}` |
| `product.select` | `{productId}` |
| `source.packet` | `{}` |
| `source.files` | `{packetId, merchantId, productId? or productLabel, name, reviewer, note}` |
| `publisher.*` | Original publisher input, plus optional selected `productId` |

GET APIs provide state, operation, source job, paged records, response preview, saved mapping, edition, comparison and exact-file downloads. Projection and dataset previews use their POST endpoints. `GET /api/health` returns the small original workspace/listener identity without returning its source corpus.

The same native APIs are exported from `workspace.mjs`, `capture.mjs` and `edition.mjs`. The CLI supports inspect, act, operation, job, records, mapping, edition, compare, preview, dataset-preview, receive and packet-inspect. Run `starforge wordpress help` for exact flags.

## Source references

The adapter uses these first-party WordPress contracts:

- [REST API discovery](https://developer.wordpress.org/rest-api/using-the-rest-api/discovery/)
- [Post types](https://developer.wordpress.org/rest-api/reference/post-types/)
- [Taxonomies](https://developer.wordpress.org/rest-api/reference/taxonomies/)
- [Posts and their native fields/query arguments](https://developer.wordpress.org/rest-api/reference/posts/)
- [Pagination and native total headers](https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/)
- [Authentication and application passwords](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [Global parameters and context](https://developer.wordpress.org/rest-api/using-the-rest-api/global-parameters/)

The source is delivered by the existing merchant distribution contribution. Its Applications adapter follows [the maintained provider contract](../../distribution/runtime-workspace/APPLICATION_PROVIDERS.md).
