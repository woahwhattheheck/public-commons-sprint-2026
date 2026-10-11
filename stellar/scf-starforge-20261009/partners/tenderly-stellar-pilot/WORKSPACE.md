# Tenderly merchant operator workspace

Use the private browser workspace to prepare a Tenderly project as a Stellar
x402 merchant, issue requests against explicit EVM state, operate the original
seller, and reopen its saved responses. The workspace uses the same plan,
prepared package and operation directory as the original terminal tools.

## Start and reopen

Use Node 22.16 or later and an existing private parent directory. From this
component's source directory:

```sh
install -d -m 700 "$PWD/private"
node workspace/server.mjs --state "$PWD/private/tenderly-workspace" --port 0
```

Open the complete local URL printed by the process. Its private fragment opens
the authenticated workspace. The server binds only to the local loopback
address. A new server process prints a new URL.

An existing merchant plan can be retained on the first launch:

```sh
node workspace/server.mjs \
  --state "$PWD/private/tenderly-workspace" \
  --plan "$PWD/private/merchant-plan.json" --port 0
```

Subsequent launches use the same state directory. Saved profiles, request
packets, original response bytes and the merchant's operation history remain
available. Starting the workspace opens the operator interface; the merchant
listener starts from its explicit **Start merchant** control.

The selected plan names two environment variables:

| Setting | Purpose |
| --- | --- |
| `provider.accessKeyEnv` | The existing Tenderly project's access key |
| `operations.keyEnv` | The merchant's stable operation-ticket signing key |

Supply their values through the existing private launch environment. The
browser edits and retains their names. Keep the same operation key when
reopening existing tickets and operation state. The original application
validates the environment when **Prepare and open** opens the selected profile.
The profile form and offline review can be used before those values are set.

For native paid operation, start the workspace with the original facilitator:

```sh
node workspace/server.mjs \
  --state "$PWD/private/tenderly-workspace" --port 0 \
  --facilitator https://your-selected-facilitator.example
```

The maintained toolkit's native x402/Stellar dependencies must be installed in
the source environment. The original seller's payment mode appears beside its
local address after startup. A launch without a facilitator uses the existing
challenge profile. The prepared plan's Stellar network, asset, recipient and
atomic price determine payment; its EVM network ID determines simulated data.

## 1. Prepare the merchant

Open **Merchant**. Enter a profile name and service name, the public HTTPS
merchant origin and fixed simulation route, the actual Tenderly account and
project, EVM network ID, and requested simulation output. Enter the selected
Stellar payment terms, preserving the atomic price as a decimal string.

The form exposes quick, ABI-decoded and full simulation output. Each request
pins its block number and transaction position. The original application adds
the plan's data network and saved-result flags to the provider request.

The expandable settings preserve the existing operation scope, ticket lifetime,
saved-response capacity, provider timeout, gas limit and concurrency. An
imported original plan populates the same form. **Review terms** compiles the
original contract and displays the provider project, data network, payment
terms, route and required environment names.

**Save profile** creates an immutable version. Re-saving the same normalized
plan reopens the existing version. A change to its price, provider, scope or
other plan field creates a distinct version with its own prepared operation
state. Existing profiles and their original operations stay available in the
saved-profile list.

Select **Prepare and open**. The original product preparer creates or resumes
the exact package for that version, including its OpenAPI contract, original
generated customer client, provider bindings and private operations directory.
The browser displays the package's absolute path. An interrupted offline
preparation resumes against those same expected bytes.

The directory layout is:

| Path relative to workspace | Contents |
| --- | --- |
| `workspace.json` | Workspace identity |
| `profiles/p-…/plan.json` | Immutable reviewed plan |
| `profiles/p-…/snapshot.json` | Exact plan binding and profile label |
| `packages/p-…/` | Original prepared merchant and customer files |
| `packages/p-…/operations/` | Original operation database and retained request context |
| `requests/r-…/request.json` | Exact issued request, ticket and customer identity |

Use the displayed prepared package's plan and operations path when operating
the same merchant from the terminal. Copying only its plan into a fresh state
directory creates a separate merchant history.

