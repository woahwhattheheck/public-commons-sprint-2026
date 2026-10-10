# Vendor-neutral ERP conversion reconciliation engine

**Status:** runnable proof-of-capability for a prospective **qualified ERP prime** responding to Columbus Consolidated Government, Georgia RFP 27-0008. MIT licensed. Does not submit a bid, offer a contracted service, access buyer data, claim City acceptance or verify a prime's suitability. Original buyer sources and proposal controls: https://columbusga.gov/finance/bid-opportunities and https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C861HB6Q6 .

## What it does

`reconcile.mjs` streams complete source and target CSVs, parses quoted multiline RFC4180-style columns (no arbitrary record sample cap), validates required vendor-mapped headers, and reconciles every source↔target composite key. Monetary fields use exact BigInt fixed-point arithmetic at declared scale and per-field tolerances, *never floating point rounding*. Duplicate keys and malformed precision fail instead of producing a false pass; missing/extra keys and per-key amount differences produce full machine-readable findings. The runner also reconciles sums across both files and optional group-by dimensions (e.g. fund/fiscal year). Each raw input and mapping configuration is SHA-256 hashed. All key and grouping identities in output use HMAC-SHA-256 keyed from the **local-only** `ERP_RECON_HMAC_KEY` secret; no raw employee IDs, fund/account identifiers or names are emitted. The full output report can still contain confidential amounts and must remain with authorized data controllers.

Input size is not artificially capped, but this implementation holds one key/value index per distinct composite key in memory (O(distinct keys)). For multimillion-key record sets, a disk-backed index and external sorter should be the next extension; do not imply production/regulated-data certification or throughput measurements from the 3-row local diagnostic.

## Run

Requires Node.js 22+; no npm packages and no network or payments. Keep CSVs, spec, secret and report in a private, authorized working directory. This repository contains only non-customer example fixtures.

```sh
export ERP_RECON_HMAC_KEY='use-a-private-random-key-of-at-least-20-characters'
node revenue/erp-conversion-assurance/reconcile.mjs \
 --spec revenue/erp-conversion-assurance/spec.sample.json \
 --source revenue/erp-conversion-assurance/source.sample.csv \
 --target revenue/erp-conversion-assurance/target.sample.csv \
 --out ./private-erp-report.json
```

Exit 0: `PASS` (same unique key set, amounts/group totals inside declared per-value tolerances). Exit 2: a structurally valid reconciliation report with full discrepancies (`FAIL`). Exit 1: malformed input, missing metadata, invalid precision, missing HMAC key, or file error. Status is not a procurement award or City acceptance.

`spec.sample.json` declares source/target column aliases, unique composite keys, amount precision and tolerances, optional `group_by`. You can make distinct scoped profiles for GL/fund balances, procurement/encumbrances, fixed assets, and per-employee parallel-payroll rows, but the *actual column schema and authorized exports* must be contracted/verified with the prime before using any real City data. Treat payroll separately under HR/privacy approval; do not post raw data or report to public GitHub/Slack.

## Commercial delivery/acceptance path (UNSENT)

1. Qualify actual ERP prime participation and two required comparable government implementations in the proposed team, not marketing-only references. Columbus's October 7 Addendum 2 replaced the submission deadline with Oct 28, 2026 5 PM Eastern.
2. Approve explicitly scoped file extracts with the prime and City: read-only export and schema, legal data permissions, column mapping, encrypted transfer, deletion retention, and report custody. No direct City-system connections or wallet credentials in this tool.
3. Run source/target conversion acceptance under authorized controls for each GL fund/year and payroll pay period, preserving original hash manifest and signed reviewer decision. Distinguish actual business-approved exceptions and tolerance from code PASS.
4. Package exception ledger + fixed acceptance agreement + payroll and cutover critical-path signoffs for a small, separately priced specialist prime workshare. Broader UAT/cutover/hypercare comes under a separately approved statement of work.

This is a commercial implementation enabler, NOT a claim that Tyler, CGI or another vendor is actually bidding. Outside outreach, price commitments and contract signing are not authorized here.
