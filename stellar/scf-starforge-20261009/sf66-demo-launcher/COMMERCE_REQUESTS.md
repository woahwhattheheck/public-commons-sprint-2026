# Private merchant requests in the commerce workspace

An original merchant buyer packet can enter the same SF66 commerce session used
for API, Python, RPC and paid-file purchases. Choose its payment option once;
the original URL, method, ordinary headers, operation ticket and body bytes move
together into the existing SF88 workspace and inbox. The same operator budget,
native signer, merchant and recorded attempt continue to own execution.

## Select the merchant packet

In the original API merchant workspace, prepare the concrete POST request,
including any files and fields, then download its private buyer request. This
is the existing `stellar-forge.operation-handoff.v1` JSON file. Its source offer
and ticket must belong to the merchant configured for this commerce session.
Keep the packet in an operator-owned directory with mode 0700 and file mode 0600.

Start with the complete [operator setup](OPERATOR.md). Keep its seller,
facilitator, operator account, Python executable and aggregate spending limits.
Replace a purchase selection with:

```json
{
  "requestFile": "/private/merchant/attachment-request.json",
  "acceptIndex": 0,
  "saveResponse": true,
  "responseMaxBytes": 8388608
}
```

`acceptIndex` is the explicit zero-based alternative in the original offer.
The request's URL and method identify the configured merchant route; an optional
`routeId` must select that same route. Setup compares the selected original
terms with the current merchant, including its asset, recipient, price, timeout
and payment-flow metadata. Select `paymentFlow: "upfront"` explicitly for a
merchant alternative using that flow. Authorization remains the default.

The packet supplies `intentId`, `method`, `path`, `query`, `bodyFile`, `headers`,
`ticketFile` and `ticketHeader`; do not also place those fields in this selection.
To change the request, prepare a new packet in its original merchant workflow.
Buyer response destination and timeout choices remain operator settings.

For an HTTP backend, retain the original `seller.upstreams`, environment
references and operation-state directory. The current ticket must match its
configured idempotency header. The original merchant authenticates the ticket
and exact request binding during admission; this setup does not issue a second
ticket. [Upstream commerce](UPSTREAM_COMMERCE.md) describes that lifecycle.

## Review, prepare and open

Run the original entry points from the same installed source:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs review --config /private/setup.json --directory /private/new-commerce
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs prepare --config /private/setup.json --directory /private/new-commerce
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs start --directory /private/new-commerce/session
```

Review shows each selected request's original terms, body presence, exact byte
count and SHA-256, content type, file count, source packet identity and current
ticket metadata. It loads no wallet key and makes no payment. Preparation uses
one original SF88 operator workspace and shared SF36 ledger for all selections.

Preparation retains the original packet under `requests/`, its unchanged body
under `bodies/`, and the ticket under `tickets/`. The existing inbox freezes the
same operation for execution. Each request body is limited to 16 MiB; a setup
may retain at most 64 MiB of request bodies across its selected purchases.
The original merchant's own request limit and schema continue to apply.

Open the complete local console URL printed by the command. In **Retained
input**, choose **Inspect retained request**. Multipart input shows its typed
fields and each file's name, field, content type, byte count and SHA-256. JSON
input shows the retained JSON values. An omitted body is displayed as absent.
This inspection reads the private inbox on demand; it does not put the request
contents in public discovery or periodic status responses.

**Download request body** saves the exact retained bytes, including multipart
boundaries. The original queue and request pins are checked before download;
the browser also verifies the downloaded length and SHA-256 against the selected
operation. The file is `request-body.bin`; the displayed content type identifies
how to interpret it. A shortened field preview never changes the saved bytes.

Use **Review operation**, then **Execute operation** and the original terminal
payment approval. The normal native buyer executes the original frozen request
once. Its response, recorded outcome and existing recovery controls remain in
the same commerce workspace. The input viewer itself neither signs nor pays.

## Stop and reopen the same operation

Stop the original session so admitted work and owned processes drain. Reopen
with the same console command and `/private/new-commerce/session` directory.
Request inspection reads the original inbox again; it does not recreate an
intent, copy a new budget or dispatch another purchase. Existing attempted or
cancelled intents keep their original state and recovery rules.

The original setup can also be inspected while stopped:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs inspect --directory /private/new-commerce
```

Direct selections remain supported. A POST, PUT or PATCH may use an original
private `bodyFile`, with ordinary `headers` when needed. A multipart body file
needs its matching `Content-Type` header and boundary. Omit `bodyFile` only when
the original offer permits an absent body. GET, HEAD and DELETE selections keep
their existing bodyless behavior. All forms use the same original admission,
request builder, byte limit and operator lifecycle.
