# Buy, reopen, and analyze a Tenderly simulation

The customer starts with the plan and private request packet downloaded from the
merchant workspace. The packet importer prepares the existing SF88 buyer
configuration. The authored Node and Python customer clients then own import,
review, execution, recovery, and export. The analysis connection consumes the
original saved response together with its EVM request context and native buyer
record.

Use the complete matching source distribution. Run the commands below from
`stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/`.

## Import the merchant's workspace download

Download `plan.json` and the selected `tenderly-request.json` from the same saved
merchant profile. Store them in a private directory and make the request file
readable only by its owner (`0600`). The request contains the merchant's issued
operation capability; its original expiry applies.

```sh
node examples/buy-node.mjs prepare \
  --plan /srv/private/incoming/plan.json \
  --packet /srv/private/incoming/tenderly-request.json \
  --intent tenderly-customer-001 \
  --out /srv/private/tenderly-inputs
```

The importer compares the packet's profile and plan hash with the normalized
merchant plan, checks its merchant route and payment terms, and validates the
seven public simulation fields through the provider product contract. It
retains the original downloaded packet, the normalized public plan, the public
simulation body, and the original five-field operation-ticket envelope. It
then calls the existing saved-offer preparation path to create `buyer.json`.

The returned preparation includes the exact body and config hashes, network
selection, block and transaction position, accepted payment terms, merchant
ticket metadata, and request deadline. The provider access key stays in the
merchant environment.

Run the same preparation command with the same files, intent, and destination
to reopen a completed import or resume its interrupted file publication. The
import checks retained files before continuing and publishes `prepared.json`
last. Keep buyer application state in the separate directory shown below.
Changing the merchant packet, plan, intent, or explicit output choices creates
a different customer preparation and needs a new input directory.

The directory contains:

| File | Purpose |
| --- | --- |
| `workspace-request.json` | Exact private workspace download. |
| `plan.json` | Reviewed normalized merchant plan. |
| `simulation.json` | Public request sent by the existing buyer. |
| `merchant-ticket.json` | Original merchant capability envelope. |
| `buyer.json` | Original native SF88 configuration and saved offer. |
| `import.json` | Packet, plan, intent, and output selection. |
| `prepared.json` | Completed input/config file bindings. |

The provider projection adds the fixed network, simulation type, and save flags
on the merchant side. The public request retains `block_number`,
`transaction_index`, `from`, `to`, `input`, `gas`, and the exact decimal string
`value`. Its body hash is carried into the native buyer configuration. The
request deadline follows the merchant configuration, including its operation
wait. An optional `--response-out` passes a chosen destination and the merchant's
response size limit into the original native config.

### Preparing from individual original files

An application with the original plan, exact request file, and issued ticket
can use the same preparation helper directly:

```js
import { prepareBuyer, prepareWorkspaceRequest } from './customer.mjs';

const prepared = await prepareBuyer({
  plan,
  bodyFile: '/srv/private/incoming/simulation.json',
  ticketFile: '/srv/private/incoming/merchant-ticket.json',
  intentId: 'tenderly-customer-001',
  out: '/srv/private/tenderly-buyer.json',
});

// Or import the exact workspace download on this customer machine.
const downloaded = await prepareWorkspaceRequest({
  plan,
  packetFile: '/srv/private/incoming/tenderly-request.json',
  intentId: 'tenderly-customer-002',
  out: '/srv/private/tenderly-inputs-002',
});
```

Both return a flat preparation object whose `configPath` identifies the native
buyer configuration. `readBuyerPreparation({configFile})` reopens its original
configuration, pinned body, and ticket references for metadata inspection.

## Node customer

Create the customer's selection from the same saved plan. The original
selection binds its merchant resource, EVM network, simulation type, plan hash,
and response limit.

```sh
node examples/buy-node.mjs selection \
  --plan /srv/private/tenderly-inputs/plan.json \
  --out /srv/private/tenderly-selection.json

node examples/buy-node.mjs import \
  --state /srv/private/tenderly-node \
  --config /srv/private/tenderly-inputs/buyer.json \
  --selection /srv/private/tenderly-selection.json \
  --profile /srv/private/operator-profile.json

node examples/buy-node.mjs review \
  --state /srv/private/tenderly-node --intent tenderly-customer-001

node examples/buy-node.mjs execute \
  --state /srv/private/tenderly-node --intent tenderly-customer-001

node examples/buy-node.mjs recover \
  --state /srv/private/tenderly-node --intent tenderly-customer-001
```

The example delegates these commands to `customer/cli.mjs`. It selects the
adjacent original SF88 runtime by default; `--runtime` selects another complete
matching installation. Import copies the retained request and merchant ticket
into private buyer state. The existing operator profile supplies the signer,
transport, and operator configuration. Execution enters the original native
purchase workflow and its current review.

The direct application API is the authored customer wrapper:

