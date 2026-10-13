# Directory conformance

The **Conformance** section assesses an original source or frozen edition against a selected standard. It keeps the plan, the complete assessed population, every finding, review decisions, comparison results and the original source files together in the Directory workspace.

The native implementation is [directory_conformance.py](directory_conformance.py). Its four strict inputs, file kinds and declared limits are in [directory-conformance-schema.json](directory-conformance-schema.json). The connected catalogue reads those same inputs through [directory-schema.json](directory-schema.json).

## Operate the complete workflow

### 1. Choose standards and scope

Open **Conformance → Standards & scope**. Choose whether the subject is an original source or a frozen source edition, then use **Choose source or edition** to browse the complete collection. The selected subject remains identified by its saved record ID.

Name the plan and record the operating actor. Select the standard family:

| Family | Selected material |
| --- | --- |
| HSDS 3.3.1 | The canonical JSON schemas and compiled tabular declarations already retained in the Directory source bundle |
| FHIR HSD 1.0.0 | The original published Organization, Location and HealthcareService profile snapshots selected from retained StructureDefinition rows |

For HSD, use **Choose HSD profile snapshot** to browse a retained source and select its original StructureDefinition row. Each selection contains the source and record ID. Select one snapshot for each applicable resource type, up to three. The native engine verifies the canonical URL, version, resource type and complete snapshot.

Record whether this is the publisher's selected standard or a migration assessment, the publisher's actual declared profile if available, and the intended population and receiving use. Leave **Tables** empty to assess the complete applicable population. A table selection explicitly narrows that population.

Choose the JSON Schema format policy. **Annotation** retains JSON Schema format declarations as annotations. **Assert** also checks supported JSON Schema format assertions. Tabular field formats retain their declared logical checks under either JSON policy. Save the assessment plan. Its immutable record freezes the subject index, original source identities, selected profile definitions, table population and implementation edition.

### 2. Assess and inspect all findings

Open **Assessments**, select a saved plan, name the assessment and run **Assess complete selected population**. The native assessment reuses the saved source and index, writes the complete finding and row indexes, and retains the complete report package.

Open the saved assessment. The workspace shows the selected standard, scope, publisher profile, format policy, row population, error and warning totals, and requirements retained for review. Expand **Rule coverage and selected population** to inspect the complete coverage counts.

The finding table supports exact filters for severity, table, rule code, original source and original record. **Previous** and **Next** follow the native page offsets. Change **View** to **Assessed rows** to inspect the original row identities and rule outcome counts. **Open original row** reads the source-owned row and its complete original JSON or CSV representation.

Each finding retains its original value description, requirement source, source reference and pointer. Open a finding to inspect those values or save its complete JSON. All findings and assessed rows are also available as full JSON Lines files.

### 3. Record a receiving review

Use **This finding** to add an individual decision to the review draft, or **Complete group** to select all findings with that rule code, severity and table in this immutable assessment. The group dialog reads the complete matching count before saving the draft. A coverage finding without a table creates a group across all tables for that rule and severity; the dialog explicitly displays **All tables / rule coverage** and identifies the omitted table filter.

Each decision records one disposition and a reason:

| Disposition | Meaning in the saved review |
| --- | --- |
| requires-correction | The receiving review calls for correction of the selected finding |
| accepted-deviation | The reviewer accepts the stated deviation for the declared receiving use |
| not-applicable | The reviewer records why the requirement does not apply to that use |

Open the review draft to inspect or edit every individual decision and group. Groups are evaluated against the complete assessment, independent of the currently visible page. The native review retains the exact matched finding IDs in its complete findings file. Individual decisions take precedence. Overlapping groups and references to findings outside the assessment are rejected by the native engine.

Record the reviewer's declaration of coverage and receiving use, then select the overall review disposition. **accept-for-receiving** requires every error to have an explicit accepted-deviation or not-applicable decision. **needs-correction** and **defer** retain the reviewer's corresponding decision. Save the complete review.

A saved review provides its complete report, decisions, summary and package. **Prepare successor** starts another review of the same assessment and retains the selected predecessor ID. Original reviews stay available.

