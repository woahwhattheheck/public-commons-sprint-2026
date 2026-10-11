# SF98: post-settlement merchant delivery outbox

For merchants that need separate fulfillment, accounting, or operations receivers, the [delivery destinations workspace](./destinations/README.md) routes these same retained native events into independently operated original-format outboxes. It provides receiver enrollment, history selection, delivery control, durable worker operation, revision-checked recovery, and an industrial local UI. Run `starforge delivery-destinations --help` from the maintained distribution, or use the source CLI described in the guide.

**Business function:** an existing merchant API can put its fulfillment system behind the original SF30 Stellar x402 seller and receive a tiny, authenticated, retryable notice only **after the native SDK's actual settlement success**. This is a customer integration layer, not another payment scheme, merchant dashboard, facilitator or claim of received cash.

The source is additive. It uses the original SF30 \`startSellerService()\`, native factory and resource-handler sequence. The existing SDK still controls signature verification, settlement, cancellation and resource release. SF98 does not create a signer, verify an on-chain transaction, change an offer, or trigger a payment. A 402, browser 2xx, successful app handler, or HTTP request counter can never enqueue an SF98 event.

## Actual seller integration

Requirements: full original repository checkout, Node 22+, existing installed official \`@x402/core\` / \`@x402/stellar\` packages, private original merchant config and trusted native facilitator. Use your **existing** verified payment terms, public HTTPS reverse proxy and operator-owned backend.

\`\`\`js
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { createNativeSellerServer } from '../sf30-seller-sdk/native-factory.mjs';
import { openOutbox, instrumentNativeSettlement } from './outbox.mjs';
import { HTTPFacilitatorClient } from '@x402/core/server';

// This is an embedding example alongside your original seller, not a replacement
// payment engine. The three original imports above resolve from sf98-merchant-delivery/.
const config = await readSellerConfig('/private/merchant/seller-service.json');
const outbox = await openOutbox('/private/merchant/sf98-outbox');
// Merchant application exports or upstream bindings are supplied here as
// existing original SF30 handlers; keep all credentials server-side.
const nativeFactory = async compiled => {
  const sdk = await createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({
      url: process.env.MERCHANT_TRUSTED_FACILITATOR_URL,
    }),
  });
  return instrumentNativeSettlement(sdk, {
    compiled, outbox,
    onWriteFailure: () => console.error('SF98_OUTBOX_JOURNAL_WARNING'),
  });
};
const session = await startSellerService({
  config, handlers: merchantHandlers, nativeFactory, port: 8423,
});
console.log(session.url);
\`\`\`

\`merchantHandlers\` above is your original application handler map. For a seller with existing external API backend bindings, use the **already shipped** \`sf30-seller-sdk/upstream.mjs\` \`readUpstreamBindings\`, \`compileUpstreamBindings\`, \`validateUpstreamService\` and \`createUpstreamHandlers\` exactly as in original \`upstream-serve.mjs\`; supply the resulting handler map to \`startSellerService\`. Do not introduce a second HTTP seller or facilitator. The original \`sf30-seller-sdk/UPSTREAM.md\` documents backend idempotency and the unsafe assumptions around mutating POST.

Each confirmed original native settlement passes through \`instrumentNativeSettlement\`. It derives the route from the original compiled matcher and hashes the original SDK's \`PAYMENT-RESPONSE\` header (and original 64-hex transaction identifier, when present). Only event fingerprints, route/method, atomic amount, asset/recipient digests, native network and a constrained optional \`X-SF98-Order-ID\` are stored. No payment payload, raw recipient wallet, browser token, HTTP query, application result or private transaction bytes are persisted. The optional merchant order ID is **buyer-provided and untrusted**: the merchant receiver must compare it against an existing, authorized order before fulfillment.

If the SDK says success but no supported canonical native settlement header is available, SF98 calls the \`onWriteFailure\` callback with a generic warning. It **does not change the already successful payment/resource response**. An I/O crash between original settlement and outbox fsync cannot be papered over by a secondary adapter; a merchant must reconcile against its own authoritative settlement system. A journal hash is deduplication identity, not proof of chain finality independent of the original SDK.

## Deliver explicitly, not inside a payment request

### Events from a route with multiple payment options

SF30 can configure several complete `exact` payment options on one resource.
The outbox binds an event to the verified requirements passed as the second
argument of the original SDK's `processSettlement`. It requires one configured
option matching scheme, network, asset, recipient, atomic amount and timeout.
Native additions to `extra`, including facilitator fee sponsorship, remain the
SDK's responsibility. The event uses the chosen option's network, amount and
asset digest, including when the buyer chooses the second advertised network.
New events also record `recipientDigest`, the lowercase SHA-256 of that exact
selected `payTo` string. The recipient address itself is not stored. This lets
merchant consumers distinguish otherwise identical options paying different
recipients.

The returned payment receipt must report success on that same network; if it
contains an amount, it must match the exact selected amount. Missing, ambiguous
or mismatched terms produce the existing journal warning and no event. The
already successful native resource response is still returned. Event schema,
retry behavior and deduplication remain compatible with existing journals.

### Recipient-aware merchant upgrade

The original event and webhook schemas remain version 1. `recipientDigest` is
additive: new native events include it and the original sender forwards it inside
the signed body; historical events without it retain their original wire fields
and bytes. Absent or null legacy recipient metadata is omitted from the webhook.
A non-null digest must be a lowercase 64-hex string; other values are rejected
by the sender. No raw recipient, wallet secret or extra payment payload enters
the webhook.

Upgrade merchant consumers before delivering recipient-bearing events. The
original [SF101 receiver](../sf101-merchant-receiver/README.md) automatically adds
a nullable recipient column to an existing private database and provides local
`bind-recipient` for pending legacy orders. The original
[SF104 WooCommerce bridge](../sf104-woocommerce-merchant-bridge/README.md) uses its
existing prebind form with the exact selected public `payTo`, storing only its
hash. Both consumers retain the existing behavior when an old order and old
notice both omit recipient identity. A new selected-recipient notice requires
the order's matching recipient binding; it cannot be silently assigned to a
legacy or different recipient. After binding the original pending order, retry
the existing event, or explicitly requeue it if already exhausted.

Process pending historical notices against their existing legacy bindings. Do
not edit an event to add current terms: changing its body would invalidate the
merchant's original replay fingerprint. The existing fulfillment policy remains
with each merchant consumer: SF101 grants its pre-enrolled file entitlement;
SF104 retains the merchant's explicit independent review and Woo release action.

The original sender supports a one-shot drain and an opt-in [continuous delivery service](./SERVICE.md). On a Linux merchant host with Node 22+ and util-linux `flock`, set a fresh HMAC key (32+ bytes) through private environment storage, never in config or CLI output:

\`\`\`sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs status \
  --state /private/merchant/sf98-outbox

node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs drain \
  --state /private/merchant/sf98-outbox \
  --url https://merchant.example/internal/x402-events \
  --allow-host merchant.example \
  --secret-env SF98_WEBHOOK_SECRET \
  --limit 20
\`\`\`

\`drain\` and the explicitly started continuous worker send HTTP through the same original signed transport. It requires an exact public HTTPS domain, checks every resolver answer for public unicast and pins the chosen address in the Node HTTPS connection with the original hostname used for TLS verification. No redirects, querystring secrets, credentials in URLs, private/loopback or mixed public/private DNS targets. Node 22's \`lookup({all:true})\` callback shape is supported. A 2xx HTTP response records webhook **acceptance**, not completed downstream work or Stellar settlement independently validated by this consumer.

Delivery body schema \`stellar-forge.sf98.webhook.v1\`: \`eventId\`, \`occurredAt\`, \`routeId\`, \`method\`, \`network\`, \`amountAtomic\`, \`assetDigest\`, \`orderReference\` (null when absent), \`settlement: ORIGINAL_NATIVE_SUCCESS\`, and optional \`recipientDigest\`. The receiver must calculate HMAC SHA-256 over \`x-sf98-timestamp + "." + raw request body\`, compare it in constant time with \`x-sf98-signature: sha256=HEX\`, enforce a short timestamp window, and atomically deduplicate \`idempotency-key\` (same \`eventId\`) before any side effect. The sender intentionally does **not** include raw transaction, recipient or buyer details. Verify the merchant's own original order/payment authority before irreversible shipping/transfer; a valid HMAC only authenticates this adapter's report.

A failed HTTP/timeout appends an original attempt state and exponential next retry time (30 seconds to 30 minutes). After 8 attempts the event remains \`EXHAUSTED\`, not silently deleted. Once the operator repairs the receiver, re-arm **only** a named event:

\`\`\`sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs requeue \
  --state /private/merchant/sf98-outbox \
  --id ORIGINAL_64_HEX_EVENT_ID
\`\`\`

Receiver may accept a POST and crash before local fulfillment. Sender may similarly crash after receiver acceptance but before writing \`DELIVERED\`. Therefore this is **at-least-once delivery** with a mandatory receiver idempotency key, not exactly-once economic execution. The continuous worker, manual drain, and manual requeue share one kernel delivery lock per merchant outbox; a competing sender fails with `SF98_DELIVERY_BUSY`. The existing seller can continue appending original events. See [SERVICE.md](./SERVICE.md) for installation, status, shutdown and crash recovery. The source logs are append-only NDJSON, private directory 0700 and files 0600. They must remain outside a public repo/site. An operator should back them up and protect them against local user compromise.

## Merchant rollout

1. Run original SF82/SF30 seller with real accepted terms and its canonical facilitator. Confirm the original native payment outcome independently; do not promote challenge-only responses to cash claims.
2. Start using the embedded original SF30 nativeFactory wrapper above; keep the merchant-specific outbox private. The same original handler and reverse proxy remain in service.
3. Configure the **merchant's own** idempotent HMAC receiver with order-to-resource binding and manual reconciliation for missing journals.
4. Issue the separately authorized real native paid request with a non-sensitive order reference, then inspect the \`status\` summary and operator logs.
5. Run explicit \`drain\` and check merchant-side receipt/fulfillment state. Retry/requeue as necessary. SF97 remains the separate finance/economics view; SF93 remains the separate support bundle; this adapter only delivers settled events.

There are no hosted GitHub Actions, no automatic wallet operation, no direct buyer contact, no Stripe or fiat invoice, and no new customer entitlement implied by these modules. Run native official source on the seller's original network before claiming a merchant pilot. SCF #46 grant interest/application belongs to the existing SF10 founder owner; this module is pre-award shipped engineering.
