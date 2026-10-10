# Sumter SC school procurement software — qualified partner/paid UAT workshare

**Operation ID:** `SUMTER-SC-RFQ-2027-018-OPENGOV-PARTNER-QA-20261010-GPT6CLOUD`  
**Prepared:** October 10, 2026 (America/New_York)  
**Owner lane:** original new nonbounty buyer → proven school-sector vendor/reseller → narrowly scoped paid subcontract conversation.  
**Stage:** `SOURCE_MATCHED / PARTNER_NOT_CONTACTED / NO_BID / NO_SOW / NO_INVOICE / NO_PAYMENT`.

## 1. Real active purchasing need, not a speculative product brief

South Carolina's original public procurement advertising authority posted **RFQ-2027-018**, *Digital Procurement Solutions for Solicitations*, on **October 2, 2026**. The named purchaser is **Sumter School District**. The district is seeking a contract for software to modernize and streamline its procurement solicitations. **Quote/submittal deadline: Friday, October 23, 2026 at 11:00 a.m. Eastern** (local South Carolina time). The official ad identifies Carlos W. Burns at the district procurement office as the buyer of record; this is *not* an authorization for our team to contact the buyer.

- Official state-issued advertisement, including deadline and procurement contact: <https://scbo.sc.gov/printad?a=69282>
- District's original source page listing the **RFQ-2027-018 Digital Procurement Solutions System** document: <https://finance.sumterschools.net/procurement/solicitations>
- District-hosted original-document link, as exposed by its official site: <https://drive.google.com/file/d/1J_ubcwLrU-bdbGnvEHooerM4R7FrolVB/view?usp=drive_link>

**Document acquisition, assigned next step:** A logged-in local browser or approved browser connector must open the original district-linked PDF, capture its unchanged bytes and SHA-256, then extract: scope/functional requirements, administrative instructions, permitted vendor/partner roles, authorized submission channel, addenda, insurance/legal terms, questions deadline, scoring, price sheet, data/privacy obligations and earliest start. The public Google Drive viewer presented a loading page in this cloud web context; **we have NOT reviewed the PDF**. Until acquired, do not assert the solicitation *requires* the particular UAT checkpoints below. Preserve source-version and live-buyer deadline if the PDF supersedes the ad.

## 2. Independently proven same-sector solution and legitimate channel

**Platform: OpenGov Procurement.** This is a concrete functional/sector fit, not a claim OpenGov plans to respond to the Sumter RFQ:

- **Greenville County School District** (also SC, K–12) states on its own live procurement website it has partnered with **OpenGov** and uses a web-based e-procurement portal for vendor registration, solicitation notifications, amendments/addenda, electronic response guidance and related functions: <https://www.greenville.k12.sc.us/Departments/main.asp?titleid=solicitations>.
- The platform supplier independently describes the Greenville County Schools procurement program: <https://opengov.com/newsroom/greenville-county-school-district-streamlines-procurement-with-opengov/>. Vendor statements about future savings are marketing claims, not an observed Sumter deployment or an acceptance guarantee.
- **Vertosoft** currently publishes a named OpenGov supplier/reseller listing, public-sector contract routes and contact **opengov@vertosoft.com**, phone **571-707-4130**: <https://vertosoft.com/opengov-2/>. OpenGov itself lists Vertosoft as a partner on <https://opengov.com/partners/> and <https://opengov.com/partner-list/>. A public government contract listing independently describes Vertosoft as a vendor of OpenGov products and related implementation services: <https://dir.texas.gov/contracts/vendors/vertosoft-llc>.

**Primary first contact after owner approval:** Vertosoft's named OpenGov channel (no send yet). **Alternative, not simultaneous cold outreach:** OpenGov's official partner application route; ask whichever channel is engaged whether an *independent acceptance/transition QA* specialist fits its proposal. Never imply we are an OpenGov/Vertosoft employee, certified partner, current supplier, awardee or incumbent. Do not solicit either organization twice through different swarm agents.

## 3. Commercial wedge: separable, demonstrable *paid* workshare

**Offer hypothesis:** A vendor-side, fixed-scope **five-business-day staging acceptance and evidence sprint** for K–12 procurement-system rollout. Our role is independent cutover, buyer-journey and vendor-journey QA—not replacing OpenGov procurement, rewriting its core platform, or advising the district to break RFQ communications rules. This can be subcontracted by the authorized prime/reseller **only if they want it and permit staging access**.

**Owner-internal price hypothesis (not a customer quote):** **$3,500 fixed**, scope and margin subject to platform access, actual RFQ, vendor approval and paid SOW. Payment milestone model to negotiate: approved test plan and sandbox access → evidence report/defect replay/cutover decision. No accepted price, deposit, contract, or revenue exists as of this packet.

**Deliverables once there is a signed SOW and staging tenant:**

1. A 1–2 page traceable acceptance plan mapped to the *original signed source and chosen platform release*.
2. Executed role-distinct supplier registration/bidder workflow and procurement-officer workflow, with source input hashes, timestamps and screenshots or audit export.
3. Reproducible scenarios for solicitation lifecycle, vendor notices, addenda, cutoff/time zones, restricted bid visibility, evaluation trail and accessible report export, *only where actual bidder/source scope warrants*.
4. One defect ledger (repro steps, severity, vendor ownership, retest status), a final cutover recommendation and remaining risk signoff. No assertion of compliance certification or security audit beyond executed checks.

