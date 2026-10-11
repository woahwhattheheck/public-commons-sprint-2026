# WooCommerce digital checkout with the original Stellar buyer

The optional checkout gateway joins the existing WooCommerce order, original
SF30 native seller, SF88 buyer and SF98 delivery service. A shopper places one
digital-product order, receives that order's fixed payment instructions, and
uses the original buyer to authorize its native Stellar payment. The existing
Woo merchant queue still performs independent settlement review and the actual
WooCommerce order release.

The gateway is disabled by default. It supports the classic checkout and the
Checkout Block through WooCommerce's documented gateway and payment-method
registration APIs. It supplies no browser wallet and makes no payment in PHP.

For independent chain review and the final selected-order release, use the
[native merchant operator](NATIVE_REVIEW.md). It composes the original SF86
verifier with this same gateway, accepted notice and Woo completion controller.

## Install and enable

Keep these files together in the installed `starforge-sf98-woo` plugin folder:

- `starforge-sf98-woo.php`: the original authenticated notice receiver and
  merchant release queue, including the selected-recipient binding.
- `checkout-gateway.php`: product mapping, gateway registration, frozen order
  handoff and customer download.
- `checkout-admission.php`: signed live order admission and merchant recovery.
- `merchant-console.php`, `merchant-console.js` and `merchant-console.css`:
  the joined native order, attempt, notice and review workspace.
- `OPERATIONS.md`: the merchant's operating and recovery guide.
- `merchant-operator.php`: authenticated native review and selected-order release.
- `NATIVE_REVIEW.md`: the complete retained chain review and operator CLI guide.

Keep all nine files when upgrading an existing installation; the original
plugin loads the console PHP and its matching browser assets. The maintained
[Site setup tool](../../../stellar-forge/developer-site/dist/woo.html) copies
the complete plugin from its selected toolkit source.

Activate the plugin normally. Activation creates the original event table and
the new `sf104_checkout_attempts` table using the site's table prefix. An
existing installation upgrading in place creates the new table when a merchant
opens WooCommerce administration. Both classic order storage and WooCommerce
HPOS use the same Woo order APIs. The order coordination lock uses MySQL or
MariaDB `GET_LOCK` on the existing WordPress connection; no background lock
service or additional database is required.

The plugin requires PHP 8.0 or later. The complete classic checkout, native
payment recovery, Woo download release and Store API checkout paths have been
exercised with WordPress 7.1.3, WooCommerce 11.2.1, PHP 8.3.6 and MariaDB 10.11.14
([installed runtime outcome, 2026-10-11](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791736569280039)).
Use the PHP version supported by the installed WooCommerce release and a
database connection that implements the named locks above.

Retain the merchant's existing `SF98_WEBHOOK_SECRET` in `wp-config.php` and the
same private value in the seller/delivery process environment. It authenticates
both the original settlement notice and the new internal admission request.
WordPress and the seller must have their actual HTTPS origins configured.

Enable pretty permalinks in **Settings → Permalinks** and configure the web
server's WordPress rewrites so the configured `/wp-json/` endpoints reach
WordPress. A fresh installation using plain permalinks does not serve those
paths. After activation and secret configuration, this request checks the
actual admission route without creating an order or reservation:

```sh
curl --silent --show-error --include --request POST \
  --header 'Content-Type: application/json' --data '{}' \
  https://shop.merchant.example/wp-json/stellar-forge/v1/checkout-admission
```

Expect HTTP `401` with the JSON status `INVALID_SIGNATURE_OR_TIMESTAMP`: this
request deliberately contains no signature. An HTML page, redirect or missing
route means the WordPress/ingress routing needs correction before starting the
native seller. Preserve the raw request body and `x-sf98-*` headers through that
ingress; they are inputs to the existing signature check.

In **WooCommerce → Settings → Payments**, enable **Stellar x402 digital
checkout**. Its label and concise buyer instructions are editable. The gateway
appears only when the cart satisfies the saved product mapping.

## Map a real digital product

Edit an existing **simple, virtual** WooCommerce product. It may use
WooCommerce's ordinary downloadable-file configuration. The **Stellar
digital-product checkout** section in the General product fields requires:

