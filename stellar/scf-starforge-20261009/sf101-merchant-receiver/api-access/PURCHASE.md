# Purchase and use an API allowance

This customer application joins an original SF101 paid-file handoff to the
existing SF88 Buyer/Inbox and the purchased API client. A retained private
directory identifies one purchase, its original buyer workspace and inbox, the
merchant's exact handoff, and the explicitly selected API gateway.

The merchant sells the [API plan](README.md) through the existing
[SF101 checkout](../CHECKOUT.md), attaches that exact enrolled file with
`api-pass attach`, and delivers its original SF98 settlement notice. The buyer's
claim token is supplied separately through the selected environment variable.
The gateway checks the original order, file, entitlement and current access
policy on every online operation.

## Set up the original buyer

Use the [SF88 operator workspace](../../sf88-operator-buyer-cli/node/WORKSPACE.md)
for the customer's signer, payer, terms and allocation. Keep the existing
operator directory and its private keys together. The original workspace
configuration remains the authority for payment approval, transport and ledger.

This application requires Node and Python 3.11 or later from the complete
Stellar Forge distribution. Its Python executable is selected by
`STARFORGE_PYTHON` or the explicit `--python` argument. Its HTTP client uses the
system trust store. An API gateway may be a public HTTPS origin or an explicitly
selected loopback HTTP origin for a local deployment.

The examples below use private paths selected by the operator. Their parent
directories must exist. Substitute the real merchant handoff, gateway and
original operator paths.

```sh
node sf101-merchant-receiver/api-access/purchase-cli.mjs prepare \
  --directory /private/api-customer \
  --handoff /private/received/api-pass-handoff.json \
  --workspace /private/original-operator \
  --inbox /private/customer-inbox \
  --buyer-state /private/node-buyer \
  --intent customer-api-pass-001 \
  --gateway https://api.example.com \
  --claim-env CUSTOMER_API_CLAIM
```

Preparation retains the exact handoff bytes and an immutable purchase
configuration. It imports that request through `Buyer.fromWorkspace` and
enqueues it into the original Inbox. The native routing marker, attempt record,
review and financial evidence remain in those existing products.

The directory is created exclusively. Reopen the same directory after a
reported preparation interruption. `review` resumes a completed original
preparation and the identical inbox intake. An incomplete original native
preparation reports its existing error and location through the original Buyer.

## Review, purchase and reopen

```sh
node sf101-merchant-receiver/api-access/purchase-cli.mjs review \
  --directory /private/api-customer

node sf101-merchant-receiver/api-access/purchase-cli.mjs buy \
  --directory /private/api-customer
```

`buy` obtains a fresh original review and invokes the native Inbox execution.
The original controlling terminal approval displays the selected payment.
The workspace's signer, shared ledger, allocation and attempt protection remain
active. Repeated execution follows the native Inbox's existing attempt rules.

After an interrupted purchase, inspect and recover the same intent:

```sh
node sf101-merchant-receiver/api-access/purchase-cli.mjs recover-purchase \
  --directory /private/api-customer

node sf101-merchant-receiver/api-access/purchase-cli.mjs purchase-response \
  --directory /private/api-customer \
  --out /private/downloads/original-purchase-response.json
```

Recovery reads the retained native outcome. The download uses the original
verified response reader. The purchase response, original settlement evidence
and later API result are separate objects with their own identities.

The local merchant/operator can join its actual sender outbox to financial
finalization:

```sh
node sf101-merchant-receiver/api-access/purchase-cli.mjs finalize \
  --directory /private/api-customer \
  --merchant-outbox /private/original-merchant-outbox

node sf101-merchant-receiver/api-access/purchase-cli.mjs history \
  --directory /private/api-customer \
  --out /private/downloads/customer-history.html
```

The outbox argument is optional for a buyer with only its own workspace. When
provided, the handoff's original merchant route is selected automatically.
The command returns the original SF86/SF36 finalization classification.
The history export covers the original selected customer inbox.

## Use the purchased plan

Supply `CUSTOMER_API_CLAIM` through the customer's existing private environment.
The claim is passed only to the maintained API client. It is kept out of the
native payment request and customer manifest.

