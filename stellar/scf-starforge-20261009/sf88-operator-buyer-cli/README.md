# SF88: One-command approved Stellar buyer pilot

Operator-side executable joining ORIGINAL SF31 buyer HTTP, SF81/SF62/SF36 approval and reservation, and SF82/SF43/SF52 durable evidence. The native signer adapter connects the official Stellar x402 SDK to that existing operation. Wallet custody, the original approval ledger, seller transport and settlement verification retain their existing roles.

From the complete public sprint checkout, using Node 22+ and Python 3.11+:

1. Put an owner-reviewed config JSON in a private local directory. It contains chosen public quote terms and paths to trusted operator files. Choose the [native SDK signer](NATIVE_SIGNER.md), backed by a runtime environment key or a wallet module, or retain your existing `signerModule`. Keep secret keys outside the config in the operator environment or established wallet custody.
2. Review the method, resource URL, base-unit spend cap and body digest without network via: node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --review --config /private/pilot.json
3. Optionally use --discover --config /private/pilot.json to read the ORIGINAL catalog without payment or signing. Save the result and use --prepare below to select its actual source terms without retyping them. Discovery is not approval.
4. Execute with --execute --config /private/pilot.json from the trusted terminal. Original SF81 invokes SF62 terminal review and SF36 durable fresh reservation before the owner-provisioned signer. SF31 makes one unsigned request and at most one signed retry. Original SF82 persists one create-only evidence file and checks canonical testnet RPC when qualified.

The evidence directory must already exist with POSIX permissions 0700. Original SF36 policy and ledger paths are absolute. After any unknown payment outcome, reconcile the original SF36 ledger and chain before another attempt, never replace a stable operation ID to force retry.

## Config shape (all values shown are illustrative, nonpayable placeholders)

~~~json
{
  "catalog": {"origin": "https://trusted-catalog.example", "query": "forecast", "limit": 10},
  "operation": {
    "intentId": "consenting-merchant-pilot-001",
    "url": "https://original-consenting-seller.example/api/forecast",
    "method": "GET",
    "expect": {
      "scheme": "exact", "network": "stellar:testnet",
      "asset": "ACTUAL_STELLAR_CONTRACT_ID",
      "payTo": "ACTUAL_STELLAR_PAYMENT_RECIPIENT",
      "maxAtomic": "1000"
    }
  },
  "operator": {
    "python": "/usr/bin/python3",
    "actor": "owner-verified-operator",
    "service": "owner-verified-seller",
    "policy": "/private/sf36/policy.json",
    "ledger": "/private/sf36/reservations.sqlite"
  },
  "signerModule": "/private/operator/official-x402-stellar-signer.mjs",
  "evidenceDir": "/private/stellar-evidence",
  "trustedPayer": "ACTUAL_OPERATOR_VERIFIED_STELLAR_ACCOUNT",
  "captureBody": true
}
~~~

The legacy trusted signer module exports an async sign({intent,challenge,accepted}) function. Alternatively, configure `nativeSigner` to use the bundled adapter to official `@x402/core` and `@x402/stellar` 2.28.0. It constructs the canonical payload for SF31's already approved exact option. `--diagnose --config /private/pilot.json` checks its installed dependencies and configured source without loading a key or wallet module. See [native signer setup](NATIVE_SIGNER.md) for both runtime source options. For POST, PUT or PATCH, an optional absolute operation.bodyFile supplies the exact request bytes (max 1 MiB). Only Content-Type and Accept request headers are configurable.

Review makes no external calls. Discover returns original source catalog listings but cannot authorize payment. Execute emits a brief status and the original SF52 aggregate report plus local SF82 evidence file path. Seller-reported settlement, observed HTTP delivery, and independently verified testnet transfer event remain distinct. SCF grant and merchant adoption stay with the existing owners. No hosted GitHub Actions or testnet payment is triggered by publication of this code.

Source lineage: SF31 buyer, SF81 one operator-approved operation, SF82 independent evidence, SF36 existing budget journal.

