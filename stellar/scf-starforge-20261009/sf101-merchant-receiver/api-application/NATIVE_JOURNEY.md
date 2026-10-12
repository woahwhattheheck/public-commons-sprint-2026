# Funded TESTNET API application journey

This native operation buys the original eight-unit API plan for 10,000 atomic TESTNET XLM, delivers the signed settlement through the original SF98 outbox and receiver, downloads the exact paid plan, runs the original `analyze` application for two units, reopens its retained response, and finalizes the original buyer accounting.

## Run the retained operation

Use Node 24 with the existing Stellar SDK / x402 installation, Python 3, Linux flock, and an existing merchant certificate trusted by the host. The source tree must contain the merged API purchase, application, and original paid-jobs modules.

```sh
node --use-system-ca \
  stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/native-journey.mjs \
  --dir /private/persistent/api-pass-native-chain-921ba0 \
  --tls-dir /private/existing-merchant-tls \
  --host merchant.routescan39da.scf.test
```

The TLS directory contains the operator's existing `server-key.pem` and `server.pem`. The host must match the certificate. The runner carries system trust into the original buyer's Node subprocess through `NODE_OPTIONS`. It uses the original public transport and official event decoder to check the real TESTNET RPC connection before the first purchase attempt.

Choose a private directory that persists across separate native invocations. Repeating the same command opens the same account keys, original order, workspace, inbox, application execution, and response files. The original Linux file lease prevents overlapping operation owners.

Four loopback ports are retained in the operation input: receiver 43110, application 43111, customer API 43112, and operator console 43113. Select different ports before the first run with `--receiver-port`, `--worker-port`, `--api-port`, and `--console-port`. Use `--python` for an explicit Python executable.

## Exact purchase and application input

| Input | Retained value |
| --- | --- |
| Intent | `api-pass-native-chain-921ba0-20261011` |
| Original order | `api-pass-native-chain-921ba0` |
| Application request | `api-application-analyze-921ba0-20261011` |
| Network | `stellar:testnet` |
| Purchase amount | `10000` atomic native XLM |
| Original plan | 412 UTF-8 bytes |
| Plan SHA-256 | `b73aec59dd56c826f55799a39b2ad01f5383ce784e1f487e81ac14329d1e4ff8` |
| Selected API route | `slow`, POST `/slow`, two units |
| Native function | Original `sf30-seller-sdk/jobs/example-application.mjs` → `analyze` |
| Application body | `{"values":[2,4,6,8],"window":2}` |

The plan retains all five original route descriptions. This operation binds and exercises the `slow` route against the original application. The application compiler derives the selected route path and response limit from that same gateway configuration.

## Original owners and transport

The Stellar SDK generates fresh buyer, fee-sponsor, and merchant TESTNET accounts. Their private keys are retained before the first Friendbot request. A resumed run checks those accounts and reuses them. The native facilitator is restricted to TESTNET, the selected native asset and merchant, and the original 10,000-unit purchase limit.

The original SF101 checkout enrolls the approved plan. The original SF88 workspace owns signer policy, approvals, accounting, and the single native purchase attempt. If that attempt already exists, the runner opens original recovery. Successful settlement produces the original SF98 event, and `drainOnce` owns its delivery lease, attempts, acknowledgement, and replay behavior.

For this operator-owned TESTNET deployment, a verified TLS listener forwards only the checkout, receiver webhook, and paid-file paths. An explicit CONNECT proxy admits the exact merchant host and actual TESTNET RPC endpoint. The SF98 callback signs the original event payload and performs a real HTTPS request to that listener using its certificate and host identity. Normal product webhook delivery retains its existing public destination policy.

The original customer then downloads and verifies the 412-byte paid plan. The original API pass attaches to the same order and entitlement. The application runs through the original paid-jobs compiler, worker, store, allowance reservation, and durable response. Reopening the same API request retrieves the original response bytes.

## Resume and completed outputs

The runner retains the original native files in its private directory. `operation.json` binds input identity; `accounts.private.json` and `merchant.private.json` retain host-local credentials. The buyer state, inbox, workspace, merchant SQLite, SF98 outbox, application profile, job store, and response files remain the authorities for recovery.

`journey-result.json` is written after the native payment is finalized and the paid application result has been reopened. It includes the original transaction reference, source plan digest, actual application response and digest, same-request replay, transport counters, and paths to the original state. The original buyer history is exported to `buyer-history.html`.

An interrupted process is resumed with the same arguments. A retained native purchase attempt follows the original buyer recovery. A retained API call follows the original customer response recovery. Operator application recovery is available through the existing `api-application inspect` and `recover` commands when an interrupted gateway response needs its completed native result attached.

## Original references

- [API purchase customer](../api-access/PURCHASE.md)
- [Purchased application operations](README.md)
- [Original SF101 checkout](../CHECKOUT.md)
- [Official TESTNET account setup](https://developers.stellar.org/docs/build/guides/transactions/create-account)
- [Official native asset setup](https://developers.stellar.org/docs/tokens/quickstart)
