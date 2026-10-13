# Directory conformance: native operation and complete receiving

This module assesses an explicitly selected, retained Directory source or edition against a recorded set of original declarations. It produces complete findings, original row references, a rules catalogue, SQLite index, human report, review records and receiving packages. It runs inside the existing Human Services Directory workspace and retains the original source bytes and identifiers.

The operator selects the publication, the assessed population and the intended receiving use. A receiving decision records that choice alongside every finding and limitation. These results do not certify an entire publisher, a live API, FHIR implementation or care pathway.

## Original source and assessment coverage

The packaged `directory-original-source.json` contains the complete selected authoring sources and their original paths and hashes. The HSDS release is 3.3.1 at Open Referral commit `606a72cc3ddd80f890b6422bc7bd53392764775a`; the selected compiled data-package metadata still declares 3.0.0. Both declarations are retained. HSD authoring at commit `ff9fff79` describes a mapping from HSDS 2.0.1. A 3.x-to-HSD selection therefore needs an explicit migration assessment and receiving review.

For HSD, the plan selects up to three complete, already retained published 1.0.0 StructureDefinition records. The published snapshots, canonical URLs, version and original record bytes are bound to the plan. The source may contain the definitions alongside the original examples; it need not be downloaded again.

| Selected family | Executed checks | Coverage retained for review |
| --- | --- | --- |
| `hsds-3.3.1`, canonical JSON rows | Exact retained canonical schemas, supported JSON types, required properties, lengths, ranges, enums, composition and local references. Additional properties follow the selected schema. | Unsupported declarations are recorded as unevaluated. JSON Schema format declarations are annotations unless the plan explicitly selects `formatPolicy: "assert"`. |
| `hsds-3.3.1`, tabular rows | Original compiled table declarations: missing values, logical types and declared formats, required fields, enums, primary-key and uniqueness observations over the selected population. | Original CSV headers, cells, numeric tokens and bytes remain unchanged. Foreign-key declarations remain in the rules catalogue as unevaluated conformance coverage; exact native resolution states are separate population observations. |
| `fhir-hsd-1.0.0` | Selected unsliced snapshot cardinalities, array shape from the original base maximum, primitive/object shape, supported fixed and pattern values, maximum lengths, and native reference observations. | Slicing, invariants/FHIRPath, terminology, external base/profile validation, complex datatype internals, target-profile validation and unsupported declarations remain unevaluated. Must Support and narrative obligations remain explicit review requirements. |

A resolved native reference means the selected index found its original target identity. It does not establish all declared foreign-key or target-profile conformance. Missing references may also reflect the selected publication population. The report retains that distinction.

Plan `tables` restricts assessment to exact table/resource-type names. Omission uses the source-native family selection. Do not use a narrow table selection to describe the whole publication as assessed. State the actual scope in `scope` and the observed publisher profile in `publisherProfile`. Use `profileDisposition: "migration-assessment"` when the publisher did not declare the selected target standard.

## Native source and workspace

All commands below use the maintained Python entry point:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py catalogue
```

Run from the repository root, or use the absolute path to that file. The installation's native command is `human-services-directory`. The catalogue exposes the complete input schemas, exact action routes and limits. The worked commands use an absolute workspace and full JSON input files; replace the example paths and uppercase ID placeholders with actual values.

An existing workspace is opened with its original UUID. To receive a complete editable packet into a new selected location:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py receive-workspace \
  --workspace /absolute/received-directory \
  --file /absolute/Complete_Editable_Receiving.zip
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py state \
  --workspace /absolute/received-directory
```

`receive-workspace` creates a missing receiving workspace and imports the packet through the original native receiver. It verifies and adopts the archive's original identity. Do not run `init` over an existing workspace. A standalone new workspace can be initialized with `init --workspace ABS` before its first source import.

Conformance adds four immutable collections: `conformancePlans`, `conformanceAssessments`, `conformanceReviews` and `conformanceComparisons`. The existing registry and file custody hold all four. Whole import recognizes the complete original collection set and the complete extended set; it does not accept an arbitrarily incomplete registry.

## 1. Save the selected assessment plan

List the actual native sources or editions before choosing one:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py records \
  --workspace /absolute/received-directory --kind sources --offset 0 --limit 50
