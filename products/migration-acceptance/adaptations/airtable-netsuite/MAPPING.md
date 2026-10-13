# Mapping the two retained provider sources

A mapping has schema airtable-netsuite.mapping.v1, a stable id, tables[] and optional relationships[]. Each table defines name, airtableTableId, netsuiteQueryId, primaryKey[] and columns[]. Names are explicit lowercase native identifiers. Each side is projected independently.

## Column declarations

Every column declares name, type and nullable. Supported types are text, integer, decimal, boolean, date and timestamp. Decimal additionally requires precision (1..38) and scale (0..precision). Integer uses signed 64-bit native BIGINT. Values outside these bounds must use a separately reviewed text representation; the adapter does not truncate or round.

airtable and netsuite selectors are both required. Airtable selectors use one of:
- fieldId: actual retained field ID; original spelling/name changes do not guess a replacement.
- recordId: true, for the original rec... identifier.
- createdTime: true, for the original record creation timestamp.
- linkRecordId: true, for an expanded linked-record ID.
- linkOrdinal: true, for its zero-based position.
- linkedFieldId: actual target-table field ID, resolved through the complete original captured linked record.

The NetSuite selector uses alias, matched case-insensitively. A response with colliding case variants is rejected. Original key spelling remains in the full raw body.

Every possibly absent field/alias needs an explicit missing policy:
- {"mode":"error"}: require the original value to be present.
- {"mode":"null"}: map absence to null; the target column must allow null.
- {"mode":"value","value":false}: deliberately map an omitted checkbox to false.
- {"mode":"value","value":""}: deliberately map an omitted empty text value.
- A links expansion may use {"mode":"value","value":[]} for omitted empty link arrays.

The raw body and projection's missingCells preserve where a reviewed fallback was used. Explicit null remains null and is never passed through an enum fallback. A missing field is not assumed to mean null, zero, false or empty text.

A selector may carry valueMap, with exact keys "string:T", "string:F", "boolean:true" and so on. This supports a reviewed NetSuite T/F mapping to actual booleans. There is no heuristic truthiness or coercion. Native typed boolean expected cells use the original worker's "true"/"false" text convention.

Text must already be text. Integer/decimal source tokens remain lexical strings because the existing exact JSON parser retains every numeric token before JavaScript can round it. Decimal exponent notation is expanded exactly; trailing zeros may be removed only to fit the declared scale without changing value. Any required rounding fails preparation.

Dates must be valid ISO dates. Timestamps require explicit timezone and at most microsecond fractional precision, matching the original native Python/DuckDB path. Local wall-clock values belong in reviewed text columns unless their timezone rule is provided separately.

## Linked-record relation tables

Set airtableRows to:
{"mode":"links","fieldId":"<actual link field>","missing":{"mode":"value","value":[]}}

The retained schema must identify that field as multipleRecordLinks and its original linkedTableId must be included in the capture. Each original link becomes one relation row, with its parent record, linked record ID and ordinal retained. A target business key can use linkedFieldId. If the selected target record is absent, business-key lookup fails instead of silently dropping the relationship. A raw linkRecordId can still expose a relationship outside the selected target population.

Select a separate independently captured SuiteQL relation query for the expected rows. Keep the original query and stable ordering in configuration. Do not derive the expected link array from Airtable.

Each relationships[] entry declares id, childTable, childColumns[], parentTable, parentColumns[] and nulls ("allow-all-null" or "reject"). Referenced parent columns must form a unique identity on each side. Every orphan row/key is retained separately for Airtable and NetSuite. The original acceptance operator receives this report in addition to its own complete table comparisons.

## Population and consistency

Each configured table/query declares scope.population, coverage ("all-live" or "filtered-live"), inactive, and deleted:"not-observed-by-list". This describes the actual selected API population. It does not assert coverage of records excluded by role permissions, a view, a WHERE clause or absent provider history.

The collector retains a complete base schema before and after the export and rejects any selected-table schema change. SuiteQL totalResults must stay constant across pages, and both providers require distinct stable identities. Those checks detect several forms of drift; they do not turn sequential HTTP reads into a database snapshot. consistency.mode therefore remains observed-interval unless quiesced is accompanied by actual retained evidence. The exact capture start/end and response times travel with the source.

For deleted-record reconciliation, retain the separately acquired authoritative deletion/audit source in the original application and review it with the operator. Full-list disappearance can also result from changed permissions or scope. compareCapturePopulations reports only presence changes in identical configured scopes.

At the documented REST/page ceiling, configure countQuery on the original query selection with q, params, alias, samePopulationAsSelection:true and reviewEvidence. It must be a separately reviewed aggregate over the same exact population, not an automatically rewritten query. The collector retains its complete one-row result before and after the selected export; both exact counts must equal all captured rows. A capped result without that source is rejected. The same option can be used below the ceiling.
