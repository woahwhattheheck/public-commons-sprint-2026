# Eligibility operator, client and CLI

The **Eligibility** tab is part of the original authenticated Research workspace. It opens the same dossier, source documents, immutable revisions and portable receiving format used by the existing source, finding and citation-update tools.

## Complete operating sequence

1. Open the original dossier and receive its actual source documents through the existing source intake.
2. Open **Eligibility → New review**. Choose the saved question, name the review and complete its protocol. Record criterion include/exclude wording, ordered stages, named local reviewers, minimum distinct decisions, full-text requirements, resolvers, exclusion reasons and disagreement procedure.
3. Open **Retained reports**. Select exact occurrence checkboxes across pages, then create a named work set for a specific saved protocol edition. The UI retains selected occurrences across pages. The work-set operation binds the original question, edition, byte hash and content digest for every report.
4. Open the **Review queue** for that work set. Choose a named eligible reviewer and record the criteria, disposition, retained evidence availability, occurrence IDs, locator and rationale. The selected reviewer’s recorded decision is displayed before other reviewers’ records. To correct it, explicitly select the previous decision as **supersedes** or load those recorded values as a correction.
5. Resolve the current independent decision set using a resolver named in the protocol. Consensus and adjudication retain the exact decision IDs, outcome, exclusion reason and rationale. Missing information stays actionable. Previous-stage and minimum-reviewer checks are enforced by the original domain engine.
6. Select current resolved outcomes in the queue and apply them to the original dossier. Include outcomes must complete the final stage; exclusions can resolve at an earlier relevant stage. Existing evidence classification and notes are preserved unless the operator explicitly enables their replacement in the application form.
7. Open **Studies** to link selected reports to an explicit study. Retain a source locator and relationship note for every report. Correcting a link keeps its previous version. The domain engine prevents a report being assigned to two current study groups within the same review.
8. Open **Source changes** after new editions, question changes, protocol revisions, resolution corrections or manual evidence edits. Review the specific impact, record its disposition and choose the receiving work set when appropriate. Further review uses the same work-set, decision, resolution and application operations.
9. Download a full review JSON or a complete section CSV. Use the existing dossier HTML/Markdown reports and complete JSON/gzip portable export for a reusable, editable receiving copy.

## Saved revisions and counting units

Every loaded page shows its dossier revision. Later pages request that exact revision. **Refresh saved revision** reads the current dossier and restarts the page at offset zero. Loaded-page search and status filters are labelled as such; they do not pretend to filter unrequested pages.

The overview keeps original engine counts and their units. Report occurrences, study groups, work-set assignments, stage assignments, decisions and applied outcomes remain distinct. The CSV contains the full selected table rather than only the visible page.

The work-set selector retains all work sets in the selected review even while the queue is filtered to one set. Original source inspection and downloads use the same existing retained-edition routes and content-hash checks as the rest of the Research workspace.

## Drafts and exact-request recovery

Editor changes are saved to the browser’s IndexedDB with a per-window writer and edit version. A conflicting write from another window does not overwrite the open edit. The editor can download an unsaved draft if browser storage is unavailable.

Before a save is sent, the browser retains its complete request ID, expected revision, actor, action and data in one committed browser record. **Browser drafts and requests** exposes that exact input and its returned operation.

- A definite completed reply stores the original operation receipt.
- A transport interruption retains the request as awaiting an outcome. **Recover original request** sends those same inputs.
- The original engine returns the existing operation after a lost acknowledgement.
- A definite rejected request remains in history. Reopen its draft, refresh the dossier and explicitly rebase before preparing a new request.
- Importing a saved original request preserves its request ID and expected revision. The operator reviews it and explicitly submits or recovers that request.
- A page refresh or another browser window does not create a new request ID for an already pending operation.

Browser drafts are local editing material. Saved eligibility decisions, operations, protocols, source bindings and every dossier revision are part of the original portable dossier. Use the complete dossier export for independent receiving.

Reviewer names are labels in the existing local authenticated workflow. The implementation uses the original listener, session and host/instance checks.

## HTTP interface

The existing API advertises:

~~~json
{"eligibilityReview": true, "eligibilityReviewRequestLimit": 16777216}
~~~

| Method | Original workspace route | Result |
| --- | --- | --- |
| GET | /api/dossiers/ID/eligibility | Revision-pinned review section |
| POST | /api/dossiers/ID/eligibility/reviews | Original review operation and dossier projection |
| GET | /api/dossiers/ID/eligibility/export | Full JSON report or selected CSV table |