## Managed-cloud HTTPS gateway for unsigned catalog discovery

Some managed Linux runtimes resolve genuine public catalog hosts through a reserved
`198.18.0.0/15` HTTPS egress overlay. The default original SF31 public-address
transport refuses that DNS answer before any request (`NONPUBLIC_DNS_ANSWER`).
This is not evidence of an empty Vellar/Periplo catalog or a failed payment.

**Operator opt-in for `--discover` only:** use the CURRENT OS resolver from the
trusted runner (`node:dns/promises.lookup(host, {all:true, verbatim:true})`) on
the actual public HTTPS catalog hostname. If and only if it returns exactly
one IPv4 address and the operator knows this is that runner's 198.18/15 gateway,
add `sandboxGatewayIPv4` under the original `catalog` object. For example:

```json
{
  "catalog": {
    "origin": "https://vellar-facilitator-testnet-production.up.railway.app",
    "limit": 20,
    "sandboxGatewayIPv4": "198.18.126.99"
  }
}
```

**The numeric address is illustrative from an earlier VM, not a universal or
permanent gateway.** Do not reuse it unless that host's *fresh* OS DNS gives
the same sole address on the particular managed machine. A changed address,
mixed DNS answers, arbitrary private IP, direct IP-literal URL, bad origin,
URL credentials, redirects, or TLS identity mismatch all fail closed.
The transport pins the exact original DNS address and verifies original
hostname/port443/certificate/SNI. Its default DNS rules do not change.

Only the original unsigned `--discover` path passes this opt-in. `--review`
and `--prepare` have no network or signer. `--execute` continues to use the
unchanged original SF81/SF31 public-only signed/payment transport: the catalog
gateway cannot be used to authorize, sign, settle, retry or bypass spend
approval. Never enable this mode to defeat actual private-resource DNS.

Local source check, no network or wallet:
`node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/catalog-gateway.test.mjs`.
For live merchant acceptance, run the original real catalog URL through
`--discover` on the managed operator runner and record its actual returned
HTTP response/classification, source and original listing count. A catalog
listing is still not a customer or a payment.

## Prepare a review config from saved discovery

Start with a catalog-only config containing the `catalog` property shown above;
no operator, signer or operation is needed for discovery. Save its original output:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --discover --config /private/catalog-config.json > /private/catalog.json
```

Inspect `originalListings` and each row's `accepts` array. Select both **zero-based**
indices explicitly, supply a stable intent ID for the intended operation, and
enter the concrete URL including required query values. For a weather listing
at `/weather` whose advertised method is GET:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --prepare --discovery /private/catalog.json --row 0 --accept 0 \
  --intent-id weather-lagos-001 --url 'https://chosen-seller.example/weather?city=Lagos' \
  --method GET --out /private/weather-review.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/weather-review.json
```

Replace the example URL with the chosen listing's actual origin/path. Preparation
allows explicit query values; it refuses a different origin/path, unresolved path
templates or a method contradicting the listing. It does not fill query values or
request bodies from seller examples. For a body-bearing method, add your own
absolute `operation.bodyFile` and allowed headers before review.

The command also accepts an unchanged native saved `resources` or `items` catalog
envelope. Input is limited to 1 MiB; the resulting config must fit the existing
64 KiB config limit. The destination's trusted parent directory must already exist.
The config is created with mode `0600` and never overwrites an existing path.

The selected option supplies the original scheme, network, asset, recipient,
atomic amount, timeout and supported payment flow to `operation.expect`. The
complete original listing, including every option, unknown provider fields and
Bazaar input/schema, is retained under `preparedFrom`, with the input file's
SHA-256 and both selected indices. `--review` displays this saved source context
alongside the concrete operation. A raw catalog without a source URL records
`source:null`; no observation time or provider identity is invented.

