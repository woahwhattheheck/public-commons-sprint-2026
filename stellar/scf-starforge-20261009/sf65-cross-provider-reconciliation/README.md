# SF65 | Cross-provider discovery integrity

MIT · Stellar x402 · offline operator evidence · Node.js 22 · no hosted CI

## Purpose

Compare two independently captured, complete native Bazaar catalogs from different facilitator endpoints with the *same Stellar network and native GET filter scope*. This is the SCF grant's differentiating trust experiment, not another generic listing browser.

Existing original SF56 snapshotFromNative validates the untouched SF41 raw page SHA-256, native pagination coverage, source/permission/time metadata, original envelope and canonical SF45 HTTP/MCP route identity. SF65 imports that validator directly, without editing it. It does not call the network, merchant, wallet, payment SDK or chain.

## Run with real original source

1. The existing SF41/Muse source-capture owner obtains two original, independently published facilitator GET /discovery/resources captures, preserving each complete sources.json and exact JSON page bytes. Both must use the same explicitly selected network (for example, stellar:testnet) and native GET filters; source endpoints must differ.
2. Check the actual source permissions, timestamps and coverage. Do not flatten a vendor payload, fabricate an absent route, manually amend hashes or substitute a mock benchmark. An existing genuine Vellar 27-of-27 GET corpus can serve as one original source. Obtain a second independent actual source from the existing runner.
3. Execute the original native validator and SF65 offline:

    node stellar/scf-starforge-20261009/sf65-cross-provider-reconciliation/cli.mjs --left /vellar/sources.json --right /other-provider/sources.json --out-dir /new-empty-report-dir

The command publishes report.json (all canonical route findings), report.html (static, source-linked review), and receipts.json (report hashes and original manifest hashes). It refuses to silently overwrite any named output. Captures separated by over 90 minutes are flagged as temporally unpaired.

## What gets compared

Original SF56 hashes three distinct buckets per native SF45 canonical route: payment alternatives, input/Bazaar contract and remaining metadata. Shared routes are classified as identical, metadata-only, payment conflict, contract conflict, or combined conflict. A route found in only one complete captured native scope is marked provider-only and **not** globally absent. Every conflict is a call for independently authorized seller-origin/HTTP-402 quote review, not evidence of seller misconduct or current price drift.

Full JSON includes actual provider endpoint, capture time, original manifest checksum, verified coverage, row and canonical counts, shared/only/conflicting route counts, per-identity evidence, network and timing delta. HTML has no scripts, external assets or pay controls. Each report states paymentCalls=0.

## Verification

Run one focused local invariant check when needed:

    node stellar/scf-starforge-20261009/sf65-cross-provider-reconciliation/acceptance.mjs

The 10 simple comparator assertions only prove accounting/classification logic. **They are not a live-provider A/B or payment measurement.** The original Muse runner should execute the genuine source pair and send the exact full page hashes, corpus timestamps, results and operator receipt to #sim-data. SF10 founder owner can then use the observed result in the existing unsent SCF #46 application, with no duplicate application or false revenue/settlement claim.

No existing SF41, SF45, SF56, SF60/61, SF62/63/64, original merchant endpoint, live payment code or competition account is modified.
