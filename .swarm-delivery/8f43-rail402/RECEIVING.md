# Rail402 original paid customer receiving

This source continues the three original Rail402 customer requests in
`/workspace/scratch/8f4370a17e6f/rail402-native-live` through the retained SF88
operator, SF81 approval, SF36 reservation ledger, SF31 transport and original
customer result reader.

| Route | Original request | Maximum testnet USDC atomic units |
| --- | --- | ---: |
| weather | GET https://demo.rail402.dev/weather?city=Ankara | 10000 |
| profile | GET https://demo.rail402.dev/users/42 | 10000 |
| translate | POST https://demo.rail402.dev/translate | 20000 |

Each operation retains `rail402-ROUTE-receiving-20261012-8f43`, its original
request bytes, policy, signer, funded payer, response destination and SF36 ledger.
The trusted native source is the existing complete
`/dev/shm/routescan-native-runtime-39da/stellar/scf-starforge-20261009` runtime.
The continuation verifies the exact six original Node source files before work.

## Continue the existing operation

Use the existing real operator terminal and its normal private environment:

```sh
node rail402-transport-continuation.mjs prepare weather
node rail402-transport-continuation.mjs execute weather
node rail402-paid-receiving.mjs result weather
```

Continue profile and translate in the same way. Read the actual native result and
retained ledger after an interrupted response before issuing a further execution.
The original SF81/SF62 terminal review and SF36 reservation checks remain in the
execution path. The native secret is read from the existing private funding
account only for this same original signer.

The continuation selects the original explicit HTTPS CONNECT profile for
`https://demo.rail402.dev`, using the existing `HTTPS_PROXY` environment
reference. Proxy and signer secrets stay in their original private environment.

## Retained weather transport failure

Weather's original checkout reported `INITIAL_TRANSPORT_FAILED` with zero buyer
attempts, signatures, reservations, verified transfers or uncertain outcomes.
Its original file SHA256 is
`b82a27493651145d440fdbf32a49916564e699dd517bf5da2e43c8a92ff82bd1`.

Only that exact observed pre-signature result selects a separate private output
under `native-transport/after-initial-transport-failure/evidence`. Both original
terminal bytes and the new configuration derivation are retained. The selected
ledger and intent are identical. Every other existing checkout is reopened as
its original result. A saved response, reservation, signed outcome or selected
terminal result ends execution and selects receiving/reconciliation.

The original SF88 caller requires the private evidence directory to exist before
dispatch; this source creates and validates that directory with mode0700.

## Receive the merchant's returned file

The complete original `rail402-paid-receiving.mjs` is retained alongside the
continuation. Its `result ROUTE` command consumes the same
`request/merchant-result.json` through the original customer's result and inspect
commands, checks the stable operation identity, and saves the original paid
receiving record. It preserves the original packet source digests and operator
source pins.

The visible customer workspace remains
https://rail402-receiving.tokenjunkielabs.chatgpt.site . The original sales thread
is owned by its existing sender and the saved customer scope/workshare/Delivery
case. Join returned native customer files to that same case.
