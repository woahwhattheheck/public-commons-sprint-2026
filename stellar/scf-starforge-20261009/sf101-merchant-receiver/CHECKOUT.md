# Approved order to paid file

The original receiver can now participate in a complete merchant purchase. An
operator enrolls an actual private file and creates its order handoff. The buyer
adds that order to the existing SF88 operation, reviews the exact URL and payment
terms, and uses the existing approval and spending workflow. The original SF30
seller runs the order application through its Python worker pool; native
settlement writes the original SF98 event. Its authenticated delivery unlocks the
file in the same SF101 database. The customer downloads the exact promised bytes.

The merchant's private file, enrolled order, token hash and entitlement stay in
the existing `receiver.py` store. The checkout does not introduce another order
database, payment engine, approval provider or signer. Each checkout listener
offers one fixed-price GET operation with one complete Stellar payment option.
Multiple approved files/orders can use that operation. Deploy separate original
merchant configurations when product prices or payment options differ.

## The order is part of the approved resource

The request has both:

```text
GET https://merchant.example/purchase/report?sf98_order=approved-order-482
X-SF98-Order-ID: approved-order-482
```

The new optional SF88 `operation.orderReference` derives this one header and
requires the same single `sf98_order` query value. The original SF31 approval
intent already includes the complete URL, and the existing SF54 mapper includes
that URL in the exact SF36 consent request. No financial schema change is needed.
The same normalized operation survives original SF88 queue storage and restart.

Before payment processing, the merchant requires the query and header to match,
looks up the original approved order, checks its route, method, network, amount,
asset and available recipient binding, and reads the original enrolled file to
confirm its size and hash. Unknown, changed or already entitled orders do not
reach native payment processing. The application repeats the original order/file
read after verification; application failure takes SF30's existing cancellation
path before settlement.

When the original receiver supplies its `access_allowed(db, ref)` policy helper,
the same read checks it before verification and again in the application. Order
and policy reads share one explicit SQLite read transaction. A
suspended or expired pending order cannot enter checkout. Older receiver source
without that optional helper retains its original access behavior; checkout does
not create a second policy store.

The order reference is a constrained, nonsecret identifier. It will appear in the
approved URL and normal merchant request records. It is not the claim token. The
claim token is provisioned separately, never placed in the URL, handoff, x402
payload, outbox event or buyer file receipt.

## Merchant setup

Use Node 22.16 or newer, Python 3.11 or newer and the existing repository source.
Native settlement uses the original installed `@x402/core`, `@x402/stellar` and
`@x402/extensions` packages. Version 2.28.0 was used for the focused local journey.
The operator owns the existing HTTPS reverse proxy and native facilitator.

Put this configuration in a private file outside the source checkout. Replace
the resource description, origin, paths and payment terms with the merchant's
actual approved values. The two `UNVERIFIED_DEMO_*` markers compile for local
inspection but are not usable payment details.

```json
{
  "schema": "stellar-forge.sf101.checkout-service.v1",
  "publicOrigin": "https://merchant.example",
  "path": "/purchase/report",
  "routeId": "paid_report",
  "description": "Purchase the previously approved private report",
  "payment": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "amount": "1000",
    "asset": "UNVERIFIED_DEMO_ASSET",
    "payTo": "UNVERIFIED_DEMO_RECIPIENT",
    "maxTimeoutSeconds": 300
  },
  "state": "/private/merchant/sf101",
  "outbox": "/private/merchant/sf98-outbox",
  "workerCount": 2,
  "maxPending": 32
}
```

`state` and `outbox` must be distinct, absolute normalized private directories.
Their parent directories must already exist. Optional `python` names the actual
interpreter, including an absolute virtual-environment interpreter path.
`workerCount` supports 1–8 persistent original Python workers; `maxPending`
supports 1–256 total pending calls. The application uses only the Python standard
library and the original receiver source.

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs inspect \
  --config /private/merchant/checkout.json
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs init \
  --config /private/merchant/checkout.json
