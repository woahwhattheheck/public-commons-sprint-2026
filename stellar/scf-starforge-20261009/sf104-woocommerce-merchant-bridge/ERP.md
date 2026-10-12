# WooCommerce → Acumatica order delivery

This extension adds an ERP operating workspace to the existing Woo merchant plugin. A manager selects the original Woo order, prepares a retained mapping revision, approves the exact ERP request, and reconciles the actual returned sales order. Corrections, interrupted responses, and a second engineer's reopen stay with that same order journal.

Open **WooCommerce → Order ERP delivery**. The same operations are available through `merchant-erp-cli.mjs` and the existing authenticated merchant client. This extension uses the original Woo order lock, WordPress permissions, and installed database.

## Installed contract and references

The adapter implements Acumatica's published **25.200.001 SalesOrder** contract. The mapping selects the actual application URL and endpoint name; `Default` is the published endpoint name. Read the selected installation's `/entity/<endpoint>/25.200.001/swagger.json` from the Mapping page before approving its first delivery.

Primary contract sources are pinned to Acumatica's own repository at `bc657f6f8a703057ed8d623fcab48617ba6180f2`:

- [Complete Default 25.200.001 OpenAPI](https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp/blob/bc657f6f8a703057ed8d623fcab48617ba6180f2/EndpointDefinitions/Default_25.200.001).
- [SalesOrder model](https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp/blob/bc657f6f8a703057ed8d623fcab48617ba6180f2/Endpoints/Acumatica.Default_25.200.001/Model/SalesOrder.cs).
- [SalesOrderDetail model](https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp/blob/bc657f6f8a703057ed8d623fcab48617ba6180f2/Endpoints/Acumatica.Default_25.200.001/Model/SalesOrderDetail.cs).
- [Address model](https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp/blob/bc657f6f8a703057ed8d623fcab48617ba6180f2/Endpoints/Acumatica.Default_25.200.001/Model/Address.cs).

The schema's example server is a publisher example. Use the application authorized for the actual integration. A compatible custom endpoint can be selected by name, but it must expose the required fields and GET/PUT paths checked by this adapter.

| Operation | Native contract |
|---|---|
| Find the original order | GET `/SalesOrder` with exact `OrderType` and `CustomerOrder` filter, expanded details, and a two-result ambiguity check |
| Read a known order | GET `/SalesOrder/<OrderType>/<OrderNbr>` |
| Create | PUT `/SalesOrder` with `If-None-Match: *` |
| Correct the known order | PUT `/SalesOrder` with its original keys and `If-Match: *` |
| Link a detail row | Native `LineNbr` and optional entity `id`, joined through the retained original line reference |
| Delete an owned detail row | The original native line key and lowercase `delete: true` |

`CustomerOrder` and `ExternalRef` are references, not uniqueness constraints. `OrderNbr` is assigned by the ERP on initial save. The adapter retains that actual key instead of treating a Woo number, SKU, or array position as an ERP key.

## Configure the existing installation

Use the plugin's existing WordPress/WooCommerce installation and source closure. The ERP PHP modules use PHP 8+, the normal WordPress database API, and the native Woo order objects. No additional PHP package, Node package, schema service, queue, scheduler, or hosted CI workflow is required.

The WordPress administrator registers authorized ERP application/credential pairs in the process environment:

```sh
export SF104_ERP_CONNECTIONS='[{"baseUrl":"https://erp.example.com","tokenEnv":"SF104_ERP_ACUMATICA_TOKEN"}]'
```

Set `SF104_ERP_ACUMATICA_TOKEN` separately to the existing authorized bearer token. Keep the value out of the mapping file, Git, command arguments, and exported project. The token must be available to the PHP process handling the request; rotating a shell variable after a long-running PHP process starts does not update that process.

The manager can select only a registered application/credential pair for live requests. This keeps a mapping editor from sending an environment credential to a different host. Production requests use HTTPS, certificate verification, and no redirects.

