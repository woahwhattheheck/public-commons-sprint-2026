# Dataset reconciliation — operating guide

Dataset reconciliation compares two immutable editions already imported into the original Stellar Forge DuckDB workspace. It keeps the field meanings, exact native values, matching rules, every original row, review decisions and complete handover together.

Open **Dataset reconciliation** from the original Dataset workspace. The same local listener, workspace identity, warehouse and export journal own both interfaces. The **Operating guide** link in the header opens this document before an export exists; a frozen copy also travels in each complete handover.

## 1. Open the original project

Use the installed DuckDB application that owns the project. If opening it from the Python installation, the existing command is:

~~~sh
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace serve --open
~~~

The command returns its local listening address and the path of its private launch record. The launch capability reaches the browser through the URL fragment and is removed from the visible address after the page opens. A Dataset workspace link in the reconciliation header returns to the same project.

When a host already owns this warehouse, use that existing browser or MCP connection. The Python CLI needs the warehouse lock; a separate CLI process cannot borrow a live browser owner's in-process connection. The installed MCP client calls the existing owner.

The reconciliation sidebar displays the native workspace ID. A browser that sees a different ID on the same address stops the dependent operation. Reopen the intended project's launch URL before continuing.

### Import source editions

In **Dataset workspace → Source delivery**, review the original acquired delivery, choose its SQL column types and meanings, and import the exact edition. Repeat for the other side. The comparison uses these original edition IDs, independent of later changes to active SQL view aliases.

Return to reconciliation and choose **New pair**. **Load earlier editions** follows the original edition catalog's continuation until earlier source versions are available. The selected edition panel shows all imported fields, native SQL types, original delivery scope and retained source meanings.

A complete comparison needs a deliberate source contract. When the original columns use different units or time representations, record the conversion for each side in the mapped field's reviewed normalization policy. The comparison keeps both original editions and every original value. Column labels do not supply a conversion or timezone.

## 2. Define the complete pair

A pair has a stable name, a display label, two immutable edition IDs and a list of canonical comparison fields. Choose a meaningful name using letters, numbers and underscores, beginning with a letter. Saving an edited pair adds a revision under that name.

For every field, set:

| Field | Purpose |
| --- | --- |
| Canonical field | The name used in comparison tables and reports. |
| Source column | The exact original column in the source edition. |
| Target column | The exact original column in the target edition. |
| Role | Matching key, or compared value. |
| Meaning | The interpretation the reviewer intends for this comparison. |
| Source/target value maps | Optional explicit mappings of original VARCHAR strings. |
| Unit and time normalization | Optional reviewed conversion from each original column into one exact canonical type. |
| Comparison rule | Exact native comparison, or a reviewed numeric allowance for a compared value. |

At least one field must be a matching key. A pair accepts up to 64 comparison fields; each original column can be selected once per side. Canonical names are unique without regard to case.

Without a normalization policy, the two selected native SQL types must be identical. A reviewed normalization can accept different compatible native types and convert them into its declared canonical type. Fields compare exactly unless a compared value has an explicit reviewed numeric rule. Matching keys remain exact after their reviewed literal mapping or UTC conversion. Rounding, case folding, whitespace trimming, units and timezones are never inferred. Large integers, decimals and original floating-point values retain their exact native meaning; the browser displays returned text without converting it through JavaScript floating point.

Fields left out of the comparison are listed by the mapping review. They remain in their complete original rows and original source exports.

### Exact VARCHAR value maps

A value map explicitly associates an original string with a canonical string. Maps apply only to VARCHAR fields and are separate for source and target. This supports a reviewed relationship such as one source's `Good` and another source's `OK` both meaning `valid`.

With a nonempty map, every non-null original string needs an entry. An unlisted string makes that row quarantined. Native NULL remains NULL. Spaces, case, empty strings and embedded newlines are part of the literal value. The interface marks SQL NULL and an empty string separately; these markers are display annotations.

Each side of a field accepts at most 10,000 literal entries. The original HTTP owner also limits a complete JSON request to 1 MiB, so the total encoded definition must fit that original request limit. The editor pages long maps while retaining the entire definition. **Export definition JSON** exports every mapping entry, including entries beyond the visible page. Duplicate original strings in one map are rejected.

Use an empty map when the original values should be compared directly. Mapping a key changes its canonical matching value, so review the resulting duplicate groups as part of the comparison.

### Reviewed unit and time normalization

Open **Unit and time normalization** below a mapped field. Choose **Reviewed numeric scale and offset** or **Reviewed UTC timestamp**, then complete the rules for both original columns and the **Normalization review basis**. The default uses the original native values.

A field uses either literal value maps or a normalization policy. Remove a conflicting map explicitly before selecting a conversion. An imported policy that conflicts with its selected type, role or map stays visible until it is corrected or deliberately removed. Editing the definition invalidates the earlier review and all displayed conversion previews.

