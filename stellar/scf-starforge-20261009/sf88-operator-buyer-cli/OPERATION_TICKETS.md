# Buy a merchant-issued POST operation

Use the original SF30 merchant operation ticket with the existing SF88 buyer.
The merchant issues the capability for the exact POST request; SF88 imports
its private file and sends the configured ordinary header through SF31.
SF81 terminal approval and SF36 reservation still govern any paid request.

## Move a complete request to the buyer's machine

In the running SF61 merchant workspace, issue the request and choose **Download
complete buyer request**. The one private JSON file contains the exact original
ticket envelope, opaque body bytes, ordinary headers and saved concrete offer.
It contains no merchant machine paths, operator profile or signer settings.
Transfer it through the merchant's existing authenticated customer channel.

On the buyer's Linux or macOS machine, use the matching current merchant release:

```sh
chmod 600 /private/merchant-operation.handoff.json
starforge buyer --import-operation \
  --file /private/merchant-operation.handoff.json \
  --dir /private/order-request --accept 0
starforge buyer --review --config /private/order-request/review.json
```

The directory must be new. Choose the actual zero-based payment option explicitly;
review prints its original asset, recipient, maximum amount and timeout. The
same stable merchant intent, URL/query, ticket header and exact body survive
import. Body bytes are never decoded or reserialized by this transfer, including
multipart boundaries or binary fields supplied by an applicable original producer.
The original merchant still determines which request formats it supports.

Import validates the original ticket envelope and expiry, original header rules,
saved source and selected terms before creating the private directory. It writes
`operation-ticket.json`, `request.body`, `offers.json`, `request.headers.json` and
the original `review.json`, all `0600` inside a `0700` directory. The ready review
is written after its inputs. Repeated import refuses an existing destination;
reopen the original config or workspace to continue that operation.

Continue with **Import into the existing private operator workspace** below,
using `/private/order-request/review.json` as its `--config`. Then enqueue the
resulting `operator.json`. For the original buyer runbook, create that operator
workspace under its configured private `configsDirectory`; choose **Refresh local
sources** and select its `operator.json`. The imported review itself has no trusted
operator configuration until the original workspace initializer supplies yours.

Node applications can use `buyer.fromOperationHandoff(file, {accept:0})`; Python
applications can use `buyer.from_operation_handoff(file, accept=0)`. Both call this
same native importer and retain their own ticket/body copies before removing
temporary files. Configure the buyer's own operator profile and review before
execution. Existing intents must be reopened with `buyer.operation(intent)`.

For the original headless issuer, export an already prepared request and its
exact saved discovery without opening the workspace:

```sh
starforge buyer --export-operation --config /private/order-review.json \
  --discovery /private/merchant-offers.json \
  --out /private/merchant-operation.handoff.json
```

Export requires the exact saved discovery used by preparation, the original
private ticket and body, and a new output in an existing private directory. The
packet is bounded at 4 MiB; the original body and discovery limits remain 1 MiB
each. File hashes detect changed transfer bytes; they are not authentication or
payment approval. The merchant's original HMAC/request verification and buyer's
original approval still happen in their existing execution paths. Keep the whole
packet private: it contains the ticket bearer, unlike the metadata printed by
import, export and review.

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

If the merchant forwards ordinary values such as language or region, use its
matching private headers file. For example, a request issued with these values
uses this exact JSON object in `/private/order-request-headers.json`:

```json
{"Content-Type":"application/json","Accept":"application/json","accept-language":"en-US","x-region":"eu"}
```

Keep that file `0600` at a canonical absolute path. The header values must be
those used by the issuer; choose the merchant's configured names and actual
values. The SF61 merchant workspace supplies this file beside its ticket, body,
concrete offer and already prepared review config.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --prepare \
  --discovery /private/merchant-offers.json --row 0 --accept 0 \
  --intent-id merchant-order-17 --url https://merchant.example/orders \
  --method POST --body-file /private/order-request-body.json \
  --headers-file /private/order-request-headers.json \
  --ticket-file /private/order-ticket.json \
  --out /private/order-review.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/order-review.json
```

Replace the URL and selection with the real saved offer. `--body-file` is the
HTTP body alone, not the merchant issuer's larger request-description envelope.
The source URL, query order, body and any merchant-forwarded ordinary headers
must match the issued request. The merchant computes the original request hash,
including its private backend mapping, and checks it during admission.
`--headers-file` copies ordinary values into the prepared operation. It does not
contain the ticket bearer. Duplicate header names, whitespace that the native
transport would trim, and reserved fields are rejected before creating the review
file. The existing `--content-type application/json` shortcut remains available;
if also supplied with a headers file, their content types must agree.

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
