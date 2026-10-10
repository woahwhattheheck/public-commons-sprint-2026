# Oregon DOT ITSM replacement: qualified partner workshare and executable QA

**Claim:** ODOT-ITSM-00015263-CENTENNIAL-PAID-MIGRATION-QA-20261010  
**Date:** October 10, 2026 | **Commercial state:** RESEARCH + PRODUCT COMPLETE, $0 booked, NO contact / bid / SOW / payment.

## First-party buyer, exact deadline and source custody

Oregon Department of Transportation issued **S-73000-00015263**, “RFQ for SaaS ITSM Platform,” via the [original OregonBuys posting](https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-73000-00015263&external=true&parentUrl=close). Publicly posted September 15. Due October 29, 2026 **1 p.m. Oregon local time**. The original listing names four source attachments: 00015263 RFQ.docx, 00015263 Addendum 1.docx, 00015263 Purchase Order Sample.docx and Proposer Information and Certification Sheet.doc. Addendum 1 was issued September 24, adding the certification form and changing the questions deadline.

An [independent analysis of these originals](https://publicbidsearch.com/bids/rfq-for-saas-itsm-platform-or-5f64c5) describes BMC Remedy 8.1.02 replacement, incident/request/asset/knowledge/problem/change workflows, Microsoft Entra ID and Workday synchronization, migration, training and support. It states October 19 at 9 a.m. Pacific is the revised question cutoff. **The operator must independently retrieve the original FOUR buyer documents and all later amendments and check their exact legal/technical terms before ANY outward offer.** Secondary extracted details are not a substitute for authoritative buyer addenda.

## Specific plausible implementation prime, not claimed participant

[Centennial Technologies first-party 2024 federal civilian Remedy-to-ServiceNow case](https://www.centennialtechnologies.com/case_study/asset-management-modernization-with-servicenow-remedy-servicenow/) documents original-system profiling, de-duplication, canonical CMDB normalization, lifecycle mapping and parallel cutover reconciliation. That is a concrete technical match to a possible BMC migration. It does **not** mean Centennial intends to bid, offers approved Oregon SaaS licensing, has a signed relationship with ODOT or has subcontract work available. The buyer has not specified ServiceNow by brand on its public notice.

Distinct from Berkeley 27-11797-C/Alcor, CCC NG2610/Sierra-Cedar, Naperville, and earlier RPI contact. October 10 exact both-Gmail-mailbox scans for Centennial name/domain/this solicitation/ODOT buyer found **no matching IDs**; repeat a complete recipient+opt-out check immediately before any proposed outreach.

## Conditional revenue transaction, not another lead packet

**TJL proposed independent QA pilot:** **$3,600 / ten business days** for one agreed export scope and a buyer/prime-approved canonical field crosswalk. This is a **negotiable hypothesis**, NOT procurement price, accepted quote, or committed income. Proposed milestones: baseline/approved extract; source-to-target identity/status/assignment/asset-link/digest reconciliation; complete redacted exception census and disposition; focused rerun after changes; immutable SHA-256 provenance and one-page pass/exception decision.

Proposed terms to negotiate, not binding: 50% on approved kickoff and 50% on accepted final QA report. No speculative access, platform licensing, customer credential transfer, production writes, or confidential record uploads to the fleet. Prime must confirm it controls the right exports and may share approved canonical projections before any live data work.

## Original executable and tested scope

The adjacent Node 22+ dependency-free **acceptance.mjs** actually compares *complete supplied* canonical Remedy and target exports, not synthetic stand-ins for a vendor SDK. It checks source/target legacy key membership, missing and extra target records regardless of matching aggregate counts, duplicate source keys, duplicate target record IDs, canonical status/owner/assignee drift, lost SHA-256 attachment digests, asset reference drift and dangling asset links. Findings list hashed record keys rather than raw legacy identifiers and include input SHA-256. It never connects to a network or any buyer system.

The export contract is JSON with these top-level fields:

- schemaVersion: tjl-itsm-acceptance-v1
- system: remedy OR target
- records: array of objects with type (incident, request, problem, change, asset or knowledge), legacyId, canonicalStatus, optional ownerKey/assigneeKey, assetRefs string array, attachmentSha256 string array of lowercase full SHA-256 digests.
- Every target record also requires its own unique targetRecordId.

Examples use no real buyer records. A buyer-approved crosswalk must *normalize* target-specific statuses and user keys before comparison; equality of those mapped values is not proof of Entra or Workday authorization or real platform acceptance.

Run read-only locally:

    node acceptance.mjs REMEDY.json TARGET.json --out report.json
    node --test acceptance.test.mjs

Exit status 0 = selected canonical fields agree, 1 = actual exceptions, 2 = invalid data or runtime error. --out refuses overwrite. The **ONE focused original Node22 check: 5/5 PASS** at authoring, covering parity, multi-class drift, missing+extra despite equal counts, duplicate identities, invalid digests. No hosted Actions and no general repository tests.

## Revenue progression owned by one decision-maker

1. **Signed-in original OregonBuys operator:** obtain all four current issuer DOC/DOCX plus amendments; hash each; confirm correct questions date, subcontract terms, insurance/certifications, SaaS legal/reseller rules, data rights, security, demos and actual evaluation before any partner claim.
2. **Single sales owner:** one contemporaneous complete history/opt-out check, verify first-party Centennial contact and one live bid-intent answer. Source case alone does not prove bidder intent.
3. **Bryce:** approve ONE exact recipient and final body in FOUNDER_DECISION_UNSENT.md or decide PASS. Nothing may be sent to the agency or vendor under this engineering claim.
4. **Only on positive real response:** buyer/prime-approved export mapping, agreed purchase order/SOW, independent QA execution, accepted invoice then genuine cash receipt. Until then $0 accepted/invoiced/paid.

Internal [#sales TAKE](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791613985368669). No spend, bounties, excluded competitions, Michael Clark contact, paused demo, SCF application, or GitHub CI.