For a deliberately selected local development connection, register its exact `http://127.0.0.1:<port>` application, set `SF104_ERP_ALLOW_LOOPBACK=1`, and set the mapping's `target.allowLocal` to `true`. This permits only that explicit loopback form. It does not relax a production connection.

The operator API uses `manage_woocommerce`. Browser requests use the existing WordPress REST nonce and cookie session. The CLI uses the original merchant-operator configuration and application-password environment references. Its HTTPS transport selects an explicit Basic-auth profile bound to the configured WordPress origin. Existing Bearer and payment transport behavior remains unchanged.

## Prepare the mapping

Copy `erp-map.example.json` into the operator's working files and replace the example identifiers with actual approved records. The Mapping page also supports editable, paged binding tables, per-table CSV import/export, and complete mapping JSON import/export.

| Mapping area | What the operator selects |
|---|---|
| Store | A stable namespace, order currency and precision, operating owner, and admitted Woo states |
| Connection | Registered application URL, endpoint name/version, credential reference, ERP order type, optional branch/tax zone, and initial hold setting |
| Customers | `customer:<Woo ID>` or `email:<billing email>` mapped to an existing ERP customer and optional location |
| Products | `product:<actual product or variation ID>` or `sku:<original SKU>` mapped to existing inventory, unit, optional tax category, and warehouse |
| Shipping | An explicit inventory/unit/tax/warehouse binding for original shipping lines, including zero-price shipping |
| Fees | `fee:<exact original Woo fee name>` mapped to existing inventory/unit/tax/warehouse |
| Addresses | Original Woo billing/shipping addresses, or the existing ERP customer's default addresses |

A product variation ID takes precedence over its parent; SKU is the fallback. Customer ID takes precedence over an approved billing-email mapping. Email references are normalized to lowercase. Each binding table has unique source keys. Mapping values are trimmed before the immutable revision ID is computed.

Changing or reselecting a mapping retains the previous revision. Existing order editions continue to reference their original maps. Saving requires the currently selected map ID, so an outdated form cannot silently replace another manager's selection.

The initial sales date follows the installed ERP's normal date default. This flow does not choose a historical accounting period, create customers or inventory records, or infer tax setup. Select those existing business records during implementation.

### Exact amounts

Money and quantities are handled as decimal text. The HTTP request emits the contract's required JSON number tokens directly from validated decimals, without converting them to a binary floating-point number.

For each original product, shipping, or fee line, the adapter retains source identity, quantity, subtotal, net total, tax, and the selected ERP mapping. It derives the unit price using half-up rounding at the approved unit-price precision, then requires the extended price to reproduce the original subtotal at currency precision. It also requires:

- All line net amounts plus the original order tax to equal the original Woo total.
- Line discounts to equal the original Woo discount total.
- The selected map's currency to equal the original order currency.
- A positive quantity and nonnegative source money in this sales-order flow.

The request disables automatic discount updates and sets manual line pricing/discounts. The installed ERP calculates tax using its configured tax categories and zone. Receiving compares the actual returned tax and order totals to the original Woo amounts, as well as native line quantities, prices, discounts, subtotals, and net amounts.

A tax difference is an operating exception. It does not become an accepted order because the HTTP write returned 200.

The current operating limits are 250 order lines, 5,000 rows per binding table, 0–4 currency decimal places, and 0–8 unit-price decimal places. Negative fees, returns, credit documents, foreign-exchange conversion, and automatic account/catalog creation require their own approved flows. Original Woo refund IDs are retained as source context; this extension does not create an ERP credit from them.

## Operate an original order

1. **Prepare.** Select the native Woo numeric order ID and mapping revision. The source includes the original Woo order key digest, display number, customer, addresses, all supported lines/taxes, amounts, and refund IDs. A namespace cannot silently create a second project for an already linked Woo order.
2. **Review.** Inspect mapped lines, customer/addresses, exact request, source changes between editions, operating owner, and the current Woo state. Unmapped or non-admitted source orders remain visible in the queue with their specific issue.
3. **Approve.** Name the current edition and journal revision and give the operating reason. The server rereads the original Woo order and checks its identity, amounts, admitted state, and installed mapping contract.
4. **Deliver.** A preflight read looks for an existing order. A unique exact match is adopted without another write. Ambiguous or differing results stay in the original exception flow.
5. **Receive.** Before any PUT, the server persists the exact approved request and pending attempt. It saves the returned response before the receiving GET. The actual target fields, document key and native line crosswalk determine the result.

