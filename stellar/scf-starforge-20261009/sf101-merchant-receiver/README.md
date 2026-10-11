# SF101 · Merchant webhook receiver and paid-file entitlement

**Runnable merchant-side delivery product** for the original SF30 Stellar x402 seller and SF98 post-settlement delivery outbox. It fills the actual SF98 integration gap: authenticating a merchant delivery notice, binding it to a previously approved order and asset/route/network/atomic amount/selected recipient, atomically unlocking a real private file, and serving that file to the authorized customer. No new payment verifier, wallet, facilitator, signer, simulated chain event, SMTP sender or hosted CI.

The existing `../sf98-merchant-delivery/deliver.mjs` is the upstream sender. SF101 accepts its **exact** `stellar-forge.sf98.webhook.v1` raw request body, `x-sf98-timestamp`, `x-sf98-signature` and `idempotency-key` headers. The original ten body fields remain required; one optional lowercase 64-hex `recipientDigest` is supported. Other fields or a null/malformed recipient digest are rejected. That sender must already be wired to `instrumentNativeSettlement` around the original SF30 native SDK. The sender only enqueues a notice when the original SDK reports settlement success and a supported original payment response is available. SF101's HMAC verifies this trusted **sender's** statement, not independent Stellar chain finality. The original merchant/facilitator remains responsible for chain reconciliation and cash accounting.

## End-to-end merchant workflow

Python 3.11+ standard library, local SQLite with full synchronous commits, no packages or external jobs. The SF98 sender is Node 22+ and needs the original checkout and x402 packages already documented in its own README.

Paid-route enrollment and signed event validation support the original seller's GET, HEAD, POST, PUT, PATCH and DELETE methods. Each event must still match the exact method enrolled for its order.

1. **Enroll an approved order before payment.** Create a customer/order reference that only your merchant system can approve. Provision a buyer claim token in your existing secure channel. Store the private digital product as a regular **0600** file. Configure one complete currently accepted payment option: route, method, network, atomic asset amount, SHA-256 of the asset identifier and SHA-256 of the selected `payTo` recipient from the original SF30 seller terms. New enrollment requires both digests. The `X-SF98-Order-ID` supplied on the buyer request is *untrusted*, so matching it against this existing order is mandatory.

```sh
R=stellar/scf-starforge-20261009/sf101-merchant-receiver
install -d -m 700 /private/merchant/sf101
python3 "$R/receiver.py" init --state /private/merchant/sf101
# In an operator-only terminal, set a 32+ byte private buyer token.
export SF101_CLAIM_TOKEN='REPLACE_WITH_OWNER_PROVISIONED_32PLUS_RANDOM_BYTES'
python3 "$R/receiver.py" enroll \
  --state /private/merchant/sf101 \
  --ref existing-order-482 --route original-dataset-route --method GET \
  --network stellar:testnet --amount 1000 \
  --asset-digest '64_LOWERCASE_SHA256_HEX_OF_ORIGINAL_SELLER_ASSET' \
  --recipient-digest '64_LOWERCASE_SHA256_HEX_OF_SELECTED_PAYTO' \
  --file /private/merchant/fulfillment/report.csv
unset SF101_CLAIM_TOKEN
```

Both digests use the **actual selected option's exact strings**, identical to `SHA256(String(payment.asset))` and `SHA256(String(payment.payTo))` in the original SF98 `nativeEvent()`. Do not trim, case-fold or substitute the first advertised option. The example digest values above are placeholders. In a trusted Node 22 checkout, an operator can derive both from the actual public identifiers held in local environment variables; only the hashes are printed:

```sh
node -e 'const c=require("node:crypto");for(const [label,name] of [["assetDigest","MERCHANT_ACTUAL_ASSET"],["recipientDigest","MERCHANT_SELECTED_PAYTO"]]){const value=process.env[name];if(!value)process.exit(2);console.log(label+"="+c.createHash("sha256").update(value).digest("hex"))}'
```

2. **Run SF101 behind the merchant's existing HTTPS reverse proxy.** The receiver binds **loopback only** and has no public HTTP mode. The externally published path must map `https://merchant.example/internal/x402-events` to `http://127.0.0.1:8472/sf98/events`, and merchant delivery must map `https://merchant.example/deliver/<order-reference>` to `http://127.0.0.1:8472/deliver/<order-reference>`. Keep proxy logs redacted for `Authorization` headers; configure HTTPS TLS, a request body cap and normal network access controls. Do not expose port 8472 publicly.

```sh
export SF98_WEBHOOK_SECRET='REPLACE_WITH_SAME_OWNER_PRIVATE_32PLUS_BYTE_HMAC_KEY_AS_SF98'
python3 "$R/receiver.py" serve --state /private/merchant/sf101 --port 8472
```

3. **Let the original native seller settle an authorized x402 request.** The genuine buyer request carries `X-SF98-Order-ID: existing-order-482`; the merchant must independently approve its order and purchased route. The original SF98 outbox only records a payment-native-success notice when the seller's SDK reports success. Do not replace that machinery with an HTTP 2xx counter or a fabricated receipt.

4. **Deliver explicitly from the original SF98 outbox.** On the original sender worker, use the already documented `deliver.mjs drain --state ... --url https://merchant.example/internal/x402-events --allow-host merchant.example --secret-env SF98_WEBHOOK_SECRET`. SF98 signs each attempt's fresh timestamp over `timestamp + "." + exact raw JSON bytes` with HMAC-SHA256. The SF101 receiver checks that signature using a constant-time comparison, requires a timestamp within five minutes and an identical `idempotency-key`/`eventId`, and matches the event's exact route, method, network, atomic price, asset digest and selected recipient digest to the pre-enrolled order. One SQLite transaction both records the unique event and changes the order from `PENDING` to `ENTITLED`. Only after commit does it return HTTP 200 to the existing SF98 sender. Retried identical events are HTTP 200 with `ALREADY_ENTITLED`; conflicting replay IDs or reused orders return 409. Unknown/mismatched orders are **not unlocked**.

