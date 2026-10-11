# Recover a completed native purchase into merchant accounting

Use this workflow when an original SF31 buyer completed a purchase and retained
its native outcome and delivered response, but the seller did not capture an
SF98 settlement event. It recovers that existing transaction into the original
merchant report and keeps the delivered bytes available to the operator.

The recovery CLI reads the original files, calls the original SF86 independent
Stellar RPC verifier, and saves a private entry whose origin is
`RECOVERED_ORIGINAL_SF31_OUTCOME`. The ordinary SF81/SF36 preauthorized buyer path
continues to use its existing reservation record. Recovery does not create that
record, call a buyer or signer, send an SF98 webhook, or contact the merchant.

## Retain the actual source files

Use the same Node 22+ installation and installed `@stellar/stellar-sdk` as the
original buyer. The maintained SF88 installation also supplies the existing
SF43 decoder. No additional package is required.

The input directory must contain the actual retained sources. Keep it private
with mode `0700` and each file `0600`.

| File | Required original content |
| --- | --- |
| SF31 outcome | `intentId`, `status`, `resource`, `requirement`, `settlement`, `receipt`, `httpStatus`, and optional `contentType`. The accepted state is `DELIVERED_REPORTED_SETTLED` with a successful native receipt and a successful HTTP response. |
| SF31 request | The complete intent originally supplied to the SF31 `approve(intent)` callback. A retained wrapper containing `intent` is also accepted. It includes the exact URL, method, accepted terms and request body identity. |
| Merchant terms | The existing `stellar-forge.merchant-accounting-terms.v1` file used by this component. One option must match route, method, network, asset, amount and recipient exactly. |
| Saved response, optional | The original response writer's saved bytes, plus its recorded byte count and SHA-256. The importer checks those values before retaining a copy. |

For an in-process integration, retain the original values at their existing
boundaries. The outcome JSON cannot serialize an HTTP `Response` object; retain
the listed scalar outcome fields and the original native requirement/receipt.
The original response writer already provides the saved body identity. Do not
include signer credentials, x402 authorization headers, or private keys.

A source file's authority remains a retained client record. The independent
ledger check establishes the exact transfer; it does not put the HTTP route or
the operator's source-file selection into the blockchain transaction.

### Create the recovery request

Create a private JSON file with this structure, using the actual source paths,
trusted payer, existing merchant route, and original response identity:

```json
{
  "schema": "stellar-forge.merchant-recovery-request.v1",
  "outcomeFile": "/private/purchase/outcome.json",
  "requestFile": "/private/purchase/request.json",
  "termsFile": "/private/merchant/prices.json",
  "routeId": "patch-record",
  "payer": "REPLACE_WITH_THE_ORIGINAL_TRUSTED_G_ADDRESS",
  "rpcEndpoint": "https://soroban-rpc.testnet.stellar.gateway.fm",
  "httpsProxyEnv": "HTTPS_PROXY",
  "response": {
    "file": "/private/purchase/response.json",
    "sha256": "REPLACE_WITH_THE_ORIGINAL_RESPONSE_WRITER_SHA256",
    "bytes": 80
  }
}
```

The payer comes from the original wallet owner. The response byte count shown
above is an example field; use the original writer's actual value. Omit
`response` if no body was retained, and always omit it for `HEAD`. A retained
empty body is valid. Saved bodies may be up to 64 MiB.

Omit `httpsProxyEnv` for ordinary direct public HTTPS. If the operator selected
an HTTP CONNECT proxy, name its environment variable explicitly. The existing
SF31 transport pins the selected RPC origin, keeps TLS verification, and does
not follow redirects. It does not read arbitrary proxy variables or persist
the proxy URL. The RPC provider comes from original SF86's declared network
profile; a receipt cannot choose its own provider.

The recorded resource must be HTTPS. An original loopback HTTP resource is also
accepted for a completed `stellar:testnet` development purchase. Recovery never
requests that resource and does not change the production buyer's HTTPS policy.

## Review, import, and reopen

Run commands from the original repository root:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/recovery-cli.mjs review \
  --config /private/purchase/recovery-request.json

node stellar/scf-starforge-20261009/merchant-settlement-accounting/recovery-cli.mjs import \
  --config /private/purchase/recovery-request.json \
  --recovered-dir /private/merchant/recovered

node stellar/scf-starforge-20261009/merchant-settlement-accounting/recovery-cli.mjs list \
  --recovered-dir /private/merchant/recovered
