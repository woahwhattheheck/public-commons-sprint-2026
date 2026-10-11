# SCF71 source-bound unpaid GET triage

This Node 22+ offline operator consumes original SF52 diagnostic JSON and
either saved native SF56 Vellar `capture.json` or the original SF71 manual
catalog envelope. It never calls a seller, facilitator, wallet or payment API.

```sh
node stellar/scf-starforge-20261009/sf71-unpaid-get-evidence/triage.mjs --report sf52.json --capture capture.json --out triage.json
```

For SF56 input, `capture.json` retains the original
`{source,capturedAt,pages:[{offset,body}]}`, with each `body` containing
the exact original JSON response bytes and native `{items,pagination}`.
The adapter imports the **unchanged** SF56 `analyzePages` source to enforce
Vellar testnet scope, original page hashes, pagination completeness, duplicate
resources, HTTP method, version, network, asset, amount and recipient admission.
The saved-capture adapter also preserves SF56's no-premature-short-page rule
and its native HTTP shape (`row.type` plus `input.method`); `input.type` remains
accepted for older operator envelopes but is not required of native listings.
Quarantined advertisements are not matching payment options. Raw hashes prove
local evidence consistency, not seller ownership.

Legacy operator-made envelopes are still accepted but cannot establish
third-party provider completeness. Bazaar `queryParams` are examples rather
than proven required fields. HTTP 400 is not a proven failed checkout or input
cause, and 402 is not settlement. Focused synthetic tests are not original
merchant/provider transaction evidence. No grant form, outreach, wallet or
hosted CI is performed.