```

Follow every returned `nextOffset` when the collection is paginated. A source ID and record ID are native retained identities, not a title or external resource ID.

A complete HSDS plan input has this form:

```json
{
  "label": "Selected published edition: HSDS migration assessment",
  "actor": "Actual reviewing operator",
  "subjectKind": "sources",
  "subjectId": "REPLACE_WITH_ACTUAL_64_HEX_SOURCE_ID",
  "family": "hsds-3.3.1",
  "profileDisposition": "migration-assessment",
  "publisherProfile": "Exact observed publisher profile or version",
  "scope": "State the complete selected publication, tables and receiving use.",
  "formatPolicy": "annotation",
  "definitionRefs": [],
  "note": "Record source-version differences and the reason for this target."
}
```

For HSD set `family` to `fhir-hsd-1.0.0` and select the actual definition records through `definitionRefs: [{"sourceId":"ACTUAL_SOURCE_ID","recordId":"ACTUAL_RECORD_ID"}]`. These objects accept only those two keys. Select the full published 1.0.0 definitions for the resource types in scope. A bare canonical URL or inferred profile is insufficient.

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py conformance-plan \
  --workspace /absolute/received-directory --input /absolute/plan.json
```

Retain the full returned plan record. It binds the selected index, source and definition identities and the executing engine's source hashes. If the engine or selected source changes, save a new plan and preserve the prior record.

## 2. Assess, inspect every finding, and receive complete files

Save an assessment input containing `label`, `actor`, `planId` and, optionally, `note`:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py conformance-assess \
  --workspace /absolute/received-directory --input /absolute/assessment.json
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py rows \
  --workspace /absolute/received-directory --kind conformance-findings \
  --id ACTUAL_ASSESSMENT_ID --offset 0 --limit 100
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py conformance-finding \
  --workspace /absolute/received-directory \
  --assessment ACTUAL_ASSESSMENT_ID --finding ACTUAL_FINDING_ID
```

Finding pages can filter by `--severity`, `--table`, `--code`, `--finding-source` and `--finding-record`. Row coverage pages use `rows --kind conformance-rows --id ACTUAL_ASSESSMENT_ID`. Follow the cursor until complete. Interactive pages are bounded; they are not a replacement for the complete JSONL files.

Every finding records its original rule and source/row context. Display previews are bounded and accompanied by a value hash. The original row/member and full source bytes remain in custody. A preview limit never replaces the source value used by the engine.

| Record | Complete file members |
| --- | --- |
| Assessment | `report`, `findings`, `rows`, `index`, `rules`, `summary`, `package` |
| Review | `report`, `findings`, `summary`, `package` |
| Comparison | `report`, `rows`, `summary`, `package` |

Retrieve a complete assessment package to a new output path:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py file \
  --workspace /absolute/received-directory --kind conformance-assessment \
  --id ACTUAL_ASSESSMENT_ID --member package --out /absolute/Assessment_Receiving.zip
```

Use the corresponding record kind and member for an individual full file. File copies use exclusive creation and return exact byte count, SHA-256 and the original descriptor. Preserve those values when handing the file to another operator.

The package contains the complete generated files and retained evidence needed by its report. Open the human HTML report from the extracted complete package so relative source/file links remain usable. A separately downloaded HTML page is a readable report, but its relative companion files must also be retained.

The engine bounds an assessment to 250,000 selected rows, 1,000,000 findings and 1 GiB per complete file/package. It stops with an explicit error if a bound would be exceeded. It does not present a truncated assessment as complete. Interactive requests retain the original 4 MiB body limit.

## 3. Record an explicit receiving review

A review contains `label`, `actor`, `assessmentId`, `disposition` and `declaration`. The overall disposition is `accept-for-receiving`, `needs-correction` or `defer`.

Individual `decisions` select exact `findingId` values. A `groups` entry selects an exact `code` and optional `severity` and `table` across this immutable assessment. Each decision records `accepted-deviation`, `requires-correction` or `not-applicable` plus a source-bound reason.

Group review freezes the full matched original finding IDs. Individual decisions take precedence. Overlapping groups are rejected for any finding without an overriding individual decision, and every group must cover at least one finding not already selected individually. Review a complete matching group before applying a group disposition; a paginated visible subset is not the group's full scope.

`accept-for-receiving` requires every error finding to have an explicit `accepted-deviation` or `not-applicable` disposition. It retains all error, warning and unevaluated findings. Unreviewed warnings and unevaluated requirements stay visible. The review declaration must explain the selected receiving use and remaining coverage.

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py conformance-review \
  --workspace /absolute/received-directory --input /absolute/review.json
```

A subsequent review can name `predecessorId` for a review of the same assessment. Both remain immutable. The review package includes the complete underlying assessment package and exact decisions; it does not rewrite the original findings.

## 4. Compare two complete assessments

Save a comparison input with `label`, `actor`, `beforeAssessmentId`, `afterAssessmentId` and `scopeNote`, then run:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py conformance-compare \
  --workspace /absolute/received-directory --input /absolute/comparison.json
```

