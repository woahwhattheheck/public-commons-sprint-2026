# Declared relationships in retained Human Services Directory editions

This implementation evaluates the foreign keys in the retained HSDS 3.3.1 tabular declarations against complete original source or edition rows. It uses the existing Directory source custody, immutable indices, conformance plans, assessments, reviews and comparisons. A result records the selected population and interpretation, every checked declaration, every candidate target and every exact match. It does not query a publisher, alter the original data, select a preferred duplicate or certify a production service.

The implementation edition is `stellar-forge.directory-conformance.hsds-foreign-keys.20261013`. The earlier conformance edition remains readable with its original assessment IDs and seven original file kinds. An HSDS assessment created with this edition retains eleven file kinds. A current FHIR assessment retains the seven applicable original kinds. Select a new plan with the current implementation to obtain new relationship checks; preserve an earlier plan and its assessment as the original record.

## Original standard and scope

The source authority is the complete retained [Open Referral HSDS 3.3.1 source](https://github.com/openreferral/specification/tree/606a72cc3ddd80f890b6422bc7bd53392764775a), including its JSON schemas, tabular datapackage and examples. Its published datapackage still declares version `3.0.0`; the assessment records both the release and that original metadata. The source contains 38 foreign-key declarations across its tables. Three separate entries declare the same schedule `service_id` relationship; all three retain their separate array positions and source pointers.

The implementation follows the retained [Table Schema foreign-key declarations](https://specs.frictionlessdata.io/table-schema/#foreign-keys). A declaration can name one field or a same-cardinality array of fields on each side. Unsupported clauses retain an explicit coverage outcome. The retained HSDS declaration set contains no composite foreign key, so the supplied original-source operation makes no claim that a published composite example was executed.

The original field type, format and missing-value rules determine each checking value. Numeric values remain exact decimals. A logical string never silently becomes a numeric identity, and there is no new trimming, case folding, SQLite affinity or implicit winner. Composite tuples, when declared, compare every component using the same original logical-value interpretation.

The selected null interpretation is SQL MATCH SIMPLE: an otherwise interpretable tuple containing a logical null does not require a target. This is an explicit implementation choice under the Table Schema SQL-style relationship, documented alongside the [SQLite composite relationship semantics](https://www.sqlite.org/foreignkeys.html#composite_foreign_key_constraints). The original required-field and primary-key checks remain separate. An invalid component remains invalid even if another component is null. Original absence, JSON null and each declared physical missing marker remain distinguishable in the complete component record. Logical NaN does not match any target, including another NaN.

## What the assessment covers

Child assertions use the plan's selected tables. Target lookup uses every eligible original row in the immutable source or edition selected by that plan, including tables omitted only from the child-assertion selection. It does not include a table excluded from the native edition, an unselected source, another workspace or a remote endpoint.

| Original representation | Relationship treatment |
| --- | --- |
| Explicitly selected CSV document | Use the original tabular field declarations and complete physical cells. A selected empty document still establishes table coverage. |
| HSDS JSON with the original `tables` layout | Read the exact original member through the maintained streaming parser. Retain each table key pointer, key and array byte ranges, and array row count. An explicitly present empty array establishes coverage. |
| Original table omitted from that JSON member | Coverage is unavailable. No remote absence is inferred. |
| Table retained in a source but excluded from the selected native edition | Record its original presence as outside the selected edition. It is unavailable as a target in that assessment. |
| Nested, entity, array or page JSON outside the tabular tables layout | Retain original JSON and native parent/reference links; explicitly report that the tabular declaration was not evaluated. No inferred foreign-key fields are written into the original row. |

Both an original table name and its declared schema path are recognized using the same mapping as the source index. If a document contains both keys, their separate pointers and ranges remain in coverage; their original indexed records remain separate candidates.

## Reading results

Existence and identity resolution are separate. If one matching original target exists, the relationship is resolved. If multiple exact targets exist, existence passes and identity resolution is ambiguous; all matches remain available. Zero matches is an error only when selected tabular target coverage exists.

| Outcome state | Constraint outcome | Meaning |
| --- | --- | --- |
| `resolved` | pass | Exactly one original eligible target matches the complete interpreted tuple. |
| `ambiguous` | pass, with a separate identity warning | Several original targets match. No target is selected automatically. |
| `missing-target` | error | The target table was received and selected, but no eligible target matches. This includes an explicitly empty target array. |
| `null-reference` | pass | The selected null policy requires no target. Physical absence/null/marker details remain explicit. |
| `invalid-key` | error | An original component cannot be interpreted, or an original CSV header repeats the selected field. |
| `nonmatching-value` | error | The original logical tuple contains NaN and therefore cannot match. |
| `target-table-unavailable` | not evaluated | The selected subject does not establish the declared target table's tabular coverage. |
| `representation-not-tabular` | not evaluated | The original row is a different supported representation with its own native relationships. |
| `unsupported-declaration` | not evaluated | The complete original declaration is retained but its shape is outside this implementation. |

Every outcome links to its exact declaration and original source row. References retain source ID, record ID, table, ordinal, original member name and SHA-256, JSON pointer or physical cell context, raw byte range and original logical identity when present. Component records retain the original field declaration, physical-value descriptor, interpretation and key hash. Complete original values remain in the original file and index; a bounded display does not replace them.

### Complete files

The existing assessment file route and CLI also expose these four additional kinds:

| Kind | Content |
| --- | --- |
| `foreignKeys` | Complete JSONL containing one outcome per selected original row and original foreign-key declaration. |
| `foreignKeyCandidates` | Complete JSONL of original target candidates by exact target-field group, including null, invalid and unsupported-representation candidates. |
| `foreignKeyMatches` | Complete JSONL of every matching outcome/candidate edge, retaining original source and target references. |
| `foreignKeyCoverage` | Complete JSON containing policy, original standard, all declarations, selected status, target groups, explicit table domains, outcome counts and support limits. |

The native SQLite assessment index contains the same records. The assessment package also retains original input/member bytes, source indices, the complete standards source and the exact implementation files. Receiving verifies all four new files against the native index and recomputes complete JSONL byte/hash identities. The earlier report, findings, row observations, rules, summary and package remain available.

### Native read routes

All routes use the existing private operator authentication and exact workspace identity.

| GET route suffix under `/api/directory/conformance/assessments/:id/` | Optional filters |
| --- | --- |
| `foreign-keys` | `table`, `state`, `ruleId`, `sourceId`, `recordId` |
| `foreign-key-candidates` | `table`, `state`, `groupId`, `sourceId`, `recordId` |
| `foreign-key-matches` | `outcomeId`, `candidateId` |
| `files/:kind` | The exact complete file kind; no page filter applies to the download. |

All three row routes accept `offset` and `limit`. The complete page is `{assessmentId, rows, total, offset, limit, nextOffset, bytes, byteBudget}`. Follow `nextOffset` until null; it advances by the number of complete returned rows. The default limit is 50, maximum 250. The complete record-body budget is 4 MiB per page. A single oversized complete row fails explicitly rather than returning a truncated or nonadvancing page. Record and declaration IDs are exact 64-character lowercase hexadecimal strings.

Equivalent source CLI examples, from the complete SDK directory:

```sh
python3 fhir_directory/cli.py rows --workspace /absolute/received-workspace \
  --kind conformance-foreign-keys --id ASSESSMENT_ID --state ambiguous --offset 0 --limit 100

python3 fhir_directory/cli.py rows --workspace /absolute/received-workspace \
  --kind conformance-foreign-key-candidates --id ASSESSMENT_ID --target-group GROUP_ID

python3 fhir_directory/cli.py rows --workspace /absolute/received-workspace \
  --kind conformance-foreign-key-matches --id ASSESSMENT_ID --outcome OUTCOME_ID

python3 fhir_directory/cli.py file --workspace /absolute/received-workspace \
  --kind conformance-assessment --id ASSESSMENT_ID --member foreignKeys \
  --out /absolute/customer/Complete_Foreign_Key_Outcomes.jsonl
```

Outcome filters additionally use `--rule`, `--source-id` and `--record-id`; candidate filters use `--target-group`, `--source-id` and `--record-id`; matching edges use `--outcome` and `--candidate`. The complete workbench and connected client consume the same native records and full-file route.

## Complete original-source operating programme

`operate_conformance_foreign_keys.py` operates this implementation on an explicitly received copy of the completed Human Services Directory workspace, UUID `2c51f522-4852-463b-bdc0-59389d7bae83`. It verifies the existing publisher CSV, original tables JSON, original nested service JSON and already-retained authored description successor by their exact source IDs and original SHA-256 values. It opens no publisher endpoint.

Run from the complete selected SDK source after receiving that original workspace:

```sh
python3 fhir_directory/operate_conformance_foreign_keys.py \
  --workspace /absolute/received-workspace \
  --out /absolute/private-foreign-key-receiving
```

Use the complete maintained source and existing Python runtime. The output directory and its parent workspace must be private and owned by the operator. The entry establishes umask 077 before writing. Reusing the same output directory resumes the same journal and exact prepared native requests. A different input, workspace, implementation identity or request is rejected instead of being silently substituted.

The programme performs eight assessments:

1. Complete original CSV, including the publisher's present relationships and missing target IDs.
2. The already-retained authored description-only CSV successor, preserving the same relationship outcomes.
3. Complete original tabular JSON, including its physically absent nullable association field.
4. Complete original nested service JSON, retaining explicit tabular noncoverage.
5. A native edition containing both original CSV versions, exposing duplicate original target identities without selecting a winner.
6. A native edition selecting only the original service table, distinguishing unavailable target tables.
7. Child service assertions over the complete original CSV source, retaining its original organization and program target context.
8. An explicitly authored deletion edition of the retained tables JSON, replacing only its original organization array with `[]`. Its complete native predecessor and successor editions, full original file, original array byte range, removed-byte SHA-256, exact derived source and every other unchanged byte remain retained. This is an authored receiving example, not a publisher change.

For each case it retains the original plan, repeated-request recovery, assessment, complete paginated results, reviewed findings and every complete assessment/review file. It compares the original and authored description successor, exercises all three authenticated HTTP read routes and four file downloads, and reads the same data through the native CLI. It retains every earlier immutable record and verifies any existing earlier assessment.

It then exports the complete editable workspace, receives it through the original workspace importer into a separate private directory, compares every portable original collection, reopens all assessments and verifies the complete relationship files and counts. Receiver-local receiving journals remain local to their original importer.

The main outputs are:

- `OPERATED_DIRECTORY_FOREIGN_KEYS.json`: complete result, original/native IDs, summaries, exact authored derivation, route/CLI receipts and fresh receiving result.
- `FOREIGN_KEYS_JOURNEY.json`: original requests, completed results, full-file descriptors, failures and stable completion time.
- `Directory_Foreign_Keys_Complete_Editable_Workspace.zip`: full original/derived workspace, sources, indices, assessments, reviews, comparisons and all retained files.
- Full assessment/review files, authenticated route receipts, complete CLI outputs and `AUTHORED_TABLE_DELETION.json`.

The separate complete operation entry binds the original source archive and Saved workspace, preserves source preimages and hashes, and saves small interruption/results before the full operation archive within the same native lifetime. A stopped operation resumes its exact current boundary and workspace UUID. Do not initialize over a received workspace or reimport an older packet into a progressed operation.

## Limits and interpretation

The new relationship layer explicitly bounds exact key material at 1 MiB, complete outcome/candidate records at 4 MiB, candidates at one million and outcome/match rows at two million each. The existing assessment/source limits continue to apply. Complete coverage is bounded at 4 MiB. Exceeding a bound stops the operation with its original state retained; it is not a partial success or an invitation to discard remaining rows.

A reviewed conformance outcome is evidence about an exact selected dataset and implementation. It does not establish current availability, eligibility, service capacity, clinical suitability, a complete live publisher snapshot or acceptance by a receiving organization. Reviews retain the original findings and the named reviewer's disposition.
