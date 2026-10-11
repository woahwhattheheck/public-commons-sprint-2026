# Tenderly customer handoff

Receive a merchant's saved simulation request, buy through the original SF88
customer, retain the result, and open it in the analysis workspace. The merchant
chooses the EVM network and simulation type; its public request contains
`block_number`, `transaction_index`, `from`, `to`, `input`, `gas`, and exact
decimal `value`. Stellar payment terms come from the merchant's original offer.

Run the examples below from `partners/tenderly-stellar-pilot/` in a complete
source installation. Use absolute paths for the private inputs, operator
profile, application state, and exports. Node uses the adjacent original SF88
runtime; Python also needs its original buyer package. Choose Node or Python
for an actual intent, then continue using that application's state directory.
Their native application-state formats are separate.

## 1. Receive the merchant's request

Obtain the merchant's saved `plan.json` and its private workspace request packet.
The original customer helper checks the plan, selected offer, request, and
operation ticket, and retains a resumable import:

```js
import { readFile } from 'node:fs/promises';
import { prepareWorkspaceRequest, prepareBuyer, readBuyerPreparation } from './customer.mjs';

const plan = JSON.parse(await readFile('/srv/private/tenderly/plan.json', 'utf8'));
const prepared = await prepareWorkspaceRequest({
  plan,
  packetFile: '/srv/private/tenderly/incoming/workspace-request.json',
  intentId: 'tenderly-customer-001',
  out: '/srv/private/tenderly/input',
  responseOut: '/srv/private/tenderly/input/provider-response.json',
});
console.log(prepared.configPath); // /srv/private/tenderly/input/buyer.json
console.log(await readBuyerPreparation({ configFile: prepared.configPath }));
```

If the merchant supplied separate request and ticket files, use the same
`prepareBuyer` helper from `../customer.mjs` instead:

```js
const prepared = await prepareBuyer({
  plan,
  bodyFile: '/srv/private/tenderly/simulation.json',
  ticketFile: '/srv/private/tenderly/merchant-ticket.json',
  intentId: 'tenderly-customer-001',
  out: '/srv/private/tenderly/buyer.json',
});
```

Import `prepared.configPath` in the following steps. The packet helper retains
its original plan, packet, public body, ticket, configuration, and import
manifest together. Calling it again with the same input resumes that import.
The original merchant ticket continues to identify the same operation.

Create a public customer selection from the same plan, outside the retained
packet-import directory:

```sh
node customer/cli.mjs selection \
  --plan /srv/private/tenderly/plan.json \
  --out /srv/private/tenderly/selection.json
```

The selection contains the HTTP resource, method, EVM network, simulation type,
plan hash, and response limit. Provider credentials and account details remain
in the merchant configuration. The customer checks the selected resource and
execution context against the imported request.

## 2. Review and purchase with Node

The application API accepts either the public selection object or its filename:

```js
import { TenderlyCustomer } from './customer/client.mjs';
import { createSelection } from './customer/selection.mjs';

const selection = createSelection(plan);
const customer = new TenderlyCustomer({
  runtimeDirectory: '/srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/tenderly-node',
  operatorProfile: '/srv/private/operator-profile.json',
  maxResultBytes: selection.maxResponseBytes,
});
const operation = await customer.fromConfig(prepared.configPath, { selection });
const review = await operation.review();
console.log(review);
```

Review the selected EVM block, transaction position, addresses, calldata, gas,
value, and original Stellar payment terms. Execute that same reviewed operation:

```js
const result = await operation.execute({ review });
console.log(await result.summary());
await result.export('/srv/private/tenderly/exports/customer-001');
const capture = await result.analyze({
  workspace: '/srv/private/tenderly-analysis',
  label: 'Customer 001',
});
console.log(capture.id, capture.analysisPath);
```

The CLI exposes the same workflow. The local operator profile is retained during
import; subsequent commands reopen the original customer state.

```sh
TENDERLY_RUNTIME=/srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli
TENDERLY_STATE=/srv/private/tenderly-node

node customer/cli.mjs import --runtime "$TENDERLY_RUNTIME" --state "$TENDERLY_STATE" \
  --profile /srv/private/operator-profile.json \
  --config /srv/private/tenderly/input/buyer.json \
  --selection /srv/private/tenderly/selection.json

node customer/cli.mjs review --runtime "$TENDERLY_RUNTIME" --state "$TENDERLY_STATE" --intent tenderly-customer-001
node customer/cli.mjs execute --runtime "$TENDERLY_RUNTIME" --state "$TENDERLY_STATE" --intent tenderly-customer-001
```

For an original SF88 operation handoff, replace `--config` with
`--handoff /absolute/handoff.json --accept 0`, keeping the same public selection.

## 3. Reopen and export the completed result

Use the original intent and application state after a restart:

```js
const operation = customer.operation('tenderly-customer-001');
console.log(await operation.inspect());
const saved = await operation.recover();
if (saved) {
  console.log(await saved.summary());
  await saved.export('/srv/private/tenderly/exports/customer-001-reopened');
}
```

