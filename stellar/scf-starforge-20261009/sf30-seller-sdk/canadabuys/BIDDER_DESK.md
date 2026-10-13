# CanadaBuys saved bidder desk

The bidder desk turns the existing retained CanadaBuys notices into a saved company review and decision workflow. It uses the original SQLite workspace, original source rows, HTTP service, Applications lifecycle, client, CLI, merchant provider and package receiver.

Open **Bidder desk** from the procurement workspace. The direct local route is **/bidder-desk**. The application remains a single owned local service. Its two browser pages use the same workspace.

## Operating journey

### 1. Select the company and actual opportunity

Capture or import the complete official tender source in the procurement workspace. The bidder page lists its retained notices; search by title, buyer or reference. The selected notice shows the original reference and solicitation numbers, publisher status, original closing field, source capture, complete bilingual row, linked documents and all retained editions.

Create a company profile under **Company profile**. Save its legal and operating names, capabilities, included/excluded terms, procurement categories, exact commodity code families, delivery/opportunity regions, qualification claims and supporting documents. Capacity separates delivery availability from minimum bid preparation time. Commercial preferences retain exact decimal amounts and currency; blank values remain unspecified.

The company profile is an authored statement. A matching keyword or commodity code is a reason to inspect the opportunity. The fit result exposes each observed publisher value, the declared capability and the reason for a match, gap or unknown. The human decision is saved separately.

**Check profile fit** evaluates every retained notice against the selected saved profile. **Review this notice against the selected profile** opens all checks for the current notice. Each result includes the exact source entry, source-row hash and selected profile revision.

### 2. Retain and review the documents

Under **Documents**, save the solicitation and its amendments, annexes, questions and answers, supplier records, certifications, security documents and past-performance evidence. Select the original source URL, publisher version, issue date, relevant page/section and relationship to any earlier document.

Attach the actual file to retain its complete bytes. Browser, client and native model enforce a 64 MiB per-document capacity. The model calculates the digest and byte length, retains the body once per digest and keeps each document metadata edition. Downloading an earlier document revision returns its original body.

A document may instead retain a link, an access restriction or a retrieval failure. These states remain visible. Mark the document **REVIEWED** with reviewer, review time and note when its content has been reviewed. A company document can be shared across notices; a solicitation document remains bound to its original notice.

Replacing document bytes, source URL, version, issue date or access state produces a new edition. A material change resets review to **UNREVIEWED** unless the submitted edit includes an explicit new review with reviewer and a later review time. The earlier reviewed edition remains in history.

### 3. Assess the actual requirements

Under **Requirements**, record the original clause and classify it as mandatory, rated, contractual, informational or unknown. Record its applicability, reviewer, review time, owner, clarification question and next due time.

Add source and supplier evidence separately. Select the exact saved document edition, page/section, relevant extract and reference note. A source reference identifies the requirement; supplier evidence supports the company’s answer.

The assessment choices are **UNREVIEWED**, **MET**, **NOT_MET**, **UNKNOWN** and **NOT_APPLICABLE**. A met assessment requires an explicit review plus source and supplier references. A not-applicable assessment records the applicability basis. Material edits to the clause, classification, applicability or references reset the assessment unless an explicit new review is supplied.

A document’s later edition does not replace the referenced earlier edition. The decision review identifies documents that changed after a requirement assessment, while retaining both the reviewed edition and the current edition where needed.

### 4. Review the context and save the decision

Under **Decision & reports**, choose the notice edition and company profile revision. **Use current notice and profile** explicitly selects their current editions. If reviewing a historical notice edition, select it and acknowledge that choice.

Record **Bid**, **No bid**, **Investigate** or **Park**, with rationale, decision owner, conditions, open questions, reviewer and complete next actions. Each action has a stable identity, task, owner, due time and open/done/cancelled state.

