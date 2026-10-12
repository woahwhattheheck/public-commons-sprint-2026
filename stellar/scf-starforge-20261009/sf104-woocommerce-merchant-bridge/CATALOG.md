# Woo catalog commissioning

The **WooCommerce → Stellar catalog** screen prepares and applies the original Stellar payment mappings for existing Woo products. It keeps named plan editions, current-data comparisons, exact source files, application history and recoverable request identities in the same WordPress database. The existing Woo product editor remains the authority for product prices, tax, visibility, stock and downloadable files.

A merchant can prepare several products together, compare the complete proposed checkout settings, apply the reviewed terms once, and receive a configuration for the existing seller and delivery worker. Earlier pending orders keep their frozen amounts, product lines, catalogs and attempt generations. The versioned seller selects the original terms for the requested order through the signed WordPress lookup; it does not replace them with the current product mapping.

## Install and open

Use the complete original SF104 plugin directory. The main file is **Starforge SF98 WooCommerce Merchant Bridge**, `starforge-sf98-woo.php`; it loads `merchant-catalog.php` and its JavaScript/CSS assets alongside the existing gateway, merchant console, refunds, ERP and connector integrations. Copying only one PHP file is not a complete installation.

The catalog screen uses the signed-in WordPress account, `manage_woocommerce`, the selected products' `edit_post` permissions and the original REST nonce. The CLI uses the existing merchant operator configuration and WordPress Application Password through `createMerchantClient`. There is no additional login system or catalog password.

For products without an active taxable price, the reviewed store total must match the current Woo unit price at the store’s configured precision. Change prices in the original product editor and then refresh the comparison. Taxable products retain an explicit tax warning because the final customer tax context remains the original checkout’s responsibility.

The maintained native Woo product store and InnoDB are required for a catalog application. The catalog journal, posts, product metadata, options and product term relationships must use InnoDB so the native metadata change and its retained history commit together. An incompatible custom product data store or transaction is reported before application. The original product editor remains available.

The plugin adds a **Catalog commissioning** link to the merchant console and an **Open saved Stellar catalog plans** link beside the original product mapping fields. Product links within the plan open the original Woo editor. Gateway settings remain available at **WooCommerce → Settings → Payments → Stellar x402**.

For payment operation, keep the prerequisites in [GATEWAY.md](GATEWAY.md) and [MANAGED.md](MANAGED.md), including working WordPress REST permalinks, HTTPS ingress and the same private `SF98_WEBHOOK_SECRET` in both Node processes and as the WordPress PHP constant. Creating, reviewing or applying a catalog does not make a native payment request.

## Prepare the actual products

Create or edit the products in WooCommerce first. An enabled Stellar mapping uses an existing **simple, virtual product**. Downloadable products use Woo's original retained file, permission, limit and expiry behavior. The catalog editor does not create products, attach arbitrary files, change prices or manage inventory.

Each mapping declares:

| Field | Meaning |
| --- | --- |
| Product ID | Exact Woo product identity, retained as a string. |
| Seller route ID | Original route identifier for the individual product. |
| Resource URL and method | Exact public HTTPS seller endpoint and GET or HEAD. |
| Network | `stellar:testnet` or `stellar:pubnet`. |
| Asset and recipient | Original Stellar asset contract and public recipient. |
| Atomic amount | Positive integer string; no decimal or floating-point conversion. |
| Maximum timeout | Whole seconds, validated by the original mapping/compiler. |
| Store currency and final total | Explicit merchant mapping to the final Woo order total. |

The store total is an explicit mapping. Tax, coupons, shipping, fees or later product changes can affect the actual order. The original checkout validates its final amount and eligibility; a saved plan does not override those checks. Keep the current Woo tax and price observations visible during comparison.

The shared-fields control fills the selected draft's network, asset, recipient and timeout. It does not apply the draft. Inspect every row before saving, particularly the exact atomic amount and store total.

## Save, compare and apply

1. Open **Stellar catalog**, enter a title, and select existing product IDs or use the native product search. One plan contains 1–64 distinct products. Current approved basket product IDs are included in a new plan so an existing basket is not silently truncated.
2. Edit the selected product mappings and the original checkout label/instructions. The customer-facing text is plain text. Changes to product price, stock, type, visibility or files belong in the linked Woo product editor.
3. If using a basket, choose its explicit product IDs, route ID, URL and method. The original basket compiler validates the same currency, network, asset and recipient, its existing line/unit limits, and the distinction between basket and individual product routes.
4. **Save edition**, including a reason. This creates immutable plan history. Browser drafts are retained locally; stale local drafts can be downloaded without replacing a newer saved edition.
5. **Review saved edition**. The comparison captures actual current product data and gateway settings, proposed terms, blockers, tax/visibility observations and pending orders with their original version identities.
6. Read the complete comparison. If a product or gateway setting changes afterward, applying this review is refused. Create a fresh comparison against the current saved edition.
7. Enter a reason, check the explicit confirmation and choose **Apply reviewed catalog**. WordPress rechecks the current account, product data, settings, saved edition and review under its catalog guard. The native product metadata/settings, application record, project revision and original request result commit together.
8. Open **Seller handoff**. Download its exact seller packet and complete workspace, then receive the packet into the existing merchant configuration.