| Field | Source and behavior |
| --- | --- |
| Final store total | The exact final Woo total for quantity one, including any applicable tax. The saved currency is the store's current currency. |
| Seller resource URL | The fixed HTTPS route served by the original native merchant; no query, fragment or credentials. Checkout adds the actual order reference and approved attempt generation. |
| Seller route ID | The original merchant route ID, 1–64 letters, digits, underscores or hyphens. |
| Method | `GET` or `HEAD`, matching that exact merchant route. |
| Network | Explicit `stellar:testnet` or `stellar:pubnet`. |
| Asset contract | The merchant's actual Stellar contract identifier. |
| Recipient | The merchant's actual receiving account or contract. |
| Atomic amount | The positive fixed native price, entered as an integer string. |
| Maximum timeout | The accepted native payment timeout, 1–86400 seconds. |

Save the product with **Enable Stellar mapping** checked. This records the
merchant operator and approval time. No exchange rate is looked up or computed:
the store total and atomic amount are an explicit merchant price mapping.

A cart must contain exactly one mapped simple virtual product at quantity one.
Coupons, fees, shipping, variations, multiple lines and a changed final total
make this payment method unavailable. The actual Woo order is checked again
during processing. Location-dependent tax that changes the final total must
match a deliberately configured merchant price before this gateway can be used.

Product changes apply to new orders. Existing orders keep their original asset,
recipient, amount, resource URL, method and storefront total. Editing an existing
order's item, total, tax, discount or payment binding makes the saved checkout
unusable until the merchant reconciles that order; it does not silently acquire
the replacement product terms.

## Export and run the same merchant route

After saving the mapping, use **Download saved merchant route** in the product
editor. This nonce-protected merchant download contains the actual product ID,
route, URL, method and native terms from that saved mapping. It contains no
credential or shopper data. Use the export directly with the maintained seller
launcher from the repository root:

```sh
S=stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge
node "$S/seller.mjs" prepare \
  --route /private/stellar-product-123-route.json \
  --store-origin https://shop.merchant.example \
  --outbox /private/merchant-sf98 \
  --out /private/woo-merchant.json

node "$S/seller.mjs" inspect --config /private/woo-merchant.json

node "$S/seller.mjs" serve \
  --config /private/woo-merchant.json \
  --facilitator https://facilitator.merchant.example \
  --port 8423 --operations-port 8424
```

Replace the example domains with the merchant's actual origins. For several
digital products, repeat `--route` with each saved product export. Each product
has a distinct route ID and all routes share one seller origin. The merchant
retains the exact original source configuration used for still-pending orders.
Changing a live route's price while old orders are pending makes their old terms
unavailable rather than repricing or recharging those orders.

If WordPress lives in a subdirectory, also supply its real admission endpoint:

```sh
--admission-url https://shop.merchant.example/store/wp-json/stellar-forge/v1/checkout-admission
```

Use the original [native seller installation](../sf30-seller-sdk/README.md) and
the merchant's configured native facilitator. The service binds to loopback;
the merchant's HTTPS ingress exposes the configured seller routes. Its existing
operations view stays private. The seller environment must contain the same
configured `SF98_WEBHOOK_SECRET` as WordPress. The launcher never embeds it in
the exported JSON.

## Customer checkout and native buyer

The shopper chooses **Stellar x402** and places the order. The gateway freezes
the existing Woo order and original `META_READY` terms, places the unpaid order
on hold, then returns the usual order-received page. This prevents Woo's normal
pay-for-order flow from offering another gateway during the native attempt.
That page offers **Download payment instructions**. The
same instructions remain available from the customer's order view while the
order is still ready for a first payment attempt.

A signed-in customer can read their own order. A guest must present that
order's valid Woo order key. Merchant administrators can also inspect it. The
JSON download is private and contains neither the order key nor billing
details. Already paid, cancelled, changed, noticed or reserved orders do not
offer a fresh payment download.

Run the downloaded instructions through the original buyer bridge:

```sh
S=stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge
node "$S/buyer.mjs" inspect --handoff /private/stellar-order-456.json
node "$S/buyer.mjs" prepare \
  --handoff /private/stellar-order-456.json \
  --out /private/woo-order-review.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/woo-order-review.json
```

The prepared file is an original SF88 review configuration. Continue with its
maintained [workspace and buyer instructions](../sf88-operator-buyer-cli/README.md)
and [native signer setup](../sf88-operator-buyer-cli/NATIVE_SIGNER.md), selecting
the existing wallet, explicit budget and local workspace. Keep that same
workspace and ledger for execution and recovery. Importing the same shop, order
and attempt generation again produces the same original intent; changing a
download filename does not create another payment identity. An explicitly
reconciled merchant reset advances the generation, allowing a fresh intent in
the same ledger without changing the order's original terms.

The original SF88 native workspace supports **Stellar testnet and explicitly
selected Stellar public network**. The handoff and offline review preserve the
merchant's exact network, asset and recipient; initialization uses that review
without switching an existing workspace's network. Follow the original
[mainnet workspace guide](../sf88-operator-buyer-cli/MAINNET.md) for a
`stellar:pubnet` handoff and use the existing payer and signer for that network.
The installed Woo journey above exercised testnet with a controlled facilitator;
it is not a claim of a funded public-network payment.

The handoff contract is `stellar-forge.sf104.checkout-handoff.v1`:

```text
schema, storeOrigin, orderReference, productId, attemptGeneration, routeId, createdAt,
storefront: { currency, total },
operation: {
  url, method, orderReference,
  expect: { scheme, network, asset, payTo, maxAtomic, maxTimeoutSeconds }
}
```

Both references are the actual decimal Woo order ID. `attemptGeneration` is an
integer from 1 through 2147483647. `operation.url` has exactly two query
parameters: `sf98_order` with that order ID and `sf104_attempt` with that
generation. The original SF88 config derives `X-SF98-Order-ID`, and the existing
SF31/SF54/SF36 approved resource binds the complete URL. The buyer bridge
derives `woo:<shop-origin-digest>:<order>:g<generation>` as the original intent.
The download cannot select the buyer's signer, wallet or filesystem paths.

## Live admission and duplicate-payment recovery

Before original native verification, the seller sends a signed `inspect`
request to the WordPress admission endpoint. WordPress compares the frozen
handoff, original merchant binding, current Woo order composition, unpaid
status and original SF98 event journal. A stale or already attempted order
cannot proceed to another native payment verification.

After the original native SDK verifies a payment, the actual seller handler
sends `reserve` for the SHA256 digest of that payment header. The order table
permits one reservation. Competing or repeated attempts receive a conflict;
the seller cannot settle them through that handler. The gateway never stores
the payment header itself.

Both phases use `stellar-forge.sf104.checkout-admission.v1` with the fields
`phase`, `orderReference`, `productId`, `attemptGeneration`, `routeId`, `method`, `network`,
`amountAtomic`, `assetDigest`, `recipientDigest` and `resourceUrl`. `reserve`
additionally requires `attemptDigest`. The original SF98 timestamp/HMAC format
authenticates the exact body. Successful responses use
`stellar-forge.sf104.checkout-admission-result.v1` and `READY` or `RESERVED`.

If a payment attempt is interrupted, retain the reservation and recover the
original buyer/seller result. There is no expiry-based release. In
**WooCommerce → Stellar checkout recovery**, a merchant may reopen the exact
reserved generation only after independently confirming that attempt did not
settle. The order must still be unpaid, unchanged and without an original SF98
notice. The action requires the merchant nonce, current digest/generation and
an explicit reconciliation note and attestation. It increments the available
attempt generation and retains the prior payment digest. The original order
snapshot, price, recipient and binding remain unchanged. The customer downloads
fresh instructions from that same Woo order and imports them into the same
buyer workspace. A stale generation is rejected before native verification;
the immediately preceding exact payment header is also rejected at reservation.
This action changes no wallet or paid status.

### Import a recovered attempt or another order into the existing workspace

For a merchant-approved new generation, download the fresh instructions from
the same order page. For another purchase, use that new order's instructions.
Prepare a new, private configuration using the existing buyer workspace:

```sh
S=stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge
B=stellar/scf-starforge-20261009/sf88-operator-buyer-cli

node "$S/buyer.mjs" prepare \
  --handoff /private/stellar-order-456.json \
  --workspace /private/merchant-operator \
  --out /private/woo-order-456-g2.json

node "$B/cli.mjs" --review --config /private/woo-order-456-g2.json
```

`--workspace` opens the original workspace offline. It preserves that
workspace's operator, signer, evidence directory, payer, transport and ledger;
it imports only the freshly reviewed operation. Scheme, network, asset and
recipient must match the trusted workspace, and the amount must fit both its
operation cap and signer cap. If the workspace uses an explicitly configured
transport, the new resource must use that transport's original seller origin.
The command loads no wallet key or signer and
creates a new configuration file without replacing an existing one. The
workspace's original policy continues to enforce the shared spending budget.

Use the original [durable buyer inbox](../sf88-operator-buyer-cli/QUEUE.md) to
retain and execute this configuration. Create the inbox once, only if no
existing inbox is available:

```sh
node "$B/queue-cli.mjs" init --root /private/buyer-inbox
```

Enqueue the new configuration, then select its exact `operation.intentId`
from the preparation output. Set `INTENT` to that full value, including its
generation. These commands reuse the same inbox, workspace and ledger:

```sh
node "$B/queue-cli.mjs" enqueue \
  --root /private/buyer-inbox --config /private/woo-order-456-g2.json

node "$B/queue-cli.mjs" show --root /private/buyer-inbox --intent "$INTENT"

node "$B/queue-cli.mjs" execute \
  --root /private/buyer-inbox --intent "$INTENT" \
  --workspace /private/merchant-operator
```

Execution retains the original terminal approval and live merchant challenge.
The old generation's request and permanent attempt record stay in the inbox.
A merchant reset does not clear the buyer's budget reservation: reconcile the
original buyer outcome and ledger before authorizing the new operation.
Changing a filename or running preparation again for the same generation
cannot create another intent.

## Deliver and release through the original receiver

Run the existing SF98 sender against the same outbox used by this seller:

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/worker.mjs run \
  --state /private/merchant-sf98 \
  --url https://shop.merchant.example/wp-json/stellar-forge/v1/settlement \
  --allow-host shop.merchant.example \
  --secret-env SF98_WEBHOOK_SECRET
```

Include the actual WordPress subdirectory when applicable. The original native
seller records success into that outbox and the original sender authenticates
its selected-recipient notice. WordPress accepts it into the existing merchant
review queue. Open **WooCommerce → Stellar merchant operations**, select the original order,
and inspect its frozen terms, current Woo state and accepted notice. The
store verifies the original Stellar settlement, then uses the existing
**Release order** action and its original transaction-hash
recovery. That original action calls WooCommerce `payment_complete`, allowing
the store's configured download and fulfillment lifecycle to run. Neither
checkout nor admission does that release. The [merchant operating guide](OPERATIONS.md)
covers paged queues, private order notes, selected-order handoffs, changed-order
review and the original locked transaction recovery.

This source integration does not assert a deployed store, a funded network
transaction, a received sale or a customer contract. It provides the complete
order/setup/buyer/admission/notice path using the maintained original modules.

## Official implementation references

- [WooCommerce Payment Gateway API](https://developer.woocommerce.com/docs/features/payments/payment-gateway-api/)
  defines the gateway registration, settings, `process_payment` result and
  order-return behavior used here.
- [WooCommerce Checkout Block payment integration](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/)
  defines `AbstractPaymentMethodType`, the asset registration hook,
  `registerPaymentMethod`, and reuse of the original gateway processing method.
- [WooCommerce WC_Order reference](https://woocommerce.github.io/code-reference/classes/WC-Order.html)
  documents the order metadata, ownership, key, totals and lifecycle APIs.

The original [receiver guide](README.md), [SF98 sender service](../sf98-merchant-delivery/SERVICE.md)
and [native buyer guide](../sf88-operator-buyer-cli/README.md) remain the operating
references for those components.
