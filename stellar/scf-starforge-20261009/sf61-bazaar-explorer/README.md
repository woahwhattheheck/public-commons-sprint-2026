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

Each catalog card shows the resource URL as **text, not a clickable merchant request**, source descriptions, tool or HTTP method when declared, tags and individual offered terms. UI text is inserted using DOM textContent, never interpreted as untrusted markup. Optional export saves the actual observed page to local JSON with mode, observation timestamp and requested filters.

CLI switches: --fixture (default), --upstream with explicit public HTTPS facilitator, and --port for a local listener (0 means ephemeral).

### What a reviewer can use

- Native source browsing, keyword discovery, filtering and original cursor/offset pagination.
- Real declared HTTP/MCP metadata and independently grouped x402 payment terms.
- Original page JSON export for subsequent engineering or commercial qualification.
- A demonstrably nonpayable default walkthrough without wallets, signatures or secrets.

### Scope and retained owners

There is no seller registration, ownership proof, money transfer, wallet signing, paid-origin invocation, facilitator verification/settlement, external customer contact, SCF interest/application submission, production deployment or guarantee that a listing is endorsed. SF30 seller SDK, SF41 live capture, SF45 recovery, SF46 release, SF53/SF57 reviewer evidence, SF58 gateway, SF60 catalog journal, and founder SCF application remain independently owned. This changes **none** of their source paths.

No CI, paid hosted Actions or new test suites are added. For source-exact broad simulation, ask the existing SF41/Muse owner to use original captures, not UI observations.