An unchanged mapping keeps its original approval metadata. Only selected mapping metadata and the catalog-owned gateway fields are updated. Unrelated gateway option keys are preserved. Product data, orders, checkout snapshots, payment attempts, settlement notices, refunds, ERP documents and connector jobs keep their original authority and state.

The shared catalog guard serializes catalog application with original checkout preparation, the gateway's settings save and mapped Woo product saves. Application also locks the selected native product and setting rows. A request cannot freeze half of a multi-product mapping change. Arbitrary external SQL writers are outside the supported Woo CRUD/guard contract; the current-data comparison still detects saved changes observed before application.

## Existing orders and seller versions

Every saved order retains its original checkout snapshot. Applying new terms does not rewrite it or increment its attempt generation. During application the plugin inventories pending, on-hold and checkout-draft Stellar orders and retains their exact valid frozen route or basket catalogs in the handoff. Paid orders are not candidates for a new payment. A reserved or changed order stays visibly unavailable under its original admission/reconciliation rules.

The new `stellar-forge.sf104.merchant.v3` configuration includes current routes, retained single-product route versions and retained basket catalogs. The seller's exact signed `catalog-order` lookup supplies the original order, generation, handoff and version. Only a matching configured version can proceed through the existing SF30 admission, native verification, durable Woo reservation, settlement and SF98 outbox. A lookup is read-only; its response is not payment or release evidence.

Keep the merchant's older seller addresses routed through its approved ingress while pending orders reference them. A new configuration cannot move an existing WordPress store identity, repair corrupt order snapshots or declare a reserved attempt safe to repeat. Use the original merchant console for those specific cases. The receiver retains up to 256 route versions and 256 basket catalogs and a 16 MiB serialized configuration. It refuses an over-limit configuration; it never silently removes a retained version.

A handoff lists all selected product IDs, including disabled mappings. Receiving with `--existing-config` replaces current routes only for those selected IDs, preserves unselected routes, and retains earlier versions. It also preserves the original private outbox and secret environment binding. It does not erase the old configuration or start another worker.

## Receive into the original merchant

The installed command is `woo-catalog`; source-checkout examples use `node catalog-cli.mjs` from this directory.

```sh
node catalog-cli.mjs receive \
  --handoff /private/catalog-handoff.json \
  --existing-config /private/woo-merchant.json \
  --out /private/woo-merchant-next.json

node seller.mjs inspect --config /private/woo-merchant-next.json
```

The output file is created privately and exclusively. Repeating receiving can reuse an already-complete byte-identical output. A different existing file is refused. For an initial merchant configuration, select the actual original outbox explicitly:

```sh
node catalog-cli.mjs receive \
  --handoff /private/catalog-handoff.json \
  --outbox /private/sf98-outbox \
  --secret-env SF98_WEBHOOK_SECRET \
  --out /private/woo-merchant.json
```

The packet carries the store's exact admission URL, including a WordPress subdirectory. It carries no secret value, wallet, signer, payer or arbitrary filesystem destination. The recipient chooses the private output and outbox; the original compiler validates the complete resulting configuration before it is saved.

For a managed merchant, follow [MANAGED.md](MANAGED.md): keep the same outbox and store binding, stop and drain the existing seller through its original Applications control, select the new configuration with the existing facilitator and named secret environment, then start the original managed seller/worker. Do not leave two workers competing for one outbox. Existing delivery failures and uncertain reservations remain visible in the original operating surfaces.

## CSV and complete workspace intake

The editor accepts exact UTF-8 plan JSON, complete catalog workspace JSON or CSV. Original filename, complete bytes, SHA-256, account and import time are retained. Reimporting the exact same source into the same target reopens its original result rather than adding another edition.

CSV has these twelve distinct headers; their order may differ:

```csv
productId,enabled,routeId,url,method,network,asset,payTo,amountAtomic,maxTimeoutSeconds,currency,total
```

Use `true` or `false` for enabled, a whole-number timeout, and strings for atomic amounts, product IDs and money. Export a draft CSV from the editor to retain actual selected terms. Do not paste a made-up asset or recipient into a production catalog.

CSV contains product terms only. Its new draft shows current original gateway settings. If the file omits existing basket product IDs, its draft disables the basket and clears those IDs so the omission is explicit during review. Nothing is applied by import. Add the full intended basket selection and save a reviewed edition.