#### Numeric scale and offset

Numeric normalization is available for a **Compared value** from VARCHAR, BIGINT, HUGEINT, DECIMAL or DOUBLE. Each side has an original unit, nonzero scale and offset. Set a common canonical unit and an exact canonical SQL type: BIGINT, HUGEINT or DECIMAL(p,s), with at most 38 digits. The two original types may differ.

~~~text
canonical value = original value * scale + offset
~~~

Keep scale and offset as signed decimal strings. Their coefficient and exponent limits match the exact numeric policy contract: at most 256 coefficient digits and an exponent magnitude of 256, within 256 characters of input. The unit fields are nonblank, NUL-free text of at most 240 UTF-8 bytes; the review basis is at most 4,000 UTF-8 bytes.

This example converts a source Wh value to kWh and keeps the target's existing kWh value. It is a policy example; replace its basis with the actual reviewed source contract.

~~~json
{
  "mode": "numeric-affine",
  "canonical_type": "DECIMAL(30,6)",
  "canonical_unit": "kWh",
  "source": {"unit": "Wh", "scale": "0.001", "offset": "0"},
  "target": {"unit": "kWh", "scale": "1", "offset": "0"},
  "basis": "Reviewed source contract declares Wh; reviewed target contract declares kWh."
}
~~~

Place the object in the mapped column's optional `normalization` property. The engine applies the calculation with exact rational arithmetic and requires the result to fit the declared canonical type exactly. It does not round, saturate, or silently use DOUBLE as an output. A native DOUBLE input retains its exact binary value; a decimal-looking display does not make that input an exact decimal.

If the field also has a numeric tolerance, the tolerance's **Comparison unit** must equal the normalization's **Canonical unit**. Its absolute allowance and all exact differences use that canonical unit. Numeric normalization does not make an approximate matching key.

#### UTC time normalization

Time normalization is available for either a matching key or a compared value. Both sides produce TIMESTAMPTZ at exact microsecond precision. Choose each side's actual representation:

| Time format | Original representation | Offset selection |
| --- | --- | --- |
| native | DATE, TIMESTAMP or TIMESTAMPTZ | A fixed ±HH:MM for a naive value; embedded for an offset-aware value. |
| iso8601 | VARCHAR with the declared ISO timestamp text | A fixed ±HH:MM for naive text; embedded when the original text supplies its offset. |
| unix-seconds | Numeric value or numeric VARCHAR in Unix seconds | utc |
| unix-milliseconds | Numeric value or numeric VARCHAR in Unix milliseconds | utc |
| unix-microseconds | Numeric value or numeric VARCHAR in Unix microseconds | utc |
| unix-nanoseconds | Numeric value or numeric VARCHAR in Unix nanoseconds | utc |

A fixed offset is part of the reviewed source contract. The engine does not guess a geographic timezone or daylight-saving rule. Use `embedded` only when each original non-null value actually carries its required offset; use a fixed offset only for naive native or ISO values. Unix formats use `utc`.

~~~json
{
  "mode": "time-utc",
  "canonical_type": "TIMESTAMPTZ",
  "source": {"format": "iso8601", "offset": "embedded"},
  "target": {"format": "unix-milliseconds", "offset": "utc"},
  "basis": "Reviewed source timestamps include their offsets; target timestamps are Unix milliseconds."
}
~~~

Missing or conflicting offsets, invalid timestamps and values with a submicrosecond remainder are retained as failed conversions. A reviewed UTC matching key may make differently written timestamps represent the same instant; inspect the resulting complete duplicate groups. Time normalization does not enable numeric tolerance for a timestamp.

#### Preview every original value

Choose **Preview source conversions** and **Preview target conversions**. Each action reviews the complete current definition and opens a native page with the original value, original unit, canonical value, canonical unit, result and reason. Follow **Next** until every original row for that side and field has been read. The browser displays 25 values per page; the read API accepts up to 100.

**Inspect conversion** opens the full original column/type, canonical type, exact original number, exact mathematical candidate and reviewed policy. A failed conversion has no accepted canonical value. A retained mathematical candidate is diagnostic and is not included in grouping.

| Result | Meaning |
| --- | --- |
| CONVERTED | The original value converted exactly into the reviewed canonical type. |
| NULL_PRESERVED | SQL NULL stayed NULL; key and window rules still decide how its row is accounted for. |
| NOT_NUMERIC | Original text is not a supported numeric value. |
| NON_FINITE | The original numeric value is nonfinite. |
| NUMERIC_LIMIT | Numeric text or coefficient size exceeds the explicit parsing limits. |
| OUT_OF_RANGE | The exact candidate cannot fit the canonical numeric or time range. |
| PRECISION_LOSS | The numeric candidate would require rounding to fit the canonical type. |
| INVALID_TIME | The original value cannot be interpreted under its reviewed time format. |
| OFFSET_REQUIRED | The reviewed contract requires an offset that the original value does not supply. |
| OFFSET_CONFLICT | The original offset or awareness conflicts with the reviewed rule. |
| SUBMICROSECOND | The time candidate has a remainder below exact microsecond precision. |

