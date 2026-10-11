# SF61 · Bazaar Atlas, Stellar x402 discovery explorer

A practical, accessible buyer/operator interface for the **original x402 v2 Bazaar GET discovery API**. It lists HTTP and MCP resources, searches with the provider's own native search, pages without substituting a synthetic ranking engine, and displays each individual payment offer with its network, scheme, payTo, asset and atomic-unit amount. It never combines fields from different offers or invokes a listed paid endpoint.

This is an additive original product interface, **not** a second index, facilitator, signer, seller-registration service, settlement engine, proof packet, funding application or simulation harness. It requires Node 22+ and the existing public Commons checkout. MIT.

## Run against original local source

From the public repository root:

~~~sh
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs --fixture
~~~

Open the printed local address in a browser on the same machine. The process imports the already-published **SF44 developer onramp** and calls its original startLocalDevelopmentCatalog(). SF44 itself imports the actual **PR451 BazaarCatalog** and createDiscoveryServer(), then serves a real loopback HTTP discovery API. The original SF44 seeded row has a deliberately invalid wallet recipient, INVALID_DEMO_RECIPIENT_NOT_A_WALLET; it is not a payable seller.

The explorer runs another loopback HTTP listener whose UI sends only same-origin GET requests. Those are forwarded exclusively to the original SF44 GET discovery endpoints. No duplicated catalog, ranking engine, mock HTTP service or remote merchant access is introduced. Ctrl-C closes both listeners.

## Connect to the ORIGINAL persistent SF60 catalog

The complementary [SF60 durable journal discovery service](../sf60-durable-catalog-transaction/SERVING.md) shipped in [PR635](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/635). The viewer now connects directly to that service without creating another catalog owner, lock, ingester or backend API. Start the existing operator's SF60 service **in its own process**, using a real existing catalog directory:

~~~sh
# Terminal A: operator-owned durable SF60 journal (example port 8787)
node stellar/scf-starforge-20261009/sf60-durable-catalog-transaction/service.mjs \
  --directory /private/catalog --port 8787

# Terminal B: canonical SF61 browser over exactly that service's read-only GET routes
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs \
  --local-upstream http://127.0.0.1:8787
~~~

Open the **SF61** printed browser origin in the same machine. Terminal B fetches the existing SF60's exact original GET /discovery/resources and /discovery/search, then returns native resource rows to the static Atlas browser. Terminal B never touches the journal directory or opens another journal lock. Terminal A owns the SF60 lock for the entire lifetime, and can also mount serveDiscovery({catalog}) in its existing authenticated owner process as documented by the backend author. Close the viewer with Ctrl-C and then the journal service; do not start a second SF60 standalone owner while an existing owner holds the journal.

The --local-upstream option accepts **only a literal IPv4 http://127.0.0.1:<port>** with an explicit port, no credentials, path/query/fragment or alternate hostname. It never follows redirect responses or forwards credentials, cookies or arbitrary browser URLs. Both HTTP listeners remain bound to the local loopback interface. This is local operator access rather than multi-user authentication; protect the host and do not expose either port over public interfaces. If the backend has no catalog records, Atlas shows an empty page instead of inventing listings.

## Operator-selected actual public facilitator

For the first-party named Vellar Stellar testnet Bazaar endpoint identified in the [SF41 original-source research](../sf41-real-source-replay/README.md), opt in explicitly:

~~~sh
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs \
  --upstream https://vellar-facilitator-testnet-production.up.railway.app
~~~

This **contacts the real external provider only when an operator runs the command**. No bearer credentials are forwarded or stored. It targets only original Bazaar GET discovery paths, rejects redirects, bounds the native page at 16 MiB with a 10-second request timeout and refuses arbitrary browser-selected remote URLs. HTTP remains loopback-only; the browser cannot change the upstream origin. The server requires the Host and socket peer to be 127.0.0.1 and supplies restrictive CSP, no-store and nosniff headers.

If the real provider fails, the UI displays the error instead of inventing results. The original SF41 capture pipeline remains the proper tool for complete provider retrieval, original-byte SHA256 custody, full offset coverage, and source-exact performance experiments. Atlas renders a **single observed native page at a time**, not an asserted complete corpus.

## Behavior

The browser sends native network, type, scheme and payTo filters. Blank query calls GET /discovery/resources using offset and limit; nonempty query calls GET /discovery/search using the original opaque cursor. The gateway accepts original resources, items, data.resources and data.items response wrappers but retains native row objects and their payment options. It never infers USD from atomic units.

Form edits are drafts until **Explore catalog** is submitted. They do not relabel the displayed offers or change the query attached to their export. The applied source-page filters remain visible beside the results. Previous and Next are disabled while drafts differ from that displayed page; submit Explore to start the new query, or choose **Restore displayed filters** to resume paging the existing query with its own cursor or offset.

Explore can replace an in-flight request. The browser cancels its pending request and ignores delayed replies from superseded requests. If a request fails, the previously loaded page remains visible with an explicit failure status; its labels, pagination and export stay bound to the original applied query. When no page has loaded yet, there are no retained rows to display.

Each catalog card shows the resource URL as **text, not a clickable merchant request**, source descriptions, tool or HTTP method when declared, tags and individual offered terms. UI text is inserted using DOM textContent, never interpreted as untrusted markup. Optional export saves the actual observed page to local JSON with mode, observation timestamp and the immutable query used to fetch that page, including its view, filters, limit and original cursor or offset. Unapplied form drafts are never substituted into that source-page record.

CLI switches: --fixture (default), --local-upstream with an existing SF60 read-only local source, --upstream with an explicit public HTTPS facilitator, and --port for a local listener (0 means ephemeral).

### What a reviewer can use

- Native source browsing, keyword discovery, filtering and original cursor/offset pagination.
- Real declared HTTP/MCP metadata and independently grouped x402 payment terms.
- Original page JSON export for subsequent engineering or commercial qualification.
- A demonstrably nonpayable default walkthrough without wallets, signatures or secrets.

### Scope and retained owners

There is no seller registration, ownership proof, money transfer, wallet signing, paid-origin invocation, facilitator verification/settlement, external customer contact, SCF interest/application submission, production deployment or guarantee that a listing is endorsed. SF30 seller SDK, SF41 live capture, SF45 recovery, SF46 release, SF53/SF57 reviewer evidence, SF58 gateway, SF60 catalog journal, and founder SCF application remain independently owned. This changes **none** of their source paths.

No CI or paid hosted Actions are added. For source-exact broad simulation, ask the existing SF41/Muse owner to use original captures, not UI observations.

The query-state continuation preserves original PR633/PR640 authorship, source metadata and provider routing; only the existing UI and its guide change. Focused local check: `node --experimental-vm-modules --test stellar/scf-starforge-20261009/sf61-bazaar-explorer/test/query-snapshot.test.mjs`. It executes the shipped browser module with an HTML-derived minimal DOM and controlled native-page responses, covering draft/source separation, exact cursor/offset export, failed paging, replaced requests and edits made while loading. It does not exercise a rendered browser, a live facilitator or the unchanged server.
