# OTF Rapid Response approved-case workbench

A complete local casework application for the October 2026 OTF Rapid Response vendor programme. It follows the original approved-case workflow: actual awarded contract → requested scope and budget → written programme-manager approval → actual casework and at-cost expenses → reports, invoices, payment history and complete closeout.

The companion vendor submission compiler lives in ../vendor_submission_20261011. Its proposal prices and requested ceiling remain proposal inputs; importing that draft does not create an award or case authorization.

## Run and receive

The portable model and report modules use standard JavaScript and SHA-256. The ordinary Node CLI and standalone browser desk use the same model. Node 22 or newer is required for the CLI. No package installation, hosted service or GitHub workflow is required.

The full editable workbook includes every original source document, operation and requested/approved scope edition. Receiving validates full source bytes and the original history before accepting a continuation. A divergent history stays explicit. A handover ZIP includes workbook.json, a readable index, complete case reports, frozen invoice HTML/CSV, all original source files and a member manifest.

Actual contract, beneficiary, staffing, receipts, approval messages, procurement decisions and payments belong in a private local working directory. Keep real completed workbooks out of this public source repository. Use beneficiary and worker aliases in routine views and preserve sensitive originals only where authorized.

## Actual contract and case boundaries

Record the actual signed award, its dates, USD total and category ceilings, one to five fully loaded labor rates, selected services and real declared operating days/hours. The initial programme maximum is USD 150,000; there is no default award or guaranteed volume. The model retains a single actual rate schedule. Source-backed ceiling/end amendments are supported; a changed rate schedule needs a separate contract workbook preserving the previous history.

For each case, retain its need, intended outcomes, selected service, task deliverables, requested role minutes and direct-cost lines. Record the case application or change request and written OTF programme-manager work order separately. Actual time and direct cost bind to the written approval that was effective when the work occurred. A later amendment cannot silently rewrite that history. Split a time entry at an approval boundary.

Case-preparation, proposal-preparation and administrative records remain in the original history with an excluded billing status. An invoice selects actual approved casework only. A worker cannot overlap retained time entries across cases. Each selected entry can belong to only one nonvoid invoice. Reports are required where the approved engagement says so. An invoice begins as a frozen prepared document; actual submission and payment require their own original source records.

Labor amounts use exact USD cents and whole minutes, with each actual entry rounded half up to a cent. This explicit application convention is not stated as an issuer rule: confirm it against the actual signed agreement before use. Direct costs record the original actual cost, receipt and allowability determination, without a margin. The model checks cumulative approved case budgets against actual contract and category ceilings. Closeout retains explicit writeoffs for any eligible but uninvoiced entries and releases unused case allocation.

## Appendix A

The application records clause-specific applicability, actual determination and source documents. It never derives a legal certification from a web search or a selected checkbox. The source mapping is in issuer-rules.json. Clause 8's threshold applies to the actual awarded contract, not an individual case. Clause 9 includes every lower-tier subcontract; each recorded subcontract retains its parent, original agreement and actual flowdown determination. Travel, invention rights, US performance/recruitment, environmental, covered telecom and goods-procurement conditions retain the actual context. Read the original agreement and applicable provisions before entering the responsible person's determination.

## Source basis

- [Original issuer notice](https://www.opentech.fund/news/open-technology-fund-requests-proposals-for-the-rapid-response-fund/)
- [Complete original RFP and Appendix A](https://www.opentech.fund/wp-content/uploads/2026/10/Rapid-Response-Fund_RFP-2026-.pdf)

The current original notice and full PDF extraction were recovered and their retained source hashes matched. Public software contains source locations and paraphrased rule mappings. Actual private bidder and case originals remain with their working owner.

## Build and receiving discipline

This directory's AGENTS.md carries the complete owner instruction for actual rendered-product inspection. Open the exact outgoing desk, exercise the complete populated case course, inspect desktop and narrow widths, open the original attachments and exported reports/CSV/ZIP, and receive the complete workbook in a fresh desk before presenting an outgoing client version. Inspect the actual pixels and exported files and repair concrete defects in this implementation. The focused source course is not a substitute for the real rendered application.
