# Columbus GA RFP 27-0008 — source-grounded GL and payroll conversion acceptance

**Scope:** bidder/prime-facing technical specification for an *independent subcontracted migration QA workshare*, not a bid, approved City mapping, live City export, or authorization to access data. Accompanies the already-merged vendor-neutral `../../reconcile.mjs` (W2); does not modify its engine. The source/target headers in this folder are **ILLUSTRATIVE CONTRACT ALIASES**, NOT verified City/CGI Advantage column names.

## First-party authority, source version and actual buyer requirements

- Columbus Consolidated Government [RFP 27-0008 (51 pp.)](https://columbusga.gov/Portals/finance/adam/Content/LDQoKeGkfk6iEZfk7wkYyw/SolicitationDocument/RFP27-0008.pdf), pp. 13 (CGI Advantage 4.0 SaaS incumbent; transition, validation, parallel payroll); 21 (multi-fund GL, configurable chart of accounts, journal posting); 23 (payroll, taxes, garnishments/deductions); 26 (financial and payroll history migration + validation/reconciliation).
- Official [Oct 7 Addendum No. 2 (6 pp.)](https://columbusga.gov/Portals/finance/Resources/bid-opportunities/2027/Heather%20FY27/RFP27-0008Add2.pdf?ver=wbOYnkUWs-BsSJZBX9578g%3D%3D), p. 1 extends electronic prime bid to **Oct 28, 2026, 5 PM Eastern**, with separate Q&A addendum still to come; p. 4 §11(G)–(I) requires source extraction/mapping/validation, years of history, number of trial conversions, named vendor/City responsibilities, interface inventory, parallel payroll and City-approved phase acceptance; §11(K)–(L) covers rollback and first fiscal/payroll year-end.
- [City's current bid-opportunities listing](https://columbusga.gov/finance/bid-opportunities) is controlling for later addenda. A prime alone submits through OpenBids; RFP p. 8 requires subcontractor disclosure and pays the prime, not the subcontractor.
- CGI's published [Advantage 4 chart-of-accounts classifications](https://myadvantagecloud.cgi.com/GACCG40/PRDHelpService/fin/MainHelp/mergedProjects/Chart_of_Accounts/COA/Chart_of_Accounts_Classifications.htm) explains Fund, Revenue, Object, and Balance Sheet Account classifications; this confirms logical **business concepts**, not Columbus physical database fields.
- CGI's published [Payroll Accounting Management overview](https://myadvantagecloud.cgi.com/GACCG40/PRDHelpService/hrm/MainHelp/mergedProjects/Payroll_Accounting_Management/PAM/Business_Area_Overview.htm) describes Gross-to-Net, deductions/fringe, fund-level posting and payroll journal/financial journal relationships; [PAM transaction reference](https://myadvantagecloud.cgi.com/GACCG40/PRDHelpService/hrm/MainHelp/mergedProjects/Payroll_Accounting_Management/PAM/Transaction_Information.htm) distinguishes PREXP/PRLIA/PRLNP etc. This is publicly documented product behavior, NOT proof the City's configuration implements every document type.

## Domain-profile contract

| Profile | Actual procurement question | Proposed normalized logical grain | W2 checks | Additional City/prime-controlled acceptance |
| --- | --- | --- | --- | --- |
| `gl.profile.json` | Can financial history be converted while retaining multi-fund chart/journal context? | Fiscal year + fund + posting period + stable journal/document ID + line ID + account class + account code. | Exact two-decimal debit and credit by business key and fund/year rollup; missing/extra/duplicate/precision reporting. | Separate signed debit/credit trial-balance for each fund/year, opening/closing/encumbrance continuity, account classification/reconciliation, reversible identifier crosswalk, complete period coverage. A W2 PASS alone cannot certify GL balance. |
| `payroll.profile.json` | Does parallel payroll agree for every approved pay run? | Pay period end + payroll cycle + pseudonymous employee crosswalk + payment/check sequence. | Exact two-decimal gross, net, employee tax, deductions, employer fringe; no tolerance in sample; report HMAC-only identities. | Separate signed gross-to-net reconciliations, benefit/garnishment/tax buckets, reversal/void/off-cycle payments, withholding/legal checks, bank/direct-deposit, PREXP/PRLIA/PRLNP reconciliation and City HR/Finance phase approval. An amount match is not payroll certification. |

**Precision convention:** nominal ISO-4217 USD cents (scale=2) for these two illustrative profiles; `0.00` tolerance is a **proposed strict default**, not an adopted City threshold. The City/prime must sign off permitted rounding, report currency, amount signs, source accounting basis, conversion years and exceptions. The W2 engine compares signed decimal strings as exact BigInt units: never feed floating-point-formatted exports.

### Real-mapping admission gates — complete before protected data

1. Capture named prime technical owner and City Finance (GL)/HR-Payroll acceptance owners, legal permission to access City/CGI/target data, export provenance/version/hash, permitted geographic storage, encryption, least privilege, approved operator account, custody and deletion schedule. Do not copy any protected data into this public repo, Slack or an unapproved VM.
2. Obtain **actual** CSV/export headers, data types, precision, tokenization and legal permissible fields from the authorized City/prime; replace example `source_columns` and `target_columns` with those exact headers. These are the ONLY physical-column claims accepted for a real run. The public CGI documentation is not a Columbus data dictionary.
3. Have City/prime approve stable ID crosswalk rules, fund/COA code translations, fiscal calendars, post/void/reversal semantics, duplicate/zero-amount behavior, pay-cycle/check uniqueness, off-cycle inclusion, sign convention, quantity/rounding, historical cutoff/freeze and excluded records. Input data must already be normalized to the same approved business keys; this engine does **not** infer equivalence of different account IDs or employee IDs.
4. Scope one GL trial by `(fiscal_year,fund)` and one payroll trial by `(pay_period_end,pay_cycle)`; run the stock W2 engine on complete authorized exports. A W2 PASS is **necessary but not sufficient**: attach non-engine balancing, payroll legality, integration/UAT and rollback receipts. Any absent required City signoff is NOT ACCEPTED, regardless of CLI status.
5. Keep HMAC key only in an authorized secret environment (`ERP_RECON_HMAC_KEY` length >=20), per-client segregated; do not put it in public code. W2 masks report IDs with HMAC but **amounts and private input files remain sensitive**. Approve data retention/transfer/destruction and redact/segregate reports before any prime-facing distribution.

### Acceptance decision register (must be approved by real prime/City, not defaulted)

| Gate | Evidence and pass rule | Required approver | Status before actual data |
| --- | --- | --- | --- |
| G0 — scope/custody | Export+schema license, jurisdiction, HMAC custody, data authority, trial IDs | Prime DPO/security + City owner | NOT YET APPROVED |
| G1 — GL keys | One-to-one source/target business key crosswalk; no missing/extra/duplicate; complete period/fund coverage | Prime conversion lead + City Finance | NOT YET APPROVED |
| G2 — GL money | Exact per-line debit/credit + fund/year deltas, separately verified trial balance, postings and account hierarchy | City Finance controller | NOT YET APPROVED |
| P1 — payroll keys | Every approved employee/paycheck/run incl reversals/off-cycle; beneficiary privacy and records custody | City Payroll + HR/privacy | NOT YET APPROVED |
| P2 — payroll money | Gross/net/tax/deduction/fringe exact per approved policy + separately signed gross-to-net, liability/expense and bank outputs | City Payroll controller + Finance | NOT YET APPROVED |
| X1 — lifecycle | Repeated trial conversions, integration/UAT, backout drill, first fiscal and calendar payroll year-end, exception disposition | Prime PM + City designated acceptance authority | NOT YET APPROVED |

## Run the unchanged W2 engine with non-City diagnostic samples

Requires Node 22+ with the original public checkout. Examples contain **invented generic accounting/payroll rows**, not City records or confirmed City source column names. The payroll target deliberately changes one employee's net payment by one cent to demonstrate an exact FAIL.

~~~sh
export ERP_RECON_HMAC_KEY='diagnostic-only-not-a-customer-secret'
node revenue/erp-conversion-assurance/profiles/columbus-rfp27-0008/profile-smoke.test.mjs
~~~

Expected: GL sample status PASS and payroll sample status FAIL with a `net_pay` amount delta of `0.01`. The smoke invokes the actual source `../../reconcile.mjs`; no network, CI, City data, customer signing or payment. Source CSVs and JSON reports remain operator-controlled for any real pilot.

**Commercial handoff:** W3 owns actual pursuing-prime qualification, W5 owns the subcontract SOW and invoice gates, W6 owns owner-approved single-recipient route. This W4 package supplies named evidence for §§11(G)–(I); it is not a solicitation response or authorization to contact the City, CGI, Tyler, prospects or Michael.