5. **The approved customer downloads the purchased file.** Over public TLS, the holder of the separately-issued long random claim token sends `Authorization: Bearer <claim-token>` to `/deliver/existing-order-482`. The receiver returns 404 before native-settlement notice acceptance or for a wrong token. After authorization, it checks the source file's original SHA-256 and byte size before sending the complete file as `application/octet-stream` with no-store. It refuses changed, symlinked, oversized or non-private source files. Claim tokens are SHA-256 hashed in the merchant database, never logged or included in SF98 events. Downloads remain available on subsequent calls while the approved order and unchanged source are retained.

6. **Operator readback and private entitlement receipt.** No wallet or further request is made by either command:

```sh
python3 "$R/receiver.py" status --state /private/merchant/sf101
python3 "$R/receiver.py" receipt --state /private/merchant/sf101 \
  --ref existing-order-482 --out /private/merchant/receipts/order-482.json
```

`receipt` is **create-only**, private 0600 JSON recording the actual signed sender event ID, grant time, paid resource fingerprint and selected recipient digest. `recipientBinding` is `SELECTED_RECIPIENT` for a recipient-bound order and `LEGACY_UNSPECIFIED` for an existing legacy entitlement, whose `recipientDigest` remains null. It is **not** an independent on-chain transaction receipt or evidence of fiat payment. For a source revision, enroll a *new* order, preserving the original accepted file and receipt. The receiver intentionally never emails or charges anyone; the existing merchant/customer system controls token distribution, sales, refunds and accounting.

## Upgrade an existing merchant database

Deploy this receiver before sending recipient-bearing SF98 events. Opening an existing database automatically adds a nullable `orders.recipient_digest` column if needed. Migration acquires SQLite's write lock and rechecks the schema under that lock, so simultaneous workers cannot race to add it. Existing orders, tokens, file fingerprints, events and entitlements are retained. Historical recipients remain null; they are not guessed from current seller configuration. `status` adds `legacyPendingWithoutRecipient` so the merchant can identify remaining migration work.

For an existing pending order that will receive a new recipient-bearing native notice, bind its actual approved recipient locally:

```sh
python3 "$R/receiver.py" bind-recipient \
  --state /private/merchant/sf101 --ref existing-order-482 \
  --recipient-digest '64_LOWERCASE_SHA256_HEX_OF_SELECTED_PAYTO'
```

The command accepts only an existing, unbound `PENDING` order. Repeating the same digest returns `ALREADY_BOUND`; changing an established digest or adding one to a historical entitled order is rejected. Original order terms, file, token and accepted event stay unchanged. No claim token is needed for this local administrative command.

| Order recipient | Incoming authenticated notice | Result |
| --- | --- | --- |
| Selected recipient recorded | Same digest | Original atomic entitlement and idempotent replay behavior |
| Selected recipient recorded | Different digest or recipient omitted | HTTP 409 `ORDER_RECIPIENT_MISMATCH` |
| Legacy recipient unset | New recipient digest | HTTP 409 `ORDER_RECIPIENT_NOT_BOUND`; bind the pending order using its approved terms, then retry the original notice |
| Legacy recipient unset | Legacy notice omits recipient | Existing entitlement behavior continues; receipt records `LEGACY_UNSPECIFIED` |

Process original legacy notices against their existing legacy orders. The upgrade does not rewrite their raw payloads or event IDs. If a new notice reached SF98 `EXHAUSTED` before recipient binding was added, use the existing SF98 `requeue` command after binding; the same durable event is retried. Already accepted events retain their original replay fingerprint and are not re-enrolled or issued a second entitlement.

## Integrity and failure behavior

- DB and journal in original private `--state` folder (0700), merchant SQLite file 0600 and WAL transaction with synchronous FULL; event ID and order reference both unique. A crash after commit but before HTTP response is recovered by the sender's original retry, which receives the same HTTP 200 idempotent acknowledgement. A crash before commit leaves the order pending. Multiple concurrent receivers may use the same SQLite file, with `BEGIN IMMEDIATE` serialized writes, but operate them within the same trust boundary and ensure migrations are coordinated.
- The sender's event must include a valid non-null order reference, a 64-hex original event ID and a positive base-unit amount. If no order was provided by the buyer or the merchant never enrolled it, the receiver does not silently allocate funds to a different order. A merchant can resolve missing order mapping, then explicitly `requeue` its **existing** exhausted SF98 event with the original sender command.
- Untrusted web requests never create an order, change its price, or access the merchant database. The administrative enrollment/receipt commands only run locally. File delivery uses a separately approved token, in addition to a committed entitlement, not mere possession of an event ID.
- The server accepts only 8 KiB JSON webhook bodies, rejects invalid header framing and signatures before JSON parsing, and never signs or spends. HTTP output is minimal, no sensitive event body or buyer tokens are echoed to logs, and no external polling or background delivery is initiated.
- The merchant must still reconcile the original native transaction outcome, webhook outbox omissions after a crash, refunds, chargebacks, order cancellation and downstream entitlements according to its own settlement policy. A successful webhook is an authenticated **notification** and a durable *digital access grant*. It does not alone establish irreversible economic finality outside the seller's trusted SDK.

**Source lineage:** exact original `sf98-merchant-delivery/{outbox,deliver}.mjs`, original SF30 seller route and payment identity, original SF49 merchant adoption, and SF97 merchant revenue operations. This is complementary private-merchant fulfillment engineering for SCF #46, not a parallel SCF grant application or substitute for the canonical SF10 founder narrative.
