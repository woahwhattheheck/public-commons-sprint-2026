# Curriculum dataset coverage

The coverage module lets an operator inspect one retained Oak bulk export before mapping its units and lessons to another selected edition. It keeps every original occurrence, shows which published lesson references have payloads, and identifies ambiguous memberships and conflicting context.

The module is a deterministic part of the existing Curriculum Migration Workbench. Its public entry point is:

```javascript
import { inspectCurriculumDataset } from './curriculum-coverage.mjs';
```

## Inspect an original dataset

Pass the parsed original bulk body together with explicit receiving identifiers:

```javascript
const coverage = inspectCurriculumDataset({
  id: selectedDataset.id,
  editionId: selectedEdition.id,
  namespace: selectedNamespace,
  body: originalBulkBody,
  provenance: originalSourceReceipt
});
```

The identifiers in this example are values selected by the existing application. They are not inferred from filenames, titles, years, slugs or API URLs.

| Input | Contract |
| --- | --- |
| `id` | Nonempty string identifying this retained dataset within the application. |
| `editionId` | Nonempty string identifying the explicitly selected source edition. |
| `namespace` | Nonempty string naming the selected identity namespace. Keep distinct identity systems distinct unless an operator has reviewed their relationship. |
| `body` | The complete parsed bulk JSON object. Retain its original `sequenceSlug`, ordered `sequence` and `lessons` arrays and all other fields. |
| `provenance` | Optional original JSON source receipt. It is copied unchanged. An absent receipt and an explicit `null` receipt remain distinguishable through `provenancePresent`. |

The engine performs no network requests and does not change the input. The result contains an independent, deeply frozen copy of the body and receipt. Unknown body and record fields are retained. Malformed collection members stay visible as occurrences with issues rather than being silently dropped.

Inputs must be JSON values: finite numbers, strings, booleans, null, dense arrays and plain objects. Cycles, accessors, symbol properties, sparse arrays, functions and undefined values are rejected. The engine bounds JSON nesting at 256 levels. The result preserves parsed JSON values; it is not a substitute for retaining the original response bytes and their source receipt.

## Read the result

The top-level schema is `curriculum-dataset-coverage.v1`.

| Result member | Contents |
| --- | --- |
| `dataset` | Explicit IDs, namespace, complete original body and provenance. |
| `units` | One row for every original `sequence` array member, in its original order. |
| `lessons` | One row for every original `lessons` array member, in its original order. |
| `references` | One row for every original `unitLessons` entry, ordered by sequence occurrence and array position. |
| `issues` | Source-linked errors, warnings and information, with exact pointers and related occurrences. |
| `summary` | Occurrence counts, distinct key counts, publication coverage counts, ambiguity counts and issue counts. |

A unit or lesson row contains `kind`, `key`, `identity`, `identityValid`, `pointer`, `order`, `record`, `datasetId`, `editionId`, `namespace`, `slug`, `context` and `contextSources`. A lesson also retains its declared `unitSlug`, all matching `referencePointers` and `unitMembership`. A unit retains its ordered `referencePointers`.

`record` is the complete original array member at `pointer`. The pointer is relative to `dataset.body`, for example `/sequence/2`, `/lessons/14` or `/sequence/2/unitLessons/0`. Pointer escaping follows JSON Pointer rules, so a slash in a property name is represented as `~1` and a tilde as `~0`.

`order` is the original zero-based array position. A reference's publisher-supplied `lessonOrder` is retained separately as the tagged `declaredOrder`. Array position is never silently sorted or replaced with the publisher's order field.

## Scoped identities

A slug alone is insufficient to identify a unit occurrence across curriculum variants. The engine constructs a deterministic semantic key from the explicit namespace, entity kind, original slug and exact scoped identity fields. Lesson identity also includes its declared `unitSlug`.

The key excludes the receiving dataset ID, edition ID, source pointer and array position. Consequently, a uniquely identified unit can match a uniquely identified counterpart across two explicitly selected editions even when its receiving ID or array position differs. The complete records remain available for the comparison layer to report content and order changes.

The following publisher fields participate when present:

