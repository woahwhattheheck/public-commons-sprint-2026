# SF104 | WooCommerce merchant order bridge for native Stellar x402

A real merchant-integration product built on the **existing SF30 native seller** and **original SF98 post-settlement outbox/signed delivery**. WordPress/WooCommerce receives the existing, minimal `stellar-forge.sf98.webhook.v1` event and associates it with an *already-existing, explicitly prebound* Woo order. One accepted native settlement event can correspond to one order. It cannot initiate a payment, sign anything, fabricate a merchant transaction, or fulfill on webhook arrival. The merchant explicitly reviews the **independent original Stellar chain settlement** before WooCommerce releases a purchased digital/physical item.

This is a **WooCommerce order bridge**, not a Woo checkout payment gateway. A buyer uses the merchant's *existing compatible x402 client* against the ORIGINAL SF30 paid API, sending `X-SF98-Order-ID: <Woo order id>` on the paid request. A merchant must agree how to associate that order and paid resource. The `X-SF98-Order-ID` header is buyer-controlled and **not proof** of the order; the server accepts only a store-admin-approved exact order+payment binding. Do not point a public checkout button at this webhook; buyers must never know its secret.

## Install and configure

The prebinding method selector and signed event validation support GET, HEAD, POST, PUT, PATCH and DELETE from the original seller. The selected method identifies the paid API operation and must match the order's approved method exactly. Signed notices use the existing POST webhook endpoint.

1. Ensure WordPress with WooCommerce and PHP 8.0+ are installed, HTTPS is correctly enforced, and the WooCommerce store can create pending/on-hold orders. Install `starforge-sf98-woo.php` in a plugin folder such as `wp-content/plugins/starforge-sf98-woo/`, then activate the plugin in WordPress. Activation creates one private prefixed `sf98_woo_events` table (unique original event ID and unique Woo order ID). Works with classic orders and WooCommerce HPOS order APIs.
2. Generate **one unique** 32–1024 byte shared delivery secret in the merchant and seller's trusted environments. Put this in the WordPress private `wp-config.php`, before the `wp-settings.php` include (not in a post, theme, public page, database option or source repo): `define('SF98_WEBHOOK_SECRET', getenv('SF98_WEBHOOK_SECRET'));`. Set the actual private environment variable on your WordPress host. Give the **same bytes** to the existing SF98 sender's private `--secret-env SF98_WEBHOOK_SECRET` environment. Protect and rotate through your hosting secret facility; in-flight retries signed under the old key will fail after rotation.
3. Create the original WooCommerce order via your existing order/invoice workflow. Leave status **Pending payment** or **On hold**. Record its ID. In WooCommerce → **Stellar x402 Orders**, prebind **that exact order** to the real original SF30 seller `routeId`, HTTP method, network (`stellar:testnet` or `stellar:pubnet`), **positive integer atomic units**, and *public SEP-41 asset identifier* as originally advertised. The plugin stores the SHA-256 of the asset identifier and the approved terms in the Woo order's metadata. No wallet private keys are accepted. This binding is editable only before any event has been journaled.
4. Supply the Woo order ID as `X-SF98-Order-ID` to the **original paid SF30 resource request**. It only becomes an SF98 event when the original native `processSettlement` reports success and supplies a supported native `PAYMENT-RESPONSE` receipt. If absent, no SF98 event exists; reconcile using the independent native seller/chain system rather than faking an event.
5. In your original SF98 operator environment, drain **only** the existing verified outbox:

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs status \
  --state /private/merchant/sf98-outbox

node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs drain \
  --state /private/merchant/sf98-outbox \
  --url https://shop.example/wp-json/stellar-forge/v1/settlement \
  --allow-host shop.example \
  --secret-env SF98_WEBHOOK_SECRET --limit 20
