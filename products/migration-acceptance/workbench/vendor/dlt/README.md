# dltHub Native Pipeline Migration

A complete local operator for retained data intake, native dlt pipeline stages, full typed parity, reviewed consumer selection, and editable application receiving.

The selected engine is **dlt 1.31.0**, original commit `2360d229c77f7f64692acc31a4555f4cfcd50ed3`, installed from its unchanged original lockfile with the DuckDB extra. The application uses original `dlt.pipeline`, `resource`, incremental cursors, package inspection, retry and abort APIs. It retains the full pipeline working directory and DuckDB file after each closed job. Earlier jobs remain available when a later source or plan edition is selected.

## Start here

1. Read [OPERATOR.md](OPERATOR.md) for installation, authentication, intake, operation, recovery and complete receiving.
2. Use [runtime/OPERATING.md](runtime/OPERATING.md) to install and package the original engine.
3. Read [WORKSHARE.md](WORKSHARE.md) for the proposed paid implementation scope and its acceptance boundaries.
4. Use `node cli.mjs help` for the installed local console.
5. Run `receiving/receive.mjs` only with the actual complete source manifest, selected runtime receipt and existing browser paths.

No native pipeline result is asserted by the presence of this source. The complete receiving command creates `CUSTOMER_RESULT.json` only after its actual stages, comparisons, browser journey and all artifact checks finish.

## Included workflows

- Original CSV, JSON and NDJSON intake with resumable checked uploads and exact source identities.
- Explicit native resource hints, merge keys, schema contracts, incremental cursor semantics, nested normalization and separately retained expected tables.
- Source-preserving Airbyte public API, protocol, legacy and Terraform configuration review. Conversion requires an explicitly reviewed dlt input before data effects.
- Separate extract, normalize and load controls, complete pipeline/package/failed-job inspection, same-job reconciliation, cancellation, explicit retry and original package abort.
- Closed parent pipeline continuation, cursor boundary replay, bounded backfill, and an explicit reason when selecting an older pipeline state.
- Whole-population typed comparison, including duplicates, nulls, exact integer/decimal values, schema compatibility, key validity and normalization coverage.
- A reviewed local consumer binding, its previous selection and rollback history.
- Complete canonical NDJSON handoffs with editable application source, runtime archive, sources, plans, requests, every historical native file and byte-exact older named exports.
- Fresh, same, forward and older receiving with suspended native custody until explicit resumption.

The consumer endpoint serves the retained complete typed export for its selected closed result. It is identified as `liveQuery:false`. External warehouse, application or DNS changes are separate customer-owned actions.

## Original reference programme

The retained original CSV inputs contain 1,000 baseline records and 14 later rows: 12 existing IDs change and two IDs are inserted. The programme retains the unchanged inputs, derives a complete changed-source realization with a written derivation, and compares all 1,002 final rows against an independent expected export. It also uses the full original dlt 100-event GitHub fixture to exercise genuine nested normalization. Unmapped resulting business tables block cutover until an explicit complete acceptance mapping exists.

The programme preserves its observed schema-contract failure, invokes the original abort API, approves an evolved schema, checks cursor replay and bounded backfill, then explicitly selects an earlier closed pipeline for verified consumer restoration. It does not invent a substitute load engine or discard the nested edition.

## Source and licensing

Application: MIT. Original dlt source excerpts and reference fixture: Apache-2.0, with original license included. Original Sling data and maintained workspace/comparison/archive modules retain their own source and license declarations under `reference/` and `vendor/sling/`. The complete engine checkout and dependency cache are included by the runtime transfer, rather than pretending the selected source excerpts constitute a build checkout.

See [SOURCE_REFERENCES.json](SOURCE_REFERENCES.json) and each retained upstream/source manifest.
