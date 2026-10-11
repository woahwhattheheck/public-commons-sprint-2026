# Tenderly saved simulation merchant

Run a saved Tenderly transaction simulation as a Stellar x402 product. The
merchant fixes its Tenderly account, project, EVM network, simulation type and
Stellar payment terms. Each customer request names the exact EVM block,
transaction position, sender, recipient, calldata, gas limit and value. The
merchant supplies its private provider credential and retains the original
provider response under one durable operation identity.

The product composes the existing SF30 merchant, upstream transport, SQLite
operation ledger, developer exporter and operations console. Customer purchase
and recovery use the existing SF88 Node and Python buyers. The browser workspace
and this command line open the same prepared package and operation state.

## Provider contract

The source is Tenderly's [single simulation REST API](https://docs.tenderly.co/simulations/single-simulations).
The configured endpoint is:

```text
POST https://api.tenderly.co/api/v1/account/{account}/project/{project}/simulate
X-Access-Key: value from the plan's server environment reference
```

The public request contains exactly these fields:

| Field | Meaning and validation |
| --- | --- |
| `block_number` | Explicit nonnegative safe integer. |
| `transaction_index` | Explicit nonnegative safe integer within the selected block. |
| `from`, `to` | Complete 20-byte hexadecimal EVM addresses. |
| `input` | Complete hexadecimal bytes, bounded by the plan. |
| `gas` | Positive integer up to the merchant's configured maximum. |
| `value` | Exact unsigned 256-bit decimal string. |

Tenderly defines transaction index `0` as the beginning of that block. An index
between `1` and the transaction count applies the earlier transactions first;
the actual transaction count selects the block's post-state. An index larger
than that count fails. This product requires both fields so a request cannot
silently select a changing head or an omitted transaction position.

The server adds `network_id`, `simulation_type`, `gas_price: 0`, `save: true`
and `save_if_fails: true`. Its fixed route supplies the account and project.
Public input cannot replace the provider URL, credential, network or save
settings. The supported simulation modes are `quick`, `abi` and `full`; see
Tenderly's [mode documentation](https://docs.tenderly.co/simulations/simulation-modes)
for the returned trace detail.

A successful HTTP response contains the original `simulation` and `transaction`
objects. Both EVM success and EVM revert (`status: false`) are useful completed
simulation outcomes. The response must match the pinned network, block,
transaction position, transaction fields and gas limit. A provider failure or
mismatched result follows the original merchant failure and cancellation path.