```sh
node sf101-merchant-receiver/api-access/purchase-cli.mjs inspect \
  --directory /private/api-customer

node sf101-merchant-receiver/api-access/purchase-cli.mjs call \
  --directory /private/api-customer \
  --route analyze --request-id analysis-original-001 \
  --method POST --content-type application/json \
  --body /private/input/analysis.json \
  --out /private/results/analysis.json
```

Choose the route ID and method actually offered by the purchased plan. Query
parameters are explicit repeated `--query NAME VALUE` pairs. Before each API
operation, the client checks that the current enrolled manifest matches the
original purchased file's SHA-256.

The original Python client sends the stable request ID and verifies the returned
response digest before exclusive private file publication. HTTP 200–599
application responses retain their actual status and consume the plan's units
under the original gateway rules; an HTTP error can therefore be a completed,
downloadable application result.

```sh
node sf101-merchant-receiver/api-access/purchase-cli.mjs calls \
  --directory /private/api-customer --limit 100

node sf101-merchant-receiver/api-access/purchase-cli.mjs recover-call \
  --directory /private/api-customer \
  --request-id analysis-original-001 \
  --out /private/results/analysis-recovered.json
```

`calls` preserves the original page result and accepts its `after` cursor.
`recover-call` uses the original saved-result endpoint. A pending or uncertain
operation returns the current gateway state; the original merchant operator can
resolve it using the retained application outcome. Use a new output filename
when downloading again. Existing files are preserved.

## Embed in a Node application

```js
import { Buyer } from './sf88-operator-buyer-cli/node/index.mjs';
import { createApiAccessPurchase, openApiAccessPurchase }
  from './sf101-merchant-receiver/api-access/purchase.mjs';

const buyer = new Buyer({
  runtimeDirectory: '/srv/forge/sf88-operator-buyer-cli',
  stateDirectory: '/private/node-buyer',
});

const customer = await createApiAccessPurchase({
  directory: '/private/api-customer',
  buyer,
  workspaceDirectory: '/private/original-operator',
  inboxDirectory: '/private/customer-inbox',
  handoffFile: '/private/received/api-pass-handoff.json',
  intentId: 'customer-api-pass-001',
  gatewayBaseUrl: 'https://api.example.com',
  claimEnv: 'CUSTOMER_API_CLAIM',
});
const review = await customer.review();
const nativePurchase = await customer.execute({ review });
// Native outcome and later finalization remain directly available.
const finalization = await customer.finalize();

const allowance = await customer.api.inspect();
const result = await customer.api.call({
  route: 'analyze', requestId: 'analysis-original-001',
  method: 'POST', bodyFile: '/private/input/analysis.json',
  contentType: 'application/json', output: '/private/results/analysis.json',
});
console.log(result.status, result.metadata.units, await result.json());

const reopened = await openApiAccessPurchase({
  directory: '/private/api-customer', buyer,
});
const recovered = await reopened.api.recover('analysis-original-001', {
  output: '/private/results/recovered.json',
});
console.log(recovered.metadata.sha256, await recovered.json());
```

`ApiAccessResult` extends the original `VerifiedFile`, so `bytes`, `json`,
`csvRows`, `chunks`, `verify` and exclusive `saveAs` use the shared checked
file reader. Its metadata is the API response metadata; its `ok` getter
indicates an HTTP 2xx application response. The original purchase and
finalization objects remain available on `ApiAccessPurchase`.

An existing pass may be consumed without creating another purchase by
constructing `ApiAccessClient` with the known gateway, original order reference,
original manifest digest and claim environment name. It uses the same
inspection, call and recovery methods.

Pass an `AbortSignal` to the native methods or API operations. API cancellation
stops its own Python child and preserves the original stable request ID for
recovery. The gateway retains its actual execution state and any completed
response. Native payment cancellation and reconciliation remain with the
original Buyer/Inbox.

The private customer manifest stores path and input bindings, with its claim
environment variable's name. Preserve this directory alongside the original
buyer, operator and inbox roots when using the existing workspace backup and
restore workflow.