Invalid policy structure is rejected during review. A valid policy with failing source values remains reviewable: the run retains those original observations in quarantine and records the exact failure for each transformed field.

### Reviewed numeric allowances

Open **Comparison rule** below the mapped field and select **Reviewed numeric tolerance**. This choice is available for a **Compared value** whose sides have the same native BIGINT, HUGEINT, DECIMAL or DOUBLE type, or whose reviewed numeric normalization produces an exact BIGINT, HUGEINT or DECIMAL type. It is unavailable for matching keys and time values.

Set the complete rule:

| Control | Meaning |
| --- | --- |
| Absolute allowance | A finite nonnegative decimal string in the reviewed comparison unit. |
| Relative fraction | A finite decimal string from 0 to 1. The fraction `0.005` means 0.5%. |
| Comparison unit | The common native unit, or the canonical unit declared by this field's reviewed numeric normalization. |
| Two SQL NULL values | Explicitly accept two NULLs as equal, or leave them not comparable. |
| Review basis | The source specification or engineering decision that justifies this rule. |

The accepted numeric comparison is symmetric:

~~~text
absolute difference = abs(source - target)
relative scale = max(abs(source), abs(target))
allowed difference = absolute + relative * relative scale
accepted when absolute difference <= allowed difference
signed difference = target - source
~~~

The absolute and relative allowances add together. Relative scale comes from the larger magnitude on either side. A zero value therefore still has the absolute allowance, while opposite signs remain part of the actual difference. The signed difference reports target minus source; it is not the acceptance threshold.

Keep coefficients as strings in definition JSON. This example shows a rule object, not an observed customer result:

~~~json
{
  "mode": "numeric-tolerance",
  "absolute": "0.001",
  "relative": "0.005",
  "unit": "reviewed source unit",
  "nulls": "uncomparable",
  "basis": "Replace with the actual source specification or engineering decision."
}
~~~

Place that object in the mapped value column's optional `comparison` property. The native review accepts finite nonnegative decimal notation, including its supported exponent form. Coefficient text is limited to 256 bytes/digits and an exponent magnitude of 256; relative allowance cannot exceed 1. Unit and basis must be nonblank and NUL-free, with limits of 240 and 4,000 UTF-8 bytes. Native review reports an invalid rule before save.

The browser retains literal coefficient text. The engine calculates from exact native integer, decimal and binary floating-point rational values. It does not round the input, alter a stored observation, infer units or convert a column to a different type. The original value text and exact numeric representation remain inspectable beside the result.

For a known key with one included observation on each side, every compared field must meet its own rule. Fields without a rule still compare exactly. A tolerance rule can establish acceptance only from finite numeric values or its explicit two-NULL policy. One NULL, or a nonfinite numeric value, produces a not-comparable field result. Two NULLs need `nulls: "equal"` to be accepted by that rule.

Duplicate-key groups continue through the original exact multiset comparison. The engine does not assign a pair of duplicate rows to make a tolerance succeed. Their field records show **DUPLICATE_NOT_PAIRED** with source and target counts; **All group rows** opens every retained observation.

Changing a mapped role or native column does not silently delete an existing rule. The editor shows the retained rule until compatible columns are chosen or **Exact native comparison** explicitly removes it. Any edit invalidates the prior mapping review. Review the entire new definition, then save its deliberate pair revision.

Definitions with no comparison property retain their original exact comparison and review identity. Adding a first numeric rule records the reconciliation feature in the existing workspace so an earlier writer cannot save a revision that silently omits it. Continue with the installed version that supports those saved rules. Existing exact runs and exports remain readable.

### Comparison windows

Leave the window column empty and add no windows to include the full source scope.

To select a window, choose one canonical mapped field and add explicit start and end values. Windows are half open: the start belongs to the window, and the end belongs to the next interval or lies outside the selected scope. Up to 32 nonoverlapping windows are supported.

| Native type | Window basis |
| --- | --- |
| BIGINT, HUGEINT, DECIMAL, DATE, TIMESTAMP, TIMESTAMPTZ | Native typed bounds, provided as exact strings. |
| VARCHAR | Explicit lexical string order. |

Window bounds apply to the reviewed canonical type. A field with UTC normalization uses explicit TIMESTAMPTZ bounds, and a numerically normalized field uses bounds that fit its exact canonical type without rounding. Without normalization, a VARCHAR window stays lexical even when its text resembles a date. Use the lexical basis only when string order is the intended source contract.

A missing or unresolvable window value is quarantined. A valid value outside all declared windows is retained as **Outside declared windows**. Overlapping, reversed or empty windows are rejected before a pair can be saved.

