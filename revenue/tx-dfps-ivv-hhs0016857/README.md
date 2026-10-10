# TX DFPS HHS0016857 — independent IV&V evidence gate

**Non-bounty buyer→qualified prime→specialist acceptance proof · 2026-10-10 · PUBLIC, no agency records.** This is a functioning, strictly offline Python standard-library verifier and an internal commercial decision; it is **not** a proposal, government compliance certification, contract, official evaluation, or any real DFPS/UAT evidence.

## Why this exact buyer matters

The **original Texas Comptroller ESBD record** [HHS0016857](https://www.txsmartbuy.gov/esbd/HHS0016857) names HHSC/DFPS's Independent Verification and Validation Services for Case Management Transformation of the IMPACT replacement. On Oct 10 the original page said **Addendum Posted** and documented:

- **Addendum No. 3, September 15, 2026:** submission deadline replaced to **October 20, 2026 at 10:30 AM Central Time**, and Exhibit H Cost Proposal replaced in full. Follow THIS revision, not early September 17 aggregator dates.
- **Addendum No. 2, September 9:** Exhibit Q HUB Subcontracting Plan replaced in full.
- **Addendum No. 1, September 4:** replacements for Exhibit H cost, Exhibit I insurance, Exhibit O online bid room instructions, and added security/privacy inquiry P-1.
- The original issued scope concerns independently evaluating project management/reporting, project-wide processes, and systems/environment/architecture/processes/products. Original RFO and all addenda/attachment files must govern bidder eligibility, security, forms and response submission.

**This public implementation does not assert that it has inspected all seven binary RFO attachments**, and is NOT a bid checklist or representation of the buyer's required acceptance criteria. It models one useful independently auditable workshare capability: baseline-pinned requirements→tests→review evidence, reproducible artifact bytes/digests, independent reviewer, temporal freshness, and fail-closed reporting.

## Actual working tool

Run with Python 3.10+ (stdlib, no service, network, package installation or GitHub Actions):

```shell
python ivv_gate.py sample-manifest.json --report sample-report.json
python -m unittest -q test_ivv_gate  # one focused evidence integrity check
```

The checked-in `artifacts/acceptance-note.json` is an explicitly illustrative, locally source-hashed artifact. Its **actual file byte SHA256** is pinned in `sample-manifest.json`; `sample-report.json` is the true output of the CLI running against those exact bytes, not a simulated government result. Editing the file, changing the baseline, claiming the same implementer reviewed their own implementation, missing a required test or recording future evidence turns the decision red. A single focused Linux Python check exercised these actual behavior cases (`1 test` with matching subcases), PASS on October 10.

Manifest contract (`tj-ivv-evidence/v1`): offset-aware `review_as_of`; canonical `baseline`; `implementer_org`; unique `requirements` with `required_tests`; `observations` with unique ID, requirement/test/baseline, `outcome` (`pass`, `fail`, `blocked`, `not-run`), `observed_at`, `reviewer_org`, relative `artifact_path`, and exact SHA256 of original local bytes. The app rejects duplicate JSON keys and IDs, orphan tests, inconsistent baseline, future evidence, untrusted filesystem escapes, absent/tampered artifacts, conflict outcomes at a single timestamp, and a reviewer whose organization matches the implementer. It chooses the latest valid observation for each test; all required tests must be positively verified and no observation integrity errors can remain. Exit codes: **0 = gate PASS**, **2 = gate FAIL**, **1 = invalid input or I/O**. The explicit report field `payment_or_buyer_compliance_proven:false` prevents using a green local demo as an agency approval.

Never put DFPS citizens' information, confidential bidder materials, production access tokens or private customer data in this repository or checked-in example. Deploy into a separately authorized environment only under the actual prime's approved data/procurement controls.

## Paid relationship hypothesis — partner, not a fake prime claim

**Potential prime/integrator:** [Integris Applied (Sourcing Advisory Services LLC), Texas DIR contract DIR-CPO-6264](https://dir.texas.gov/contracts/dir-cpo-6264). The current Texas DIR listing independently confirms **active** deliverables-based IT services including Category 3 IV&V and Category 4 project/program management, and explicitly states the DIR contract covers **services only**, no resellers. [Integris's first-party DBITS page](https://integrisapplied.com/dbits/) confirms the same legal identity, Texas HUB/woman-owned description and named managing director **Tim Ryckman** with a public business route. The different DIR contract **does not make Integris an actual bidder, awardee, authorized prime on THIS HHS RFO, our client, or an interested reseller**. Also, the DIR vehicle's "no resellers" term cannot be hand-waved away: any subcontract is conditional on this RFO's rules, an actual legal partner and the appropriate vehicle, never a resale of the DIR agreement.

**Alternate technical match:** [BerryDunn independent verification and validation consulting](https://www.berrydunn.com/ivv-services), whose first-party service line discusses oversight of complex state initiatives; no current HHS opportunity participation has been established.

**Potential specialist package to SELL (proposed, not offered or accepted):** a **five-business-day, $3,600 fixed-fee independent evidence-intake and replay pilot**, up to twelve prime-selected, non-sensitive acceptance tests, with two pinned artifact snapshots, machine-verifiable traceability coverage, conflict/exception ledger, an independent reviewer handoff and operator runbook. Proposed commercial milestones: $1,200 on an approved SOW+intake and $2,400 upon accepted source-bound report. The prime owns direct HHSC contract, IV&V professional judgment, staffing/insurance/security compliance, state bidder eligibility and final submission; TJLabs would supply a separable **technical evidence validator and defect triage** as authorized supporting capacity. Commercial price is an internal **hypothesis** and must be reviewed against actual input volume, liability and agency restrictions before any binding quote.

**Acceptance shape:** (1) test supplied buyer-authorized artifact bytes against hashes; (2) every critical requirement/test either carries independent positive evidence or is an explicit non-green exception; (3) detect changed/replayed payloads, stale revisions, changed reviewer and missing scope; (4) reproducible exit status and machine-readable report; (5) approved prime reviews data handling, logs and handoff. Zero claims of independent agency certification, actual Texas award, proposal, customer response, money owed or money received.

**Go/no-go gates BEFORE CONTACT/SOW:** original RFO+latest Exhibit H/Q/O, mandatory minimum qualifications, permitted subcontracts/organizational independence, HUB plan and insurance, TX-RAMP and security/privacy requirements, no conflicted implementer affiliation, named prime confirmation it is bidding/needs independent evidence capacity, authorized client artifact sharing, credible schedule given the **October 20, 10:30 AM CT** bid cutoff, one existing relationship owner, and explicit founder-controlled outreach approval. If any fail, **NO-BID** this procurement; retain the general service for another legitimate customer rather than inventing an award.

## Source ledger and control

| Layer | URL | Established use |
|---|---|---|
| Original buyer issued | https://www.txsmartbuy.gov/esbd/HHS0016857 | Live issuer metadata and Addenda 1–3 chronology, Oct 20 10:30 CT deadline |
| State contract | https://dir.texas.gov/contracts/dir-cpo-6264 | Sourcing Advisory / Integris existing 2026 IV&V DBITS vehicle, no reseller |
| Named potential partner | https://integrisapplied.com/dbits/ | First-party stated capabilities, HUB and contact, not this opportunity's bidder receipt |
| Alternate partner | https://www.berrydunn.com/ivv-services | First-party independent IV&V capabilities only |

No contact, solicitation response, vendor registration, signature, payment, private system access, credential use, private repo mutation or GitHub Actions run is included. The separately signed existing-owner sales handoff is `COMMERCIAL_DECISION.md`; the proposed introduction text is **UNSENT**.