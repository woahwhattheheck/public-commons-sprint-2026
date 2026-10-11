# Review a merchant's receiving configuration

Review the receiving side of every original seller payment option before opening
the product to buyers. This workflow consumes the existing SF30 seller JSON,
uses the original compiler to obtain its exact ordered payment choices, reads the
deployed token contract and recipient state, and creates one private operator
report. It belongs to the existing SF101 receiving-readiness component.

## Run against the existing seller

Use Node 22.12 or later and the application's existing optional
`@stellar/stellar-sdk` installation. The implementation uses the original SDK's
StrKey, Asset, Contract, XDR, Account, TransactionBuilder and SorobanDataBuilder
primitives. It was developed against the shared 16.3.1 runtime; it does not load
a wallet or require a key. The original SF30 source and its imports must remain
beside this component, as they are in the maintained product distribution.

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --out /private/merchant/receiving-review-001
```

The seller's `publicOrigin` supplies the exact original resource origin. For a
local configuration that omits it, pass its actual running loopback origin:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --origin http://127.0.0.1:8423 \
  --out /private/merchant/receiving-review-001
```

The original configuration reader and route compiler validate the source. The
application's handler, admission functions, private dataset, response files and
asset bytes are not executed to inspect payment terms. Imported offers, direct
definitions, fixed/dynamic paths, supported HTTP methods and paid file responses
use their original compiler paths. Every configured alternative retains its
network, contract, recipient, atomic amount, timeout and additional native terms.

Testnet uses the existing SDF endpoint `https://soroban-testnet.stellar.org`.
An existing alternative provider can be supplied with `--rpc-testnet`. For
public-network choices, supply the merchant's existing RPC endpoint explicitly:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --rpc-public https://YOUR_EXISTING_RPC_PROVIDER \
  --out /private/merchant/receiving-review-002 \
  --previous /private/merchant/receiving-review-001
```

The endpoint is HTTPS and contains no URL credentials, query or fragment. Each
network's `getNetwork` passphrase must match the configured `stellar:testnet` or
`stellar:pubnet` network. The report retains the selected provider URL and native
ledger observations. Public-network account facts use official Horizon public;
testnet uses official Horizon testnet. A failed option remains visible beside
the other completed options, with the concrete read or receiving action.

`--timeout-ms` accepts 1000–30000 milliseconds per read. `--ops` controls the
existing classic calculator's nominal merchant operating-fee comparison. The
default is ten operations. That fee headroom is shown as a merchant operating
fact; the receiving review does not require the merchant to pay the buyer's
transfer fee.

## What the native reads establish

The RPC path issues `getNetwork`, `getLedgerEntries` and `simulateTransaction`.
Simulation transactions use the original SDK's unsigned null-account read
source. They contain only `decimals`, `symbol`, `name`, `balance` or SAC
`authorized` calls. Each return value is decoded by the installed native XDR
implementation. A read is accepted only when its simulation has no authorization
entries and no writable footprint, matching the SDK's `isReadCall` criteria.
State requiring restoration is reported for the existing operator to resolve.

The contract instance is read by its exact native ledger key. Its executable
distinguishes a built-in Stellar Asset Contract from a custom contract. For a
SAC, the built-in metadata and the SDK's network-specific `Asset.contractId`
calculation must identify the exact configured contract. Native XLM uses its
deterministic native asset contract; an issued asset retains the case-sensitive
code and exact issuer. Current administrator identity is not substituted for
the original asset issuer.

For an ordinary G-address receiving a SAC asset, the workflow then uses the
original SF101 Horizon calculator for that specific account and original issued
asset. It checks the trustline, full receiving authorization, buying liabilities
and remaining inbound limit against this option's exact atomic quote. The
classic signed 64-bit balance range is enforced before converting to seven-place
asset text. Native balance and authorization observations are compared with the
classic snapshot; changed observations request another read rather than silently
choosing one. Account reserve, sponsorship, selling liabilities and nominal fee
headroom remain visible in their original fields.

For a C-address receiving a SAC asset, native `balance` and `authorized` supply
the contract recipient's current state; the signed 128-bit balance limit applies.
Custom contracts retain their deployed executable, observed decimals, name,
symbol and recipient balance, with a specific action to apply that contract's
receiving policy. A successful generic token getter does not define all of a
custom contract's transfer conditions.

Original source references:

- [Stellar Asset Contract: executable identity, classic and contract recipients](https://developers.stellar.org/docs/tokens/stellar-asset-contract).
- [Trustline authorization, limits and RPC lookup behavior](https://developers.stellar.org/docs/build/guides/basics/verify-trustlines).
- [Native RPC getLedgerEntries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries).
- [Native SDK contract read and simulation interface](https://stellar.github.io/js-stellar-sdk/guides/06-invoke-a-contract/).
- [Original SF101 reserve and account calculation](README.md) and [original SF16 exact amounts](../sf16-asset-engine/README.md).

## Read the saved review

Open `review.html` from the new output directory. It shows each route and choice
individually, including exact native amounts, token identity, recipient,
observed balance, authorization, classic capacity and the action needed for that
choice. It uses a grayscale layout with narrow-screen and print formatting.
Each configured price is checked independently; amounts from different token
contracts are never added together.

| Option state | Meaning |
| --- | --- |
| `RECEIVING_PREREQUISITES_OK` | Live observations satisfy the implemented receiving checks for this exact configured SAC option. |
| `ACTION_REQUIRED` | A concrete account, contract, network, authorization or capacity condition needs correction. |
| `REVIEW` | A read could not complete, the source changed, retained observations are being reviewed, or the custom contract needs its own receiving policy. |

The CLI exits 0 when every option has live receiving prerequisites, 2 when any
option needs a concrete correction, 1 when review remains, and 3 when the input
or output cannot be processed. Changes to the seller file during the run are
recorded; the retained plan still identifies the exact source that was reviewed.

The original seller performs each native transaction using the buyer's actual
request and approved payment. The review is an observation of receiving state
at its recorded ledgers; another transaction can change that state afterwards.

## Compare a repair and reopen original reads

Use `--previous PRIOR_DIRECTORY` to compare this completed review with its
previous saved version. The comparison joins the complete original option
identity, reports added/removed choices, shows changed states, and lists resolved
and introduced receiving conditions. Changing a price or recipient appears as a
changed option identity rather than assigning an old result to the new choice.

To inspect the same original network responses later:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --from-capture /private/merchant/receiving-review-002 \
  --out /private/merchant/receiving-review-reopened
```

