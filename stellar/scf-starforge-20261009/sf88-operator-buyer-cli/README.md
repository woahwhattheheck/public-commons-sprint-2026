# SF88: One-command approved Stellar buyer pilot

Operator-side executable joining ORIGINAL SF31 buyer HTTP, SF81/SF62/SF36 approval and reservation, and SF82/SF43/SF52 durable evidence. This is not a new signer, wallet, merchant service, ledger, protocol, auto-payer or replacement for the existing SF82 seller pilot.

From the complete public sprint checkout, using Node 22+ and Python 3.11+:

1. Put an owner-reviewed config JSON in a private local directory. It contains only chosen public quote terms and paths to trusted operator files and the existing signer module. Keep the SF36 secret keys outside the config in the operator environment.
2. Review the method, resource URL, base-unit spend cap and body digest without network via: node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --review --config /private/pilot.json
3. Optionally use --discover --config /private/pilot.json to read the ORIGINAL catalog without payment or signing. Manually select and review actual source terms. Discovery is not approval.
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
