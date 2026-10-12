# Databento customer receiving warehouse

This is the customer side of the original Databento migration delivery. It receives a completed `tj.databento-migration-delivery.v1` directory from `processor.py export`, keeps its exact mapped data and source identities in SQLite, and supports customer selection, query, export, rollback, and recovery.

It runs with Python 3.11 or later on Linux or macOS and uses only the standard library. It has no network client or provider credential configuration. The producer application, source acquisition, mapping/review state, and original UI remain the owners of their existing workflows.

## Receive the original complete delivery

Run from this directory, or use an absolute path to `receiver.py`. All output destinations must have an existing parent directory.

```bash
python3 receiver.py init --warehouse /customer/warehouse
python3 receiver.py receive --warehouse /customer/warehouse --delivery-directory /producer/complete-delivery
python3 receiver.py status --warehouse /customer/warehouse
python3 receiver.py inspect --warehouse /customer/warehouse --delivery DELIVERY_ID
```

The receive result supplies `id`, the immutable delivery identity. It is `delivery-` plus the SHA256 of the original manifest bytes, including their original ordering and whitespace. The receiver verifies every manifest-listed file and then streams the original mapped NDJSON and CSV together. It checks the original labels, values, row count, hashes, source index, coverage, report counts, and complete-export assessment binding. All original customer metadata is retained; private producer operator file bodies are not copied into the warehouse.

The input must be the complete output of the original processor, with both mapped data files and its manifest. A preview, a CSV by itself, or a directory with missing operator members from an operator-audience export is not a complete delivery. Use a customer-audience producer export when transferring to a customer who should not receive operator material.

Rows commit in batches of 512. A process interruption leaves an importing delivery with a retained exact prefix. Repeat the same receive command against the same original complete delivery directory: it checks every committed original row before continuing. An OS lock prevents two importers from writing the same delivery concurrently. A completely staged duplicate returns the retained result. A damaged or changed original input is not silently accepted or promoted.

## Make an explicit customer selection

Receiving stages a delivery. Selection is a separate named customer decision and does not change its original source role or assessment.

Use the current `head.generation` and `head.delivery_id` from status:

```bash
python3 receiver.py activate --warehouse /customer/warehouse --delivery DELIVERY_ID --expected-generation 0 --expected-delivery none --actor "Customer operator" --reason "Reviewed the retained source scope and selected this local edition" --operation-id customer-select-001
```

The actor, reason, target, expected head, and operation ID are retained together in one transaction. A stale head yields `HEAD_CONFLICT`. Repeating exactly the same operation returns the original decision; reusing its ID for a different decision yields `OPERATION_CONFLICT`.

To move to another received edition, activate that edition using the newly displayed head. To restore a previously selected edition, use `rollback` with the same argument shape. A rollback target must have been selected before in this warehouse. Staged data is never deleted by activation or rollback.

An original `assessmentReady: false` remains false in every inspection and decision record. Customers may select a reference session for local analysis without claiming a provider migration was accepted. Different reference sessions are not automatically treated as a historical/preview pair.

## Query exact values

```bash
python3 receiver.py query --warehouse /customer/warehouse --limit 50
python3 receiver.py query --warehouse /customer/warehouse --delivery DELIVERY_ID --after 50 --limit 50 --filters-json '[{"column":"instrument_id","op":"eq","value":"12345"}]'
python3 receiver.py index --warehouse /customer/warehouse --delivery DELIVERY_ID --column instrument_id
```

Choose the actual original output label shown by `inspect`; the example label above is not imposed on the producer mapping. A query returns the selected delivery identity, original manifest digest, exact original JSON line, cells with their original JSON kinds, total matched rows, and an ordinal cursor.

Filters are combined with AND. Supported operators are `eq`, `prefix`, `contains`, and `is-null`; optional `kind` selects a JSON kind. Values are exact text, including integer and decimal number tokens. This avoids coercing large nanosecond values, fixed-point prices, unsigned sentinels, or leading zeros into floating point.

The generated SQL table uses `c0`/`k0`, `c1`/`k1`, and so on. The retained dictionary maps these aliases back to the exact case-sensitive output labels and JSON pointers. `_ordinal` is the original 1-based mapped row order. `_raw` contains the entire original NDJSON line as bytes. `cN` is exact cell text and `kN` is its JSON kind (`null`, `string`, `number`, `boolean`, `object`, or `array`). JSON null and an empty string are distinct even though CSV represents null as an empty field.

