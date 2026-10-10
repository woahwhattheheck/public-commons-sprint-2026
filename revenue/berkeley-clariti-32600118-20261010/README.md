# Berkeley / Clariti permitting cutover: independent acceptance evidence

**Status:** Public MIT source, one local focused test executed, internal founder-reviewed commercial opportunity only. No relationship with Clariti, Berkeley, or its implementation partners is claimed. This is not a certified Clariti integration, City-provided acceptance criterion, contract award, or implementation milestone.

## Actual buyer, awarded vendor, and incremental budget

**Buyer:** City of Berkeley, California. **Actual contracted provider:** Clariti Cloud Inc. The City Council's January 20, 2026 consent record (item 16, RFP specification **24-11661-C**) records Resolution 72,090–N.S., authorizing the comprehensive Permit Software Procurement project, **up to $5,359,128**, for permitting, licensing, inspections, cross-department operations, migration, system integrations, citizen portal, training, hosting, and five years of support. The associated Council report says the negotiated $4,871,934 plus contingency; a not-to-exceed contract ceiling is **not actual spending**. A May 12, 2026 council agenda and report identify amended Contract **32600118**, adding **special-event permitting** for up to **$121,000**, revising total ceiling to **$5,480,128**. A ceiling or change-order authorization is **not a subcontracting budget available to us**.