### Review and save

Choose **Review mapping** after editing. The native response includes the complete definition, original source scope, original and canonical SQL types, meanings, omitted fields, normalization and numeric-rule contracts when used, and a digest binding that exact review. The review shows both sides' conversion rules and basis, followed by each comparison rule's literal coefficients, comparison unit, NULL policy and basis before **Save reviewed pair**.

Check the review, then choose **Save reviewed pair**. Editing any field invalidates the previous review. The browser retains the full draft and requires a review of its current contents before saving.

An edit carries the original pair revision. If another operator has saved a newer revision, the current save returns a revision conflict. Keep the draft, open the latest pair revision and deliberately reconcile the definitions. The browser does not replace another operator's work by automatically adopting a new revision number.

**Import definition JSON** loads a complete definition as a new pair draft. Change its name if it describes a new pair; an existing name is protected by the native revision check. An exported pair definition is a useful starting point for a new source delivery.

## 3. Run and interpret reconciliation

Open a saved pair and select **Run reconciliation**. The exact pair revision and reviewed definition digest travel with the request. Opening a historical pair revision and running it is supported. Running the same revision reopens its original deterministic run.

The native run materializes one comparison row per original source observation. The run summary accounts for both sides:

~~~text
original rows = included + quarantined + outside declared windows
included rows = matched + unmatched included rows
~~~

Exact matched multiplicity is counted across equal canonical values within each key and window. A unique source/target group may also be accepted by its reviewed numeric rules. Duplicates retain the original exact multiset comparison; no arbitrary row pairing is chosen.

Runs with numeric rules expose three separate counts: **Canonical exact matches** retains the original canonical value multiplicities, **Accepted exact matches** applies the reviewed comparison including its NULL policy, and **Accepted tolerance matches** counts accepted numeric differences. **Matched rows** is accepted exact plus accepted tolerance. Read the recorded categories and original rows alongside these counts.

### Key-group categories

| Category | Native meaning |
| --- | --- |
| MATCHED | The known key/window has accepted exact matches with equal compared multiplicities. |
| TOLERANCE_MATCHED | A unique source/target group is accepted by its reviewed rules and includes a numeric difference accepted within tolerance. |
| SOURCE_ONLY | The known key and window appear only on the source side. |
| TARGET_ONLY | The known key and window appear only on the target side. |
| VALUE_DIFFERENCE | One original included row exists on each side and its compared values differ. |
| MULTISET_DIFFERENCE | A group with multiple observations has different canonical value multiplicities. |
| NOT_COMPARABLE | A known-key group contains quarantined observations, or a unique numeric-rule comparison is not comparable under its NULL or nonfinite-value policy. |

SOURCE_ONLY and TARGET_ONLY describe the known keys inside the selected windows. Unresolved keys remain separately quarantined; their correspondence is not inferred.

For example, two equal source observations and one equal target observation give one matched observation and one unmatched source observation. Equal NULL values in exact compared-value fields participate in the original native comparison. A numeric rule uses its explicit two-NULL policy for a unique counterpart. A NULL matching key cannot establish correspondence and is quarantined.

The group table shows the canonical key fields, source and target counts, quarantined counts, matched multiplicity and unmatched counts. Use **Duplicate keys** to inspect multiplicity separately from the category filter.

### Inspect recorded field differences

For a run with numeric rules or normalization, open **Field differences**. Filter by group identifier, canonical value field or recorded field state. **All recorded fields** clears those filters; the pager follows the native result through every returned page. The **Field differences** action on a key group opens its full value-field comparison.

The table displays the original source and target value text, recorded state, absolute difference, permitted difference and reviewed unit. **Inspect field** opens the source and target column names, canonical SQL type, original row references, observation counts, signed difference, relative scale, exact numeric representations and complete rule. When normalization is present, original value text still describes the source observations; exact numeric representations and differences describe the converted canonical values. **Group conversions** opens their complete original-to-canonical records. These are retained values from the native run; the browser does not recalculate them.

| Field state | Interpretation |
| --- | --- |
| EXACT_EQUAL | The compared native values are exactly equal under this field's comparison. |
| EXACT_DIFFERENT | The values differ in a field that has no tolerance rule. |
| NULLS_EQUAL | Two SQL NULLs are accepted by the explicit equal policy. |
| WITHIN_TOLERANCE | The exact absolute difference is within the reviewed allowance. |
| OUTSIDE_TOLERANCE | The exact absolute difference exceeds the reviewed allowance. |
| NULL_NOT_COMPARABLE | A NULL value prevents acceptance under this numeric rule. |
| NON_FINITE_NOT_COMPARABLE | A native numeric value is nonfinite. |
| DUPLICATE_NOT_PAIRED | The complete duplicate group retains exact multiset accounting; no counterpart was chosen. |
| ONE_SIDED | A known key has observations on only one side. |
| QUARANTINED | The original observation or group remains quarantined. |

