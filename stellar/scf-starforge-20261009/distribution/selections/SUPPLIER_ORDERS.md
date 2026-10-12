# Supplier order desk

The supplier order desk keeps original Unite openTRANS 1.0 orders, confirmations,
dispatch notifications and invoices in one private operator workspace. It retains
every original XML file, saved draft, prepared document and explicit current
selection. Browser, command line and merchant MCP use the same native workspace.

## Install and open

Build the complete product from its published Git revision with the maintained
distribution builder:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /path/to/original-repository \
  --ref ORIGINAL_COMMIT \
  --selection supplier-orders \
  --out /path/to/supplier-orders-release
```

Use the returned archive with the original installation and runtime commands.
The application uses Node.js 24 or later and Python 3. The captured openTRANS
DTDs ship with the product, and XML processing uses the installed Python standard
library. The merchant MCP host uses its original declared runtime dependencies.

```sh
starforge supplier-orders serve --workspace /private/supplier-orders
```

Open the private URL printed by the command. Keep the URL's token with the
operator; it grants access to this workspace. The interface binds to the local
computer and presents a neutral order list, document history, editable draft,
review and file delivery surface.

## Receive and review an order

Import the complete supplier ORDER XML. The workspace retains its original bytes
before parsing, associates its exact supplier and order number, and creates the
first current order selection. Further versions remain in history until the
operator selects the intended version with a reason.

An order number remains one complete identifier, including hyphens and suffixes.
Every subsequent line resolves against the original order number and original
line number. The review identifies article, unit, supplier, currency, quantity,
line amount and required recipient-field differences beside their source paths.

For each order, the operator can see the ordered, confirmed, cancelled, dispatched
and invoiced quantities; remaining quantities; current source documents; parcel
references; serial numbers; and review findings. Current document errors affect
order status even when quantities balance.

## Prepare confirmations, dispatches and invoices

Create a confirmation from the selected original order. Keep the source line
identifiers and enter the current confirmation or cancellation quantity. A negative
confirmation quantity records the cancelled quantity. When a later partial
confirmation replaces a line, the current view uses that line's latest selected
confirmation and retains the earlier document in history.

Create a dispatch notification from remaining quantities. Split an order across
separate dispatch documents and record available parcel, tracking, delivery-period
and serial information. A revised dispatch with the same business identifier
replaces that document's current contribution. Supplier dispatch documents describe
what the supplier reported as dispatched.

Create an invoice from uninvoiced quantities and the current commercial source.
Prices use exact decimal arithmetic, including price quantities other than one.
The operator can choose explicit rounding. Known unbilled dispatch references
produce separate invoice lines so each original openTRANS invoice item carries
its permitted delivery reference. Header and line fields follow the actual DTD
for the selected document kind.

Saving a draft records a complete revision and the exact source order selection.
Preparing it produces complete XML, parses those same bytes with the captured DTD,
reviews the recipient requirements, and retains the outgoing original. Select
the prepared document explicitly when it should contribute to the current order.
Concurrent order changes require reopening the draft's intended source selection.

The original sender/customer transport can take the resulting XML file and its
exact byte length and SHA-256 from the browser, CLI or MCP retained-file interface.

## Command line

```sh
starforge supplier-orders import --workspace /private/supplier-orders \
  --input /incoming/order.xml --request-id original-order-intake-001

starforge supplier-orders orders --workspace /private/supplier-orders

starforge supplier-orders order --workspace /private/supplier-orders \
  --order PO4500002323

starforge supplier-orders new-draft --workspace /private/supplier-orders \
  --kind ORDERRESPONSE --order PO4500002323

starforge supplier-orders save-draft --workspace /private/supplier-orders \
  --request /private/confirmation-request.json

starforge supplier-orders prepare --workspace /private/supplier-orders \
  --request /private/prepare-request.json

starforge supplier-orders select --workspace /private/supplier-orders \
  --request /private/current-selection-request.json
