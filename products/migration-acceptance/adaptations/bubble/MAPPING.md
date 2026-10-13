# Exact Bubble field and relationship mapping

The complete input is a `bubble.reconciliation-capture.v1` object with two independently retained `bubble.capture.v1` values: `source` and `expected`. Their operation IDs must differ. The expected population is the selected destination or rehearsal environment observed in its own capture. Preparation never generates expected rows from projected source rows.

The mapping is `bubble.mapping.v1`. It names an ID, a readable `expectedBasis`, every selected table, primary key, column, exact type and two independent selectors. Each table names `sourceTypeId` and `expectedTypeId` from its respective capture configuration.

## Fields and missing values

A field selector uses an exact JSON Pointer, for example:

```json
{"kind":"field","pointer":"/Organization Code","missing":{"mode":"error"}}
```

Pointers preserve literal spelling, spaces and case. Escape a literal tilde as `~0` and a slash as `~1`. A missing key differs from an explicit null. Missing policies are `error`, `null`, or `value` with the complete explicit replacement value. Nullability belongs to the mapped column. The full original body retains fields outside the selected mapping.

Supported exact scalar types are text, signed 64-bit integer, decimal with explicit precision/scale, boolean, calendar date and timezone-bearing timestamp. JSON numeric tokens are parsed as their exact original text before JavaScript could round them. Integers cannot silently exceed BIGINT; decimals cannot silently round; timestamps exceeding native microsecond precision are rejected. Text stays text. An explicit `valueMap` uses keys such as `string:Open` or `boolean:true`; unknown values fail visibly. An explicit mapped null is accepted only when the column is nullable; an original raw null continues to follow column nullability.

To preserve a complete structured field as text, select `encoding:"canonical-json"`. This is explicit encoding, not a silent object-to-string conversion. An encoded JSON null becomes the literal text `null`; a scalar null remains database null.

## Captured relationships

Bubble record IDs can differ between apps or environments. Resolve a source reference through that side's complete captured parent type:

```json
{"kind":"field","pointer":"/Organization","missing":{"mode":"error"},
 "lookup":{"typeId":"organizations","keyPointer":"/_id",
 "valuePointer":"/Organization Code","missing":{"mode":"error"}}}
```

The destination selector independently names its own type and fields. Lookup indexes require unique, present scalar keys. Missing referenced records and missing target values follow the explicit lookup policy. A missing record is not replaced with a guessed parent.

For list relationships, give the table `sourceRows` and `expectedRows`:

```json
{"mode":"list","pointer":"/Allowed Organizations",
 "missing":{"mode":"value","value":[]}}
```

Each retained item becomes one row. A column may select `kind:"list-item"` with an item pointer (empty string means the entire item), or `kind:"list-ordinal"`. Ordinary record-field selectors still refer to the original parent record. Lists are not silently sorted or deduplicated. Choose the real business key; ordinal identity is appropriate only when order itself is part of the agreed relationship.

A mapping `relationships` row has `id`, `childTable`, `childColumns`, `parentTable`, `parentColumns` and `nulls` (`reject` or `allow-all-null`). Preparation records all orphans independently on both sides. The native receiver also compiles those exact relationships as required rules unless an explicit `acceptance` policy says otherwise.

## Independent native acceptance

The original compiler retains every selected business column and primary key. Native receiving adds complete table row-count controls. Optional `acceptance.controls` uses the original business-rule schema:

```json
{"id":"case_amount_by_org","objectId":"cases","groupBy":["organization_code"],
 "measure":{"kind":"sum","column":"amount","scale":2},
 "nulls":"reject","acceptance":"required"}
```

Exact totals are evaluated from the original complete observed rows. Native parity or required type/key findings cannot be erased with an exception. An analyst may separately acknowledge or accept only a rule explicitly classified as reviewable through the original maintained decision writer.

Review privacy separately. A successful admin-token export does not prove tenant isolation. The captured scope states the population visible to its credential; records or fields withheld by privacy rules remain unknown. The source does not infer hidden values or cross-organization access from row equivalence.
