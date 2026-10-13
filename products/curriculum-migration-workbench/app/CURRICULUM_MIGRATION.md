# Curriculum migration plans

The Curriculum tab compares two retained bulk response editions at unit and lesson occurrence level. It shows publication coverage, repeated identities, exact changed values and order changes, then saves the complete plan and engineering decision in the existing workspace.

## Operator workflow

1. Create a BULK case in the existing workbench. Select the source contract and candidate contract edition, then save each complete response with its source description.
2. Use the case's field migration editor for intentional changes to the original response. Each transformation retains its reason. The original response remains available alongside the expected transformed body.
3. Open Curriculum and select the bulk case. Enter the original and candidate identifier namespaces. Equal slug text in different namespaces does not establish identity.
4. Create a migration plan. Unique valid semantic identities match automatically. For repeated or changed identities, add an occurrence mapping with its entity kind, original pointer, candidate pointer and engineering reason.
5. Review coverage findings, complete wire changes, matched records, unmatched occurrences, ambiguity candidates, schema results and order changes. The finding table paginates the display; the complete calculation and source remain in the workspace.
6. Record an accepted or changes-required decision with a note. Export the existing workspace and reopen it through Receive workspace.

The workbench keeps every plan and decision. A later response, field mapping, case revision or selected schema change makes the earlier plan stale. Create another plan before recording a decision against the changed input.

The displayed MATCH status means the transformed expected body equals the candidate, the retained reference checks are complete, the original and candidate meet their own schemas, and the expected body meets the candidate schema. REVIEW preserves the exact findings for an engineering decision. Accepting a reviewed plan records a decision; it does not rewrite source data or remove differences.

## Identity and relationship behavior

A JSON Pointer identifies one occurrence, for example /sequence/2 or /lessons/14. A semantic identity includes the explicit namespace, publisher identity fields and exact scope. Array position, receiving dataset ID and edition ID are not semantic identity fields.

Automatic matching requires a valid identity that is unique in both complete selected datasets. Explicitly pairing one duplicate does not silently resolve another duplicate. Explicit mappings must be one-to-one. All candidates remain visible until an occurrence pair is selected.

The coverage engine retains year, sequence, programme, option-group, pathway, tier and exam-board scope. Absent fields, null values and supplied values remain different. Exam-board and tier titles remain in the source record while their nested slugs define identity. Differently named fields remain distinct.

Published unit-to-lesson references use the publisher's global lessonSlug coverage rule. Each payload's unitSlug must also occur in the retained sequence. Cross-unit reuse remains visible. New and migration states do not require a published payload; unknown states remain unresolved.

Read CURRICULUM_COVERAGE.md for the complete coverage API and original publisher source pins.

## JavaScript integration

The three modules are colocated with the maintained model.mjs:

- curriculum-coverage.mjs inspects complete dataset occurrences and references.
- curriculum-migration.mjs compares datasets and adds retained workspace plans and decisions.
- curriculum-panel.mjs renders the operator panel using the existing application's workspace callbacks.

For a standalone comparison, pass explicitly selected dataset descriptors to compareCurriculumDatasets(original, candidate, options). Each descriptor contains id, editionId, namespace, body and provenance. The result contains full original and candidate inspections, occurrence matches, all unmatched occurrences, ambiguous identities, exact wire differences, relationship changes and relative order changes.

An explicit mapping has this shape:

    {kind: "unit", from: "/sequence/2", to: "/sequence/5", reason: "Reviewed correspondence between the selected editions."}

Use kind lesson with /lessons/N pointers. Occurrence mapping selects correspondence; field transformations in the existing model change the expected payload. The operations remain separate so selecting a corresponding record never silently erases changed values.

For the existing workspace:

    import {
      planCurriculumCase, decideCurriculumPlan,
      receiveCurriculumWorkspace, curriculumPortfolio
    } from './curriculum-migration.mjs';

    const planned = planCurriculumCase(workspace, caseId, {
      namespaces: {
        original: selectedOriginalNamespace,
        candidate: selectedCandidateNamespace
      },
      mappings: selectedOccurrenceMappings
    }, {actor: operatingEngineer, at: operationTime});

Use decideCurriculumPlan with planId, outcome and note. The outcome is accepted or changes-required. Both functions return a new workspace and append existing-shaped history events.

Receive exported workspaces with receiveCurriculumWorkspace. It uses the existing model receiver, reconstructs each retained computation from its complete historical inputs and schemas, and reconciles plan and decision history. It rejects changed computed results, orphaned case events, missing plans, and decisions recorded before their plans. Current-workspace changes do not prevent reviewing historical plans; they change their current decision status.

curriculumPortfolio reports READY, MATCH, REVIEW or CHANGED for each bulk case. curriculumReviewRows returns the complete table source, including raw-original, mapped-expected and candidate coverage, exact record and wire changes, unmatched occurrences, ambiguity groups, schema issues and HTTP differences.

## Browser persistence

The panel is integrated into the existing navigation, source download and workspace import/export. It uses the current operating engineer field and the same browser storage and export behavior as other workbench operations.

For another existing host UI, mountCurriculumPlanner accepts a container and getWorkspace, onWorkspace, actor and optional now callbacks. onWorkspace receives the proposed full workspace plus workspaceId and expectedRevision. Compare those values against the current workspace before replacing it, so an intervening edit cannot be overwritten. The maintained integration performs this check and then uses the existing save function.

The panel uses text nodes for source values and a grayscale layout. Its detail views retain complete data and render the selected detail on demand. No data is sent to a network service by the panel.

## Command line

The existing cli.mjs includes three curriculum operations. Every output path is create-only, as in the original CLI:

    node cli.mjs curriculum-plan --workspace WORKSPACE.json --case CASE_ID \
      --original-namespace ORIGINAL_NAMESPACE --candidate-namespace CANDIDATE_NAMESPACE \
      --mappings OCCURRENCE_MAPPINGS.json --actor ENGINEER --out NEW_WORKSPACE.json

The mappings option is optional. Field transformations continue to use the existing map command and the case's retained field mappings.

    node cli.mjs curriculum-report --workspace WORKSPACE.json --case CASE_ID \
      --plan PLAN_ID --out NEW_REPORT.json

Omit out to print the complete report to standard output. The report contains the selected full plan, all review rows and its recorded decisions.

    node cli.mjs curriculum-decision --workspace WORKSPACE.json --case CASE_ID \
      --plan PLAN_ID --outcome accepted --note "Engineering decision" \
      --actor ENGINEER --out NEW_WORKSPACE.json

Use changes-required for the other decision outcome. The existing summary command includes curriculum portfolio state; receive verifies the complete curriculum extension when present.

## Delivery and source continuity

Download application includes the added modules and guides with the existing application, original public contract source, generated SDK and current workspace. The self-contained HTML contains the same module bodies as the source files. The publisher source edition and original embedded workspace remain unchanged.

The coverage behavior follows Oak National Academy's maintained bulk schema and reference checker at source commit eabbd67483f37cf6ceb8abb697fc44cb12aca99c. Every actual migration case retains the selected response provenance and schema editions that were used for its plan.