```

`review` is offline. It checks exact original request/outcome agreement, maps
the complete merchant option using the existing compiler, and hashes the
retained sources. It does not import the SDK or read a signing key.

`import` performs read-only `getNetwork`, `getTransaction` and `getEvents`
through the original SF86 verifier and SF43 SDK event decoder. The network
passphrase, successful transaction, asset contract, actual token payer,
recipient and atomic amount must match. Its public-RPC match is retained
alongside the source files. Testnet and pubnet use their respective original
network profiles. A local RPC replay cannot create a recovered entry.

The importer stores one entry per SHA-256 of `network + "\n" + transaction`.
An identical later import returns `ALREADY_IMPORTED` without another RPC run.
A different route or source binding for that same transaction returns
`RECOVERY_TRANSACTION_ALREADY_BOUND_TO_DIFFERENT_SOURCE` and preserves the
existing entry. Changed retained files are detected when reopening. Successful
imports become visible by one directory rename after their files are synced.

## Open the already-delivered result

Use the recovery ID printed by `import` or `list`:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/recovery-cli.mjs response \
  --recovered-dir /private/merchant/recovered \
  --id RECOVERY_SHA256 \
  --out /private/purchase/reopened-response.json
```

This verifies the retained sources and response hash, then creates a new private
file containing the original bytes. The destination must not already exist.
The command does not request the seller again, repeat a mutation, or pay again.

## Use the original merchant report

Keep using the merchant's existing SF98 outbox, SF86 proof directory, and current
merchant terms. Add the recovered source to the original reporting workflow:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/recovery-cli.mjs report \
  --recovered-dir /private/merchant/recovered \
  --outbox /private/merchant/sf98 \
  --proof-dir /private/merchant/sf86-proofs \
  --terms /private/merchant/prices.json \
  --out /private/merchant/reports/new-reconciliation
```

The command calls the existing accounting CLI and its report writer. It uses
the same option matching, independent proof classification, transaction
deduplication, JSON ledger, CSV tables, HTML review and output manifest.
Recovered entries retain their own origin and do not increase the count of
captured SF98 native events. The accounting engine handles transaction reuse
across both sources in one place. The original journals remain unchanged.

A merchant with no native events can use an existing empty private outbox and
proof directory. The recovered transfer carries its own original SF86 proof.
For a native testnet XLM development purchase, set the merchant's USD price and
cost fields to `null` and use an explicit testnet price basis; recovery does not
create a fiat valuation or identify the native asset as USDC.

## Reusable source contract

`recovery.mjs` exports:

| API | Result |
| --- | --- |
| `reviewRecoveredSettlement({configFile})` | Offline resolved payment option, original request identity, selected RPC and source hashes. |
| `importRecoveredSettlement({configFile,recoveredDir,signal?})` | `IMPORTED` or `ALREADY_IMPORTED`, retained entry and original proof. Trusted integrations may supply the existing verifier's `fetchImpl` and `decodeContractEvent` seams. |
| `readRecoveredSettlements(recoveredDir)` | `{entries,hashes}`; each entry is `{data,fileDigest,proof:{data,fileDigest}}`. Every source and saved response is rechecked. |
| `readRecoveredResponse({recoveredDir,recoveryId})` | Verified original body bytes, SHA-256 and content type for an existing operator surface. |
| `exportRecoveredResponse({recoveredDir,recoveryId,outputFile})` | Create-only private copy of those bytes and its identity. |

The canonical engine accepts `recoveredDir` as an optional input to
`runOriginalAccounting({outboxDir,proofDir,termsFile,recoveredDir})`. The maintained
accounting workspace can retain that source alongside its ordinary fixed
inputs and keep its existing report, review-note and run-comparison features.

Each entry directory contains `entry.json`, `outcome.json`, `request.json`,
`terms.json`, `proof.json`, and optional `response.bin`. `entry.json` uses schema
`stellar-forge.merchant-recovered-settlement.v1`; it records the actual recovered
origin, import time, complete selected option, transaction, request body
identity, source byte counts/hashes, and saved response identity. The receipt
fingerprint explicitly uses canonical receipt JSON, since the original HTTP
header bytes need not have been retained. It is not presented as an SF98
captured-header fingerprint.

The recovered store is an immutable private source, separate from the SF98
sender queue and original buyer budget ledger. Deleting or editing its contents
is not a refund or a new accounting event. The existing merchant reconciliation
classification remains the authority for reports.