Preparing the same financial source and mapping in the same admission category reuses its edition. A status change within admitted states does not change the financial source digest. Moving from a non-admitted state into an admitted one can create a usable preparation after the Woo source is corrected. A changed financial source or mapping requires review of its new retained edition.

Every mutation uses the original Woo order lock and a matching retained journal revision. The CLI, browser and another operator therefore work on the same project. No browser page load or queue refresh sends an ERP order.

| Queue state | Operating meaning |
|---|---|
| WAITING_WOO | The selected Woo state is outside the approved ERP admission states |
| NEEDS_MAPPING | The source or selected mapping requires correction before a complete request can be prepared |
| READY | A complete original source edition is ready for review |
| APPROVED | The exact current edition has an operating approval |
| RECEIVED | A native ERP read matched the selected edition and returned its real document/line keys |
| SOURCE_CHANGED | A newer original source or a reviewed target correction requires another approval |
| CONFLICT | The target is ambiguous, changed, or differs from the approved source |
| UNCERTAIN | An original request is retained and its receiving outcome needs resolution |
| REJECTED | The ERP returned field rejection; the original response and receiving state are retained |
| IMPORTED | A complete project was reopened and has not yet been bound to this original Woo installation |
| NEEDS_RECONCILIATION | The target must be read before another approval or delivery |

The queue searches the original Woo ID, customer-order reference, operation ID, and actual ERP order number. Its indexed pagination does not load every order to render a page.

## Recover an interrupted response

Use **Reconcile ERP** on the original project. Reconciliation reads the pending edition and known business key or original reference; it does not send another PUT.

If that read exactly matches the pending edition, the journal retains the real target keys and resolves the original attempt as received. A current Woo source that has since changed remains visible for its next edition.

If the target is unique and belongs to the original Woo order but its amounts or mapped fields differ, review the actual document and use **Use shown target for correction**. The operator names the exact target baseline and the reason. If an earlier request is unresolved, the operator also records that its ERP processing has finished. Every returned line must have an owned source reference and an actual native line key.

This decision records **IDENTIFIED_FOR_CORRECTION**, not financial acceptance. Prepare and approve the correction; the receiving read must then match the corrected source before the target becomes received.

If the completed original ERP operation produced no order, the operator can record that checked provider outcome, explicitly confirm no order was received, and authorize another review. The server performs a new native search and preserves the original attempt and recovery decision. Approval is cleared; a new write still requires an explicit current-edition approval.

A zero-result search by itself does not show whether earlier processing is still running. The client does not retry an uncertain write automatically.

## Correct the same ERP order

Prepare the current Woo source or corrected mapping. Review the differences and the latest target document. Approval captures that exact target baseline. Immediately before the update, delivery rereads the ERP order and requires the same baseline.

The update includes the original ERP order number. Each retained Woo line reference joins to its actual returned `LineNbr` and optional `id`. New source lines are added. Removed lines use their owned original keys with `delete: true`. A foreign or ambiguous ERP detail row prevents this correction from deleting unrelated work.

The request uses `If-Match: *` for an existing document and `If-None-Match: *` for a create. Those are **existence guards**, not a native compare-and-swap on a document revision. Coordinate ERP edits to this order during the read/write interval. The adapter records its preflight baseline and actual receiving comparison but does not claim an atomic ERP revision lock.

## Command-line handoff

Run from the installed `sf104-woocommerce-merchant-bridge` source:

