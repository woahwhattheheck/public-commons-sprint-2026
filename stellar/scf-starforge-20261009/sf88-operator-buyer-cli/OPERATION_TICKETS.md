# Buy a merchant-issued POST operation

Use the original SF30 merchant operation ticket with the existing SF88 buyer.
The merchant issues the capability for the exact POST request; SF88 imports
its private file and sends the configured ordinary header through SF31.
SF81 terminal approval and SF36 reservation still govern any paid request.

## Prepare the request without copying a bearer into JSON or commands

Receive the merchant's ticket file through its existing authenticated customer
channel. The original issuer is
[`sf30-seller-sdk/upstream-operation.mjs`](../sf30-seller-sdk/upstream-operation.mjs),
documented in [the merchant operation guide](../sf30-seller-sdk/IDEMPOTENCY.md).
The buyer receives no merchant HMAC key and generates no operation ticket.

Keep the received ticket and actual JSON request body in the operator's
private directory. The ticket must be a regular, same-owner `0600` file at a
canonical absolute path, with no symlinks. It uses the original
`stellar-forge.upstream-operation-ticket.v1` envelope containing `ticket`,
`operationKey`, `requestHash` and an epoch-millisecond `expiresAt`.

From the complete checkout root, select the merchant's actual saved POST offer:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --prepare \
  --discovery /private/merchant-offers.json --row 0 --accept 0 \
  --intent-id merchant-order-17 --url https://merchant.example/orders \
  --method POST --body-file /private/order-request-body.json \
  --content-type application/json --ticket-file /private/order-ticket.json \
  --out /private/order-review.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/order-review.json
```

Replace the URL and selection with the real saved offer. `--body-file` is the
HTTP body alone, not the merchant issuer's larger request-description envelope.
The source URL, query order, body and any merchant-forwarded ordinary headers
must match the issued request. The merchant computes the original request hash,
including its private backend mapping, and checks it during admission.

The default ticket header is `x-merchant-operation`. If the merchant configured
another header, supply `--ticket-header` with that exact lowercase name. HTTP,
payment, authorization and `x-sf98-order-id` headers are reserved. The existing
`orderReference` / SF98 order identity remains a separate operation field.

An existing reviewed config may instead contain these fields inside its
original `operation` object:

```json
{
  "ticketFile": "/private/order-ticket.json",
  "ticketHeader": "x-merchant-operation"
}
```

These are file references, not a standalone operation or a place to paste the
bearer. Other operation fields retain the original config contract. Tickets
currently apply to POST, matching the original merchant idempotency binding.

Review prints ordinary headers, body bytes/hash and accepted payment terms,
plus ticket operation key, request hash, expiry, header name and file hash.
It never prints the bearer. Local parsing checks the original envelope and
expiry; the merchant verifies its private HMAC and exact request binding.

## Import into the existing private operator workspace

Use the normal initializer with the prepared review config and actual existing
testnet payer. The [buyer guide](README.md) covers SDK installation and signer
environment or provider setup.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --init-workspace \
  --config /private/order-review.json --dir /private/order-operator \
  --actor owner-operator --service merchant-orders \
  --payer ACTUAL_EXISTING_TESTNET_PUBLIC_ADDRESS --python /usr/bin/python3

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review-workspace --dir /private/order-operator
```

The initializer validates the ticket before creating a workspace, imports its
exact bytes into private `operation-ticket.json`, and points `operator.json`
at that copy. The source delivery file may then be archived using the owner's
normal process. No signer module needs to be hand-built.

Direct `--execute-workspace` uses that imported file. Missing, malformed,
nonprivate, expired or changed pinned queue tickets are rejected before the
buyer can send them or request payment approval. Valid ticket headers accompany
the original unsigned request and, only after original approval and signing,
the original paid retry. They never become `PAYMENT-SIGNATURE`.

If the ticket expires during terminal approval or wallet access, the existing
attempt records a pre-send expiry failure. The same ticket is checked before
the signer and again before SF31 receives its envelope; no paid request is sent.

## Queue, restart and inspect the exact operation

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  init --root /private/orders-inbox
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  enqueue --root /private/orders-inbox --config /private/order-operator/operator.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  show --root /private/orders-inbox --intent merchant-order-17
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  execute --root /private/orders-inbox --intent merchant-order-17 \
  --workspace /private/order-operator
```

Enqueue creates another private ticket copy bound to this job's exact file
hash, metadata and configured header. Its body, ticket and operation stay the
same after a process restart or a change to the source workspace template.
`show` and `list` remain offline and print only safe metadata. An expired ticket
is still inspectable; it cannot consume a new queue attempt. A modified
snapshot fails before the attempt marker, and a different ticket cannot
replace an existing intent through a repeated enqueue.

After an attempt, preserve the original intent, private queue state, SF36
ledger and SF82 outcome. Use the existing [inbox recovery](QUEUE.md) and the
merchant's operation-status command to reconcile the same operation key.
The merchant's backend idempotency prevents a second backend mutation for
that identity; it does not authorize another paid retry. Ticket expiry does
not erase history, create a new intent, or turn a prior attempt into a new one.

Public source contains only implementation and instructions. Tickets, request
bodies, operator state and received output stay in the private workspace and
inbox. CLI output, queue metadata and checkout summaries contain no bearer.