**First-party source evidence** (public):
- [Berkeley Jan 20, 2026 Council item 16](https://berkeleyca.gov/city-council-regular-meeting-eagenda-january-20-2026)
- [Berkeley Jan 20, 2026 Clariti contract staff report](https://berkeleyca.gov/sites/default/files/2026-01/2026-01-20%20Item%2016%20Contract%20Clariti%20Cloud%20Inc.pdf)
- [Berkeley May 12, 2026 Contract 32600118 amendment report](https://berkeleyca.gov/sites/default/files/2026-04/2026-05-12%20Item%2005%20Contract%20No.%2032600118%20Amendment.pdf)
- [Clariti official partner program](https://www.claritisoftware.com/partners) — specifically lists implementation and technology partner routes and `partnerships@claritisoftware.com`; does not verify willingness or capacity to buy an independent audit.
- [Clariti Enterprise public product scope](https://www.claritisoftware.com/products/enterprise-permitting-software) — permits, inspections, code enforcement, planning, process automation, portal, flexible APIs.

## Narrow technical product: vendor-neutral independent cutover comparison

`audit.mjs` is a **no-dependency, offline, read-only Node 22** source/target comparison of **normalized, same-cohort snapshots**. It accepts *locally furnished extracts prepared by an authorized data owner*, not Clariti APIs, private City datasets, or production logins. The supported canonical JSON shape is:

```json
{
  "cohort":"cutover-2026-accepted-snapshot-01",
  "records":[{
    "id":"CASE-001",
    "type":"permit",
    "department":"Planning",
    "status":"in_review",
    "relatedIds":["INSPECTION-001"],
    "reviewStates":{"Fire":"approved","PublicWorks":"pending"},
    "attachments":2,
    "paymentMinor":"0"
  }]
}
```

The `type` vocabulary is `permit`, `license`, `inspection`, `special_event`. `reviewStates` is an **observed department→state map**, not an assumption about which departments must approve which case. The case identifier must be the stable *normalized* join key on both sides; `cohort` must match, and both snapshots must represent the same intended observation point. `attachments` is an explicit nonnegative count; `paymentMinor` is an optional nonnegative decimal string (normalized minor currency units; no payment initiation). For linked cases, include both ends within the same cohort if you want an orphan check. All transformations and legal requirements remain an **owner-controlled source mapping**, not guessed from the public contract.

Run:

```bash
node revenue/berkeley-clariti-32600118-20261010/audit.mjs --source old-normalized.json --target new-normalized.json > cutover-report.json
# exit 0 = reconciled snapshot; 2 = discrepancies requiring human review; 3 = invalid input/errors
node --test revenue/berkeley-clariti-32600118-20261010/audit.test.mjs
```

Checks: missing/unexpected cases, changed type/department/status, lost/added case relations, changed departmental reviewer status, changed attachment count, changed normalized payment minor units, and orphaned destination links. Strict duplicate-ID/cohort and schema defenses refuse malformed evidence rather than silently pass. Report is aggregated, and bounded example references use **ephemeral HMAC-derived tags**, not names, addresses, raw identifiers, raw amounts, or evidence rows; HMAC key is not published in report. Source and destination are never mutated. The code cannot contact the City or vendor or infer ledger correctness, permissions, audit trails, workflow legality, or final go-live suitability.

**Focused receipt:** On Ubuntu/Linux Node 22.16.0, `node --test audit.test.mjs` executed **3/3 PASS**, checking true matching case parity, five targeted evidence discrepancies (including cross-department special-events review drift), and wrong-cohort/duplicate/incomplete hard refusals. No broad suites or GitHub Actions run, no vendor data touched. No buyer has accepted or licensed this proof-of-capability.

## Workshare opportunity (owner review only)

**Differentiation:** Clariti already has implementation and technology partners, so a generic claim that its platform needs external engineers would be weak. A plausible *independent* offer is 5 business days of supervised, audit-friendly cross-department cutover reconciliation for a **single authorized 200–500-case cohort** covering source/target permit metadata, inspections, licensing and new special-event reviewer handoffs. Complete work only on approved pseudonymized exports. Require an authorized Clariti/implementation partner sponsor, one signed statement of work, permitted data use, owner-approved acceptance scope and valid procurement treatment *before* engagement.

**Illustrative, unquoted internal price hypothesis:** $3,200 fixed for a five-business-day pilot if data volume, format, owner and security gates are satisfied: $1,200 for cohort mapping and case-contract acceptance; $2,000 upon independent discrepancy report + human sign-off. This is not Clariti's price, an approved rate, guaranteed opportunity, invoice, signed deal, or proof that the $121,000 amendment can pay for it.

**Owner-controlled first route:** Exact first-party official Clariti `partnerships@claritisoftware.com` (not a proven buyer or willing subcontracting authority); alternate partner network includes Avocette, Accenture and Deloitte implementation partners and Carahsoft procurement partner, with no inference they participated in Berkeley. Current two connected Gmail accounts were scoped-read for `claritisoftware.com`, `Clariti Cloud`, `24-11661-C`, `32600118`; each returned zero matching messages, which does not establish no outside contact. Before an external approach, have Bryce validate prior relationship custody, specific recipient/sender, message text, commercial terms, and any relevant vendor/subcontracting requirements. Do not contact Berkeley directly for a vendor's independent acceptance bid without proper procurement route.

### UNSENT — internal outreach candidate, not delivered

**To (owner to verify):** partnerships@claritisoftware.com  
**Subject:** Independent cutover acceptance capacity for municipal permitting programs

Hello Clariti partnerships team,

I saw the City of Berkeley's public contract records for its permitting modernization and the later special-events permitting scope. We build vendor-neutral, read-only reconciliation tools that help implementation teams document what did and did not transfer correctly across permit records, departmental review states, inspections, case links, and supporting attachments.

If one of your implementation teams has a need for independent cutover acceptance or time-limited evidence reconciliation capacity, would you point me to the appropriate partnership owner? We can share a small working, dependency-free sample and discuss a tightly scoped pilot using only authorized, pseudonymized extracts. No access to City systems would be needed for that initial conversation.

Thank you.

**Operational status:** This draft is **not sent**, no partner acceptance or customer reply has occurred, no bid/submission/cash or owner commitment. The primary revenue gate is a real authorized prime/partner expressing actual interest; if absent, STOP the lane rather than treating an unsigned prospect as revenue. No Michael Clark outreach or previously claimed Berkeley ServiceNow RFP/Alcor work is implicated.