Keep `--origin` identical when the original config required it. The saved
manifest must match the capture bytes, and the compiled seller plan must match
the original capture. The exact serialized read requests are replayed through
the same native XDR parsing and original account calculator. No network is used
for this retained review. Its mode is `RETAINED_NETWORK_READS`, and it preserves
the original response timestamps and hashes. Providing a custom transport to the
embedding API produces `CALLER_TRANSPORT_READS`, separately from direct live reads.

| File | Contents |
| --- | --- |
| `plan.json` | Original compiled routes, ordered payment choices and seller-source identity. |
| `report.json` | Each option's native/classic observations, action, source state and optional repair comparison. |
| `options.csv` | Exact option-by-option mapping for merchant operations. |
| `review.html` | Local printable operator review. |
| `capture.json` | Exact read request identities, original response bytes or transport failures, timestamps and digests. |
| `manifest.json` | Completed output byte counts and SHA-256 values. |

Each output directory is new and private (0700); its files use 0600. Existing
reviews are preserved. The manifest is written after all output files. Captures
contain the merchant's public ledger account details and configured option
identities, so keep them with the merchant's private operational records.

## Embed in the maintained operator workflow

`readMerchantReceivingPlan(configPath, {origin})` returns the source-bound compiled
plan. `inspectMerchantReceiving({configPath, origin, endpoints, timeoutMs,
feeOperations, capture, sdk, fetchImpl})` returns `{plan, report, capture}`.
`compareMerchantReadiness(previous, current)` computes the option-state repair
comparison. `writeReceivingBundle(directory, result)` saves the complete product
handoff; `readReceivingBundle(directory, 'report.json' | 'capture.json')` checks a
saved file against its manifest before consumption.

The original single-account `cli.mjs` remains intact. Its native parser now also
accepts Stellar's case-sensitive issued-asset codes. The original Horizon reader
exports account and ledger reads separately, allowing the merchant operation to
read each unique recipient once and each network's ledger once. Native metadata
and balances are similarly reused across options sharing the same identity.