A complete workspace contains its saved project, all editions, reviews, applications, exact imported sources and request receipts, with an inventory/identity check. Receiving validates original record identities and required edition/review/request references, verifies source bytes and preserves the full original packet as an immutable source. It opens a local plan; imported account numbers or approvals do not grant permission to apply changes in another store.

For a different store, explicitly save its intended store origin, local product IDs and terms, then create a fresh comparison. Original source history stays available inside the retained imported workspace file. Native Woo database backup remains the complete recovery for products, accounts, orders, payment state and the original catalog database itself.

Limits are explicit: one plan has at most 64 selected products; CSV is at most 2 MiB; an imported source or portable workspace is at most 16 MiB; one project export has at most 1,000 history records. Host HTTP/PHP body limits must accommodate the selected input, including base64 overhead. Oversized complete histories are not truncated; preserve them through the original full WordPress database backup.

## Lost response and reopening

Each create, save, review, apply or import request has one UUID and an exact argument hash before it is dispatched. The original SQL transaction publishes the change and that UUID's result together. A repeated UUID with changed arguments is refused.

The browser keeps its pending request across reloads. Use **Check original result** after a lost or incomplete response. If no committed result is present, **Continue same request** sends the exact saved arguments; it does not create a new application identity. If a large source could not fit browser storage, reselect its exact original filename and bytes before continuing. A definitive current-data conflict requires a new comparison; it never substitutes new terms into the old request.

For durable local operation the CLI retains full requests under the original merchant operator workspace:

```text
/private/merchant-workspace/catalog-requests/<request-uuid>/request.json
/private/merchant-workspace/catalog-requests/<request-uuid>/result.json
```

A completed server response is retained before the command reports success. A disconnected process can reopen the original request file, query the server and retain the same result. Credentials are resolved from the original named environment variables only while the authenticated client is running; they are not written to these files.

```sh
node catalog-cli.mjs request \
  --operator /private/woo-operator.json --id ORIGINAL-REQUEST-UUID

node catalog-cli.mjs continue \
  --operator /private/woo-operator.json \
  --request-file /private/merchant-workspace/catalog-requests/ORIGINAL-REQUEST-UUID/request.json
```

Keep both the original request and any confirmed server result. A timeout, truncated JSON, failed local result save or 503 remains uncertain until the same UUID is inspected. The CLI never automatically creates a replacement application request.

## Complete CLI operation

The operator JSON is the existing `stellar-forge.sf104.merchant-operator.v1` configuration documented in [OPERATIONS.md](OPERATIONS.md). Use its actual HTTPS `siteUrl`, private `workspace` and `outbox`, and existing `usernameEnv` / `applicationPasswordEnv`. Do not put passwords in command arguments.

```sh
node catalog-cli.mjs status --operator /private/woo-operator.json
node catalog-cli.mjs products --operator /private/woo-operator.json --q "Download"
node catalog-cli.mjs create --operator /private/woo-operator.json \
  --title "Reviewed digital catalog" --products 22,23
node catalog-cli.mjs show --operator /private/woo-operator.json --project PROJECT-UUID

node catalog-cli.mjs save --operator /private/woo-operator.json \
  --project PROJECT-UUID --revision 1 --plan /private/edited-plan.json \
  --note "New exact terms from the selected merchant mapping"
node catalog-cli.mjs review --operator /private/woo-operator.json \
  --project PROJECT-UUID --revision 2 --edition EDITION-UUID
node catalog-cli.mjs apply --operator /private/woo-operator.json \
  --project PROJECT-UUID --revision 2 --review REVIEW-UUID \
  --confirm --note "Compared current product prices, tax and complete payment terms"

node catalog-cli.mjs export --operator /private/woo-operator.json \
  --project PROJECT-UUID --kind seller --out /private/catalog-handoff.json
node catalog-cli.mjs export --operator /private/woo-operator.json \
  --project PROJECT-UUID --kind workspace --out /private/catalog-workspace.json
```

Replace example IDs and revisions with the actual saved responses. `show` returns `edition.plan`, the current product observations and saved review. Save only the intended complete plan as `edited-plan.json`. CLI reads and imports do not imply customer approval; a successful application records the actual authorized WordPress account's decision.

## Runtime boundaries

This feature uses the existing Woo products and checkout engine, original authenticated merchant client, native seller compiler, SF30 handler/admission, SF98 outbox and managed Applications lifecycle. It introduces no alternative payment processor, accounting ledger, refund policy, ERP mapper or publication controller.

Source validation and native receiving outcomes are recorded with the released change. No new wallet transaction, merchant sale or external customer integration is implied by installing or exercising the catalog editor. The real operating check for a release is one complete plan → current-data comparison → native application → exact seller/workspace export → same-request reopen, with the original pending-order snapshots observed unchanged.
