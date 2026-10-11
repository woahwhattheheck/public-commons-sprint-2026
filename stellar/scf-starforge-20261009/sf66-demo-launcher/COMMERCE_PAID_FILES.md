# Purchased files in the commerce workspace

Use one prepared commerce session to review an original merchant order, execute
its existing buyer request, retrieve the entitled file and recover its local
receipt. The browser reads the same SF88 inbox as the terminal. The merchant
uses the original SF101 checkout, Python application, SF30 native seller and
SF98 settlement outbox. Retrieval calls the original SF101 `purchase.mjs`.

## Prepare the existing order and buyer

Follow [SF101 checkout setup](../sf101-merchant-receiver/CHECKOUT.md) to initialize
the merchant's private state and enroll the approved file. Keep its generated
handoff and separately supplied claim token. The original receiver and signed
SF98 delivery worker must use this checkout's same state and outbox. Keep their
existing HTTPS ingress and delivery configuration.

Prepare the buyer's operation using the original command:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs prepare \
  --handoff /private/customer/merchant-handoff.json \
  --config /private/customer/operator.json \
  --out /private/customer/order-operator.json
```

The resulting operation retains the original intent, operator, signer and caps.
Its approved URL contains the order reference, and original SF88 derives the
matching `X-SF98-Order-ID` header. Configure the final buyer request before
generating a native signer configuration that fingerprints it. For SF103, the
plan's `config` must still be the exact `buyer.json` referenced by that signer's
configuration. An original SF88 workspace may instead supply its existing
operator environment during execution.

Use separate paths for the immediate paid HTTP response and the purchased file.
The response is the checkout acknowledgement. The product is the exact file
promised by the handoff and served by the entitled order's delivery URL.

## Import the handoff into the existing session

Extend the [original commerce plan](./COMMERCE.md):

```json
{
  "schema": "stellar-forge.commerce-plan.v1",
  "seller": {
    "checkoutConfig": "/private/merchant/checkout.json",
    "port": 8423,
    "facilitator": {"url": "https://your-existing-facilitator.example"}
  },
  "operationsPort": 0,
  "buyers": [
    {
      "config": "/private/customer/order-operator.json",
      "workspace": "/private/customer",
      "paidFile": {
        "handoff": "/private/customer/merchant-handoff.json",
        "destination": "/private/customer/downloads/purchased-report.csv",
        "claimEnv": "SF101_CLAIM_TOKEN"
      }
    }
  ]
}
```

Choose `checkoutConfig` for the original SF101 merchant, or the original
`config`/`handlers` pair for another existing merchant. The checkout supplies
its own original handlers. `facilitatorConfig` may select an existing native
facilitator configuration instead of a facilitator URL; it uses the original
policy, signer environment and native drain behavior. Omitting a facilitator
retains challenge-only operation.

Each `paidFile` is optional. Its handoff must match that buyer's exact GET URL,
order and payment limits. On startup, its route ID and complete promised
payment terms must also match the actual compiled merchant option. Multiple
prepared orders can share the merchant; each uses a distinct product
destination and stable intent. `claimEnv` defaults to `SF101_CLAIM_TOKEN` and
can name a separate variable for each customer's separately provided token.
Product, original sidecar, buyer response and evidence destinations must also
be distinct across the complete prepared set; initialization rejects a
collision before publishing the session.

Keep input JSON private (`0600`) and the existing destination parent directory
private (`0700`). Load the token through the operator's normal environment
before starting the session. The browser receives neither the token nor an
input for a destination, URL or claim token.

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs init \
  --plan /private/commerce-plan.json --directory /private/merchant-session

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs start \
  --directory /private/merchant-session --port 8426
```

Initialization copies the exact handoff bytes into the session, records their
SHA-256 and queues the unchanged prepared buyer through the original SF88
inbox. The session also freezes the original checkout configuration and its
compiled seller configuration. Reopening checks these retained bindings.
Initialization does not execute the buyer or retrieve the product.

## Review, purchase and retrieve

1. Select the original prepared operation. Review its URL, order header, quoted
   payment terms and spending cap using **Review operation**.
2. Read **Purchased file** for the promised size, SHA-256, merchant delivery URL
   and configured local destination. Expand its association details for the
   original inbox job, request hash and handoff hash.
3. **Execute operation** invokes the unchanged inbox command. Answer the
   original approval prompt in the terminal. Its original result and saved
   response remain in **Delivery**.
4. The merchant's existing SF98 worker sends its signed settlement event to
   the original SF101 receiver. **Retrieve entitled file** explicitly invokes
   the original retrieval once. If the merchant has not granted access, the
   browser shows the original failure; it does not start another payment.
5. After retrieval, **Preview file** or **Download file** opens only this
   operation's retained product. The server checks the file's current size and
   SHA-256 before returning it. Text previews are limited to 256 KiB; binary
   content remains downloadable. The original private file and sidecar stay in
   their configured paths.

The foreground terminal also supports `retrieve INTENT`. Both interfaces call
the same original SF101 function. Status refreshes do not request delivery,
invoke a signer or pay. Retrieval errors can be retried explicitly after the
merchant notification or token configuration is corrected.

## Reopen and recover

Restart the same session directory. The original inbox retains its attempt and
outcome; the frozen handoff retains the promised file; the original
`DESTINATION.sf101.json` receipt identifies the delivered bytes. Browser review
tokens are newly issued, while durable buyer and delivery identities remain.

**Check and recover local file** hashes an existing product through the
original SF101 retrieval function. Matching bytes require zero merchant
requests and can recreate a missing original sidecar. A mismatched existing
file is not overwritten. An existing receipt whose file is missing remains an
original retrieval error; the workspace does not turn it into a successful
download. **Recover recorded result** remains the separate original inbox
recovery action for interrupted buyer attempts.

Association details show the actual SF82 evidence path and digest when its
intent, execution time and terms match the original inbox attempt. SF82 records
the intent and terms; the immutable inbox supplies the exact URL/order, and
the SF101 sidecar supplies the file identity. These are displayed together
without changing any of the original records or treating a downloaded file as
independent chain settlement evidence.

For a buyer backed by an existing SF88 workspace, its original accounting
completion remains available for this same retained intent:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs finalize \
  --root /private/merchant-session/inbox --intent ORIGINAL_INTENT \
  --workspace /private/customer \
  --outbox /private/merchant/outbox --merchant-route ORIGINAL_ROUTE_ID
```

Use the checkout's actual outbox and route. This delegates to the existing
finalization/reconciliation implementation and its original transaction record;
it does not execute another purchase or derive settlement from the product file.

Stopping waits for the owned buyer/review/signer/retrieval work, drains the
original seller and owned native facilitator, then closes the original
operations service and Python source. The original receiver and webhook
worker retain their separately managed lifetimes. The original usage-history
writer stays in the session's private `usage` directory, including when an
SF101 checkout uses its existing delivery-aware operations service.

For distributions, include `commerce-purchase.mjs` and this guide with the
existing commerce browser files and SF101 checkout/purchase dependency closure.
There is no browser build step or additional package dependency.