**Why this is a credible separately purchasable service:** The buyer is actively purchasing procurement software; Greenville's public implementation shows a school-district workflow; the reseller has an authentic named commercial channel; launch correctness and buyer acceptance are naturally distinct from licensing/proposal writing. The above does **not** prove the vendor has need, funding or willingness to subcontract. Commercial validation is the next human response.

## 4. Proposed acceptance work items (design, NOT verified tender clauses)

See [`acceptance_matrix.csv`](./acceptance_matrix.csv). Each row has a pass/fail predicate and required first-party evidence. The selected vendor and PDF determine which are in scope. Never stage a fake ledger receipt or claim screenshots from unexecuted flows. Distinguish test data from actual source systems. Explicit `NO_ACCESS` and `NOT_IN_SCOPE` are honest workflow outcomes; the owner can request the actual logs using their logged-in local browser, rather than hand-waving them away.

## 5. Exactly who does what next, with a deadline

**Local procurement-source operator / Oct 10–12:** Retrieve original buyer RFQ PDF and any addenda, calculate checksum, check actual terms and permissible channel; paste only sanitized requirements/URLs/metadata into original `#sales` claim thread. Stop any unsanctioned buyer communication.

**Named partner qualification / Oct 12–13:** Check whether Vertosoft already participates or has a protected government bid contact and if vendor-side subcontract is permissible. No assumption of participation. If this checks out, original relationship owner approves **one** outreach route. Avoid duplicate contact from another fleet seat; hold other contacts while awaiting partner reply.

**Vendor-positive path / Oct 13–20:** Ask for 20-minute commercial discovery on procurement bid scope and launch QA; offer scope at **hypothetical** $3,500 / 5 days; vendor may decline or negotiate. If interested, send an actual priced SOW for acceptance, confidentiality, scope, deliverables, billing and access. No work-for-fee without written acceptance. Vendor, not swarm, owns bidder registration, RFQ response and any customer representations.

**Oct 23 11:00 a.m. EDT:** Original external procurement deadline, not our own submission unless separately approved and eligible. If a partner answers after the cutoff, consider a **post-award** QA service only with an actual awardee's permission, rather than backdating outreach.

## 6. Owner-ready *UNSENT* single-channel outreach draft

**Recipient:** Vertosoft OpenGov channel — `opengov@vertosoft.com`. **Status: UNSENT, awaiting original source terms and relationship-owner approval.** The information below is not a bidder-submitted proposal, and the user has not approved outbound transmission or a legal statement of capability.

**Subject:** Sumter Schools RFQ-2027-018 — small independent e-procurement acceptance QA workshare

Hello Vertosoft OpenGov team,

I found Sumter School District's October 23 procurement-software solicitation, RFQ-2027-018. Greenville County Schools' publicly documented OpenGov Procurement rollout caught my attention because it is a useful same-state K–12 example of supplier onboarding, addenda and electronic solicitation management.

Would your public-sector team consider a narrowly scoped independent staging acceptance/UAT workshare if you're involved in this opportunity or similar school-district rollouts? We can scope a five-business-day evidence package around supplier onboarding, deadline handling, addenda, role-restricted bid visibility, evaluation audit trail and handover reporting, with reproducible test cases and a concise defect/acceptance report. This would support an authorized prime's implementation rather than replace the software or represent your company.

If there is an appropriate OpenGov school-district procurement or implementation-partner contact, would you point me to the right person for a short scope discussion? I can send the proposed acceptance checklist first.

Best,
TokenJunkieLabs

**Do not send automatically.** First reconcile the original RFQ PDF, sender identity, proof of past work, prior contact ledger, channel restrictions, owner approval and any buyer-specific no-contact rules. Never contact Michael Clark or the paused demo channel as part of this lane.

## 7. Original-source record and stage ownership

| ID | Evidence | What it proves | What it does not prove |
| --- | --- | --- | --- |
| SUMTER-BUYER-01 | SCBO advertisement / 2026-10-02 | Active request and exact 2026-10-23 11:00 EDT deadline | RFQ technical conditions from original PDF |
| SUMTER-BUYER-02 | District solicitations page / 2026-10-10 | RFQ #018 PDF actually listed by issuer | Entire original PDF captured/read |
| SUMTER-COMP-01 | Greenville County Schools first-party page | School district publicly declares actual OpenGov procurement portal | OpenGov bidding for Sumter |
| SUMTER-SUPPLIER-01 | OpenGov/Vertosoft official partner pages | Real partner and channel | Supplier agrees to employ TJL |
| SUMTER-SALES-01 | This document, UNSENT | Specific price-and-acceptance hypothesis ready for a human reply | Contract, award, invoice, remittance or cash |

**Nonbounty business KPI:** 1 new verified public buyer, 1 specific platform match with independent same-sector deployment, 1 authentic channel, 1 proposed paid pilot. 0 partner contacts, 0 signed SOWs, 0 invoices, **$0 realized cash from this case**. Update the stage only from provider/readback events, never from existence of a draft.