## 2. Start, drain and resume the merchant

After opening a saved profile, choose seller and operations ports. Port zero
selects an available local port. **Start merchant** invokes the original native
seller and operations controller on the selected package's original state.
The interface displays its actual address and payment mode.

Configure the public HTTPS ingress to that original seller using the existing
merchant deployment workflow. The operator workspace and private operations
listener stay local.

**Drain and stop merchant** closes admission and waits through the original
seller lifecycle, then keeps that profile's retained operation history open.
Use the same profile to start again. Stop a running merchant before opening a
different saved profile.

Closing the operator process drains the running merchant through the same
lifecycle. When recovering after process loss, reopen the original directory
and inspect the existing operation history before continuing its request.

## 3. Issue and retain a request

Open **Requests** and provide the actual operation ID, customer reference,
historical block number, transaction index, sender, recipient, calldata, gas
limit and value in wei. Value remains an exact decimal string. Importing a
transaction JSON file populates these fields for review.

Select a ticket lifetime within the saved plan's original maximum. **Issue and
retain ticket** uses the original operation controller and keeps the ticket
with its exact public body and reviewed merchant terms.

**Download complete request** returns `tenderly-request.json`:

```json
{
  "schema": "stellar-forge.tenderly-workspace-request.v1",
  "profile": "p-…",
  "planSha256": "…",
  "merchant": {
    "id": "tenderly-simulation",
    "method": "POST",
    "path": "/evm/simulate",
    "url": "https://your-merchant.example/evm/simulate"
  },
  "payment": {},
  "body": {},
  "operation": {
    "schema": "stellar-forge.upstream-operation-ticket.v1",
    "ticket": "…",
    "operationKey": "…",
    "requestHash": "…",
    "expiresAt": 0
  },
  "customer": { "id": "original-operation-id", "subject": "original-customer" }
}
```

The displayed abbreviations describe fields; the download contains their
complete original values. Keep this packet private and hand it to the intended
customer. [CUSTOMER.md](CUSTOMER.md) describes its conversion to the original
SF88 buyer configuration, native client operation and retained customer result.

Choose an existing retained request to download its same bytes and ticket.
Changing the transaction creates a new reviewed request. The native buyer
retains its own spending and payment state while the merchant retains the
provider operation.

## 4. Open completed results

Open **Results & recovery**, select the operation state filter and load its
original history. The table provides keyset pagination, attempts, generations,
response sizes and update times.

Select a completed row. The workspace reads its exact response from the
original SF30 operation ledger, checks the retained Tenderly request context,
and displays the simulation ID, network, pinned block and transaction index,
outcome and gas usage. A reverted EVM transaction is a recorded simulation
outcome.

The JSON preview shows up to 64 KiB. **Download response** streams the complete
original `response.json`; the displayed byte count and SHA-256 describe that
same full file. The operation's original change history is separately paged.
These reads do not invoke the provider simulation endpoint.

The customer analysis consumer accepts the raw Tenderly response and original
request. Its Node integration can receive the original buyer result directly;
see the maintained Tenderly analysis guide under
`sf88-operator-buyer-cli/tenderly-analysis/`.

## 5. Retrieve and reconcile a saved provider result

Select the original uncertain or interrupted operation under **Results &
recovery**. Enter its saved Tenderly simulation ID in the provider lookup form.
Use the ID from that operation's original provider record.