Use the native query API or a read-only SQLite connection for analytics. Numeric conversion and units must be chosen explicitly from the original source representation. The receiver does not guess price scaling, symbol mappings, absent values, local timezone, or source completeness. The optional query index preserves the exact text/kind representation.

## Export a customer handoff

```bash
python3 receiver.py export --warehouse /customer/warehouse --out /customer/handover-001
python3 receiver.py export --warehouse /customer/warehouse --delivery DELIVERY_ID --filters-json '[{"column":"instrument_id","op":"eq","value":"12345"}]' --out /customer/selected-001
```

Open `receiving-overview.html` for an escaped, self-contained reading view. It shows the selected source scope, original assessment, exact filters, source identities, customer decisions involving this delivery, and the first 50 selected records. Its linked NDJSON and CSV contain the entire selection.

An unfiltered export reproduces the original complete customer NDJSON and CSV byte for byte and verifies both original hashes before finishing. A filtered export records its own selection and file inventory while preserving the original manifest and metadata under `provenance/`. Neither claims to be a new producer migration result. Both retain the original source coverage and exclusion counts.

The head and relevant local customer decisions are captured in one short SQLite read snapshot. These decisions belong to the customer warehouse; private producer operator notes and review files are excluded. The export manifest lists every emitted data, metadata, reading-view, and decision file with its size and SHA256. The manifest's own bytes are not self-hashed.

## Backup, move, and reopen

```bash
python3 receiver.py backup --warehouse /customer/warehouse --out /customer/warehouse-backup-001
python3 receiver.py restore --bundle /customer/warehouse-backup-001 --out /customer/restored-warehouse
python3 receiver.py status --warehouse /customer/restored-warehouse
```

The backup uses SQLite's native online snapshot operation. It contains one database, this exact receiver source, a README, and a file-hash manifest whose head comes from the copied database. Complete received data, original row bytes, retained source manifests, column dictionaries, decisions, and indexes move together. Restore verifies each file and the copied database integrity/head, then opens a new private warehouse directory.

The snapshot can also be inspected directly with its bundled `receiver.py` in read-only commands. Restore leaves the backup unchanged. All creation, export, backup, and restore destinations are create-only; existing content is preserved.

A backup taken while an import is incomplete preserves the committed prefix and status. Completed deliveries remain fully usable without the original producer directory. Resuming an incomplete import requires the same exact original complete delivery directory; the snapshot does not pretend it captured rows that had not yet been received.

## Integration API

```python
from receiving.receiver import Warehouse, ReceivingError, restore

warehouse = Warehouse.create("/customer/warehouse")   # create once
try:
    staged = warehouse.receive("/producer/complete-delivery")
    displayed = warehouse.status()
    inspection = warehouse.inspect(staged["id"])
    page = warehouse.query(staged["id"], filters=[], after=0, limit=50)
    # Bind actor/reason/operation_id to an actual explicit customer action.
    decision = warehouse.activate(
        staged["id"],
        displayed["head"]["generation"],
        displayed["head"]["delivery_id"],
        actor="Customer operator",
        reason="Selected this reviewed source scope for local analysis",
        operation_id="customer-select-001",
    )
    exported = warehouse.export("/customer/handover-001", staged["id"])
    backup = warehouse.backup("/customer/warehouse-backup-001")
finally:
    warehouse.close()

restored = restore("/customer/warehouse-backup-001", "/customer/restored-warehouse")
```

For subsequent requests, open `Warehouse(path, readonly=True)` for status, inspection, query, export, or backup, and close it after use. The original controller can map `ReceivingError.code` to its current error presentation. It should display the exact current head before activation and forward the named actor, reason, stable operation ID, and expected head unchanged.

The receiving component does not need an alternate producer store, a new acquisition route, or its own competing web server. The existing controller can expose these complete customer actions after its original export is finished.

## Operating limits

- Mapped rows are streamed; the default maximum row size is 16 MiB and small metadata documents are limited to 32 MiB.
- SQLite's actual installed column limit is checked before creating a mapped table. A too-wide mapping stays upstream for an explicit narrower customer selection.
- Pages contain at most 1,000 records; the reading view shows at most 50. CSV and NDJSON exports stream all selected rows.
- A warehouse needs space for the original row bytes, exact cell text/kinds, SQLite structures, and optional indexes. Backups and exports need additional destination space.
- API errors leave received committed data and prior customer selections intact. Correct the reported condition and explicitly resume or retry the intended operation.
