# SF88: One-command approved Stellar buyer pilot

Operator-side executable joining ORIGINAL SF31 buyer HTTP, SF81/SF62/SF36 approval and reservation, and SF82/SF43/SF52 durable evidence. This is not a new signer, wallet, merchant service, ledger, protocol, auto-payer or replacement for the existing SF82 seller pilot.

From the complete public sprint checkout, using Node 22+ and Python 3.11+:

1. Put an owner-reviewed config JSON in a private local directory. It contains only chosen public quote terms and paths to trusted operator files and the existing signer module. Keep the SF36 secret keys outside the config in the operator environment.
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

The trusted signer module exports an async sign({intent,challenge,accepted}) function backed by the already-installed official Stellar x402 SDK; no signer, private key or wallet implementation is bundled. For POST, PUT or PATCH, an optional absolute operation.bodyFile supplies the exact request bytes (max 1 MiB). Only Content-Type and Accept request headers are configurable.

Review makes no external calls. Discover returns original source catalog listings but cannot authorize payment. Execute emits a brief status and the original SF52 aggregate report plus local SF82 evidence file path. Seller-reported settlement, observed HTTP delivery, and independently verified testnet transfer event remain distinct. SCF grant and merchant adoption stay with the existing owners. No hosted GitHub Actions or testnet payment is triggered by publication of this code.

Source lineage: SF31 buyer, SF81 one operator-approved operation, SF82 independent evidence, SF36 existing budget journal.

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