Drafts are stored in the browser session for the current workspace. Use **Save draft** to retain an editable JSON file before moving to another browser or computer. A draft becomes a workspace record when the native save succeeds.

### 4. Compare complete assessments

Open **Compare results**. Select the earlier and later assessments, name the comparison and describe the two populations in **Population and scope comparison**.

The comparison reports all rule-outcome counts by table and rule, the before and after populations, changed rule-group counts, the selected engine and profile relationship, and the recorded scope. The package includes both complete original assessment packages, so each side can be inspected independently.

### 5. Receive and reopen

Each assessment, review and comparison provides only the files actually declared by its saved record:

| File | Contents |
| --- | --- |
| report | Readable HTML report |
| findings | Complete immutable findings or reviewed finding decisions as JSON Lines |
| rows | All assessed original rows or complete comparison rule-outcome rows |
| index | Complete assessment SQLite index |
| rules | Selected original rule catalogue and assessment plan |
| summary | Complete counts, populations and scope |
| package | Complete reports, records, source selections and original subject material |

The **Complete editable workspace** download also includes all four conformance record collections and their retained files. Receive it through the original Directory receiving workflow, reopen the same workspace UUID and inspect the same plans, assessments, reviews and comparisons.

## Native CLI and HTTP

The normal native CLI provides these actions using the complete JSON input file:

```sh
starforge human-services-directory conformance-plan --workspace /absolute/private/directory --input /absolute/plan.json
starforge human-services-directory conformance-assess --workspace /absolute/private/directory --input /absolute/assessment.json
starforge human-services-directory conformance-review --workspace /absolute/private/directory --input /absolute/review.json
starforge human-services-directory conformance-compare --workspace /absolute/private/directory --input /absolute/comparison.json
```

Use the exact flags shown by the installed command's help when operating an existing installation. The four native POST actions are:

| Action | Route | Input schema |
| --- | --- | --- |
| Save plan | /api/directory/conformance/plans | conformance_plan |
| Assess plan | /api/directory/conformance/assessments | conformance_assess |
| Save review | /api/directory/conformance/reviews | conformance_review |
| Compare results | /api/directory/conformance/comparisons | conformance_compare |

The original private operator authentication applies to these routes and to every complete-file download.

Read or page the record collections using /api/directory/{collection} and /api/directory/{collection}/{id}. The collections are conformancePlans, conformanceAssessments, conformanceReviews and conformanceComparisons.

Additional read routes:

| Route | Parameters |
| --- | --- |
| /api/directory/conformance/assessments/{id}/findings | offset, limit, severity, table, code, sourceId, recordId |
| /api/directory/conformance/assessments/{id}/findings/{findingId} | Exact original finding ID |
| /api/directory/conformance/assessments/{id}/rows | offset, limit, table |
| /api/directory/conformance/{assessments,reviews,comparisons}/{id}/files/{kind} | A file kind declared by the selected record |

Native pages return assessmentId, rows, total, offset, limit, nextOffset and the actual page byte budget. Follow nextOffset until null.

## SDK and Merchant MCP

The maintained package export is **./merchant/human-services-directory**. Both the local client and the normal Merchant MCP host provide these actions, with camelCase aliases on the SDK client:

| Action | Required body |
| --- | --- |
| directory_conformance_plan | workspace, conformance_plan |
| directory_conformance_assess | workspace, conformance_assess |
| directory_conformance_review | workspace, conformance_review |
| directory_conformance_compare | workspace, conformance_compare |
| directory_conformance_findings | workspace, assessmentId |
| directory_conformance_finding | workspace, assessmentId, findingId |
| directory_conformance_rows | workspace, assessmentId |
| directory_conformance_file | workspace, collection, recordId, fileKind |

MCP tool names add the normal merchant_human_services_directory_ prefix. The four writes take their full native input under the listed body key. The findings and rows calls accept the matching native page filters. Generic directory_records and directory_record also accept all four conformance collections.

Every call returns the original retained operation response. Use readHumanServicesDirectoryValue or client.readValue to receive the complete JSON response. Downloads use the existing retained-file manifest, range transfer and resume behavior.