A field record is one value field in a known-key group. Unknown matching keys remain in the original quarantined-row view. Duplicate and one-sided records keep their counts without fabricating a source/target row pair or a numeric difference.

Use **All group rows** to inspect every original observation. **Review group**, or the decision form beneath an inspected field, records an engineering decision against the original complete group. An accepted tolerance is still available for deliberate engineering review; it does not insert an approval decision.

Runs that did not record these field results keep their original groups and rows. The browser labels that absence and does not generate field results retroactively. The native fields route reports `FIELDS_NOT_RECORDED` for such a run.

### Inspect saved normalization results

For a run with a normalization policy, open **Normalizations**. The complete native table contains one record for every normalized field in every original observation, including SQL NULLs and conversion failures. **Conversion accounting** shows converted, null and failed field-value counts for each side; these counts are separate from the complete row accounting.

Filter by side, canonical field, result or group identifier. **All recorded conversions** clears the filters, and **Next** follows every retained page. **Inspect conversion** opens the exact policy and value record together with every original field in that same source row. A failed key conversion may have no known group; it remains available by side and original row.

The full record retains original and canonical SQL types, original value text, original and canonical units, exact numeric representations where applicable, result and failure reason. Canonical value text is absent after a failed conversion even if a mathematical candidate can be retained for diagnosis. Review or correct the source contract through a deliberate new pair revision; previous runs remain unchanged.

### Inspect every original row

Open **Original rows** to page through both complete editions as accounted for by this run. Filter by side, row status or group ID. **All group rows** opens the observations belonging to a selected group.

**Open full row** displays every original field alongside the canonical comparison values. The retained native row index identifies the original observation; it is not an invented counterpart on the other side.

Quarantine reasons identify the actual problem, such as an unmapped literal, a NULL key or a missing window value. Correct source interpretation by importing a reviewed source edition or saving a deliberate mapping revision. Existing rows and runs remain available for comparison.

All catalogs and row tables provide their original continuation. A visible page limits the display, not the native comparison or the complete export.

## 4. Record engineering decisions

Select a complete key group or an original row, enter a reviewer and reason, then choose an outcome:

| Outcome | Use |
| --- | --- |
| OPEN | The observation remains open for review. |
| ACCEPTED_DIFFERENCE | The reviewer accepts this particular difference with a stated reason. |
| REQUIRES_CORRECTION | The observation requires corrective work. |
| DEFERRED | Review is intentionally deferred with a stated reason. |

Save the decision against the current decision revision. Each decision appends a sequence number, original subject, reviewer, reason and timestamp. The decision history remains readable after a later decision changes the current interpretation.

Decisions do not change original source values, native group categories or row accounting. A decision that says a correction is required is an engineering record; the next corrected source delivery must be imported and compared to establish the result.

If a peer records a decision first, reopen the current run and review the updated decision revision before saving. The full entered reason remains in the interface after a returned conflict.

## 5. Freeze reports and compare a follow-up run

Choose **Create complete report** from a run. The report freezes the exact source editions, pair revision, mapping review with its normalization and comparison rules, decision revision, summary and saved native query recipes. Runs with recorded field differences include the complete fields query; normalized runs also include the complete normalizations query. **Reports and handover** shows the frozen policies and full-export meaning.

Optionally select a previous saved run. **Load all saved baselines** follows the complete native run catalog. A full run ID can also be supplied directly.

The resulting change table separates:

| Change | Interpretation |
| --- | --- |
| ADDED_TO_REPORT | A known canonical key/window is present in the later selected report. |
| ABSENT_FROM_REPORT | A known key/window from the earlier selected report is absent later. |
| CHANGED | The known group changed in classification/counts or exact canonical content. |
| UNCHANGED | The compared group retained its native classification, counts and comparable canonical content. |

The two compared runs must use the same ordered canonical key names and SQL types; a different key contract requires a separately reviewed comparison. The report also records whether mappings, normalization policies, canonical schemas, windows and source scopes are equal. Its change rows expose `canonical_schema_equal`, `canonical_content_changed` and `classification_or_counts_changed`. This identifies a changed value even when both runs still have the same group category and number of rows.

The scope field `normalizations_equal` identifies a changed conversion policy even when the group counts are unchanged. Read these scope fields before calling a change a correction. A key's absence from a later selected window does not by itself establish a corrected source. A changed source contract remains visible with the report.

Reports are immutable. Creating the same report at the same decision revision with the same baseline reopens the original report. A later decision produces a distinct report while preserving the earlier one.

## 6. Prepare and receive the whole handover

In **Reports and handover**, open the intended report and choose **Prepare complete handover**. This uses the original Dataset workspace export request journal. Export preparation runs the saved report recipes over their retained native tables and copies the original source handoffs and warehouse snapshot.

The completed native package contains:

| Path | Complete contents |
| --- | --- |
| manifest.json | Native file index, byte lengths, SHA-256 hashes, report binding and receiving information. |
| reconciliation-request.json | Original export request, frozen report, original view bindings and guide. |
| report.json | Complete immutable report and saved native recipes. |
| OPERATING.md | The operating guide frozen at export preparation. |
| queries/rows/ | Full original accounting query: CSV, Parquet, request, execution and manifest. |
| queries/groups/ | Full native key-group query and its original metadata. |
| queries/fields/ | Every recorded field, original value, exact difference, allowance and rule as CSV/Parquet, for a run with comparisons or normalizations. |
| queries/normalizations/ | Every original-to-canonical conversion, policy, exact numeric representation, result and reason as CSV/Parquet, for a normalized run. |
| queries/decisions/ | Full decision history through the frozen report revision. |
| queries/changes/ | Full change query and metadata when a previous run was selected. |
| sources/EDITION_ID/ | Each distinct original source edition's complete native source handoff. |
| warehouse/ | Original sparse warehouse snapshot and native handoff metadata. |

Query exports contain all query rows. For a run with reviewed comparisons or normalizations, the manifest binds those contracts to the frozen report and includes the complete fields recipe and export. A normalized run also carries its complete normalizations recipe and export. The receiver requires each declared full export, then reopens the same original report and warehouse. Earlier exact exports retain their original package form.

The JSON report is useful for review alongside the complete native handover.

Use **Save all files to a folder** where the browser supports folder access. This preserves nested native filenames. The interface checks the declared and received byte lengths; the native receiving command verifies content hashes and the complete package relationships.

Individual downloads remain available, with long file lists paged in the interface. Every entry remains in the full manifest and folder download. When downloading individually, recreate each listed relative directory and retain its exact filename. Files called `manifest.json` or `result.parquet` in different query directories are distinct originals. For a large package, use the typed native client below so every file and continuation is handled together.

The receiving folder must be private to its operator. Browser downloads may inherit broader local file modes. On Linux, restrict the chosen complete package directory before native inspection:

~~~sh
chmod -R go-rwx /absolute/private/received-package
~~~

Inspect the entire package using the exact manifest hash from its native export record:

~~~sh
python -m stellar_forge_buyer.reconciliation.package inspect --directory /absolute/private/received-package --manifest-sha256 EXACT_MANIFEST_SHA256
~~~

Receive it into a separate, new working directory:

~~~sh
python -m stellar_forge_buyer.reconciliation.package receive --directory /absolute/private/received-package --destination /absolute/private/reopened-project --manifest-sha256 EXACT_MANIFEST_SHA256 --workspace-id ORIGINAL_WORKSPACE_ID
~~~

Use actual returned values for the uppercase placeholders. The receiving directory must be separate from the immutable package and must not be an existing unrelated workspace. The receiver checks every declared original file, query, source, report and manifest, then uses the original sparse-copy and DuckDB reopening path.

The completed receiving result returns the new directory, original native workspace identity and original report ID. Open that directory through the installed DuckDB application or the existing `serve --open` command. Reopen the original report in **Reports and handover**.

The working warehouse may subsequently change while the received package remains immutable. An interrupted receive continues the same retained binding and temporary copy. Re-running receive with the same destination and manifest verifies its saved receiving record; it does not rerun source acquisition or create another export.

Current package limits are 16 MiB of manifest metadata and 8 GiB per original file. A larger original is rejected explicitly, never silently shortened.

## 7. Recover the original request

The browser saves the complete JSON request body and its 32-character request ID in IndexedDB before the first POST. A successful native result is retained before the interface loads dependent catalogs.

If a connection ends before the response arrives:

1. Open **Saved requests**.
2. Find the original action and choose **Inspect original request**.
3. If it is complete, choose **Open saved result**.
4. If continuation is needed, choose **Continue original request**.

The continuation uses the same original body and identifier. When the native journal explicitly reports that the request does not exist, this action sends the retained body. A catalog refresh or GET never resumes a write.

Two native journals are visible. Pair saves, runs, decisions and reports use the reconciliation journal in the original warehouse. Complete exports use the original Dataset workspace request journal. Requests made from another client can be reopened from their native catalog; the complete original body is loaded before continuation.

Keep the original browser profile until its pending operations are resolved. When browser storage is unavailable, native catalogs remain readable, but a new browser mutation cannot proceed without retaining its request. Use the original CLI request file or typed client with its own retained request when needed.

A returned storage error may mean the native operation stopped partway through export. Preserve its existing directory and original request; free the actual required capacity and continue that request. An existing complete package is independently inspected before it is reused.

## 8. CLI and request bodies

The reconciliation commands extend the original installed CLI:

~~~sh
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile status
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile review --definition /absolute/private/definition.json
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile save-pair --request-file /absolute/private/save-pair.json
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile run --request-file /absolute/private/run.json
~~~