The lookup uses Tenderly's documented
[Get full simulated transaction details](https://docs.tenderly.co/api-reference/simulator/get-full-simulated-transaction-details)
endpoint: `POST /api/v1/account/{account}/project/{project}/simulations/{id}`,
with no request body. The saved plan supplies the account, project and access-key
environment name. The access-key value stays in the merchant process.

The workspace keeps each lookup with its original operation key, request hash,
plan and provider simulation ID. Selecting an existing lookup reopens its saved
response. **Fetch again** explicitly retrieves another observation of that same
simulation. A provider `Retry-After` value determines the earliest permitted
refresh. Saved observations remain selectable after later fetches and process
restarts.

Review the lookup state and request context. A matching response must have the
selected simulation ID and the original network, block, transaction position,
sender, recipient, calldata, gas, gas price and value. The simulation and
transaction outcome must agree. A reverted transaction can be a matching saved
simulation: its EVM outcome is retained in the result.

The review displays the complete response's byte count and SHA-256. Its preview
is limited to 64 KiB; **Download original provider response** returns the complete
original provider bytes within the plan's saved-response size limit. Error or
mismatched responses remain available for inspection, with their HTTP status
and provider retry information.

For a matching observation, enter the original provider reference and choose
**Apply reviewed saved result**. The workspace submits the generation shown when that
observation was reviewed to the existing operation controller. That controller
completes the same merchant operation and retains its original audit history.
Reopening or applying the same recorded recovery returns the already completed
result. A changed operation generation invokes the original conflict behavior:
refresh and review its current state. A live original operation keeps its native
execution ownership.

After recovery, the existing **Download response**, customer delivery and
analysis consumer read the result from the original operation ledger. The
customer continues the same issued request and ticket.

### Terminal operation

Use the displayed prepared package path, with the same private launch
environment as the workspace. The installed toolkit uses `starforge tenderly`;
source users can substitute `node cli.mjs`.

```sh
starforge tenderly lookup \
  --prepared /private/merchant \
  --operation-key ORIGINAL_OPERATION_SHA256 \
  --simulation-id ORIGINAL_SIMULATION_ID

starforge tenderly lookups \
  --prepared /private/merchant \
  --operation-key ORIGINAL_OPERATION_SHA256

starforge tenderly lookup-inspect \
  --prepared /private/merchant --lookup-id SAVED_LOOKUP_SHA256

starforge tenderly lookup-result \
  --prepared /private/merchant --lookup-id SAVED_LOOKUP_SHA256 \
  --observation-id SAVED_OBSERVATION_UUID \
  --out /private/saved-provider-result.json

starforge tenderly recover-saved \
  --prepared /private/merchant --lookup-id SAVED_LOOKUP_SHA256 \
  --observation-id SAVED_OBSERVATION_UUID \
  --generation REVIEWED_GENERATION \
  --reference ORIGINAL_PROVIDER_REFERENCE
```

Add `--refresh true` to `lookup` for an explicit new observation. `lookups`
accepts `--limit` and the returned `--before` cursor. Output-file parents must
exist with private permissions; an existing output file is preserved.

### Retained lookup data

The original package's `operations/provider-lookups/<lookup-id>/` directory
holds the immutable lookup intent, observation request records, complete
responses and completed recovery records. Each complete provider response and
its metadata publish together through an atomic private-file write. If a
process ends before a complete response is retained, that observation remains
pending; an explicit fetch continues the same saved simulation lookup.

Lookup history reads one response at a time while assembling its summaries.
The workspace's existing operation queue and application shutdown drain include
provider lookups and recovery. The original operation ledger continues to
control merchant completion and retry.

### Import an already retained response or record a confirmed retry

The original recovery form remains available below the provider lookup.
Choose **Saved simulation result recovered**, enter the provider reference and
select the complete original JSON response with its original HTTP status. The
application checks the response against the retained request before completing
the same ledger row.

If the provider confirms that no simulation was dispatched, choose that outcome
and record the original confirmation reference. The existing controller makes
the operation eligible for its next explicit attempt. Continue its same
original identity.

## Embedded use

`workspace/server.mjs` exports `startTenderlyWorkspace({directory, planPath,
port, env, merchantOptions})`. `merchantOptions` is a trusted host configuration
passed to the original application and merchant launcher. The returned handle
contains the local URL, server, model and an idempotent `close()` method.

`workspace/model.mjs` supplies the same profile, preparation, request, runtime,
result and recovery operations for a trusted local caller. Its mutations share
one process queue; prepared-package metadata uses the existing runbook lease;
provider execution and result recovery use the original durable operation
engine. Immutable profile and request snapshots publish after their exact files
are complete.