| Scope | Identity behavior |
| --- | --- |
| `sequenceSlug` | Uses the original dataset value, with an explicitly supplied occurrence value retained if present. |
| `year`, `yearSlug` | Preserves numeric years, the literal `All years` value and exact year slugs. |
| `subjectSlug`, `keyStageSlug` | Uses the literal values; no subject or key stage is inferred from a title or unit name. |
| `unitOptionGroup` | Keeps the producer's option-group identifier distinct from the expanded unit slug. |
| `pathwaySlug`, `pathway` | Preserves both literal fields as separate dimensions. |
| `examBoard` | The identity projection uses its nested `slug`; the complete original object, including titles, stays in `context` and `record`. |
| `tier` | The identity projection uses its nested `tierSlug`; the complete original object stays retained. |

For retained legacy or migration bodies, explicitly supplied `programmeSlug`, `programSlug`, `programmeId`, `programme`, `yearId`, `subjectId`, `keyStage`, `unitOptionGroupSlug`, `unitOptionGroupId`, `unitOptionSlug`, `optionSlug`, `optionId`, `tierSlug`, `examboardSlug`, `examBoardSlug` and `examboard` are also kept as separate literal dimensions. These fields are not synthesized when missing. Differently named fields are not treated as aliases.

Each dimension is represented with a tagged value:

```json
{"state":"absent"}
{"state":"null"}
{"state":"value","value":"higher"}
```

Thus an omitted tier, an explicit null tier and an explicitly supplied tier remain different. Empty strings and numeric/string differences are also preserved. Human-readable exam-board and tier title changes alone do not create new semantic identities.

The engine records where each effective context field came from. An occurrence field takes precedence over a dataset-level field, with both original values preserved and a context-disagreement issue where they differ. `contextSources` provides the exact source pointer, or null if the field is absent. A missing scope on one side of a membership check remains unknown; it is not treated as proof of a conflicting value.

`identityValid` checks the required original identity inputs used by this module. A unit needs the original sequence slug, unit slug, year/year slug, key stage and subject; a lesson needs the original sequence slug, lesson slug, declared unit slug, key stage and subject. The full publisher JSON Schema remains the authority for complete document validation. This flag does not claim that every nonidentity schema constraint was checked.

An automatic mapping must require `identityValid: true` and a unique key on each selected side. Repeated keys stay repeated rows. A namespace difference, absent scope or ambiguous repeated identity must not be repaired by merging slugs or selecting the first occurrence.

## Coverage follows the publisher's reference rules

The maintained publisher checker establishes two separate checks.

First, each `unitLessons` entry whose exact state is `published` must have at least one payload with the same `lessonSlug` somewhere in the dataset's `lessons` collection. Matching is global within this original dataset, because a lesson can be referenced by a different unit occurrence.

Second, each lesson payload's declared `unitSlug` must occur somewhere in the sequence. This check is independent of the first. A reference from unit A can legitimately resolve to a payload declaring unit B when B is retained in the sequence. If B is absent entirely, the payload fails the original unit-membership check even though its lesson slug has a matching reference.

| Original reference state | Payload expectation |
| --- | --- |
| `published` | A matching lesson payload is required. Missing payloads are errors. |
| `new` | Missing payloads are recorded without a published-payload error. |
| `migration` | Missing payloads are recorded without a published-payload error. |
| Missing or null | The expectation is unresolved and reported. |
| Another string | The original state is preserved and reported as unknown. |
| Another JSON type | The original value is preserved and reported as invalid. |

The engine never promotes an unknown state to published, new or migration. It also does not infer publication from a payload's presence.

A reference's `resolution` retains every matching payload, together with same-unit candidates, other-unit candidates, context-compatible candidates and explicit context disagreements. The actual property names are `candidatePayloadPointers`, `sameUnitPayloadPointers`, `otherUnitPayloadPointers`, `contextCompatiblePayloadPointers` and `contextDisagreements`.

The resolution status is `matched`, `ambiguous`, `missing-published`, `missing-non-published`, `missing-unspecified` or `invalid`. The separate `publication` field continues to distinguish unknown and unspecified source states when no payload exists. Multiple matches remain ambiguous even when one has more compatible context; the operator gets the evidence without an automatic candidate selection.

A lesson's `unitMembership` similarly retains all matching unit occurrences. `candidateUnitPointers` is the full declared-slug match; `contextCompatibleUnitPointers` and `contextDisagreements` explain its scopes. Several sequence occurrences with one unit slug produce an ambiguity warning rather than disappearing behind a map overwrite.

Titles are useful review evidence but are not relation keys. The engine reports lesson-title and unit-title disagreements as warnings. Cross-unit lesson references and unreferenced payloads are informational findings. Duplicate identities and duplicate references remain explicit warnings with links to every occurrence.

