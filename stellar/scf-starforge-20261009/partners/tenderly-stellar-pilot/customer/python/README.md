# Tenderly customer for Python

Purchase an explicitly pinned EVM simulation through the original Stellar Forge operator buyer, preserve its complete response, and hand it to an analyst as the same portable export used by the Node customer.

The original buyer owns operator review, approval, the payment reservation, the ledger, response saving, and recovery. The customer binds the reviewed merchant selection to the requested network, block, transaction position, addresses, calldata, gas, and value. A reverted simulation remains a completed result with `status: false`; the original financial state remains separately available.

## Install the matching source packages

Use Python 3.11 or newer and the Node runtime required by the original buyer. Run these commands from the matching repository root:

```sh
python -m pip install ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
python -m pip install ./stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/customer/python
export STELLAR_FORGE_CHECKOUT="$PWD"
```

The executable is `stellar-forge-tenderly`, also available as `python -m stellar_forge_tenderly`. To run directly from source, put **both** Python package roots on `PYTHONPATH`:

```sh
export PYTHONPATH="$PWD/stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/customer/python:$PWD/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
python -m stellar_forge_tenderly --help
```

The `checkout` argument identifies the repository root containing the original native runtime. Python resolves `stellar_forge_buyer` from the installed package or `PYTHONPATH` independently.

## Inputs

Use the merchant's public `customer-selection.json` generated from its reviewed plan. Its schema is `stellar-forge.tenderly-customer-selection.v1` and its fields are `resource`, `method`, `networkId`, `simulationType`, `planSha256`, and `maxResponseBytes`. The resource is the exact merchant POST URL. The selected response limit is applied through the original buyer and retained in the export.

The exact purchased request body contains seven fields:

| Field | Value |
| --- | --- |
| `block_number` | Explicit nonnegative integer block number |
| `transaction_index` | Explicit nonnegative integer position in that block |
| `from` | Sender EVM address |
| `to` | Recipient EVM address |
| `input` | Complete hexadecimal calldata beginning with `0x` |
| `gas` | Positive integer gas limit within the reviewed merchant plan |
| `value` | Exact unsigned 256-bit integer in canonical decimal text |

Network selection comes from the public selection. Advanced imports can supply `--network-id` explicitly when a selection file is unavailable. A supplied selection and explicit network must agree. `simulation-request.json` adds the selected network for analysis while `request.body` retains the exact original seven-field HTTP bytes.

## Prepare and review

Use the original provider customer's prepared `configPath`, the corresponding exact request body, and the public selection:

```sh
stellar-forge-tenderly prepare --state-dir ./buyer-state \
  --config ./customer-inputs/buyer.json --request ./customer-inputs/simulation.json \
  --selection ./customer-selection.json --operator-profile ./operator-profile.json
```

The private operator profile uses the original buyer's `operator`, `signerModule`, `trustedPayer`, and timeout settings. Existing operator configuration in the native config is preserved. The preparation output identifies the original `intentId`; use that same intent in subsequent commands.

The source can also be an original `--workspace` or an original `--handoff` with its explicit `--accept` index. For a retained discovery result, use `--discovery`, `--row`, `--accept`, `--intent-id`, and the exact `--url`; a public selection can supply that URL. The native buyer resolves the offer and validates its operation ticket.

```sh
stellar-forge-tenderly review --state-dir ./buyer-state --intent-id "$INTENT_ID"
stellar-forge-tenderly execute --state-dir ./buyer-state --intent-id "$INTENT_ID"
```

Review saves the original buyer's configuration and body fingerprints. Execution consumes that saved review and retains the original terminal approval and single-attempt behavior. To inspect the selected request before importing anything, run `request --request simulation.json --selection customer-selection.json`.

## Recover, export, and analyze

After an interruption, reopen the same original intent from its local state:

```sh
stellar-forge-tenderly recover --state-dir ./buyer-state --intent-id "$INTENT_ID"
stellar-forge-tenderly export --state-dir ./buyer-state --intent-id "$INTENT_ID" \
  --output ./analysis-handoff
stellar-forge-tenderly open-export ./analysis-handoff
```

`recover` reads the original saved output and verifies the delivered file through the original buyer. `execute` and `recover` also accept `--export NEW_DIRECTORY` to retain an export in the same command. Use a new directory for each Python export. The completion manifest is written after all content files.

The export schema is `stellar-forge.tenderly-customer-export.v1`:

| File | Content |
| --- | --- |
| `response.json` | Exact original full Tenderly response bytes |
| `request.json` | Intent, configuration and body hashes, expected simulation pins, and optional public selection |
| `request.body` | Exact original seven-field HTTP request bytes |
| `simulation-request.json` | Network plus the seven request fields for analysis tools |
| `buyer-result.json` | Original buyer result record with its native financial state intact |
| `buyer-evidence.json` | Optional exact evidence from this operation, including its receipt and chain observation when present |
| `manifest.json` | Simulation identity and SHA-256 hashes and byte counts for all retained content files |

`open-export` and `TenderlyResult.open_export()` use local files only and need neither the buyer package nor Node. They check the exact permitted manifest file names, file sizes and hashes, body binding, complete response, native saved-response metadata, and summary. They accept Node and Python exports using the shared schema.

Give `response.json` and `simulation-request.json` to the original Tenderly analysis CLI. The full provider response remains available for traces, contracts, decoded data, logs, and future analysis features.

## Python application

```python
from pathlib import Path
from stellar_forge_tenderly import (
    TenderlyCustomer, TenderlySimulationRequest, TenderlyResult, load_selection,
)

selection = load_selection("customer-selection.json")
body = Path("customer-inputs/simulation.json").read_bytes()
request = TenderlySimulationRequest.from_bytes(body, network_id=selection["networkId"])
customer = TenderlyCustomer(checkout=checkout, state_dir="buyer-state")
operation = customer.from_config(
    "customer-inputs/buyer.json", request=request, request_body=body, selection=selection,
)
operation.configure(operator_profile="operator-profile.json")
review = operation.review()
result = operation.execute(review=review)
result.export("analysis-handoff")

# In a later process, use the same intent and original buyer application state.
result = customer.operation(operation.intent_id).recover()
offline = TenderlyResult.open_export("analysis-handoff")
print(offline.simulation_id, offline.evm_transaction_hash)
print(offline.stellar_payment)
full_response = offline.envelope
```

An application can also supply its existing original buyer as `TenderlyCustomer(buyer=buyer)`. `from_workspace`, `from_operation_handoff`, and `prepare` all accept the same typed request and optional selection. The runnable `examples/purchase.py` separates preparation, reviewed execution, and recovery into explicit commands.

`result.response_bytes` exposes the exact retained response. `result.envelope`, `simulation`, and `transaction` expose the complete parsed data. `result.stellar_payment` preserves the native purchase status and the original receipt and chain observation when present. The simulation ID, EVM transaction hash, and Stellar payment transaction remain distinct.

## Native accounting

`inspect` and `list` read local operation views. `accounting --intent-id ...` reads retained original accounting results. `finalize --intent-id ...` delegates to original SF36 accounting for that same operation; its `--outbox` and `--merchant-route` options are supplied together when using the original merchant route. Python exposes the same operations as `operation.finalize(...)` and `operation.recover_finalization()`.
