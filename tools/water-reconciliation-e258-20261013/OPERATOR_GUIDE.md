# Discovery operator guide

## 1. Select the original operation and authorized exports

Keep one directory for each discovery case and one immutable output directory for each edition. Record the source owner, the actual extraction authority/reference, the export date and relevant system release in the manifest. For a customer operation, select data_class AUTHORIZED_CUSTOMER_EXPORT only when that describes the actual input. The label records the operator's provenance statement; it does not obtain access or approve a new data use.

The input root defaults to the manifest's directory. --input-root can select a different explicit authorized root. Table paths are relative to that root, and resolved files must stay inside it. Input symlinks resolving outside the selected root are rejected. Put complete authorized exports in that root rather than adding unrelated directories to the scope.

Every table declares id, path, ordered columns and its original CSV format. UTF-8 and UTF-8 with a byte-order mark are supported. The default comma delimiter and double-quote quoting follow the Python CSV reader; quoted newlines are retained. A record number is a logical CSV record, while physical_line_end identifies the reader's end line. Blank/short/long records remain width errors instead of disappearing. Missing or repeated headers stop the run.

The default header_mode exact requires the original header order to equal the declared schema. allow_extra preserves the complete original file, records its unmodelled headers and models only the declared columns. It still checks every record against the actual complete header width.

An optional table sha256 pins a previously received file. If absent, the actual full-file hash is captured at receiving. The complete snapshot is streamed while hashing, and file size/modification metadata is checked before and after the read. An interrupted run cleans only its own unfinished staging directory.

## 2. Define typed source columns

Every column has its exact name and a type. Optional required defaults to false, trim defaults to false, and null_values defaults to the single empty string. Literal strings such as NA and NULL remain values until the source owner explicitly declares them null tokens. Null matching occurs after any declared trimming.

| Type | Accepted interpretation |
| --- | --- |
| text | Exact decoded Unicode text, after explicit trimming/null handling |
| integer | Signed base-ten integer, up to 1,000 input characters; exact canonical integer |
| decimal | Finite signed base-ten decimal without exponent notation, up to 1,000 characters; exact decimal |
| date | Valid YYYY-MM-DD calendar date |
| boolean | true, false, 1 or 0; case sensitive |

An enum restricts a column to canonical typed values. Required nulls, invalid dates, out-of-enumeration values and incorrect numbers remain invalid rows. Their original raw values stay in the local working database and complete source CSV. A profile gives each column's null count, invalid count, exact distinct-valid count and, for numeric/date columns, extrema.

Primary-key profiles report null-key rows, duplicate groups, all rows in those groups and excess duplicate rows. The duplicate group calculation covers fully valid rows with complete keys; its scope and eligible-row count are explicit. Null-key counts cover the full original table.

Foreign keys name a child key and equally typed target columns. They report eligible complete child rows, null child keys, matched/unmatched rows and duplicate parent-key groups. An ambiguous target key remains visible even if an existence match succeeds. These checks preserve original rows; they do not merge or delete duplicate records.

## 3. Agree the metric contract

A metric names one source table. Its cohort expression defines which valid original records belong to the reporting population. The unit determines how records become countable members:

    "unit": {"kind": "rows"}

counts original eligible records. This is suitable only when the source record grain is the intended reporting grain.

    "unit": {"kind": "distinct", "columns": ["enrolment_id"]}

counts exact distinct canonical keys. Multiple records for a unit are grouped. Each outcome is true for that unit when any of its records meets that outcome filter; multiple outcome matches are reported as overlap. A null component of an eligible unit key returns INVALID_UNIT.

The supplied demonstration uses distinct enrolments, not distinct people. Changing to learner_id changes the reporting question and its semantic definition hash. It is a deliberate metric revision.

Typed filters accept:

    {"column": "academic_year", "op": "eq", "value": 2024}
    {"column": "outcome", "op": "in", "value": ["successful", "partial"]}
    {"all": [{"column": "level", "op": "eq", "value": "FE"},
             {"column": "mode", "op": "eq", "value": "full_time"}]}
    {"any": [ ... ]}
    {"not": { ... }}
    {"column": "funding", "op": "is_null"}