Tenderly explains that each
[simulation request consumes simulation usage](https://docs.tenderly.co/troubleshooting/simulations),
including repeated identical requests. The original durable operation ledger
therefore controls dispatch and recovery; the outgoing `idempotency-key` header
does not substitute for a provider guarantee.

## Prepare the merchant

Use the complete source tree and its existing native runtime dependencies.
Node 22.16+ or Node 24 provides the SQLite runtime used by this integration.
Run the commands below from this directory. Create a private parent once:

```sh
install -d -m 700 /srv/private/tenderly
node cli.mjs template --out /srv/private/tenderly/plan.json
```

Edit the plan with the actual public merchant origin, Tenderly account and
project, selected EVM network, and original Stellar payment terms. The example
plan uses Ethereum network `1` and Stellar testnet payment terms; those are
independent networks with different roles. Replace its asset and recipient
placeholders before native launch. Amounts remain exact atomic-unit strings.

The plan stores credential **environment names**. Keep the actual Tenderly
access key and the merchant's persistent 32-byte hexadecimal operation key in
the existing private runtime environment. Keep that operation key for restarts
and renewals of the same operation. The saved plan and its generated artifacts
contain the public offer and environment references.

```sh
node cli.mjs inspect --plan /srv/private/tenderly/plan.json

node cli.mjs prepare \
  --plan /srv/private/tenderly/plan.json \
  --out /srv/private/tenderly/merchant
```

Inspection and preparation run offline. Preparation compiles the original
merchant offer and developer contract, then retains:

| Artifact | Purpose |
| --- | --- |
| `plan.json`, `review.json` | Normalized saved plan, public offer review and plan digest. |
| `seller-service.json`, `upstreams.json` | Original merchant and fixed provider configuration. |
| `openapi.json` | Original developer document with the exact public input schema. |
| `client/` | Original generated JavaScript client, declarations, source OpenAPI, package metadata and completion receipt. |
| `request.example.json` | A complete example public request. |
| `prepared.json` | Exact saved file sizes and digests. |
| `operations/` | Private operation state shared by the application, console and reopen commands. |

An interrupted preparation leaves `INCOMPLETE`. Run the same prepare command
with the same plan and output to finish missing files. The product compares all
retained bytes before adding files, uses the original client exporter and
retained-export recovery, and preserves existing operation data. A changed
plan uses a new prepared directory. A complete package reopens without writes.

## Start the original merchant

Load the two environment values named by the saved plan into the existing
merchant process, then select the actual native facilitator:

```sh
node cli.mjs serve \
  --prepared /srv/private/tenderly/merchant \
  --facilitator https://YOUR_EXISTING_FACILITATOR \
  --port 8423 --operations-port 8424
```

Startup prints the seller URL, current native mode and the original private
operation-control URL. Both listeners bind to `127.0.0.1`. Use the existing
trusted reverse proxy for the plan's public HTTPS merchant origin. Keep the
operator console in the private operator environment.

The native merchant uses authorization flow: obtain and validate the provider
result before original settlement. A successful native settlement also goes
through the original SF98 delivery outbox. Usage history and availability state
remain in the package's operation directory. Omitting the facilitator starts
the original challenge-only merchant for local catalog and configuration work.

`SIGINT` or `SIGTERM` drains the original seller, closes the console, and then
closes the same upstream operation store. Accepted in-flight work retains its
original completion ownership. `--drain-grace-ms` selects the original bounded
listener drain period; a forced listener shutdown still allows the application
cleanup to wait for the original work to retire.

The [browser workspace](WORKSPACE.md) provides saved profiles, preparation,
ticket issue, startup, results and recovery. When the browser prepares a
profile, use its reported package directory with this CLI's `--prepared`
option. That keeps command-line work on the same ledger as the browser.

## Issue a customer request and purchase it

Start with the prepared example or another exact JSON request. Save the public
body in a private file, then issue the original merchant ticket:

```sh
node cli.mjs issue \
  --prepared /srv/private/tenderly/merchant \
  --body /srv/private/tenderly/request.json \
  --id simulation-001 --subject customer-001 \
  --expires YOUR_FUTURE_ISO_TIME \
  --out /srv/private/tenderly/ticket.json

node cli.mjs buyer-prepare \
  --prepared /srv/private/tenderly/merchant \
  --body /srv/private/tenderly/request.json \
  --ticket /srv/private/tenderly/ticket.json \
  --intent tenderly-purchase-001 \
  --out /srv/private/tenderly/buyer.json \
  --response-out /srv/private/tenderly/buyer-response.json
```

Choose an expiry inside the plan's `maxTicketSeconds`. Ticket issue is local:
the server composes the provider projection, lets the original issuer bind its
hash, and retains the matching public request. It writes the original private
five-field ticket envelope. The printed result contains the operation key,
request hash and expiry. The public body is then pinned byte-for-byte in the
original buyer config; its outgoing request carries the original ticket.

The merchant operation ID and subject stay stable for that provider operation.
Reusing them with different request content fails. Renewing the same request
can use a new ticket expiry while retaining the same operation identity. The
buyer also keeps its stable native intent for review, purchase and recovery.

Follow [CUSTOMER.md](CUSTOMER.md) for the executable Node and Python import,
review, execute and reopen commands. The prepared config carries the exact
merchant offer, public request bytes, ticket and request deadline. The deadline
includes the configured Tenderly call and original operation wait. The buyer's
retained response keeps its original payment and delivery record alongside
the simulation payload.

## Reopen and reconcile retained operations

List and inspect the original operation records:

```sh
node cli.mjs list --prepared /srv/private/tenderly/merchant --limit 25

node cli.mjs status --prepared /srv/private/tenderly/merchant \
  --operation-key OPERATION_SHA256

node cli.mjs audit --prepared /srv/private/tenderly/merchant \
  --operation-key OPERATION_SHA256 --after 0 --limit 25

node cli.mjs result --prepared /srv/private/tenderly/merchant \
  --operation-key OPERATION_SHA256 \
  --out /srv/private/tenderly/reopened-response.json \
  --response-out /srv/private/tenderly/response-envelope.json
```

`list` and `audit` expose the original cursors for further pages. `result`
reads a completed original row, checks its retained bytes and request binding,
and writes those exact bytes to the selected new file. This private read works
after ticket expiry and across process restarts. It makes no provider call.
Its optional response envelope preserves HTTP status, allowed headers and
the raw body as base64 for the original recovery interface.

| Original state | Operator action |
| --- | --- |
| `IN_FLIGHT` | Let the owning original request complete; a dead original owner can be reconciled through the existing recovery rule. |
| `COMPLETE` | Reopen the retained response and its original record. |
| `UNCERTAIN` | Inspect the saved Tenderly operation and recover its actual response, or explicitly permit another attempt after resolving the provider outcome. |
| `RETRY_READY` | A subsequent authorized request may claim a new original dispatch. |

For a known saved provider result, retain the original response bytes and use
the current record's exact generation and request hash:

```sh
node cli.mjs recover --prepared /srv/private/tenderly/merchant \
  --operation-key OPERATION_SHA256 --generation CURRENT_GENERATION \
  --request-hash REQUEST_SHA256 --action complete \
  --reference TENDERLY_SIMULATION_ID_OR_BACKEND_REFERENCE \
  --response /srv/private/tenderly/response-envelope.json
```

The original recovery parser accepts `{status, headers, bodyBase64}` or
`{status, headers, body}`. A successful simulation response must match this
operation's saved public request. Original generation checks protect a newer
outcome from an earlier operator view. Recovery retains the provider reference
in the original audit history. An explicit `--action retry` uses the same
generation, request hash and reference, with the response option omitted.

## Source acceptance

One integrated journey on Node 24.19.0 exercised the original workspace,
merchant listener, ticket issuer, SQLite operation controller and nativeFactory
acceptance seam with a local provider returning documented Tenderly response
shapes. It covered interrupted preparation and same-directory completion,
workspace authentication and assets, mixed-case EVM input, exact request and
result retention, uncertain response delivery, generation-guarded recovery of
a saved revert, operation pagination, and byte-exact reopening after restart.
The complete journey made two local provider dispatches. The original Node
and Python buyers imported and reviewed the same saved customer configuration
and reopened their existing operation state. Provider and native payment
fixtures were explicit parts of this source acceptance run.

## Application interfaces

`product.mjs` owns `templatePlan`, `inspectPlan`, `providerRequest`,
`sellerConfig`, `upstreamBindings`, `describeResult`, `prepareProduct` and
`readPreparedProduct`. Its review returns the normalized plan, plan SHA-256,
route, provider reference, payment terms, limits and required environment
names. `describeResult` returns the simulation ID, network, block, transaction
position, success/revert state and gas used while preserving the raw response.

`createTenderlyApplication({plan, stateDirectory, env})` returns the original
composed `config`, `handlers`, `operationControl`, `operations`, `review`,
`snapshot()` and `close()`. The operation API is:

```js
await app.operations.issue({ body, id, subject, expiresAt });
await app.operations.list({ state, cursor, limit });
await app.operations.inspect(operationKey);
await app.operations.audit(operationKey, { after, limit });
await app.operations.request(operationKey);
await app.operations.response(operationKey); // { status, headers, body: Buffer }
await app.operations.recover({ operationKey, expectedGeneration,
  requestHash, action, reference, response });
```

`startTenderlyMerchant` accepts the same plan and state, plus the original
listener, facilitator, history, availability and delivery options. It returns
`{seller, operations, application, outbox, url, mode, close}`. Native embedding
may supply the existing `nativeFactory` instead of a facilitator URL. The
explicit `allowLoopbackUpstream` and `upstreamOrigin` development options let
the complete original merchant exercise a local provider endpoint without
changing the saved production plan. The provider override is restricted to
`http://127.0.0.1` and is never accepted from a customer request.

The only shared-engine addition is a read-only `response(operationKey)` on
the existing durable store and bound handler. It decodes an original completed
row with the same size, header and digest checks and applies the original
configured response contract. The original issuer, dispatch, payment,
generation recovery and private SQLite storage remain the execution path.