Press **Review selected context**. The page displays all capability checks, mandatory-review issues and changed-document issues. The model returns a digest for the complete context reviewed. Saving the decision supplies that digest inside the same SQLite transaction that rechecks the selected context. If the source, profile, documents or requirement editions changed during the review, the save asks for reassessment.

Every saved decision contains its original source row and metadata, company profile, evidence metadata, requirements, capability assessment, review, actions and context digest. A new decision or substantive decision edit records the reviewed context. A native administrative patch containing only owner and/or next actions preserves the prior frozen context, assessment and review time.

The four choices are available with the recorded evidence and open questions. The fit engine does not turn a match into a bid decision or silently replace the reviewer’s choice.

### 5. Compare and deliver

**Compare saved decision with current records** compares the frozen decision against the latest retained notice, profile, evidence and requirements. It shows complete before/after values and reassessment reasons. It does not overwrite the saved decision.

Download an HTML, JSON or CSV report for any selected decision revision. HTML is a standalone reading copy. JSON retains the full saved envelope. CSV includes typed sections for the decision, actions, source fields, profile, fit checks, requirements, document references and changes. Spreadsheet display cells are escaped while JSON retains original values.

**Download selected workspace package** carries the selected notice history, complete included CSV bodies, original workshares and all referenced bidder records. The bidder graph includes every earlier edition through each selected head, exact evidence bodies and relevant command receipts. A full-workspace package includes all saved profiles and documents, including work that has no decision yet.

Receive through the original **Sources & handoffs** view, native CLI, HTTP client or merchant tools. The receiving transaction validates all included source and record identities before committing. Matching history is reused; new consistent editions append; an incoming older head never replaces a newer local head. Divergent histories or command receipts are retained with the complete incoming bidder package in the saved receiving result for review.

## Data semantics

The implementation reads the actual bilingual CanadaBuys columns retained by the existing source model. Tender status and award status are interpreted in their own source context. Missing data and literal unknown codes remain unknown.