```sh
node merchant-erp-cli.mjs help
node merchant-erp-cli.mjs status --config /private/merchant/operator.json
node merchant-erp-cli.mjs map-save --config /private/merchant/operator.json --input /private/merchant/erp-map.json --expected-map none
node merchant-erp-cli.mjs map-check --config /private/merchant/operator.json --map MAP_SHA
node merchant-erp-cli.mjs prepare --config /private/merchant/operator.json --order WOO_ID --map MAP_SHA --revision 0
node merchant-erp-cli.mjs inspect --config /private/merchant/operator.json --operation OP_SHA --out /private/merchant/order-review.json
```

Read the returned native IDs and current revision; do not treat placeholders as executable IDs. Use revision 0 only for a new ERP project. Later preparations and decisions name the current retained revision:

```sh
node merchant-erp-cli.mjs approve --config /private/merchant/operator.json --operation OP_SHA --revision CURRENT_REVISION --edition EDITION_SHA --reason-file /private/merchant/approval.txt
node merchant-erp-cli.mjs deliver --config /private/merchant/operator.json --operation OP_SHA --revision APPROVED_REVISION --edition EDITION_SHA
node merchant-erp-cli.mjs reconcile --config /private/merchant/operator.json --operation OP_SHA --revision CURRENT_REVISION
node merchant-erp-cli.mjs export --config /private/merchant/operator.json --operation OP_SHA --out /private/merchant/complete-erp-project.json
```

The client supports 75-second ERP requests and responses up to 16 MiB. Existing merchant calls retain their original limits. A client deadline does not erase a retained server-side attempt; inspect the same operation before another decision. Output files are written with mode 0600 and are not overwritten with different contents.

The full CLI includes paged orders/maps, mapping read/save/check, prepare, inspect, approve, deliver, reconcile, identify target, authorize retry, bind import, and complete export/import. All methods use `createMerchantClient`; there is no separate credential store or parallel delivery queue.

## Reopen with another engineer

A complete export contains the original operation, all referenced mapping revisions, source editions, approved requests, responses, receiving comparisons, native line crosswalks, operator decisions and import history. It includes customer/address data and environment **names**, but no resolved credential values.

Retain the original Woo database and plugin source with the export. The ERP export is not a Woo database backup and does not recreate Woo orders.

On the receiving installation:

1. Restore the original Woo order/database and install this plugin source.
2. Register the approved ERP connection and configure its named token.
3. Import the complete ERP project. Its digest, original identity, mapping/plan relationships, attempts, and receiving crosswalk are checked.
4. Select its retained mapping revision and bind the project to the original Woo order. Binding checks the actual current Woo order key/content and reads the installed ERP contract.
5. Reconcile its actual target. Imported approvals are not reused to send another order.

Import never replaces an existing live or divergent journal. Reimporting the identical saved project returns its existing imported operation. Source history remains retained even when the target still requires correction.

The portable project limit is 16 MiB. The per-order retained journal limit is 8 MiB. If that journal reaches capacity, its original record remains intact; export it and extend journal storage as an engineering change before adding more editions. Exporting does not reset or silently truncate history.

## Source organization

| File | Responsibility |
|---|---|
| `merchant-erp-mapping.php` | Decimal arithmetic, mapping compilation, original order plan and exact JSON number emission |
| `merchant-erp-acumatica.php` | Registered connection, published contract check, native HTTP, target identity/comparison and owned-line corrections |
| `merchant-erp-store.php` | Original source capture, immutable mapping records, indexed order journal, revision writes |
| `merchant-erp.php` | Prepare/approve/deliver/reconcile/correct/reopen lifecycle and authenticated REST routes |
| `merchant-erp-console.php`, `merchant-erp.js`, `merchant-erp.css` | WordPress administration and industrial operator workspace |
| `merchant-erp-client.mjs` | ERP methods on the original merchant transport and portable export digest check |
| `merchant-erp-cli.mjs` | Full operator commands and private file output |
| `erp-map.example.json` | Replaceable configuration example with no live credential |

The bootstrap mounts these modules alongside the existing merchant console and refunds. The ERP journal uses `<prefix>sf104_erp_maps` and `<prefix>sf104_erp_orders`; it does not change the original payment, settlement or fulfillment records.