```

The above command uses **existing** `deliver.mjs` unchanged, its first-party public-DNS-pinned HTTPS enforcement, no redirects and native signed wire. Configure host-level TLS/WordPress site URL correctly. Do not manually POST example messages as if they were paid settlements. The HMAC protocol is exactly `hex(HMAC-SHA256(secret, x-sf98-timestamp + "." + raw UTF-8 body))` in `x-sf98-signature: sha256=...`, a five-minute timestamp window, matching `idempotency-key` and `eventId`. Successful first intake returns HTTP **202 AWAITING_INDEPENDENT_REVIEW**, matching replay HTTP **200 ALREADY_ACCEPTED**, and original SF98 treats both as webhook delivery acceptance. Neither means chain confirmation or merchant fulfillment. Reused event ID with different content, second event for an already-occupied order, wrong terms, or non-approved order returns HTTP 409/422 as appropriate; SF98's normal retry/exhaustion journal handles it.

## Release one accepted order

Use the original **SF86 Stellar RPC transaction reconciliation** or another operator-owned read-only chain verifier to check the real native transaction's settlement status, actual asset contract, recipient, atomic amount and order association. *Do not* infer that from this webhook's HMAC or the buyer-controlled order reference. In the admin queue, enter the independently observed original transaction hash (64 hex), check the explicit review attestation and choose **Release order**. This calls WooCommerce's **actual** `WC_Order::payment_complete($tx)` for that pending/on-hold order and stores a private single-order release record. Normal WooCommerce stock/fulfillment/payment-completed hooks may run, so configure your store's products, shipping and emails before using it.

Repeated clicks and competing operators are guarded by database state (`RECEIVED` → `REVIEWING` → `RELEASED`), one unique event per order, and a compare-and-swap transition. If PHP crashes *after* Woo completes the order but *before* the bridge finishes its journal, repeating with the **same** confirmed chain hash marks the existing Woo-paid order released without charging/fulfilling it again. If PHP crashed before Woo ran, an unfulfilled stale review lock older than two minutes can be explicitly reset using the same transaction hash; retry review after its notice. Do not manually reset this table while a live request is running. A different transaction hash conflicts rather than silently replacing evidence.

## Operational limits

- No native-chain RPC read happens inside WordPress. Use an independent chain verifier before manual order completion. The signed notice only says the **original native seller SDK reported settlement success**, not that this plugin proved ledger finality. Check merchant order/payment association and avoid duplicate release across other gateways.
- Each Woo order accepts **one** original event. Split-installment, pooled/fungible payments, refunds, reversals, subscriptions and multiple paid pages per order are outside this version. The original SF100 buyer data-room workflow separately handles multi-page data delivery. This plugin does not assume that an HTTP 402 or API 2xx is a paid order.
- The admin page displays only event ID prefix, associated Woo order, receive time and state. Raw payment headers, checkout request, buyer identity and private wallet material are never stored here. The WordPress/WooCommerce order itself already contains customer data governed by the merchant's normal controls.
- Keep the plugin database private and backed up, use actual HTTPS, normal WordPress/WooCommerce admin authentication, and a unique HMAC secret. No cron, webhook auto-drainer, hosted GitHub Actions, wallet call, independent buyer charge, background network request or merchant/customer contact is introduced by this source.
- The SF98 sender includes `orderReference` as `null` when the buyer omitted or malformed the original order header; that will **not** attach to an order here. The source will return HTTP 422 instead of inventing one.
- Before a public merchant rollout, validate on a real operator-controlled WordPress/WooCommerce instance, original SF30 native seller, the existing SF98 sender and independently observed Stellar testnet settlement. Lint and focused local endpoint exercise alone do not establish a live merchant, ledger transfer, WordPress deployment or sales contract.

## Maintainer acceptance surface

The source has no Composer/npm dependencies. A syntax check is `php -l starforge-sf98-woo.php`. The plugin's HMAC receiver, event/order matcher and Woo order-bound manual completion compose via the real WordPress/Woo APIs (`register_rest_route`, `wc_get_order`, `$wpdb`, `WC_Order::payment_complete`). Review real store lifecycle and stock/email effects before enabling on a production shop. The exact original sender source is `../sf98-merchant-delivery/deliver.mjs`, schema in `outbox.mjs`; do not change those canonical native payment/evidence contracts from this merchant plugin.