```

The full draft returned by `new-draft` includes `orderIds`, `orderRevisions`,
`orderStateSha256` and `document`. Retain those source fields in the save request,
add one stable `requestId` and a `reason`, and edit the business document. A later
save includes `draftId` and the currently observed `expectedRevision`.
Prepare requests contain `requestId`, `draftId` and `expectedRevision`.
Selection requests contain `requestId`, the returned document `id`, a reason,
and `expectedOrderRevisions` from the current workspace.

A request ID belongs to one original operation and payload. Repeating it reads
that operation's actual result; give a changed operator action its own ID.
`operation` returns the complete journal record. `validate` reads original XML;
`render` reads the complete normalized document and emits its original XML form.
Use `starforge supplier-orders --help` for all command arguments.

## Complete customer receiving

```sh
starforge supplier-orders export --workspace /private/supplier-orders \
  --request-id supplier-workspace-delivery-001 --out /deliveries/supplier-orders.zip

starforge supplier-orders receive --workspace /private/customer-orders \
  --input /deliveries/supplier-orders.zip --request-id customer-receiving-001
```

The ZIP contains every original source file and complete workspace rows: document
and draft revisions, current selection IDs, operation history and foreign branches.
The receiving operation checks the complete ZIP, source files and immutable
documents before merging. Newly received business documents are parsed again from
their original XML. Accepted matching local sources are reused.

Existing customer selections and drafts remain current. Incoming divergent or
later history is preserved as a foreign branch, so the customer can continue its
own next revision. Replaying an older package retains that same customer state.
The browser and MCP offer the same export and receiving operations, complete-file
downloads and resumable byte ranges.

Per-document XML intake supports 64 MiB. Complete workspace ZIPs support 8 GiB.
Transfers may continue while bytes progress; an idle HTTP connection is closed
after 30 seconds. Workspace shutdown waits for admitted native operations to finish.

## Merchant MCP and client

The source-owned `supplier-orders` provider adds the complete order workflow to
the maintained merchant host. Initialize it with the original provider command,
then start the existing host:

```sh
starforge merchant-mcp init-provider supplier-orders --options /private/host-options.json
starforge merchant-mcp serve --config /private/merchant/merchant.json
```

The provider guide documents the exact host-options schema, connection file,
runtime, credentials, complete 27-tool catalog, client, CLI and receiving flow:

- `stellar-forge/mcp-merchant-operator/SUPPLIER_ORDERS.md`
- `stellar-forge/mcp-merchant-operator/supplier-order-client.mjs`
- `stellar-forge/mcp-merchant-operator/supplier-order-client.d.mts`
- `stellar-forge/mcp-merchant-operator/supplier-order-cli.mjs`

`starforge supplier-order-client` uses that same provider. Its tool results retain
native operation status, complete validation findings and original file identities.

## Original source and recipient rules

The installed source directory retains the original openTRANS 1.0 DTDs, four
publisher XML examples, ReadMe and source manifest. The full publisher ZIP and
its individual members are identified by their original hashes. The recipient
profile separately records Unite's published interface requirements and the
v3.3 supplier guide.

The original DTD is the structural authority for emission. For example, it names
the confirmation date `ORDERRESPONSE_DATE` and the delivery-note identifier
`DELIVERY_NOTE_ID`. Invoice item structure permits one delivery reference, while
delivery periods and party groups have document-specific locations. Original
optional empty string fields and unedited extensions remain available in the source.

Primary references:

- https://support.unite.eu/en-gb/for-suppliers/edi-interfaces-for-order-processing
- https://support.unite.eu/en-gb/for-suppliers/order-transmission-interface
- https://support.unite.eu/en-gb/for-suppliers/order-confirmation-interface
- https://support.unite.eu/en-gb/for-suppliers/dispatch-notification-interface
- https://support.unite.eu/en-gb/for-suppliers/invoice-interface
- https://unite.eu/assets/support/uk/mercateo-edi-3-3supplier_en.pdf
- https://unite.eu/assets/support/uk/specification_opentrans_v1_0_en-2.pdf