Store each complete request file before dispatch. Use a new lowercase 32-hex request ID for a new operation and retain it for any continuation. The native workspace ID is also lowercase 32-hex. Pair, edition, run, report and digest identifiers are lowercase 64-hex.

The native review returns the normalized definition and `review_sha256`. A new pair save body is:

~~~json
{
  "request_id": "ORIGINAL_REQUEST_ID",
  "workspace_id": "ORIGINAL_WORKSPACE_ID",
  "expected_revision": 0,
  "definition": "REPLACE_WITH_THE_COMPLETE_REVIEWED_DEFINITION_OBJECT",
  "review_sha256": "RETURNED_REVIEW_SHA256"
}
~~~

The string placeholder for `definition` must be replaced with the complete JSON object returned by review. For an edit, use the actual current pair revision instead of zero.

A run body uses the returned pair record:

~~~json
{
  "request_id": "ORIGINAL_REQUEST_ID",
  "workspace_id": "ORIGINAL_WORKSPACE_ID",
  "pair_id": "RETURNED_PAIR_ID",
  "expected_revision": 1,
  "definition_sha256": "RETURNED_PAIR_DEFINITION_SHA256"
}
~~~

A group decision body is:

~~~json
{
  "request_id": "ORIGINAL_REQUEST_ID",
  "workspace_id": "ORIGINAL_WORKSPACE_ID",
  "run_id": "RETURNED_RUN_ID",
  "expected_revision": 0,
  "subject": {"kind": "group", "group_id": 1},
  "outcome": "OPEN",
  "actor": "Actual reviewer",
  "reason": "Record the actual observation and the review needed."
}
~~~

Use the actual current decision revision and original group ID. A row subject is `{"kind":"row","side":"source","row":1}`, with its actual side and original row index.

A report body contains `request_id`, `workspace_id`, `run_id`, the actual decision `expected_revision`, and optionally `before_run_id`. An export body contains exactly `request_id` and `report_id`.

| Operation | CLI command after reconcile |
| --- | --- |
| Browse catalogs | pairs, runs, reports, operations; all support --offset and --limit. |
| Read a saved pair | pair ID [--revision N] |
| Read a saved run/report | run-read ID; report-read ID |
| Inspect all native groups/rows | groups RUN_ID; rows RUN_ID; each supports native filters and paging. |
| Inspect recorded value fields | fields RUN_ID [--group-id N] [--column-name NAME] [--state STATE] [--offset N] [--limit N] |
| Preview a reviewed conversion | normalization-preview --definition FILE --side source --column-name NAME [--offset N] [--limit N] |
| Inspect saved conversions | normalizations RUN_ID [--side source] [--column-name NAME] [--state STATE] [--group-id N] [--offset N] [--limit N] |
| Open one original row | row RUN_ID --side source --row N |
| Read decision history | decisions RUN_ID --offset N --limit N |
| Read report changes | changes REPORT_ID --offset N --limit N |
| Record a decision/report | decision --request-file FILE; report --request-file FILE |
| Inspect/continue reconciliation request | request ID; resume ID --workspace-id WORKSPACE_ID |
| Prepare whole native export | export --request-file FILE [--export-root DIR] |
| Inspect/continue original export | export-request ID; resume-export ID |

Export CLI operations borrow the original DuckDBOperator journal and lock. Close the existing HTTP owner before starting that CLI owner. If the browser should remain open, use its export action or the installed MCP client.

## 9. Existing MCP tool and typed client

Reconciliation extends the original `sf43_discover_review_and_pay` tool with `action: "duckdb"`. Supply the existing registered `duckdbWorkspace` alias, a `duckdbOperation` and its complete `duckdbRequest`.

| Workflow | Existing-tool operations |
| --- | --- |
| Workspace and definition review | reconcile-status, reconcile-review, reconcile-normalization-preview |
| Saved pairs | reconcile-pairs, reconcile-pair, reconcile-save-pair |
| Native runs | reconcile-runs, reconcile-run, reconcile-execute |
| Original data review | reconcile-groups, reconcile-rows, reconcile-row, reconcile-fields, reconcile-normalizations |
| Decisions | reconcile-decisions, reconcile-decide |
| Reports and follow-up changes | reconcile-reports, reconcile-report, reconcile-save-report, reconcile-changes |
| Original reconciliation requests | reconcile-operations, reconcile-request, reconcile-resume |
| Full native handover | reconcile-export, reconcile-export-manifest |
| Original export continuation and bytes | operation, resume, file |

The installed distribution exports `./buyer/duckdb/reconciliation`. Its source module is `stellar-forge/mcp-paid-agent/duckdb-reconciliation-client.mjs`.

~~~js
import {openDuckDBReconciliationClient}
  from './stellar-forge/mcp-paid-agent/duckdb-reconciliation-client.mjs';

