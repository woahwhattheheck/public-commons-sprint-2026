# SF61 · Bazaar Atlas, Stellar x402 discovery explorer

A practical buyer/operator interface for the **original x402 v2 Bazaar GET discovery API**. Browse HTTP and MCP resources, inspect each original payment option, and prepare an exact Stellar HTTP request for the existing SF88 buyer terminal. The compact neutral interface preserves individual asset, recipient and atomic-unit amount strings. It never combines terms across options or invokes a listed seller endpoint.

This is an additive original product interface, **not** a second index, facilitator, signer, seller-registration service, settlement engine, proof packet, funding application or simulation harness. It requires Node 22+ and the existing public Commons checkout. MIT.

## Retain catalogs and buyer requests

Atlas can keep captured catalogs and buyer work in a private directory across restarts. Start with an absolute path whose parent already exists:

```sh
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs \
  --workspace /private/atlas
```

Open the complete address printed by the terminal. Import an original SF88 capture folder (session, manifest and all saved pages), a saved native provider page, or an Atlas page export. Search retained offers, select one exact payment option, and save a named buyer request. Each prepared revision retains its original catalog row, selected terms, stable operation ID, request headers, body and ticket inputs. The existing SF88 builder creates the buyer configuration and operation handoff.

The saved workspace supports interrupted capture uploads, restart, side-by-side request comparison, and complete export/receive with the original identifiers and bytes. The installed distribution exposes `starforge atlas` and `starforge atlas-workspace`; the latter exports, inspects and receives complete workspaces. Linux uses the same util-linux `flock` runtime as the maintained buyer workspaces. See [the workspace operating guide](WORKSPACE.md) for intake, receiving, file-product destinations, request editing and the original buyer commands.

To browse a live source while retaining selections, combine `--workspace` with one of the source options below.

## Run against original local source

From the public repository root:

~~~sh
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs --fixture
~~~

Open the printed local address in a browser on the same machine. The process imports the already-published **SF44 developer onramp** and calls its original startLocalDevelopmentCatalog(). SF44 itself imports the actual **PR451 BazaarCatalog** and createDiscoveryServer(), then serves a real loopback HTTP discovery API. The original SF44 seeded row has a deliberately invalid wallet recipient, INVALID_DEMO_RECIPIENT_NOT_A_WALLET; it is not a payable seller.

The explorer runs another loopback HTTP listener. Discovery uses same-origin GET requests forwarded exclusively to the original source's GET discovery endpoints. Buyer preparation uses one same-origin local JSON POST to the existing SF88 pure configuration builder; that request performs no network or disk I/O. The deliberately nonpayable development listing has its review action disabled. Ctrl-C closes both listeners.

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

Each catalog card shows the resource URL as text, source descriptions, declared operation, tags and individual offered terms. UI text uses DOM textContent. Page export saves the original normalized rows with source mode, exact discovery URL, observation timestamp and immutable query, including its original cursor or offset. Unapplied form drafts are never substituted into that record.

## Catalog selection to buyer terminal

1. Connect Atlas to an original SF60 catalog or an explicitly chosen public facilitator and find the intended HTTP resource.
2. Choose **Review this offer** beside one exact Stellar option. The buyer workspace retains that original page, row and option independently of later browsing, form-filter edits and refreshes. It shows the full asset, recipient, atomic amount and timeout. An earlier selection is visibly labeled when another page is displayed.
3. Enter a **stable operation ID**, the concrete URL and intended method. A declared original method is fixed; an undeclared method requires an explicit choice. The original SF88 builder enforces the selected origin/path, supported exact Stellar terms, timeout, atomic integer bounds and optional payment flow. Enter your own query values; seller examples never become request inputs automatically. Optional Content-Type, Accept and an absolute body-file path use SF88's original operation validator. Preparation does not read a body file.
4. Choose **Prepare buyer review**. Atlas calls `prepareReview()` from the existing `sf88-operator-buyer-cli/prepare.mjs`, including its same 1 MiB source-input and 64 KiB configuration limits. The generated configuration contains the whole original listing and source file SHA-256. No operator identity, secret, signer, budget policy or execution approval is created.
5. Save **both** the buyer configuration and selected source JSON in the private operator workspace. The displayed source digest hashes the exact downloaded UTF-8 source bytes; the configuration digest hashes the exact downloaded configuration. Browser downloads use the browser's normal directory and file permissions. Use private storage; these downloads do not inherit the CLI's POSIX `0600` guarantee.
6. Run the existing terminal review command with the absolute path to the saved configuration:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/operator/buyer-review.json
```

Complete the existing trusted operator, evidence and public payer settings using the SF88 guide. The merged [SF103 native Stellar signer](../sf103-native-buyer-signer/README.md) then connects the official x402 SDK to this same saved operation; its setup command creates a private buyer/signing configuration pair without requiring a custom signer implementation. Follow its preparation and inspection steps before using the generated buyer configuration with SF88. SF88's original current-challenge matching, SF62 terminal approval and SF36 reservation still own spending. A saved listing is review context, not proof of current seller terms or approval.

Editing any buyer request field invalidates a prepared configuration and disables its download until prepared again. Replacing or clearing a selection cancels its pending preparation; a delayed response cannot overwrite the new request. Browsing a different source page keeps the selected observation and its prepared configuration intact.

The unchanged CLI `--prepare` entrypoint now also accepts original `scf61-observed-native-page-v1` exports (including older exports without a source URL). It uses the same builder as Atlas, then performs its existing private, exclusive, fsynced write. The original `/api/prepare-review` endpoint performs pure preparation; the optional saved-workspace routes retain requests in the host-selected private directory. It accepts only loopback Host/socket, an exact same-origin Origin, JSON content type and limited request bytes, and imports no signer or execution module. All remote discovery remains GET-only.

CLI switches: --fixture (default), --local-upstream with an existing SF60 read-only local source, --upstream with an explicit public HTTPS facilitator, optional --workspace for retained catalogs and requests, and --port for a local listener (0 means ephemeral).

### What a reviewer can use

- Native source browsing, keyword discovery, filtering and original cursor/offset pagination.
- Real declared HTTP/MCP metadata and independently grouped x402 payment terms.
- Original page JSON export for subsequent engineering or commercial qualification.
- A demonstrably nonpayable default walkthrough without wallets, signatures or secrets.

### Scope and retained owners

There is no seller registration, ownership proof, money transfer, wallet signing, paid-origin invocation, facilitator verification/settlement, external customer contact, SCF interest/application submission, production deployment or guarantee that a listing is endorsed. SF30 seller SDK, SF41 live capture, SF45 recovery, SF46 release, SF53/SF57 reviewer evidence, SF58 gateway, SF60 catalog journal, and founder SCF application remain independently owned. This changes **none** of their source paths.

No CI or paid hosted Actions are added. For source-exact broad simulation, ask the existing SF41/Muse owner to use original captures, not UI observations.

The query-state continuation preserves original PR633/PR640 authorship, source metadata and provider routing; only the existing UI and its guide change. Focused local check: `node --experimental-vm-modules --test stellar/scf-starforge-20261009/sf61-bazaar-explorer/test/query-snapshot.test.mjs`. It executes the shipped browser module with an HTML-derived minimal DOM and controlled native-page responses, covering draft/source separation, exact cursor/offset export, failed paging, replaced requests and edits made while loading. It does not exercise a rendered browser, a live facilitator or the unchanged server.