```js
import { TenderlyCustomer } from './customer/client.mjs';
import { analyzeResult } from './examples/buy-node.mjs';

const customer = new TenderlyCustomer({
  runtimeDirectory: '/srv/forge/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/tenderly-node',
});
const operation = customer.operation('tenderly-customer-001');
const result = await operation.recover();
if (result) {
  const response = await result.json();
  console.log(await result.summary());
  const analysis = await analyzeResult(result, {
    workspace: '/srv/private/tenderly-analysis',
    label: 'Customer simulation',
  });
  console.log(analysis);
  // response contains the complete original simulation and transaction objects.
}
```

Use `status` to inspect one retained intent and `list` to enumerate customer
operations. If recovery has no retained result, keep its original operation
directory and use that intent's native recovery information. Its saved attempt
record is the authority for resuming work after a timeout or process loss.

## Python customer

`examples/buy-python.py` loads the authored `stellar_forge_tenderly` package and
the matching original `stellar_forge_buyer` package from the distribution. It
delegates to the package's existing CLI. `--checkout` selects the matching
repository root; the default is the complete adjacent release.

Use the network ID and limits printed by the saved merchant preparation. The
example below uses network `1` and a one-megabyte response limit:

```sh
python3 examples/buy-python.py prepare \
  --state-dir /srv/private/tenderly-python \
  --config /srv/private/tenderly-inputs/buyer.json \
  --request /srv/private/tenderly-inputs/simulation.json \
  --network-id 1 \
  --profile /srv/private/operator-profile.json \
  --max-response-bytes 1048576

python3 examples/buy-python.py review \
  --state-dir /srv/private/tenderly-python --intent tenderly-customer-001

python3 examples/buy-python.py execute \
  --state-dir /srv/private/tenderly-python --intent tenderly-customer-001

python3 examples/buy-python.py recover \
  --state-dir /srv/private/tenderly-python --intent tenderly-customer-001
```

The Python `execute` command consumes the original saved review. Its package
also exposes `TenderlyCustomer`, `TenderlySimulationRequest`, `TenderlyResult`,
and the unchanged native operation through `native_operation`.

Choose the application that will own an actual purchase. Node and Python have
separate application-state formats; reopen the application that recorded the
original intent. The completed customer export is the portable exchange format
between applications and analysts.

## Export and reopen the completed simulation

The customer export associates the original response with its exact request
and unchanged native buyer result. Node exports can resume their own interrupted
destination. The Python exporter uses a new private destination.

```sh
node examples/buy-node.mjs export \
  --state /srv/private/tenderly-node --intent tenderly-customer-001 \
  --out /srv/private/tenderly-export

node examples/buy-node.mjs open-export \
  --directory /srv/private/tenderly-export
```

For a Python-owned purchase:

```sh
python3 examples/buy-python.py export \
  --state-dir /srv/private/tenderly-python --intent tenderly-customer-001 \
  --out /srv/private/tenderly-python-export

python3 examples/buy-python.py open-export /srv/private/tenderly-python-export
```

Every completed export contains these files:

| File | Retained content |
| --- | --- |
| `response.json` | Exact original provider response bytes. |
| `request.body` | Exact original seven-field public request bytes. |
| `request.json` | Native intent/config/body bindings and comparison context. |
| `simulation-request.json` | EVM network plus the seven public simulation fields. |
| `buyer-result.json` | Original native buyer result record. |
| `manifest.json` | File sizes and hashes, request context, and simulation summary. |
| `buyer-evidence.json`, when available | Original retained buyer evidence. |

Opening an export verifies its manifest and input/result associations locally.
The original request body remains byte-preserved; normalized comparison fields
identify equivalent EVM addresses and calldata. The provider response preserves
traces, logs, decoded calls, state changes, and any other fields it delivered.

## Analyze the original saved result

For a retained Node purchase, the analysis join passes the actual original
`BuyerResult` instance to the existing analysis consumer:

```sh
node examples/buy-node.mjs analyze \
  --state /srv/private/tenderly-node --intent tenderly-customer-001 \
  --workspace /srv/private/tenderly-analysis \
  --label customer-simulation
```

For a completed Node or Python export:

```sh
node examples/buy-node.mjs analyze-export \
  --directory /srv/private/tenderly-export \
  --workspace /srv/private/tenderly-analysis \
  --label customer-simulation
```

The export connection reopens the existing customer export, verifies the
selected original response/request/native-record files against its manifest,
and feeds their bytes to the original analysis workspace. The resulting
capture retains the buyer record and response together. The command returns
the capture ID and `analysisPath`; the analysis package supplies the retained
catalog, comparison, review, and report interfaces.

The merchant's `simulation.status` and `transaction.status` describe EVM
execution. A saved result with status `false` is a delivered revert and remains
available for diagnosis. Purchase settlement, saved response delivery, and
EVM execution are represented by their original separate fields.

## Source interfaces

- [Merchant plan and provider contract](product.mjs)
- [Workspace packet and original buyer preparation](customer.mjs)
- [Authored Node customer and completed export](customer/client.mjs)
- [Authored Python customer](customer/python/stellar_forge_tenderly/customer.py)
- [Original SF88 Node buyer](../../sf88-operator-buyer-cli/node/client.mjs)
- [Original SF88 Python buyer](../../sf88-operator-buyer-cli/python/stellar_forge_buyer)
- [Retained Tenderly analysis](../../sf88-operator-buyer-cli/tenderly-analysis/README.md)
