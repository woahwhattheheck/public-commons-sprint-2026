# Citation update review

The Research workspace connects registered Crossref notices to the evidence and findings already saved in a dossier. An operator can review a notice, edit every affected source assessment and finding, save those choices in one revision, and reopen the report from before or after that decision.

## Working in the original browser

1. Open a saved dossier and choose **Update review**. The page lists the retained notice, the DOI it updates, its registered type and date, and the number of selected evidence occurrences and affected findings.
2. Open a notice. Inspect its registered assertions, original metadata record, source edition, and acquisition or source-document bindings. Publisher and Retraction Watch assertions for the same notice remain separately attributed within that notice.
3. Review the evidence under each original question. Selection, classification and notes are editable per occurrence. The same DOI can occur in several questions; the review shows each occurrence and its original edition.
4. Edit affected findings in full. Each finding keeps its original question and can cite the available sources in that question. Choose a disposition and give a reason for every affected finding.
5. Enter the reviewer name, overall decision and reason, then save. Evidence changes, finding text and citations, dispositions, original notice and source bindings, and the decision are committed together.
6. Open the original, reviewed or current report, or download a complete portable dossier. A later report can display the earlier decision alongside any subsequent changes.

Browser drafts save complete text and the original review base in IndexedDB. The page can reopen draft branches and download a draft. Storage failures leave the open edit available and report the failure. A saved dossier revision is the authoritative completed decision.

### Concurrent edits and a lost response

A draft records both its dossier revision and an impact fingerprint. When either changes, refresh the current dossier and explicitly rebase the draft. The comparison shows the original, draft and current values. Nonconflicting changes combine; conflicting edits require a choice. A source or finding removed from the current review remains visible in the comparison so its old draft text can be recovered.

Before the browser sends a save, it durably records the complete request. If the response is interrupted, recover that same request. Its request ID and payload remain fixed. The server returns the original saved review when that exact request already succeeded, even after later dossier edits. The browser retains a completed receipt if another tab subsequently reports uncertainty.

The original listener supports a fixed --port. Keep the same browser origin when reopening browser drafts; the portable dossier carries completed decisions across machines and fresh browser profiles.

## Notice identity and source coverage

A notice is identified by the normalized notice DOI, updated-work DOI and registered update type. The direction comes from the notice record's update-to entries. Each update-to.DOI identifies the work being updated. The original work may also contain an updated-by entry pointing back to its notice.

Distinct publisher and Retraction Watch assertions are retained and sorted canonically for the review fingerprint. Reordering or repeating an otherwise identical assertion leaves the notice version unchanged. Original response bytes preserve their received order. DOI/title/editorial metadata and registered assertion changes produce a new notice version; indexing, deposit timestamps and citation counters remain retained without reopening a review by themselves.

The latest received observation of a notice supplies its displayed version. Earlier observations and source editions remain accessible. An earlier retained relation also remains available if a later imported record omits it.

Acquisition coverage is displayed for every retained Crossref edition. A skipped, failed or partial updates lookup is carried through from the original acquisition. Direct metadata-document imports report the coverage of their retained work and update-list documents. Inspect this coverage when assessing the extent of the review.

The impact fingerprint includes the notice version, selected or finding-cited evidence assessments, and affected finding text and citations. A newly received unselected occurrence by itself leaves the previous decision current. Selecting or citing it makes it part of the next impact assessment.

### Review states

| State | Meaning |
| --- | --- |
| PENDING | This retained notice has no saved review. |
| REVIEW_AGAIN | A saved review exists and the current impact fingerprint has changed. |
| REVIEWED | The latest saved decision matches the current impact. |
| FOLLOW_UP | The matching latest decision explicitly requests follow-up. |

The pending filter includes notices needing an initial review, another review or follow-up. Counts show follow-up separately.

## Decisions and finding dispositions

Overall decisions are retain, revise, exclude and follow-up. The operator's evidence and finding edits define the resulting dossier. Selecting an overall label applies no implicit text or citation changes.

Each currently affected finding requires one of:

| Disposition | Required result |
| --- | --- |
| unchanged | The finding text, title and citations remain unchanged in this review. |
| revised | The finding actually changes in this review. |
| citation-removed | The finding changes and retains none of the affected DOI's occurrences. |
| follow-up | The operator records the question to resolve; explicit edits remain available. |

Finding citations stay in the finding's original question. Existing unavailable reference-only handles can remain attached to that finding. Retained source bodies continue to live in the original dossier's content-addressed store.

## HTTP API

The existing authenticated loopback listener exposes:

| Method and path | Result |
| --- | --- |
| GET /api/dossiers/:id/citation-updates | A revision-pinned notice page, counts and coverage. |
| GET /api/dossiers/:id/citation-updates?revision=N&noticeId=ID | Complete notice, evidence, affected findings, citation choices, bindings and immutable review history. |
| POST /api/dossiers/:id/citation-updates/reviews?projection=metadata | One atomic review or recovery of the same completed request. |
| GET /api/dossiers/:id/export?format=html&revision=N | The original report at the selected revision. |

Notice pages accept revision, offset, limit (1–100) and status (all, pending, reviewed). A page after offset zero requires an explicit revision. Report formats are json, json.gz, md and html. Explicit revision exports include that revision in their filename; full portable exports include the complete history through that revision.

A review request has these fields:

~~~json
{
  "requestId": "a-stable-unique-request-id",
  "noticeId": "copy the cu_ identifier from the selected detail",
  "expectedFingerprint": "copy its 64-character fingerprint",
  "expectedRevision": 12,
  "actor": "Reviewer name",
  "decision": "revise",
  "reason": "The recorded notice changes how the selected work supports this finding.",
  "evidenceChanges": [],
  "findingChanges": [],
  "findingDispositions": []
}
~~~