## Use the summary correctly

`summary.units`, `summary.lessons` and `summary.references` count retained occurrences. `uniqueUnitKeys` and `uniqueLessonKeys` count distinct semantic keys. Their difference reveals repeated identities without removing the duplicate source records.

`publishedReferencesWithPayload`, `missingPublishedPayloads` and `missingNonPublishedPayloads` count reference occurrences, not unique lesson slugs. A lesson referenced three times therefore contributes three coverage observations. `unreferencedPayloads` counts payload occurrences with no matching retained reference slug. `ambiguousReferences` and `ambiguousUnitMemberships` count affected occurrences.

`summary.complete` is true only when this module finds no errors and every reference has a known publication expectation. Ambiguity warnings can remain even when reference coverage is complete. Read the issue counts and retain the mapping layer's uniqueness rules.

This value describes checks over the retained selected dataset. It does not establish that all publisher history was acquired, that an endpoint's collection is exhausted, that every JSON Schema keyword was validated, or that a migration plan was applied.

## Review and resolve findings

Review issues in source context before changing any dataset or mapping. Each issue contains `code`, `severity`, `pointer`, `relatedPointers`, `message` and `detail`.

| Finding family | Operator review |
| --- | --- |
| Missing or invalid collection, record, identity field, order or slug | Recheck the actual captured body and selected contract. Preserve the original body and source receipt. |
| `MISSING_PUBLISHED_LESSON_PAYLOAD` | Inspect the published reference and the complete retained lessons collection. Correct the acquisition or source edition if a payload is genuinely absent. |
| `MISSING_LESSON_UNIT` | Inspect the payload's declared unit and all retained sequence occurrences. |
| Duplicate unit/lesson identity | Review each occurrence, its option/board/tier/pathway context and its original pointer. |
| Ambiguous payload or unit membership | Retain every candidate and select an explicit occurrence pair in the mapping layer when justified. |
| Context disagreement | Compare the exact tagged values and their source pointers. Missing scope is not evidence that two populated scopes are equal. |
| Unknown or unspecified reference state | Obtain the correct original contract or source value; do not assign an invented publication state. |
| Title disagreement, cross-unit reference, unreferenced payload | Review the source evidence. These observations alone do not authorize deletion, relabeling or slug merging. |

The existing workspace owns immutable source assets, audit events and saved mapping decisions. The coverage module returns inspection data for those existing operations. Re-inspecting identical input produces identical JSON values and leaves the original asset untouched.

## Integration and verification

The module has no package dependencies, filesystem imports, network calls, timers or generated timestamps. It can run inside the existing application browser or its JavaScript CLI. Import the module from the same source-selected distribution as the app, and retain its source identity with any delivered receiving result.

A useful end-to-end receiving record includes the exact publisher file identity, explicit dataset/edition/namespace selections, complete coverage result, any explicit occurrence mappings, selected-edition comparison, and a successful reopen through the existing workspace. Keep these stages distinct in delivery status.

The implementation's source review and focused constructed-input invariants cover cross-unit reuse, publication-state expectations, title/edition-independent keys, absent/null distinctions, variant and duplicate preservation, immutable output and malformed-input handling. Constructed invariants are not a publisher dataset. A receiving claim must identify the actual retained publisher data and the execution result that consumed it.

## Maintained source basis

The behavior is grounded in `oaknational/oak-curriculum-api` at commit
`eabbd67483f37cf6ceb8abb697fc44cb12aca99c`:

- The full bulk JSON Schema: `src/app/api/bulk/schema.json/schema.json`, Git blob `51d70a78ece2833e92e7c9555ab36137e91255e9`.
- The maintained reference checker, Git blob `64c6b92d9d31d82328028799c12c28c7cde107e4`.
- The maintained bulk producer, Git blob `a2cc6a291b6dc88a17559ecf8cda3c9be8c1edd4`.
- The producer's retained type definitions, Git blob `9872d4cb8610f99351ad3758057b4e2d6cd4b27b`.

The schema is available at:
https://github.com/oaknational/oak-curriculum-api/blob/eabbd67483f37cf6ceb8abb697fc44cb12aca99c/src/app/api/bulk/schema.json/schema.json

These are source pins for the implemented behavior. The actual customer-selected dataset retains its own provenance and edition identity.
