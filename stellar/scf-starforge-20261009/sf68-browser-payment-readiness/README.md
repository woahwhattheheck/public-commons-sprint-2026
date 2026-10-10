# SF68 | Original seller browser x402 readiness audit

**Merchant deliverable, not another payment processor.** A browser can get HTTP 402 yet be unable to read its `PAYMENT-REQUIRED` challenge or send its payment retry because of CORS. The real first-party [x402 Foundation issue #3722](https://github.com/x402-foundation/x402/issues/3722) reports 192/1,359 surveyed live seller endpoints that allowed some origins but did not expose the challenge header, plus 132 broken OPTIONS cases. Those are the reporter's measurements, not ours or evidence about an individual seller.

This Node 22+ zero-dependency source probes an operator-selected **actual seller URL with exactly GET and OPTIONS**, sends a caller-specified buyer `Origin`, and analyzes the observed response headers under CORS's standard noncredentialed/credentialed rules. It explicitly checks PAYMENT-REQUIRED visibility, duplicate or invalid Allow-Origin, PAYMENT-SIGNATURE preflight allow-list, paid method and OPTIONS status. It delivers concrete repair actions and original observed CORS response header values. It never sends the paid operation, PAYMENT-SIGNATURE, wallet bytes, a POST, a settlement, or a transaction. An HTTP observation is not by itself a guarantee that all browser integrations or the seller application work.

## Run on an original seller endpoint

```sh
node stellar/scf-starforge-20261009/sf68-browser-payment-readiness/audit.mjs \
  --resource https://seller.example.com/data \
  --origin https://buyer.example.com \
  --method POST \
  --out /private/seller-browser-audit.json
```

`--method` is the **intended client retry method**, only supplied to the read-only OPTIONS preflight. The tool's only network methods remain **unpaid GET and OPTIONS**. Supply `--credentialed` to evaluate browser fetches sending cookies/authorization; no credentials are actually transmitted. Credentialed CORS cannot rely on wildcard origin, expose or allow lists. The saved JSON is exclusive-create (`wx`), permissions `0600`, and retains only the relevant CORS headers and a boolean indicating whether PAYMENT-REQUIRED exists, not the original payment challenge bytes.

The tool requires a remote `https://` seller and buyer origin. An operator can enable literal `http://127.0.0.1` for a local seller and buyer via `--allow-loopback`; it rejects hostname-based HTTP, cross-origin identity confusion, credentials in URLs and redirects. No operator should interpret the parsed URL alone as an external security assertion. `--help` prints usage. Exit `0` reports `READABLE_402_AND_PREFLIGHT_READY`; exit `2` reports actionable `BROWSER_CHECKOUT_REMEDIATION`; exit `1` reports invalid input or request failure.

## Targeted original HTTP acceptance

One focused loopback server check, no hosted CI:

```sh
node --test stellar/scf-starforge-20261009/sf68-browser-payment-readiness/audit.test.mjs
```

It runs actual Node HTTP servers, performing original GET + OPTIONS against both correctly exposed and incorrectly gated routes, verifies merchant findings and **zero paid requests**, plus credentialed wildcard rejection. Live acceptance means invoke the CLI against a merchant endpoint under that seller's permitted read-only diagnostic scope. Seller HTTP 200 on a GET is classified as `UNPAID_GET_NOT_402`; a POST-only seller might legitimately require discovery via its actual advertised method, so do not assert the seller is broken without confirming the original contract. To validate actual browser behavior, run the real seller and buyer origins in a permitted Chromium environment in addition to this header audit. Chromium was unavailable for loopback navigation in the initial cloud test environment; the native Node HTTP acceptance passed.

## How this turns into a commercial/grant demonstration

Join this `schema: stellar-forge.browser-x402-readiness.v1` output with the independent existing [SF52 seller catalog visibility](../sf52-merchant-visibility/README.md) and [SF64 merchant repair packet](../sf64-merchant-conversion-report/README.md) for a seller-approved fixed-scope browser-to-catalog diagnosis. Distinguish browser header defects from origin challenge defects and absent facilitator indexing instead of guessing payment failures. SF49 retains commercial qualification and seller consent; SF10 retains the SCF Build #46 application; SF41/Muse retains live original captured corpus. Do not represent an issue reporter or fixture as a contracted customer, and do not equate receipt of HTTP 200/402 with onchain settlement or user adoption. MIT.