CanadaBuys documents the tender closing field with a fixed UTC−05:00 basis. The original parser and bidder checks preserve the original wall time and offset; they do not substitute a daylight-saving timezone. See the official [CSV support guide](https://canadabuys.canada.ca/en/tender-opportunities/csv-file-support).

Commodity code families remain explicit. A code declared as UNSPSC is not compared as GSIN. Region declarations carry their family and explanatory note; a supplier address or geographic match does not establish a procurement eligibility clause.

The profile’s delivery availability is compared with a retained expected performance start where available. Minimum preparation days use the tender deadline. Contract values remain separate from authored commercial preferences, and an absent original value does not become zero.

Awards and standing offers/supply arrangements remain available through the original notice relationships and full workspace. Their original reference, solicitation, contract and supplier fields retain their source identities. The bidder feature does not add a second source acquisition process.

## Native and HTTP use

All mutations use explicit revisions. Creating a record uses the current workspace revision. Updating a record uses that record’s current revision. A stable command ID identifies a complete save input and its committed result.

The browser maintains the same command ID for an unchanged retry. Native clients can do the same. A repeated committed save returns the original record and current workspace metadata, with alreadyApplied. Reusing the same command ID for different input returns a conflict.

### A saved profile and decision with the Node client

Use the actual running operator origin and retained notice ID. Fill the company statement from the business being reviewed.

~~~js
import { CanadaBuysClient } from './client.mjs';

const client = new CanadaBuysClient(operatorOrigin);
let { workspace } = await client.bidderStatus();

const profileResult = await client.bidderCreate('profile', {
  commandId: profileSaveCommandId,
  label: company.profileName,
  legalName: company.legalName,
  description: company.capabilities,
  keywords: company.searchTerms,
  commodityCodes: company.commodityCodes,
  deliveryRegions: company.deliveryRegions,
  qualificationClaims: company.qualificationClaims,
  capacity: company.capacity,
  commercial: company.commercial
}, workspace.revision);

const notice = await client.notice(noticeId);
const profile = profileResult.record;
const selection = {
  noticeId: notice.id,
  sourceEntryId: notice.currentEntry.id,
  profileId: profile.id,
  profileRevision: profile.revision
};

const reviewed = await client.bidderAssess(selection);
// Present reviewed.context and reviewed.assessment to the reviewer.
({ workspace } = await client.bidderStatus());
const saved = await client.bidderCreate('decision', {
  ...selection,
  contextSha256: reviewed.contextSha256,
  commandId: decisionSaveCommandId,
  choice: reviewer.choice,
  rationale: reviewer.rationale,
  reviewedBy: reviewer.name,
  owner: reviewer.owner,
  unknowns: reviewer.openQuestions,
  conditions: reviewer.conditions,
  nextActions: reviewer.actions
}, workspace.revision);

const report = await client.bidderReport(saved.record.id, {
  revision: saved.record.revision, format: 'html'
});
const comparison = await client.bidderComparison(saved.record.id);
~~~

The API never changes the reviewed context merely because another source, profile or evidence revision has appeared. A changed context returns DECISION_CONTEXT_REVIEW_REQUIRED; read and review the new context, then submit its digest.

### Actual evidence bytes

~~~js
const body = await readFile(originalDocumentPath);
const state = await client.bidderStatus();
const saved = await client.bidderCreate('evidence', {
  commandId: documentSaveCommandId,
  noticeId,
  title: originalDocumentTitle,
  kind: 'SOLICITATION',
  sourceUrl: originalDocumentUrl,
  localOrigin: originalDocumentName,
  bodyBase64: body.toString('base64'),
  version: publisherVersion,
  language: 'en'
}, state.workspace.revision);

const download = await client.bidderEvidence(saved.record.id, {
  revision: saved.record.revision
});
// download.body is a Uint8Array containing the exact saved bytes.
~~~

To update only a nested field, provide only that field. For example, a capacity-state update retains the original availability, lead time and note. Changing a document’s review note retains its other review fields unless a material document change requires a new review.

### CLI

The source command and installed canadabuys command expose the same operations. Use canadabuys help for the complete existing source/workshare/merchant commands.

~~~bash
canadabuys bidder-status --workspace /absolute/procurement
canadabuys bidder-list --workspace /absolute/procurement --kind profile
canadabuys bidder-create --workspace /absolute/procurement \
  --kind profile --file /absolute/company-profile.json \
  --expected-revision 4 --command-id company-profile-first-save

canadabuys bidder-create --workspace /absolute/procurement \
  --kind evidence --notice-id ORIGINAL_NOTICE_ID \
  --file /absolute/document-description.json \
  --attachment /absolute/original-solicitation.pdf \
  --expected-revision 5 --command-id solicitation-first-save

canadabuys bidder-assess --workspace /absolute/procurement \
  --file /absolute/decision-selection.json --out /absolute/review-context.json

canadabuys bidder-create --workspace /absolute/procurement \
  --kind decision --file /absolute/reviewed-decision.json \
  --expected-revision 6 --command-id reviewed-decision-first-save

canadabuys bidder-record --workspace /absolute/procurement \
  --kind decision --record-id ORIGINAL_DECISION_ID --history
canadabuys bidder-report --workspace /absolute/procurement \
  --record-id ORIGINAL_DECISION_ID --revision 1 \
  --format html --out /absolute/decision-r1.html
canadabuys bidder-compare --workspace /absolute/procurement \
  --record-id ORIGINAL_DECISION_ID

canadabuys package --workspace /absolute/procurement \
  --scope selected --notice-id ORIGINAL_NOTICE_ID \
  --out /absolute/complete-notice-package.json
canadabuys receive --workspace /absolute/received-procurement \
  --file /absolute/complete-notice-package.json --expected-revision 0
~~~

The shown revision numbers illustrate the sequence; use the actual current revision returned by the workspace. reviewed-decision.json includes the exact contextSha256 from the reviewed assessment, the selected notice/profile and the human-authored decision fields. Native output files use a new destination and are not overwritten.

### HTTP routes

| Operation | Method and route |
| --- | --- |
| Saved counts/current workspace | GET /api/bidder/status |
| Complete record page | GET /api/bidder/records/{kind}?offset=0&limit=100 |
| Saved edition and history | GET /api/bidder/records/{kind}/{id}?revision=1&history=true |
| Create saved record | POST /api/bidder/records/{kind} |
| Append record edition | PATCH /api/bidder/records/{kind}/{id} |
| Profile fit | POST /api/bidder/fit |
| Exact reviewed decision context | POST /api/bidder/assess |
| Current comparison | GET /api/bidder/decisions/{id}/compare |
| Saved decision report | GET /api/bidder/decisions/{id}/report?format=html&revision=1 |
| Original evidence bytes | GET /api/bidder/evidence/{id}/file?revision=1 |

Record lists return page.nextOffset. Continue until null to obtain the full collection. Evidence and requirement lists may be selected by noticeId. Omitting the evidence selection includes company documents and documents from every retained notice.

The existing host/origin checks and request capacity apply. The service listens on the original loopback address; documents are downloaded as attachments.

## Merchant and provider integration

The existing provider adds eight bidder tools: status, list, record, create, update, fit, assess and compare. Each uses the host-declared workspace alias and the same model. The create/update tools accept the full record object and explicit revision. Evidence can consume an inspected, hash-pinned configured input alias; the provider does not accept an arbitrary filesystem path.

merchant_canadabuys_export adds decision-html, decision-json, decision-csv and evidence formats. Select decisionId or evidenceId and optional recordRevision. The existing publication, file listing, exact chunk read and release tools deliver the complete output.

The original SF30 merchant packages the entire selected v2 workspace once and transmits it through its existing immutable dataset. The SF100 adopter reconstructs every selected package part, validates original content, merges consistent bidder histories/evidence/command receipts and passes the result through the same receiving transaction.

Typed exports are included for the native bidder desk, its domain values and report API, alongside the existing workspace and client exports.

## Schema migration and compatibility

Opening an original workspace v1 preserves the original workspace UUID, sources, source observations, reviews, workshares, captures, publications and receiving history. The constructor creates the bidder tables and advances metadata to workspace v2 in one migration transaction. A migration audit entry and one workspace revision record that change. Reopening a v2 workspace does not repeat it.

New packages use package v2 and require their complete bidder payload. The current receiver also accepts a complete original package v1. Older application versions reject workspace/package v2, which prevents an old client from silently exporting a project without the bidder records.

Evidence bodies, record editions, command receipts and receiving are committed through the same original SQLite transaction. Decisions retain acquisition provenance from the reviewed source. During receiving, deterministic row-derived values are checked against the source bytes while original capture labels, URLs, response metadata and capture times remain part of the frozen reviewed context.

## Source and validation

The implementation extends the original 27-file CanadaBuys application at commit 5aeebd4531bb388bf074a45a8f907f9186a7eb14 in woahwhattheheck/tjlabs-stellar-merchant-workspace. Original source intake and full-feed native runs remain with that application.

The source-backed domain review uses retained complete 67-column tender and 80-column award rows from the original October 12, 2026 captures. A small row projection used by an operating/receiving exercise is identified as a projection; the full-feed capture sizes and hashes remain separate original provenance.

The complete receiving programme exercises migration, saved records, evidence changes, reviewed context, retry continuity, reports and cold receiving through the native application. Its result is recorded only after the actual run. Browser review uses the operator page served by that same application.


## Complete original document intake

Use [Import and review an original document set](EVIDENCE_INTAKE.md) to bring the solicitation, financial workbook and amendments into the existing desk together. The browser preview and Node command save one transaction of ordinary evidence records, retain the unchanged request for recovery, and carry the originals through complete receiving packages.