Operators eq, ne, lt, le, gt, ge, in, not_in, is_null and not_null are supported. Values are normalized using the declared column's type and null rules. Null is handled with an explicit null predicate; it is not a typed equality value. SQL three-valued null logic applies to comparisons and NOT, so an ordinary inequality does not automatically include null records. Use an explicit any/not_null expression for the agreed null policy. Empty all means true; empty any means false. Filters use bound values, and source column identifiers never become untrusted SQL expressions.

A metric contains one or more explicitly named outcome filters. Every outcome has a count and the same retained denominator. require_partition true requires exactly one outcome per unit; overlapping and unclassified unit counts remain in the report. A missing outcome filter is rejected.

invalid_rows reject is the default. If any row in the source table has a width/type error, the metric remains INVALID_INPUT and no denominator or percentage is published. This preserves uncertainty when an invalid row might have belonged to the cohort. An explicitly selected exclude policy computes from fully valid rows and discloses the whole invalid-row exclusion count. It does not infer where excluded invalid records would have belonged.

Rounding declares places from 0 through 8 and HALF_UP, HALF_EVEN or DOWN. Default is HALF_UP at one decimal place. Percentages use exact numerator and denominator with Decimal arithmetic, then apply that one rounding step. A zero denominator has percentage null. The displayed sum is a sum of rounded outcomes, not a replacement denominator.

## 4. Review source systems, dependencies and mappings

The source_register keeps the original system identity, owner, source reference, extraction method, identifiers, refresh window, retention, authorized access, volume and consumers. depends_on names another source-system ID. The engine returns a dependency order when the graph is acyclic; cycles remain explicit with no invented topological order.

Mapping entries retain an ID, review status, named original source fields, target, transformation description, owner and decision reference. States are PROPOSED, REVIEWED, ACCEPTED and REJECTED. A mapping references declared original columns and is not silently executed as a transformation. This makes the record useful during discovery before target-design decisions are approved.

The exported CSV registers are editable review copies. The canonical executable definition remains manifest.receiving.json or a new version of the original manifest. Transfer agreed edits back into that JSON, increment edition, and create a new output. Do not edit a completed report to simulate a source correction.

## 5. Correct an edition and compare

Correct the original source or explicit metric definition, create a new named manifest, and run into a new output directory. Original editions stay readable.

The comparison includes both complete metric results, both input quality profiles, both run identities and each table's changed profile. A matching semantic definition permits a count change, denominator change and difference between the explicitly rounded percentages. Both underlying numerators/denominators remain present so a reviewer can compute an unrounded difference if that is the agreed reporting convention.

The semantic hash includes the metric and the table's declared column types, null/trim/enumeration/required policy. Changing these definitions produces DEFINITION_CHANGED and suppresses the automatic rate delta. Added and removed metrics have their own classification. An uncomputed edition remains UNCOMPUTED_EDITION.

A same-definition rate difference does not establish causation. Review changed cohort membership, late source corrections, duplicates and outcome coverage through the preserved full files and quality profiles.

### Reconcile complete logical records

When both tables declare the same primary key and canonical column schema, comparison also counts inserted, removed, changed and unchanged business records. The engine compares complete SQLite key indexes; it does not use a sample or a Python in-memory dictionary of the customer cohort.

A canonical value hash is SHA-256 over the declared column values after their exact type/null/trim normalization. An unchanged logical record can therefore retain its meaning when a decimal changes from 100.10 to 100.1. Keys are matched by their complete canonical values; the hash is used for the record's canonical value comparison.

A key repeated in either edition, or associated with an invalid record, excludes that whole key from matches on both sides. Its ambiguous group count and the original row counts on each side remain explicit. Null/invalid keys that cannot be associated are counted separately. The report checks these conservation identities:

- Left original rows = removed + changed + unchanged + left ambiguous rows + left unkeyed rows.
- Right original rows = inserted + changed + unchanged + right ambiguous rows + right unkeyed rows.

