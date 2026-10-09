# Caseboard lifecycle and localhost execution

Recovery of the original ClaimProof caseboard from PR #209. The original `caseboard.html` blob was `ce0294fe9b3a0587dbce2baac8cb7ec1ff8cda41`; the server blob was `70d7e2d17349f6189d85f29d5ebf260505b79cce`. Both were fetched and hash-checked before editing. No changes touch the checkout server, PayPal APIs, entrant ownership, or original source attribution.

## Delivered fixes

Clear now invalidates imports suspended in file reading or SHA-256 verification, preventing cleared buyer records from reappearing. Admission rechecks the 500-case cap after awaited verification, rather than letting concurrent imports admit case 501. Replacing a selected review refreshes the advisory inspector instead of displaying stale content. The grid uses the built-in Quartz/dark theme API; the old `theme: 'legacy'` had neither required stylesheets nor a legacy theme class. The localhost server catches invalid request URLs and returns JSON 400 instead of terminating.

## Reproduce

From `claimproof-commerce`, using Node 22:

```sh
node evidence/caseboard-lifecycle/check.cjs
node evidence/caseboard-lifecycle/server-smoke.cjs
```

`check.cjs` executes the real HTML's inline application code with real WebCrypto and synthetic review records. DOM and AG Grid are explicit test doubles, so this is not visual or CDN acceptance. Four focused checks failed before the changes and four passed afterward; the capacity check uses 499 preloaded fixture rows, not hundreds of separate tests.

`server-smoke.cjs` starts the actual production server on a temporary loopback port. Two grouped checks cover the page, read-only route, content-security policy, malformed URL, and same-process health afterward. No external network, model or payment requests occur. The original process really terminated with `ERR_INVALID_URL`; the fixed process returns 400 and remains healthy.

See `before.txt`, `after.txt`, and `server-after.txt` for captured runs. Full browser rendering with the pinned CDN library remains unverified in this DNS-restricted environment. Source theme contract: https://www.ag-grid.com/javascript-data-grid/theming-v32-themes/ and https://www.ag-grid.com/javascript-data-grid/themes/ .