Preparation makes no network request, loads no signer, copies no operator paths
from discovery, and generates no credentials or payment approval. The result has
`captureBody:false`; it is ready for offline review, not execution. Add your own
trusted operator, signer and evidence settings only after review. The saved listing
may be stale or edited: its hash identifies the file, not verified seller terms.
Execution still obtains a fresh original SF31 challenge, requires a unique matching
option within the displayed caps, and asks the original operator to approve its
full current terms. `preparedFrom` is review context, not an exact-option commitment
or a replacement for that approval; no unknown provider field is silently turned
into signer or payment authority.

## Save the returned dataset or other output

The optional response-file flow uses the original [SF31 writer](../sf31-buyer-client/SAVING_RESPONSES.md).
Set `captureBody` to `false` (or omit it), then use the same destination for review
and the independently authorized execution:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/pilot.json --response-out /private/downloads/dataset.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute --config /private/pilot.json --response-out /private/downloads/dataset.json
```

Review prints the destination and limits with `prepared:false`; it creates no
output file, contacts no provider and loads no signer. Execution prepares a
create-only destination before the buyer call. The original writer requires an
existing trusted parent directory and hard-link support; its completed and
partial files use mode `0600`.

For a saved configuration with different byte/time limits, add this top-level
property instead of the flag:

```json
"responseFile": {
  "destination": "/private/downloads/dataset.json",
  "maxBytes": 67108864,
  "timeoutMs": 30000
}
```

The flag and `responseFile` configuration are mutually exclusive, so an explicit
destination is never silently overridden. Defaults are 64 MiB and 30 seconds.
`--response-out` is available for review and execution, not catalog discovery.
`captureBody:true` conflicts with response-file saving: SF82's optional cloned
body capture and the file writer must not consume the same response concurrently.
The original SF82 receipt, reservation and independent verification remain active.

Saving starts immediately when the original buyer returns. It runs alongside
SF82's independent verification, because the HTTP transport's body deadline does
not pause for RPC work. The writer consumes the response once and never makes a
second buyer call, changes an intent ID, signs, retries or releases payment budget.

The command's JSON keeps the original buyer status and outcome report and adds
`responseFile` separately: `SAVED` includes path, byte count, SHA-256 and content
type; `FAILED` includes the local error and any retained nonempty `partialPath`;
`NOT_STARTED` means no returned response was handed to the writer. A successful
save does not prove settlement. An unsuccessful save does not undo a payment.

Exit code `2` retains the original buyer/evidence error priority. Exit code `3`
indicates a file-save or file-cleanup problem when the buyer/evidence adapter did
not return an error. An evidence-recording failure still reports any returned
buyer status and available local-file outcome. Keep those results and reconcile
the original operation; neither error code authorizes another purchase.

## Interruptions and local cleanup

SIGINT/SIGTERM now request cancellation through the original buyer and response writer. The command awaits local cleanup before exiting 130/143. A failed evidence pipeline also cancels an incomplete download immediately; an already published output remains saved. A rejected non-2xx response body is closed when the writer cannot consume it. These paths never make an additional buyer call.

The output reservation is prepared before loading the trusted signer module. If setup fails, the CLI reports any response-writer partial path or cleanup warnings along with the original error code. Completed-file cleanup warnings retain exit code 3. Nonempty partial files remain private and incomplete at the reported path; inspect that path and the original evidence/reservation before considering any further operation.

If evidence processing fails after a native buyer error, the summary now retains that original error's code, its known payment-sent state (or null when unknown), and the bounded original reservation metadata. `interrupted` and `retry:NO_AUTOMATIC_RETRY` accompany the original buyer status, independently produced outcome report and separate `responseFile.status`. Local file output is not payment proof, and a failed save does not undo an operation.

This increment retains the original SF88 launcher (PR #767), response-output integration (PR #795), and unchanged SF31 writer (PR #774), SF81 approval bridge and SF82 evidence adapter.

Focused local composition check (Node 22.3+ with module mocks): `node --experimental-test-module-mocks --test stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/response-delivery.test.mjs`. It uses original SF31 transport/writer and SF82 evidence with a substituted privileged SF81 constructor and local Response streams; it does not execute terminal approval, a signer, network or payment.