The result is PARTIAL_AMBIGUOUS whenever either edition contains ambiguity or unkeyed records. Qualified movement counts remain available with that scope. Changed keys/schemas produce KEY_OR_SCHEMA_CHANGED; a missing primary key produces NO_STABLE_KEY. The engine does not infer a natural key, match by row order or expose raw customer keys/row payloads in the movement summary.

The CLI resolves the original directories from the two report paths. It checks the original manifest and every retained CSV hash, then uses each bound SQLite store. If the cold handover has no SQLite database, it rebuilds the full typed/key store from those exact snapshots and checks its full profiles against the original report. The temporary database is deleted after comparison; the received original files remain unchanged.

The Python API accepts compare_reports(left_report, right_report, left_root, right_root). With report dictionaries alone it returns the aggregate comparison and INPUT_DIRECTORIES_REQUIRED for the row-comparison section, without pretending the original records were compared.

## 6. Preserve and independently receive the complete case

The pack command carries every original snapshot, both original and receiving definitions, all reports/registers and the unchanged operator source/guides. The handover has an explicit complete member manifest with SHA-256 and byte size. ZIP creation uses a task-owned temporary file and exclusive publication to the selected new path.

The receive command requires a new directory, verifies the exact complete member set, rejects traversal/symbolic-link members, enforces a configurable expanded-byte limit, and checks every source byte before publishing the directory. It does not execute bundled code. Inspect source before running an unfamiliar handover.

The default expanded size limit is 4 GiB and member limit is 10,000. Select an appropriate limit for the actual agreed dataset. Receiving streams members and hashes; it does not load a full large CSV into memory. The derived SQLite file is omitted from the ZIP and rebuilt from the exact original CSV files.

Run the received source against manifest.receiving.json into a second new directory. Compare its input hashes, semantic metric hashes, profiles and outcomes with the preserved original report. The run identity changes because the receiving manifest has different local paths and explicit pins. The handover's original run identity remains the link to the first production.

Keep private original data and its complete handover within the project's agreed access and retention scope. Export the report or selected source-approved review material when that is the commissioned delivery. This tool does not transmit data, schedule a process, contact a prospect or create an agreement.

## 7. Resource and platform considerations

SQLite scales the working set beyond Python memory. Each declared cell retains raw and normalized forms, so allow working storage for both plus database indexes and the original snapshots. Distinct and grouping operations use SQLite's file-backed temporary store; set TMPDIR/SQLITE_TMPDIR to an appropriate task-owned directory before starting the process on a constrained worker.

The database page cache is 8 MiB. CSV fields default to a 16 MiB character limit, configurable with --max-field-chars. A source with unusually large quoted fields needs an explicit adjustment. Long arithmetic values are bounded at 1,000 characters.

A source error stops that edition and removes only its own staging directory. Saved editions are not changed. If a process is externally killed, its task-owned temporary directory may remain with a leading period; inspect that original directory before starting the continuation. Choose the same source inputs, keep their hashes, and publish a new complete output only after the interrupted original is reconciled.

## 8. Ayrshire source context for the original programme

The college's public Performance Indicators 2024–25 page 1 supplies an independent aggregate reference: 2,316 FE full-time total equals 1,698 successful, 198 partial and 420 non-completion. Keep those counts and the publication's rounded percentages as separate source facts. This fixture does not derive or claim the college's actual underlying student-level data.

Source: https://www1.ayrshire.ac.uk/media/1j2jp5yy/ayrshire-college-24-25-performance-indicators.pdf

The 2025 Board report and financial statements, printed page 12, records the earlier Microsoft/Azure context and describes subsequent Purview, Unit-e/CAMS and Power BI objectives. Those are dated source statements; current deployment, access, licences and ownership are discovery inputs.

Source: https://www1.ayrshire.ac.uk/media/hjoaoa2m/bom-finance.pdf

The 2024–27 infrastructure strategy provides the governance and integrated-data context.

Source: https://www1.ayrshire.ac.uk/media/f1rpr3ce/infrastructure-strategy-2024-27-final.pdf

The full current tender document selection is controlled by the original programme's current source inventory. Current replacements and clarifications remain with that original source owner. This reusable workbench supplies discovery/reconciliation engineering; the commissioned programme owns scope, acceptance, commercial terms and customer communication.