The identifier and fingerprint shown above are descriptions; copy the actual values from the selected detail before sending the request. Every changed evidence record contains occurrenceId, selected, classification and note. A changed finding contains id, title, text and the complete occurrenceIds array. Each finding disposition contains findingId, disposition and reason.

The endpoint accepts up to 16 MiB of UTF-8 JSON. The original dossier revision limit remains 8 MiB, including its retained decision history. The listener advertises citationReviewRequestLimit in its API capabilities. A rejected save leaves the existing revision intact; keep the draft to adjust or export it.

The response is {dossier,review,duplicate}. Review entries include the exact original request and its digest, before/after fingerprints, actor/reason, original and reviewed revision numbers, previous revision digest, original notice/source bindings and complete before/after changes. Reusing an ID with a different request is rejected.

## Existing client and commands

ResearchWorkspaceClient exposes citationUpdates(id, options) and reviewCitationUpdate(id, request). Its existing exportDossier method accepts revision. Borrowed connections retain the original workspace and listener ownership.

~~~sh
node workspace-cli.mjs citation-updates \
  --connection-file /private/application-url.json \
  --directory /private/research \
  --id DOSSIER_ID --revision 12 --limit 30

node workspace-cli.mjs citation-review \
  --connection-file /private/application-url.json \
  --directory /private/research \
  --id DOSSIER_ID --input /private/review-request.json

node workspace-cli.mjs export \
  --connection-file /private/application-url.json \
  --directory /private/research \
  --id DOSSIER_ID --revision 13 --format html \
  --out /private/reviewed-report.html
~~~

The local CLI provides the same citation-updates and citation-review commands. Use --store for its original dossier directory; citation-review reads the request through --file. Its existing export command accepts the selected --revision and writes the chosen format.

## Portable reopening and reports

The original JSON and streamed portable formats carry every immutable review entry. Before either importer changes its saved dossier, it validates the complete original history and retained source bytes. For each newly appended review, it reconstructs the previous revision's source projections, runs the same review operation with the saved request and timestamp, and compares the complete reconstructed review and resulting dossier state. This checks the notice record, assertion group, source occurrence, source hash, text/citation changes and decision as one operation.

Markdown and HTML reports include notice status, review identity and reasons, original/reviewed revision numbers, before/after finding titles, text and citations, evidence edits, and original notice/source bindings. Historical report exports restrict their displayed history to the selected revision. A report reopened from the corresponding portable dossier reproduces that saved state.

## Direct import of retained metadata

The companion [CROSSREF_DOCUMENTS.md](./CROSSREF_DOCUMENTS.md) describes the complete original-document intake. With the five supplied files in examples/crossref-retraction-1758835919874651/, run:

~~~sh
node crossref-document-cli.mjs \
  --provenance examples/crossref-retraction-1758835919874651/provenance.json \
  --source-dir examples/crossref-retraction-1758835919874651 \
  --query "How does the registered retraction affect this cited work?" \
  --label "Retained original Crossref retraction documents" \
  --supporting README.md \
  --output /private/citation-review/crossref-document-edition.json
~~~

The receipt supplies the exact edition bytes and SHA-256. The output carries both original works, the complete registered-updates collection for the target work, all five original documents and the actual transfer provenance. Each projected result carries its original document bindings. The separate updateRequestedDois list identifies which DOI's update collection was retained. Import that output through the existing Research receive command or the complete workflow below.

## Complete native workflow

citation-review-workflow.mjs runs the whole product using an original validated Crossref edition or a retained Crossref-document edition. It receives the exact source into two research questions, selects the affected occurrences, creates source-review findings, opens the original browser, and runs citation-review-browser.mjs against that live listener.

The browser phase exercises full text/citation edits, per-finding dispositions, saved draft recovery, explicit rebase and recovery of the original request after an interrupted reply. The workflow then exports the before/reviewed/current reports, JSON and gzip, reopens both portable forms in fresh stores, verifies all source bodies and saved review details, and checks that a rehashed altered review cannot enter a new dossier.

Run from this Research source directory with Node 22 or later, an installed Playwright module and an existing Chromium executable. Copy the actual SHA-256 from the intake receipt:

~~~sh
node citation-review-workflow.mjs \
  --operation citation-review-document-20261012 \
  --edition-file /private/citation-review/crossref-document-edition.json \
  --sha256 SHA256_FROM_INTAKE_RECEIPT \
  --run-directory /private/citation-review/native \
  --playwright-module /installed/playwright/index.mjs \
  --chromium /installed/chromium/chrome \
  --target-doi 10.1177/1758835919874651
~~~

The operation uses one private run directory and retained request IDs. Reuse that run directory after an interrupted process. The normal swarm runtime owns process scheduling and resource selection. The native result records completed steps and artifact identities; connection tokens stay in the private connection file.

## Original sources

- [Crossref: registering updates](https://www.crossref.org/documentation/register-maintain-records/maintaining-your-metadata/registering-updates/)
- [Crossref REST API response format](https://github.com/CrossRef/rest-api-doc/blob/master/api_format.md)
- [Crossref REST API filters](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-metadata-retrieval/#filters)
- examples/crossref-retraction-1758835919874651/ retains the original work, notice and filtered update-list JSON, exact byte identities and the actual source-transfer provenance.

The separate [CITATION-REVIEW-OPERATOR.md](./CITATION-REVIEW-OPERATOR.md) provides the browser handover, draft recovery details and original native browser contract.
