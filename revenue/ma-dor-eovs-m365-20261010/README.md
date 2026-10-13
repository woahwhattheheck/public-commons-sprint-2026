# Migration Workbench — original evidence, cases and cutover

A complete local operating application for source inventories, file migration evidence, case/document relationships, explicit destination plans, independent rehearsal results, reviewed findings and portable customer continuation. The Python browser and command line share one original SQLite workspace, immutable source objects and request history.

## Start the complete application

Use Linux and Python 3.10 or later. The application uses the Python standard library; no package installation is required. From this complete directory:

    python3 migration_server.py --workspace /absolute/path/to/workspace --create --title "Migration review"

Open the local address printed by the server (default http://127.0.0.1:8083). Enter the operator name to record with changes. To reopen the same project, use the same command without --create. One process owns a workspace at a time; stop its server before opening that same workspace through the CLI.

For a received handover:

    python3 /absolute/received/application/migration_server.py --workspace /absolute/received/workspace

Keep the whole received application, workspace and retained object tree. The original standalone Node audit remains available for its compact JSONL contract; it is not the entry point for the full operating application.

## Choose the workflow

| Need | Start here |
| --- | --- |
| Import inventories/provider reports, review mappings, reconcile file evidence and work corrections | [Operating Workbench](OPERATING_WORKBENCH.md) |
| Project supplied cases/documents/links, set a lifecycle cutoff and destination policy, reconcile independent rehearsals, review findings and record cutover readiness | [Cases & cutover](CASE_MIGRATION.md) |
| Exact original operation envelope, parsers, pagination, source profiles and snapshot contracts | [Core API](MIGRATION_CORE.md) |
| Run the complete supplied-case programme, preserve interrupted requests and verify customer/return continuation | [Case receiving](CASE_RECEIVING.md) |

In the browser, retain complete original files in Sources. Then use the existing Rounds, Mappings & evidence, Reconciliation and Corrections views for file evidence, or open Cases & cutover for its six source-to-decision views. Handover & history prepares the entire editable project. Download the Cases working JSON separately when preserving unsubmitted browser drafts.

## Native entry points

    python3 migration_cli.py --workspace /absolute/path/to/workspace state
    python3 migration_cli.py --workspace /absolute/path/to/workspace case schema
    python3 migration_cli.py --workspace /absolute/path/to/workspace case list rehearsal --offset 0 --limit 100

The complete CLI also retains source import, original request inspection/resume, complete CSV/NDJSON exports, report publication, delivery preparation/download and independent receiving. Mutation requests use actual operation IDs, recorded actors and the current reviewed revision; examples in the guides identify where supplied values are required.

## Complete handover and source selection

New deliveries contain all 21 application files, the original SQLite snapshot, every retained object and earlier archive referenced by that snapshot, complete readable reports and full case/file result exports. Current case deliveries declare the exact commons.case-migration-application/v1 roster. Complete historical 16-file deliveries remain inspectable and receivable under their original profile and frozen bytes.

Read reports/review.html and reports/case-review.html in a prepared handover. Continue the same logical project in its separate received workspace, prepare a customer return, and independently reopen it. Re-receiving the original identical archive preserves later customer edits.

## Evidence and execution scope

The application interprets supplied originals and records explicit decisions. Independent target inventories remain separate from loader receipts. Missing evidence stays unresolved; a recorded cutover approval does not execute a tenant migration, establish effective access or replace the customer's acceptance process. Keep actual customer data and credentials in their authorized environment. The repository contains generic software and requires operator-supplied inputs.

The complete source and API reviews are distinct from execution of a selected customer programme. A native result must identify its actual source/input, complete outputs and closed operation.

---

## Historical origin — 10 October 2026

The original Massachusetts metadata-audit discovery note follows unchanged for provenance. Its dates, proposed commercial scope, founder decisions and agent-era holds describe that historical operation. They are not current application instructions, current procurement verification or standing approval policy for this workbench.

<details>
<summary>Original Massachusetts DOR / EOVS discovery and compact audit note</summary>

# Massachusetts DOR + EOVS M365 migration: independent evidence pilot

Commercial discovery and executable metadata-only migration acceptance tool — 2026-10-10.

## Buyer and procurement status (do not conflate)

1. Massachusetts DOR, bid **BD-27-1003-1003C-1003L-134297**: original COMMBUYS says **OPEN RFI**, information only, for future network-shares-to-SharePoint migration; posted Oct 8 and responses due **Nov 5, 2026 at 3:00 PM ET**. Official https://www.commbuys.com/bso/external/bidDetail.sda?docId=BD-27-1003-1003C-1003L-134297&external=true&parentUrl=close . Its original RFI DOCX attachment is linked on that page. Third-party reproduction reports **23 servers, ~30 TB, 730 root folders, 12 business units**, and an Oct 15 questions deadline; treat the detailed scope/earlier question gate as **unverified until the original DOCX is read**. An RFI is not a funded award or an invitation to submit a paid proposal. Mirror: https://app.govly.com/public/opportunities/17218642 .
2. Massachusetts EOTSS / EOVS, **RFQ 27-04987**, bid **BD-27-1060-ITD00-ITD00-134163**: mirrors show AWS-to-SharePoint/M365 migration due **Oct 29, 2026 at 3:00 PM ET**, with bidder eligibility reportedly restricted to **ITS81**; one COMMBUYS-derived mirror itself labels status **CLOSED**. Do not claim an open bid or submit before an authenticated eligible vendor verifies CURRENT portal status, official attachment, addenda and response rights. Sources: https://app.govly.com/public/opportunities/17208033 and https://www.lightrfp.com/marketplace/bid/COMMBUYS-BD-27-1060-ITD00-ITD00-134163/rfq-27-04987-for-m365-migration-services .
3. **Planet Technologies, Inc.** is on the CURRENT Massachusetts statewide **ITS81 Project Services/GIS** user-guide vendor roster with categories 1, 2, 3 and named public procurement contact **Neal Miller, nmiller@go-planet.com**. This establishes potential procurement eligibility, **not** actual EOVS invitation, bidding intent, subcontract acceptance or preferred-partner status. Massachusetts official https://www.statewidecontractuserguide.mass.gov/CUG/Guide/ITS81/E?Category=ITS . Planet independently lists its MA ITS81 vehicle and Microsoft government cloud services: https://go-planet.com/about-planet/contract-vehicles/ and https://go-planet.com/govcloud/ .

## Exactly what could be purchased

**Founder-approval proposal hypothesis, not a booked contract:** sell Planet or another demonstrably authorized implementing prime a **$4,600 fixed-fee, five-business-day independent migration evidence pilot**. Prime retains project management, production migration, government contract and security signoffs. TJLabs delivers a source/target evidence specification, a local metadata-only audit CLI, evidence reconciliation for a partner-supplied representative sample (target up to 20,000 matching file IDs within 16 MiB each input manifest), prioritized exceptions, a witnessed walkthrough and a signed delivery/acceptance packet. Fees, exact sample size, turnaround, scope rights and liability must be agreed in a written SOW **before** performance. Do not imply a state contract award or that any buyer will pay.

**Concrete buyer problem:** independent proof that moved files are complete, unmodified (for bit-preserving moves), mapped into expected target paths, assigned the expected security-principal identifiers and classification labels, with timestamps showing classification before migration. Raw file contents and tenant credentials remain entirely at the prime/client. We supply software and interpret output; a state/prime operator supplies genuine manifest exports. The sample audit is not a SOC 2/NIST/HIPAA certification, Purview API policy inspection, effective ACL test, tenant authorization or live government data inspection.

## Working product: offline reproducible JSONL acceptance

Required source.jsonl fields: sourceId, path, contentSha256 (lowercase 64 hex), sizeBytes (nonnegative safe integer), principals (unique nonempty string IDs), label, expectedTargetPath, classifiedAt (UTC ISO timestamp).
Required target.jsonl fields: sourceId, path, contentSha256, sizeBytes, principals, label, migratedAt (UTC ISO timestamp). sourceId and target ID are a partner-defined persistent mapping and MUST NOT be inferred from a mutable path.

    node audit.mjs source.jsonl target.jsonl
    node --test audit.test.mjs

The CLI returns deterministic PASS/FAIL JSON, sorted per-object failure codes, and exit status 2 on mismatches or 64 on malformed inputs; it has no network calls, signer, write path, cloud account access, client dataset or paid service dependency. A PASS means only that TWO PROVIDED MANIFESTS agree under declared rules. Manifest collection/original hash computation, Microsoft Purview and retention/DLP policy checks, inherited group expansion, storage region checks, chain of custody and secure tenant access must be separately performed by the authorized implementer; never assert them from these rows.

Pilot scale: each JSONL file must be <=16 MiB; this bounded offline module is **not** a validated 30 TB migration engine or a full independent effective-access audit. Do not publish real agency manifests or personally identifying paths in this public repo.

## Founder-ready decision and reusable lead workflow

Check prior account history: an earlier September Snohomish County lead packet mentioned Planet Technologies; do not double-contact a relationship or resend anything from that lane. **Owner decision: pursue ONE authorized Planet contact after reviewing that history, or reject.** No email was sent, no state bid was submitted, no government tenant data was obtained and no payment or buyer interest is claimed in this operation.

The repeatable route is: (a) public buyer+live identifier+closing gate, (b) first-party qualification of a legal bidder/prime, (c) an explicitly independent and fixed-scope acceptance wedge with real runnable artifacts, (d) CRM/history suppression and founder review, (e) one consensual partner conversation, (f) paid written SOW and receipt before expanding delivery. For the two MA notices, reuse the same qualified partner research but treat their bid statuses, restrictions and eventual revenue as **separate opportunities**.

## Source and provenance caution

The DOR COMMBUYS public original page is available; the EOVS official attachment and bid-rights could not be independently accessed here. All claimed detailed security and timing clauses from mirrors require re-checking against the original vendor-accessible DOCX. Source pages are date-sensitive and the status may change.

</details>