```js
import {
  openHumanServicesDirectoryLocalClient,
  assessHumanServicesDirectoryConformance,
  iterateHumanServicesDirectoryConformance,
  downloadHumanServicesDirectoryConformance
} from "./connected/client.mjs";

const client = await openHumanServicesDirectoryLocalClient({
  connection: "/absolute/private/directory-connections.json",
  exportsDirectory: "/absolute/private/customer-exports"
});

try {
  const result = await assessHumanServicesDirectoryConformance({
    client,
    workspace: "directory",
    planId: savedPlanId,
    assessment: {
      label: "Receiving assessment",
      actor: reviewer,
      note: "Assess the complete population selected by the saved plan."
    }
  });

  for await (const {page} of iterateHumanServicesDirectoryConformance({
    client,
    workspace: "directory",
    assessmentId: result.assessment.id,
    kind: "findings",
    filters: {severity: "error"},
    limit: 100
  })) {
    for (const finding of page.rows) {
      // Each finding includes its original requirement, value and source reference.
      await reviewOriginalFinding(finding);
    }
  }

  await downloadHumanServicesDirectoryConformance({
    client,
    workspace: "directory",
    collection: "assessments",
    recordId: result.assessment.id,
    fileKind: "package",
    directory: "/absolute/private/received-conformance"
  });
} finally {
  await client.close();
}
```

The assessment helper accepts either the complete plan input or an existing planId. If the assessment returns a retained native error, the error details preserve that plan ID and its retained response IDs for continuation. The iterator yields one complete native page at a time and checks its assessment identity, total and next offset. The file helper returns both the original retained result and the completed download receipt.

The connected CLI uses the same actions:

```sh
starforge merchant-human-services-directory call \
  --connection /absolute/private/directory-connections.json \
  --exports /absolute/private/customer-exports \
  --action directory_conformance_assess \
  --args /absolute/connected-assessment.json
```

The arguments file contains workspace and the complete conformance_assess input. The existing tools, value, inspect, download and reopen commands work with conformance responses and files.

## Coverage and source interpretation

HSDS JSON checks follow the retained canonical schemas. CSV cells retain their original strings; their declared tabular types are interpreted for assessment. The original schema controls whether additional properties are accepted. Declared HSDS foreign keys retain their source declarations and native reference observations; full cross-table foreign-key conformance is recorded as unevaluated coverage.

FHIR HSD assessment reads the selected published snapshots. The implementation checks supported cardinality, primitive, fixed, pattern and reference assertions. Slice requirements, unsupported invariants, external bases, terminology and other unevaluated requirements remain explicit findings or coverage entries for the reviewer. Must Support and narrative obligations retain their declared meaning.

All five outcomes—pass, annotation, error, warning and not-evaluated—remain in the complete reports. Review decisions supplement those outcomes and leave the original source and findings available. Assessment plans select their implementation edition; a changed engine requires a new plan while the previous assessment remains readable.

## Complete operating programme

[operate_conformance.py](operate_conformance.py) runs the full native conformance workflow against a received Directory workspace. It retains the selected original sources and published HSD snapshots, saved plans, all assessment/review/comparison IDs, full authenticated files and the complete editable workspace with its receiving result.

The UI, connected catalogue, types and installed selection include this conformance source alongside the original Directory, Gravity and source-index workflows.


The companion [operate_conformance_clients.mjs](operate_conformance_clients.mjs) consumes that exact native result and a separate received copy of its workspace. It reopens all original conformance IDs through the browser and normal Merchant host, receives every finding and row page, downloads the complete comparison and editable workspace, and reopens the retained downloads.

```sh
node operate_conformance_clients.mjs \
  --native /absolute/OPERATED_DIRECTORY_CONFORMANCE.json \
  --workspace /absolute/private/received-conformance-workspace \
  --out /absolute/private/conformance-clients \
  --chromium /absolute/chrome-headless-shell
```

Its output includes desktop and phone views, the complete browser report, the full connected catalogue, the original record IDs and complete downloaded packages. Its journal reuses completed actions and immutable responses when the same operation resumes.