```

Inspection reads configuration and original offer schemas. Initialization calls
the existing receiver initializer; it preserves enrolled orders. Keep the same
private database through service restarts and backups.

### Enroll the actual file

Use the merchant's existing secure mechanism to generate and provision a long
random claim token. Place it in `SF101_CLAIM_TOKEN` for enrollment. The buyer
receives that same token through the separately authorized private channel.
Use an opaque printable token of 32–1024 bytes without whitespace; a randomly
generated 64-character hexadecimal token is suitable for this interface.

The file must be a private regular file, 1 byte to 32 MiB, with no group or other
access. `receiver.py` reads and hashes the actual bytes during enrollment.

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs enroll \
  --config /private/merchant/checkout.json \
  --ref approved-order-482 \
  --file /private/merchant/reports/report-482.csv \
  --out /private/merchant/handoffs/order-482.json
```

Use `--claim-env NAME` when the existing private environment uses another name.
Only that selected value is passed to the original enrollment process. The
persistent Python checkout workers receive neither the token nor the webhook
HMAC key.

Enrollment derives route/method/price and asset/recipient digests from the same
compiled seller offer, then calls original `receiver.enroll()`. The emitted
handoff is create-only, 0600 JSON with the order, purchase and delivery URLs,
accepted payment terms, and promised file hash/size. It contains no file path or
token. Supply this exact handoff to the customer through the existing merchant
relationship.

If enrollment completed but the handoff could not be saved, recover that same
order without enrolling or rotating its token again:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs handoff \
  --config /private/merchant/checkout.json \
  --ref approved-order-482 \
  --out /private/merchant/handoffs/recovered-order-482.json
```

Existing orders without the receiver's optional recipient digest are labeled
`ORIGINAL_LEGACY_ORDER` in the handoff. A receiver with recipient binding stores
and checks the supplied digest and produces `ORIGINAL_RECIPIENT_DIGEST`. The
checkout never silently rewrites or upgrades a legacy order.

### Start the existing services

Start checkout and the original operations view. Without a facilitator it checks
the real approved order and returns an original HTTP 402 challenge. Its Python
application performs read-only order and file checks; it cannot grant access.

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs serve \
  --config /private/merchant/checkout.json --port 8423 --operations-port 8424
```

For the actual merchant-native payment runtime, add the existing trusted
facilitator:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs serve \
  --config /private/merchant/checkout.json --port 8423 --operations-port 8424 \
  --facilitator https://facilitator.example
```

Local HTTP facilitators require the explicit existing development option
`--allow-local-facilitator`. This does not authorize a purchase or replace the
merchant's native payment configuration.

Start the original receiver with the merchant's existing `SF98_WEBHOOK_SECRET`:

```sh
python3 stellar/scf-starforge-20261009/sf101-merchant-receiver/receiver.py serve \
  --state /private/merchant/sf101 --port 8472
```

Configure the existing HTTPS proxy as follows. Preserve the complete query and
`X-SF98-Order-ID` on the purchase route; redact authorization in delivery logs.

| Public route | Original local service |
|---|---|
| `/purchase/report` | SF30 checkout at `127.0.0.1:8423`, including query and order header |
| `/internal/x402-events` | Original receiver `127.0.0.1:8472/sf98/events` |
| `/deliver/<order>` | Original receiver `127.0.0.1:8472/deliver/<order>` |

Keep the operations listener private. Its existing `/fulfillment` view is wired
to this checkout's actual original outbox; `/api/delivery` shows its current
delivery status. `/_seller/docs` and `/_seller/openapi.json` use the same compiled
purchase offer. SIGINT/SIGTERM drain the original seller, close the original
operations observer, and then close the Python workers.

## Buyer preparation, approval and purchase

Start with the buyer's already configured original SF88 operation for this
merchant's `/purchase/report` endpoint. Its operator workspace, policy, ledger,
signer, stable intent and spending cap stay with the original SF88 onramp.
The helper refuses a different merchant/path, request body, mismatched payment
rail/recipient, conflicting order, or a price beyond that existing buyer cap.

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs inspect \
  --handoff /private/buyer/order-482.json
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs prepare \
  --handoff /private/buyer/order-482.json \
  --config /private/buyer/original-operator.json \
  --out /private/buyer/order-operator.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --review \
  --config /private/buyer/order-operator.json
```

The existing review shows the exact order-bearing URL and its derived order
header. Inspect the merchant handoff's file promise as part of that decision.
Preparation does not load a wallet, reserve budget or invoke a signer.

