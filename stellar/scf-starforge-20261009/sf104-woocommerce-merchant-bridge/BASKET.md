# Digital baskets on the original Woo merchant

The basket gateway lets a customer buy several approved digital products, or
several units of one product, with one exact native Stellar payment. It creates
the normal WooCommerce order and retains every line's declared storefront price,
native atomic price and delivery definition. The original SF88 buyer, SF30
native verification and settlement, SF98 notice, independent merchant review
and Woo `payment_complete` still own their existing transitions.

The basket setting is optional and disabled by default. Existing single-product
v1 orders and buyer instructions remain usable. Enabling baskets makes the
approved catalog the source for **all new Stellar checkout orders**, including a
one-line, one-unit order. A customer can change quantities in the cart without
switching payment endpoints.

## Install the complete original product

Follow [GATEWAY.md](GATEWAY.md#install-and-enable) and retain all 16 files in its
plugin inventory. In particular, `checkout-gateway.php` requires the new
`checkout-basket.php`; include that PHP file when upgrading an existing plugin.
The complete source package also contains `basket.mjs`, `basket-seller.mjs` and
the updated original `buyer.mjs` and `seller.mjs`. Keep the WordPress and Node
sides on the same released source.

Use the store's existing WordPress manager account, PHP version supported by
its WooCommerce release, MySQL/MariaDB named locks, HTTPS origin and permalink
rewrites. The same private `SF98_WEBHOOK_SECRET` is a **PHP constant** in
`wp-config.php` and an environment value in the original seller and delivery
processes. It authenticates exact admission and notification bodies. The
catalog, buyer instructions and browser do not contain that secret.

The gateway uses WooCommerce's documented
[payment gateway API](https://developer.woocommerce.com/docs/features/payments/payment-gateway-api/)
and [Checkout Blocks integration](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/).
Release calls the original Woo payment completion path and its native
[download permission function](https://woocommerce.github.io/code-reference/files/woocommerce-includes-wc-order-functions.html#function_wc_downloadable_product_permissions).
No additional WordPress database or payment engine is introduced.

## Declare unit prices and enable the catalog

1. Configure each existing **simple, virtual** product using the original
   **Stellar digital-product checkout** fields. Downloadable products use their
   ordinary Woo file definitions. Save a positive storefront price for **one
   unit including applicable tax**, the exact positive native atomic amount,
   network, asset, recipient and timeout. Each product retains its individual
   route declaration for compatibility with existing single-product orders.
2. Open **WooCommerce → Settings → Payments → Stellar x402 digital checkout**.
   Under **Digital baskets**, enable baskets and enter the comma-separated
   approved product IDs. Choose a distinct basket route ID and public HTTPS
   seller endpoint, without a query string. Use `GET` or `HEAD`.
3. Save settings and use **Download this exact basket catalog**. The
   nonce-protected export includes the current product IDs, names, unit prices,
   original native terms and a canonical catalog digest. It has no customer,
   order, download path or credential data.
4. Prepare and serve that exact catalog with the original seller before
   offering the payment method to customers.

Every selected product must share the store currency, Stellar network, asset
and recipient. The endpoint and route ID must differ from the individual
product routes. A catalog contains at most 64 products; an order contains at
most 20 distinct product lines and 100 total integer units. Each product can
appear once in the order, with its quantity on that line.

Coupons, fees, shipping and product variations are not part of this digital
basket contract. Line totals, line taxes and the final order total must equal
the declared per-unit totals multiplied by quantities. Store tax configuration
therefore has to produce the exact declared tax-inclusive amount for the
customer's location. Configure a price appropriate to that store's tax policy;
the gateway does not calculate an exchange rate or alter tax rules.

Native prices are decimal integer strings. PHP uses string arithmetic and Node
uses `BigInt`, with the original signed-128-bit native range. For example,
two units at `2500000` and three units at `4250000` produce one exact amount
`17750000`. The buyer timeout is the smallest saved timeout among the lines.

## Prepare and serve the merchant

Run from the retained original source tree or its installed package's `source`
directory:

```sh
S=stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge

node "$S/seller.mjs" prepare \
  --basket /private/basket-catalog-current.json \
  --store-origin https://shop.merchant.example \
  --outbox /private/merchant-sf98 \
  --out /private/woo-basket-merchant.json

node "$S/seller.mjs" inspect --config /private/woo-basket-merchant.json

node "$S/seller.mjs" serve \
  --config /private/woo-basket-merchant.json \
  --facilitator https://facilitator.merchant.example \
  --port 8423 --operations-port 8424
```

Replace example origins and paths with the merchant's existing deployment.
`prepare` and `inspect` are offline. `prepare` creates a new private config;
it refuses to overwrite an existing one. The seller listens on loopback behind
the merchant's existing HTTPS ingress. Start the original SF98 delivery worker
against the **same outbox**, store origin and private secret using the commands
in [GATEWAY.md](GATEWAY.md#export-and-run-the-same-merchant-route).

To keep pending orders from older catalogs payable, retain their exact exports
and repeat `--basket`. Include `--route` for any still-pending legacy v1 orders:

```sh
node "$S/seller.mjs" prepare \
  --basket /private/basket-catalog-previous.json \
  --basket /private/basket-catalog-current.json \
  --route /private/legacy-product-route.json \
  --store-origin https://shop.merchant.example \
  --outbox /private/merchant-sf98 \
  --out /private/woo-basket-next.json
```

All retained catalogs use the same basket endpoint, method and route ID. Up to
32 catalog versions can be served together. Keep an older catalog until its
original unpaid orders are settled, cancelled or explicitly reconciled. Changing
a product price or approval does not rewrite those orders. Save and export the
new catalog for new checkout orders, validate the new config, drain the current
seller using its normal shutdown, then launch the new config with the same
outbox and facilitator.

The original gateway, seller and buyer still support explicitly selected
`stellar:testnet` and `stellar:pubnet`. A catalog's network must match the
buyer's existing workspace and signer. See the original
[native signer](../sf88-operator-buyer-cli/NATIVE_SIGNER.md) and
[public-network workspace](../sf88-operator-buyer-cli/MAINNET.md) guides.

## Buyer checkout and the same original inbox

Classic checkout and Checkout Blocks call the same gateway processing method.
The native cart checks the actual products, quantities, line totals and order
total again on the server. The order becomes **On hold**, with no paid status or
download permission. Its ordinary order-received page displays the basket lines
and offers **Download payment instructions**. The customer's order view can
reopen the same handoff.

A signed-in buyer can read their own order; a guest needs the valid Woo order
key. The downloaded JSON contains no order key, billing data, signer,
filesystem path or wallet identity. Each line names its intended downloads
without exposing their private paths. The same original buyer handles v1 and v2
instructions:

```sh
node "$S/buyer.mjs" inspect --handoff /private/stellar-order.json
node "$S/buyer.mjs" prepare \
  --handoff /private/stellar-order.json \
  --out /private/basket-review.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/basket-review.json
```

Inspect the exact aggregate, each line, network, asset and recipient. For the
first purchase, initialize the original workspace and signer from this reviewed
configuration using the original SF88 instructions. For an existing compatible
workspace, preserve its ledger, budget and trusted signer configuration:

```sh
node "$S/buyer.mjs" prepare \
  --handoff /private/stellar-order.json \
  --workspace /private/original-buyer-workspace \
  --out /private/basket-inbox.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  enqueue --root /private/original-inbox --config /private/basket-inbox.json

# Use the complete intent printed by prepare/enqueue.
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  show --root /private/original-inbox --intent "$INTENT"
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  execute --root /private/original-inbox --intent "$INTENT" \
  --workspace /private/original-buyer-workspace
```

The bridge checks the workspace's exact payment identity and amount/timeout
caps. A workspace priced for a smaller old order may require a deliberate
original budget/configuration change before this aggregate can be imported.
No automatic cap increase occurs. Native spend confirmation remains in the
original trusted terminal path.

The intent is `woo:<shop-origin-digest>:<order>:g<generation>`. Importing another
copy of the same handoff preserves that intent. Its exact paid resource includes
`sf98_order`, `sf104_attempt` and `sf104_basket`; the original buyer also derives
`X-SF98-Order-ID`. The full resource identity follows the original approval and
reservation chain.

## Exact quote, settlement and per-line delivery

On first use of an order resource, the Node seller asks the original WordPress
admission endpoint for its authenticated frozen quote. It checks the quote
against one of the operator's retained catalog exports, including every unit
price and payment identity. It then compiles that **specific order's** aggregate
into the original SF30/native handler. A fixed-product review is never relabeled
as a basket review.

The service coalesces concurrent initialization of the same exact order,
generation and basket digest. Its bounded cache retains an initialized original
handler while requests or native verification/settlement are still running.
Retiring an idle cache entry does not release a Woo reservation; the original
database record remains authoritative across seller restart.

Every native request performs the original signed live-order inspection.
After native verification, the original reservation call admits one payment
attempt before settlement. An altered, already noticed, paid, reserved or
cancelled order cannot start another settlement through that order handler.
The order's quote is not a payment result.

Successful native settlement writes the original SF98 outbox event. The
existing signed delivery receiver journals it; the merchant independently
reviews the original Stellar transfer and releases the selected Woo order
through [the native review workflow](NATIVE_REVIEW.md). Woo then grants its
ordinary per-product download permissions and applies each product's quantity,
download limit and expiry. A repeated notification or release returns the
original outcome without completing the order again.

The frozen private order snapshot includes each product's virtual/downloadable
flags, exact file IDs, file labels/paths, limit and expiry. If those delivery
definitions change before release, the original saved-order check refuses
release. Reconcile the product definitions against that original snapshot
before continuing the same order. The public handoff includes labels only.
This protects the configured file identity; a mutable file's bytes remain the
merchant's storage responsibility.

## Recovery and order changes

Use **WooCommerce → Stellar merchant operations** for the existing order,
attempt, notice and review history. A reservation remains reserved if a native
outcome is interrupted or unknown. Recover the original buyer and outbox result;
do not initiate another purchase merely because the browser did not return.

If the merchant independently establishes non-settlement, use that order's
existing reset action with the current generation, attempt digest, reason and
attestation. It advances the generation while retaining the same order,
basket digest, catalog, prices and delivery definitions. The buyer downloads
the new handoff and uses the same `prepare --workspace`, inbox `enqueue`,
`show` and `execute` commands above. An old handoff is rejected before
verification.

Saved order-line, quantity, money, currency, tax, binding or delivery-definition
changes are visible conflicts. Restore the merchant-approved original state
when appropriate, or resolve the order through the merchant's existing order
policy. Neither a settings save nor reset silently changes the frozen order.
The per-order named lock coordinates the original gateway, admission, reset
and release controllers; arbitrary third-party/admin writes do not acquire it,
so the saved-order check is the current state precondition.

The existing [verified refund workflow](REFUNDS.md) continues to apply reviewed
monetary credits to the original whole order. It does not infer a line return,
restock or per-unit entitlement revocation from a partial monetary amount.
Any such business decision remains explicit in the store's ordinary workflow.

Preserve the complete WordPress database and plugin, retained catalog/config
versions, original outbox, operator review and original buyer workspace/inbox
when handing the merchant to another engineer. Reopen that same case and its
original IDs. The catalog by itself is not a complete recovery archive.

## Source contracts

| Record | Original role |
| --- | --- |
| `stellar-forge.sf104.basket-catalog.v1` | Nonsecret merchant export of sorted approved unit terms, one payment identity, endpoint and catalog digest. |
| `stellar-forge.sf104.checkout-handoff.v2` | Exact order, generation, catalog/basket digests, line quantities and aggregate original buyer operation. |
| `stellar-forge.sf104.checkout-admission.v2` | Same signed WordPress endpoint; `quote`, `inspect` and post-verification `reserve`. |
| `stellar-forge.sf104.checkout-basket-quote.v1` | Authenticated frozen handoff, available only while the original order is ready. |
| `stellar-forge.sf104.merchant.v2` | Original seller deployment with retained basket catalog versions and optional legacy fixed routes. |

The basket digest binds the store and order, catalog identity, route, all line
terms, total and exact native payment identity. It excludes only the attempt
generation and creation time, allowing an explicit non-settled reset to preserve
the original commercial terms. The catalog and basket use canonical UTF-8 JSON
with sorted object keys; array order is preserved. Native amounts and
quantities remain strings, and no exchange-rate service is consulted.
