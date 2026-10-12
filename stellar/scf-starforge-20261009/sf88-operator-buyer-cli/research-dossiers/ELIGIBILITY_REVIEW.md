# Eligibility review in the original Research workspace

This workflow adds a complete question-linked review to an existing Research dossier. It uses the original retained documents, immutable revisions, authenticated local workspace, source browser, client, CLI and portable receiving format.

## Start a review and retain its protocol

Create a dossier question and receive the actual source documents through the existing source workflow. Each retained source occurrence has its own question, edition, original-byte hash and content digest. The eligibility **occurrences** section exposes these exact records even before a work set exists.

Create a named review with a criterion protocol. A protocol defines:

- A name and explicit include/exclude wording for each criterion.
- Ordered stages, their criterion IDs, eligible reviewer IDs, minimum number of distinct decisions and whether a retained full-text basis is required.
- Named reviewer identities, including the operators configured to resolve decisions.
- An exclusion-reason catalogue and a written disagreement procedure.

Cochrane chapter 4 distinguishes studies from reports and describes independent final full-text inclusion decisions by at least two people, with a predefined disagreement procedure. Configure a review that uses those methods accordingly; the application also supports purpose-defined single-reviewer stages. The method is a property of the saved protocol.

Sources: [Cochrane Handbook, chapter 4, section 4.6.4](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04), chapter updated March 2025 and retrieved 12 October 2026; [YHEC literature reviews and evidence synthesis](https://www.yhec.co.uk/what-we-do/literature-reviews-evidence-synthesis/), retrieved 12 October 2026, describes review methods chosen for different decision purposes.

The review captures the question wording at each protocol edition. Revise the protocol with an explanation to create a new edition. Earlier criteria, question wording, reviewer assignments and decisions remain in their original editions.

## Select exact reports into a work set

A work set names its protocol edition and an explicit list of retained occurrence IDs. Select the intended report occurrences using the existing source display and eligibility occurrence list. Each work set saves the exact report identities, the source revision, and the original edition inventory at creation.

The same DOI may occur in several questions or source editions. The operation uses each selected occurrence directly. A source-group ID remains useful for navigating citations; a work-set selection uses occurrence IDs.

A later work set can select the revised source or protocol edition. Earlier work sets remain available in history and exports. New source editions and changed question/protocol wording appear in the impact view.

## Record independent decisions and corrections

Choose a named reviewer from the saved stage configuration and open a report. Record one of:

- **include**: every stage criterion has a recorded meets/not-applicable assessment.
- **exclude**: every stage criterion has an assessment, at least one fails, and the saved exclusion catalogue supplies the reason.
- **uncertain**: preserve the unresolved issue and the evidence needed to settle it.
- **unavailable**: record the unavailable basis and keep the report in the operational queue.

The decision retains its actor, stage, question, protocol, work set, report, original source hashes, criterion assessments, source locator, rationale and revision. Available source bases require explicit retained occurrences and a locator. A full-text stage requires an available retained basis for an include/exclude decision.

Corrections include the previous decision ID as **supersedes** and a new rationale. The previous entry remains available. A correction makes any resolution referring to the older decision set stale. Later stages become ready after the preceding stage has a current include resolution; a current exclusion marks later stages as unnecessary.

The workspace records named local operators using the original authenticated session. The selected reviewer identity describes who is entering the decision in that operating workflow.

## Resolve the actual decision set

The queue shows missing decisions, uncertainty, unavailable sources, disagreement, agreement, stale resolutions and resolved outcomes. Each row identifies its work-set/report/stage assignment, current decisions, remaining decisions and current resolution.

A resolver supplies all current decision IDs and the recorded method:

- **consensus** requires the minimum number of distinct decisions to agree on include/exclude and, for exclusion, the same reason.
- **adjudication** records the configured resolver's disposition and rationale after the minimum decision set is present.
- **awaiting_information** keeps the report open for the missing information.

A decisive full-text resolution requires an available retained source basis in the decision set. Every new resolution records the previous resolution it supersedes.

## Apply outcomes to the original dossier

Use **apply-outcomes** to choose the exact resolved report occurrences. An inclusion must complete the final stage; an exclusion can resolve at the relevant earlier stage. The action uses the current protocol and question wording.

The original dossier commit records the complete request, resolution reference, and before/after selection for each occurrence. Existing classification and notes are preserved unless the operator supplies replacements. Eligibility and the original supports/contradicts/background classification remain separate recorded judgments.

Each application is atomic with its eligibility operation. Other questions, findings, grouped-source occurrences, retained editions and citation-review records continue in the same dossier. A later manual selection edit, resolution correction or protocol change appears as an impact on a previously applied outcome.

## Link reports to studies

Use **study-link** for an explicit study identity. Provide a name, selected report occurrences, a rationale, and a retained source locator and note for every report. The operator's documented relationship establishes the group.

To correct a group, supply its existing study ID and the revised membership/evidence. The previous version and its hash remain in history. One report can belong to one current study group within a review. Moving a report begins by correcting its previous group.

Counts distinguish retained report occurrences, explicit study groups, ungrouped reports and repeated work-set assignments.

## Review source and protocol impacts

The impact view identifies changed question wording, prior protocol work sets, later source editions and applied outcomes requiring reconsideration. Record a disposition, rationale and, where useful, the receiving work-set ID. Acknowledgements preserve the exact observed impact fingerprint.

Create the needed work set, record the new decisions and resolutions, and apply the resulting outcomes through the same workflow. An acknowledgement records the review of an impact; the operational decisions and selections have their own explicit commands.

## APIs and saved-request recovery

The original store exposes:

~~~js
await store.eligibility(dossierId, {
  revision, reviewId, workSetId, section: 'queue', offset: 0, limit: 30
});
await store.reviewEligibility(dossierId, {
  requestId, expectedRevision, actor: {id, name},
  action, reviewId, data, projection: 'metadata'
});
await store.exportEligibility(dossierId, {
  revision, reviewId, workSetId, format: 'json', section: 'queue'
});
~~~

Use IDs returned by the saved dossier and prior operation results. All later pages retain the initial revision; the original page limit is 100. Sections are **overview, reviews, occurrences, queue, decisions, resolutions, studies, impact, operations**.

The command actions and their data are:

| Action | Data |
| --- | --- |
| create-review | questionId, name, description, protocol |
| revise-protocol | protocol, reason |
| create-workset | protocolId, name, occurrenceIds, reason |
| decide | workSetId, occurrenceId, stageId, disposition, criterionAnswers, basis, reason; exclusionReasonId for exclusion; supersedes for a correction |
| resolve | workSetId, occurrenceId, stageId, mode, disposition, decisionIds, reason; exclusionReasonId for exclusion |
| study-link | name, occurrenceIds, reason, evidence; studyId for a correction |
| apply-outcomes | workSetId, outcomes, reason |
| review-impact | impactId, disposition, reason; workSetId when applicable |

Each command uses a client-generated request ID and the observed dossier revision. Save the complete original request before sending. Repeating the same request after a lost response returns the original operation with **duplicate: true**, together with the current dossier projection. Reusing its ID for changed input is rejected. A conflicting unrelated revision requires a fresh read and a newly prepared request.

## Reports and independent receiving

The normal HTML and Markdown dossier reports include protocol editions, criteria, reviewer/stage configuration, original occurrences, recorded decisions, resolutions, study links, impacts and applied outcomes.

Eligibility JSON contains the complete review projection and operation records. CSV exports the selected queue, decision, resolution, study, impact, operation or occurrence table, with nested source information kept as JSON cells. Each report supplies its counting units. Counts for overlapping work sets and repeated applications are explicitly labelled.

For a complete editable receiving, use the original dossier JSON or streamed/gzip portable export. It contains every original revision and retained source blob. Both receiving paths validate operation hashes, exact source bindings, immutable event prefixes, original request replay and the complete same-commit selection changes before writing the received dossier.

Open the received workspace, recover a previous request, and continue the review using its actual current revision. The original source documents and earlier eligibility decisions remain available beside the continued work.