Use the original durable inbox for the prepared operation:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs init \
  --root /private/buyer/inbox
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs enqueue \
  --root /private/buyer/inbox --config /private/buyer/order-operator.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs show \
  --root /private/buyer/inbox --intent ORIGINAL_STABLE_INTENT
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs execute \
  --root /private/buyer/inbox --intent ORIGINAL_STABLE_INTENT \
  --workspace /private/buyer/original-workspace
```

Initialize the inbox only when it does not already exist. Use the buyer's
existing private workspace and runtime environment from the current SF88 onramp.
The terminal's original approval/reservation and native signer remain the only
purchase path. The queue records one permanent attempt and never automatically
repeats a payment. Use its existing show/recover commands after interruption.

The immediate paid response is a small order/file descriptor. It is distinct
from the separately downloadable product. An optional original SF88
`responseFile` saves that immediate descriptor; the command below saves the
entitled product. Keep different destinations for them.

## Original notification and customer download

The merchant delivers the original SF98 outbox using its existing worker or
explicit drain command. The HMAC key must match the original receiver.

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs drain \
  --state /private/merchant/sf98-outbox \
  --url https://merchant.example/internal/x402-events \
  --allow-host merchant.example --secret-env SF98_WEBHOOK_SECRET
```

An accepted original notification changes the enrolled order to `ENTITLED` in
the receiver's existing SQLite transaction. Its existing idempotency, recipient,
access and claim-token rules govern subsequent file requests.

On the buyer's machine, put the separately provisioned token in the private
`SF101_CLAIM_TOKEN` environment value, then run:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs retrieve \
  --handoff /private/buyer/order-482.json \
  --out /private/buyer/downloads/report-482.csv
```

This sends one GET to the handoff's exact same-merchant `/deliver/<order>` path,
with its token in `Authorization`. It uses the original public HTTPS transport's
DNS pinning, TLS checks, no redirects and body deadline. It has no payment
fallback. A 404 for a pending order or rejected token creates no final file;
repair the merchant notification/token and explicitly retrieve again.

The original response-file writer receives a stream that verifies the promised
size and SHA-256 at EOF. Only matching complete bytes reach the create-only final
path. A failed or interrupted stream can leave the original writer's private
`.partial` file; it is never called a completed download. The new file and its
adjacent `.sf101.json` receipt use 0600 permissions.

Rerunning `retrieve` when the final file already exists checks its actual private
bytes first. Matching bytes reuse or repair the local file receipt without a
network request or token. A different, non-private or symlinked file is refused
without replacement. Local possession of a previously downloaded copy is not a
new access grant; server-side suspension cannot retract an existing local copy.

Keep the original buyer financial outcome, original merchant entitlement receipt
and local downloaded-file receipt together in the merchant's existing workflow.
The last records completed local bytes, not independently verified Stellar
settlement or cash collection. The original receiver receipt remains available:

```sh
python3 stellar/scf-starforge-20261009/sf101-merchant-receiver/receiver.py receipt \
  --state /private/merchant/sf101 --ref approved-order-482 \
  --out /private/merchant/receipts/order-482.json
```

## Operational behavior and validation

Prepayment reads and the post-verification read use the original bounded Python
pool. An application failure withholds the purchase response and lets the native
seller cancel before settlement. Original SF98 journal failure after successful
native settlement remains a merchant reconciliation event; checkout logs
`SF101_NATIVE_OUTBOX_WRITE_FAILED` and does not pretend it can undo settlement.
Concurrent independently approved purchases are separate attempts. There is no
one-charge guarantee across different intents or a crash before notification.

The focused `checkout.journey.mjs` runs actual local Python/SQLite, original SF88
configuration/inbox/review, SF31 resource approval and SF54 mapping, official
x402 2.28.0 SF30 processing, original SF98 HMAC HTTP sender, original SF101
receiver, and original streamed file writer. It covers pending/wrong-token
denial, mismatched order rejection before verification, exact delivered bytes,
receiver restart, duplicate event acknowledgement, local-file recovery and
wrong-hash withholding. Its facilitator and approval are controlled locally;
the check does not submit a transaction or claim a live customer payment.

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.journey.mjs
```

Source ownership stays with the original SF30/Python, SF88 onramp, SF98 sender,
SF101 receiver/access and SF10 grant teams. This is delivered product integration
for the existing merchant pilot and canonical grant application.