The comparison reports aggregate rule/outcome counts and row populations for the two explicit assessments. It does not infer that two rows from different editions are the same real-world service. Use the existing native edition comparison and original record identities for that separate question. Retain both populations, profiles and plan identities in the comparison scope note.

## HTTP and original operator integration

The existing authenticated loopback Directory server exposes these native methods:

| Action | HTTP route | Native method |
| --- | --- | --- |
| Plan | `POST /api/directory/conformance/plans` | `save_directory_conformance_plan` |
| Assess | `POST /api/directory/conformance/assessments` | `assess_directory_conformance` |
| Review | `POST /api/directory/conformance/reviews` | `review_directory_conformance` |
| Compare | `POST /api/directory/conformance/comparisons` | `compare_directory_conformance` |

List or reopen full records through `GET /api/directory/conformancePlans[/:id]` and the equivalent three collection names. Finding pages use `GET /api/directory/conformance/assessments/:id/findings`; one finding appends `/:findingId`. Row coverage uses `/assessments/:id/rows`. Complete files use `GET /api/directory/conformance/{assessments,reviews,comparisons}/:id/files/:kind`.

The server reuses the original private workspace, identity, authentication, native file response and lifecycle. Start it with `serve --workspace ABS --port 0 --expected-workspace-id ACTUAL_UUID` and retain its actual startup record. The companion application and connected client use this same API and catalogue.

## Whole editable receiving and recovery

Export the entire workspace, including original sources, indices, mappings, service selections, all conformance records and every retained conformance file:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.py file \
  --workspace /absolute/received-directory --kind workspace \
  --out /absolute/Directory_With_Conformance.zip
```

Receive that complete ZIP in a fresh selected directory using `receive-workspace`. Reopen the original workspace UUID and each original assessment/review/comparison ID, then verify complete files by their original hashes. An exact completed import is recognized by the original archive SHA, workspace UUID, `kind: "workspace"` and `state: "complete"` in the native receiving record.

Assessment and review requests are immutable content-addressed inputs. An exact repeated request reopens its existing record and verifies its retained files. Preserve the full original JSON request, returned record, engine source edition and operation journal when continuing. A changed label, actor, note, source, engine or decision is a different reviewed request; do not silently replace it inside a pending operation.

Archives used for process recovery must preserve complete files, empty native directories and Unix private modes. The native layout and file checks remain active. Restore a saved receiving boundary and its original journal rather than reinitializing or acquiring the source again.

## Worked original-source receiving driver

`operate_conformance.py` is the maintained complete worked journey for operation `SCF-DIRECTORY-CONFORMANCE-450E-20261012`. It expects a separate, fully received copy of the completed original Directory workspace:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/operate_conformance.py \
  --workspace /absolute/received-original-directory \
  --out /absolute/conformance-receiving
```

The driver checks the original workspace UUID and the original CSV, authored CSV successor and published HSD source hashes. It selects the retained full published definitions; saves three plans, assessments and reviews; traverses complete finding and row pages; verifies exact repeated-request reuse; compares the two selected CSV assessments; reads the original native HTTP records and full files; exports an editable packet; and receives that packet into a fresh workspace with complete registry/file verification.

Its durable journal is `CONFORMANCE_JOURNEY.json`. Its final result is `OPERATED_DIRECTORY_CONFORMANCE.json` with the actual original source, plan, assessment, review and comparison IDs, summaries, HTTP receipts, full file descriptors, editable packet and restoration result. The final completion timestamp is prepared in the journal before the immutable result is written, so a same-operation recovery reproduces that result.

The driver records `needs-correction` where errors remain and otherwise records `defer`; it never invents acceptance of unevaluated requirements. Its resulting counts and files must come from the executed operation. Source review and publication alone do not establish that this worked journey completed.

## Validation and source delivery

The native engine, API/CLI joins, immutable receiving, review groups, complete file coverage and the original-source driver have been reviewed against the retained maintained implementation. The companion integration has independently checked the exact schemas, read routes and file kinds. The first native source-only parse passed for the engine modules. At this source publication boundary, the final complete worked operation is still pending actual runtime admission; no assessment counts or completed receiving artifacts are claimed here.

The operation's complete source/input carrier retains the original 280-file Directory source edition, these additive native files, original Library materialization helpers and exact completed input archive identity. It can run without another Git source fetch once received. Actual programme receipts and saved results accompany the operation when it completes.

Original standards and licensing remain in the retained source bundle. This native extension is MIT-licensed under the maintained repository's source terms.