`recover()` reads the original retained attempt and result. A completed saved
result opens without another simulation or purchase. If the original attempt
is still unresolved, retain that intent and use its existing merchant/operator
reconciliation. `customer.list()` is an async iterator over retained customer
operations.

A `false` simulation status is a completed EVM revert, with its original error,
trace, gas, and state details. The original buyer record separately describes
purchase and delivery. Both successful execution and reverts can be retained
and analyzed.

Choose a new directory for each immutable export. The bundle includes:

| File | Purpose |
| --- | --- |
| `response.json` | Exact original provider response bytes. |
| `request.body` | Exact public request bytes sent by the customer. |
| `request.json` | Customer request, selection, and native-operation binding. |
| `simulation-request.json` | EVM network plus the public request fields, for analysis. |
| `buyer-result.json` | Original native buyer result record. |
| `buyer-evidence.json`, when available | Original saved native receipt and outcome record. |
| `manifest.json` | File identities and the simulation/customer association. |

The source preparation's configuration hash identifies the original input
configuration. SF88 imports that configuration into customer-owned paths and
records a separate native configuration hash. Both identities remain associated;
the request and ticket bytes retain their original identities. Tenderly
simulation ID, EVM transaction hash, and Stellar settlement records also retain
their distinct meanings.

Open the portable bundle independently of the buyer runtime:

```js
import { openExport } from './customer/client.mjs';
const opened = await openExport('/srv/private/tenderly/exports/customer-001');
console.log(opened.simulation);
```

`openExport` verifies the bundle and returns `manifest`, `request`, `record`,
`envelope`, `simulation`, `evidence`, and `analysisRequest`.

CLI equivalents are `status` or `recover` with the original
`--runtime --state --intent`; `export` adds `--out NEW_DIRECTORY`.
`open-export --directory EXPORT_DIRECTORY` opens a portable bundle.

## 4. Python customer

For a source checkout, expose both Python packages. The `checkout` argument
locates the original native runtime; it is separate from Python's import path.

```sh
export PYTHONPATH="$PWD/customer/python:$PWD/../../sf88-operator-buyer-cli/python"
```

```python
import json
from pathlib import Path
from stellar_forge_tenderly import (
    TenderlyCustomer, TenderlySimulationRequest, TenderlyResult,
)

selection = json.loads(Path('/srv/private/tenderly/selection.json').read_text())
body = Path('/srv/private/tenderly/input/simulation.json').read_bytes()
request = TenderlySimulationRequest.from_bytes(
    body, network_id=selection['networkId'],
)
customer = TenderlyCustomer(
    checkout='/srv/starforge/source',
    state_dir='/srv/private/tenderly-python',
)
operation = customer.from_config(
    '/srv/private/tenderly/input/buyer.json',
    request=request,
    request_body=body,
    selection=selection,
)
operation.configure(operator_profile=json.loads(
    Path('/srv/private/operator-profile.json').read_text()
))
review = operation.review()
print(review)
# Execute after reviewing this original request and its selected terms.
result = operation.execute(review=review)
print(result.describe())
result.export('/srv/private/tenderly/exports/python-customer-001')
```

On a later run, reopen the same customer and call
`customer.operation('tenderly-customer-001').recover()`. Use
`TenderlyResult.open_export('/absolute/export-directory')` for a fully offline
portable read. The result exposes `response_bytes`, `envelope`,
`simulation_id`, `evm_transaction_hash`, and `stellar_payment`.

## 5. Inspect, compare, and review

Node's `result.analyze({workspace, label})` passes its original BuyerResult and
derived simulation request directly to the original analysis library. The CLI
equivalent is:

```sh
node customer/cli.mjs analyze --runtime "$TENDERLY_RUNTIME" --state "$TENDERLY_STATE" \
  --intent tenderly-customer-001 --workspace /srv/private/tenderly-analysis --label "Customer 001"
```

A portable Node or Python export can enter the same analysis workspace:

```sh
node ../../sf88-operator-buyer-cli/tenderly-analysis/cli.mjs receive \
  --workspace /srv/private/tenderly-analysis \
  --response /srv/private/tenderly/exports/customer-001/response.json \
  --request /srv/private/tenderly/exports/customer-001/simulation-request.json \
  --buyer-result /srv/private/tenderly/exports/customer-001/buyer-result.json \
  --label "Customer 001"

node ../../sf88-operator-buyer-cli/tenderly-analysis/cli.mjs serve \
  --workspace /srv/private/tenderly-analysis --port 8468
```

Open the printed local URL. The workspace retains exact result identities and
source pointers while inspecting calls, gas, logs, assets, and state changes.
Compare saved captures, add a review, export it, and reopen the same workspace.
The [analysis guide](../../../sf88-operator-buyer-cli/tenderly-analysis/README.md)
covers the complete browser and CLI workflow.

Provider semantics follow Tenderly's [single-simulation contract](https://docs.tenderly.co/simulations/single-simulations)
and [saved full-result API](https://docs.tenderly.co/api-reference/simulator/get-full-simulated-transaction-details).