const reconciliation = await openDuckDBReconciliationClient({
  client: existingMcpClient,
  workspace: 'registered_workspace_alias',
  expectedWorkspaceId: originalWorkspaceId
});
try {
  const current = await reconciliation.status();
  const review = await reconciliation.review(completeDefinition);
  const pair = await reconciliation.savePair(retainedSavePairRequest);
  const run = await reconciliation.execute(retainedRunRequest);
  if (run.comparison_rules || run.normalizations) {
    let offset = 0;
    for (;;) {
      const fields = await reconciliation.fields(run.run_id, {offset, limit: 100});
      // Consume every original row in fields.rows as typed native text.
      consumeRecordedFields(fields);
      if (fields.next_offset === null || fields.next_offset === undefined) break;
      offset = fields.next_offset;
    }
  }
  if (run.normalizations) {
    let offset = 0;
    for (;;) {
      const conversions = await reconciliation.normalizations(run.run_id, {offset, limit: 100});
      consumeRecordedConversions(conversions);
      if (conversions.next_offset === null || conversions.next_offset === undefined) break;
      offset = conversions.next_offset;
    }
  }
  const report = await reconciliation.saveReport(retainedReportRequest);
  const exported = await reconciliation.exportReport(retainedExportRequest);
  const inspected = await reconciliation.inspectExport(exported.export_id);
  // Supply the original retained export manifest hash and destination.
  const received = await reconciliation.download({
    exportId: exported.export_id,
    directory: originalReceivingDirectory,
    expectedManifestSha256: originalManifestSha256
  });
} finally {
  await reconciliation.close();
}
~~~

`consumeRecordedFields` and `consumeRecordedConversions` denote the caller's handling of complete returned pages; supply those functions in the consuming application. Optional client field filters are `group_id`, `column_name` and `state`. The corresponding existing MCP operation is `reconcile-fields`, with the original run ID and those native paging/filter fields in its request. Numeric values and allowances in returned field rows are exact strings; never parse them through JavaScript `Number`.

For a read-only conversion preview, use `reconciliation.normalizationPreview(completeDefinition, {side: 'source', column_name: originalCanonicalField, offset: 0, limit: 100})` and follow its returned `next_offset`. The saved `normalizations(runId, filters)` method also accepts `side`, `column_name`, `state` and `group_id`. Its MCP operation is `reconcile-normalizations`; the preview operation is `reconcile-normalization-preview`.

The existing private listener exposes `POST /api/reconciliation/normalization-preview` with `{definition, side, column_name, offset, limit}` and `GET /api/reconciliation/runs/RUN_ID/normalizations` with the same native paging and saved-result filters. Keep the existing capability and workspace headers. A preview is a read-only review of the complete definition and returns its `review_sha256`; it does not save a pair or start a run.

Each request in this example is the full saved MCP request built from the preceding native results; the names denote retained caller inputs, not prepopulated sample data. MCP mutation requests omit the CLI/HTTP body's workspace_id field: the existing adapter binds the registered alias to the native workspace identity and supplies that field. Keep the original request_id, revision, definition and digest fields unchanged. The client exposes the same paging, row review, decisions and original request continuation methods as the native tool.

The client receives all manifest-declared files with the original byte-range receiver, up to 65,536 bytes per range, and preserves nested paths. It retains the same export, manifest, workspace, hashes and partial file offsets across an interruption. The small export-manifest descriptor allows receiving to proceed when a full file list would exceed a normal tool response.

Closing this adapter aborts and settles its own requests. It does not stop the external MCP client, original Python owner or warehouse.

## 10. Complete native receiving workflow

The shipped `reconciliation/receiving.py`, `reconciliation/browser-receiving.mjs` and `stellar-forge/mcp-paid-agent/duckdb-reconciliation-receiving.mjs` form one receiving workflow around the original installed host.

The browser arm opens the actual workspace and uses its visible controls for complete definition import and review, pair save, native run, an observed review decision, immutable report and complete export. When the supplied definition includes numeric rules, the same arm reads their literal controls and opens the complete recorded Fields view. When normalization is present, it also checks every side's explicit controls, pages through every original conversion preview, opens all saved normalization records, and drills through a conversion to the full original row. The report and complete export retain the same frozen policies. Inputs without those optional policies retain the original workflow. It retains the operation ID, source commit, full input, original browser request IDs and resulting native identities. A persistent browser profile keeps its original request journal available across interruption.

The same host's MCP and typed-client arm reads the original rows, makes an explicit reviewed successor mapping from actual retained source values, compares the resulting native runs, receives every original package file and reopens the original report from a separate sparse working warehouse.

The browser arm closes only the browser context it owns. The original native caller owns server start, server shutdown, source selection and final project reopening. A source or browser parse check alone is not the native receiving result; the completed receiving record identifies the actual executed project and its full exported files.