Read parameters are **revision**, **reviewId**, **workSetId**, **section**, **offset** and **limit**. The original page maximum is 100.

Sections: overview, reviews, occurrences, queue, decisions, resolutions, studies, impact and operations.

Export adds **format=json|csv**. CSV sections: occurrences, queue, decisions, resolutions, studies, impact and operations.

The mutation body is the original domain request:

~~~json
{
  "requestId": "CLIENT_GENERATED_STABLE_REQUEST_ID",
  "expectedRevision": 1,
  "actor": {"id": "REGISTERED_REVIEWER_ID", "name": "REGISTERED_REVIEWER_NAME"},
  "action": "ACTION",
  "reviewId": "SAVED_REVIEW_ID",
  "data": {}
}
~~~

Use the actual returned dossier revision and saved identifiers. **create-review** omits reviewId because that operation creates it. Action-specific fields are documented in ELIGIBILITY_REVIEW.md. HTTP writes use the original body parser and a 16 MiB limit. Exports preserve the returned filename, content type and dossier revision header.

## Existing client

~~~js
const client = new ResearchWorkspaceClient({
  connectionFile: '/private/original-research-connection.json',
  directory: '/original/dossier-store'
});
try {
  const status = await client.status();
  const page = await client.eligibility(dossierId, {
    reviewId, workSetId, revision, section: 'queue', offset: 0, limit: 30
  });
  const result = await client.reviewEligibility(dossierId, originalRequest);
  const saved = await client.exportEligibility(dossierId, {
    reviewId, workSetId, revision, format: 'json',
    file: '/receiving/eligibility-review.json'
  });
} finally {
  await client.close();
}
~~~

The client keeps the original connection-file, workspace/instance identity, timeout, exact download and borrowed-listener lifecycle. A completed download uses the existing atomic file writer and can verify an expected SHA-256.

## Complete CLI workflow

Use **research-dossiers remote** or the existing **research-client** with the same private connection file and original dossier directory. The eligibility commands are also available through eligibility-cli.mjs.

~~~text
research-client eligibility-help

research-client eligibility-view --connection-file FILE --directory STORE --id DOSSIER
  --review REVIEW --section overview

research-client eligibility-view --connection-file FILE --directory STORE --id DOSSIER
  --review REVIEW --section occurrences --revision REVISION --offset 0 --limit 100

research-client eligibility-queue --connection-file FILE --directory STORE --id DOSSIER
  --review REVIEW --workset WORKSET --revision REVISION --offset 0 --limit 30

research-client eligibility-review --connection-file FILE --directory STORE --id DOSSIER
  --input ORIGINAL_REQUEST.json

research-client eligibility-export --connection-file FILE --directory STORE --id DOSSIER
  --review REVIEW --workset WORKSET --revision REVISION --format json
  --out COMPLETE_REVIEW.json

research-client eligibility-export --connection-file FILE --directory STORE --id DOSSIER
  --review REVIEW --workset WORKSET --revision REVISION --format csv
  --section decisions --out COMPLETE_DECISIONS.csv
~~~

The action-specific commands consume the same complete original request JSON and verify that its action matches the selected command:

| Command | Saved action |
| --- | --- |
| eligibility-create | create-review |
| eligibility-protocol | revise-protocol |
| eligibility-workset | create-workset |
| eligibility-decide | decide |
| eligibility-resolve | resolve |
| eligibility-study | study-link |
| eligibility-apply | apply-outcomes |
| eligibility-impact | review-impact |

All mutation commands require **--input**. They never silently manufacture a new request ID, change an expected revision or replace the selected actor. After an uncertain result, keep the original input file and recover the same operation. **--timeout-ms** uses the original client’s supported timeout.

A JSON/CSV eligibility report is a review deliverable. Continue an independently received editable workspace using the original complete dossier export/reopen commands, which include all retained source files and history.

## Integrated receiving

The original source programme owns the assembled customer receiving run. Its useful sequence is a complete saved question and actual documents → protocol/work set → independent decisions → conflict and correction → resolution → applied evidence → study links → source-impact review → JSON/CSV and complete dossier export → delivered original workspace reopen → another real decision on the received revision.

The UI has stable original tab and form identities: **eligibility-tab**, **view-eligibility**, and **eligibility-operation-form**. Queue and section cards retain **data-record-id**, and section buttons retain **data-section**. Visible controls are labelled for ordinary browser operation and accessible form selection.
