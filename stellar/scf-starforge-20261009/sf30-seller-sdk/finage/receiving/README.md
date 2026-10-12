# Finage customer receiving warehouse

Receive the complete output of the original Finage market processor into a local customer warehouse. The warehouse keeps the selected records, their exact JSON and CSV values, source identities, coverage, mapped column labels and the customer's selection history. It supports resumable receiving, exact queries, indexes, full and selected exports, rollback, and portable backup and recovery.

The Finage entrypoint uses the maintained Databento receiving engine through a fixed Finage format profile. The original producer application continues to own source acquisition, time interpretation, symbol mapping, reviews, revisions and full market export.

## Use the installed merchant package

The existing distribution includes both `starforge finage-warehouse` for individual native commands and `starforge finage-receive` for the complete two-export receiving operation. Run `starforge finage-receive info` to inspect the selected release, exact shared engine/profile source and actual command paths. Preparation writes a private configuration from the original delivery identities; run and resume continue the original operating program and retain its actual native result.

See the [complete installed operating guide](../../../distribution/FINAGE.md) for source validation, create-only preparation, same-operation continuation, installed APIs and independent customer backup recovery.

## Start with a complete original delivery

Use Python 3.11 or later on Linux or macOS. The receiving engine uses the standard library. Keep the repository's Finage and Databento receiving directories together when using this source entrypoint.

From the Finage directory:

```bash
python3 receiving/receiver.py init --warehouse /customer/finage-warehouse
python3 receiving/receiver.py receive --warehouse /customer/finage-warehouse --delivery-directory /producer/finage-delivery
python3 receiving/receiver.py status --warehouse /customer/finage-warehouse
```

The equivalent Node entrypoint forwards the same arguments and process signals:

```bash
node warehouse.mjs receive --warehouse /customer/finage-warehouse --delivery-directory /producer/finage-delivery
```

Set `FINAGE_PYTHON_EXECUTABLE` when Node should invoke a particular Python interpreter.

The input is the complete directory produced by:

```bash
python3 processor.py export --workspace workspace.json --out /producer/finage-delivery --edition-id ORIGINAL_EDITION_ID --audience customer
```

Select the original edition ID shown in the producer workspace. The receiver also accepts an original operator-audience delivery when every manifest-listed operator member is present; it verifies those files and retains only the customer documents and mapped records. Use the producer's customer audience when handing a delivery to a customer.

All destination directories are created once. Their parents must already exist.

## Original format bindings

The receiver checks the following exact producer fields before receiving rows.

| Document | Original format and binding |
| --- | --- |
| manifest.json | `tj.finage-market-delivery.v1`; exact original edition, workspace SHA256, audience, counts, coverage, source inventory and every emitted file identity |
| customer/market-summary.json | `tj.finage-market-report.v1`; original `edition.id`, `columns`, `assessment.sourceCoverage`, summary counts, `dataExport.included`, `dataExport.completeRecords` and `ready` |
| customer/source-index.json | `tj.finage-source-index.v1`; original edition, sources and coverage |
| customer/output-columns.json | `tj.finage-output-columns.v1`; exact ordered column names and JSON pointer mappings |
| customer/mapped-records.ndjson | Every customer record, with original line bytes and JSON number tokens |
| customer/mapped-records.csv | The same records, ordered column labels and exact cell values |
| Remaining customer documents | Original market summary HTML and DELIVERY.md, retained with their declared hashes |

The complete mapped files, counts, customer metadata and original manifest must agree. A delivery identity is `delivery-` followed by the SHA256 of the original manifest bytes. Whitespace or ordering changes in that manifest produce a different identity.

Receiving streams CSV and NDJSON together and checks every row's original value and JSON kind. Rows commit in batches of512. If the receiving process stops, repeat the exact receive command with the same original complete directory. The engine checks the committed prefix before continuing. A completed duplicate returns the original staged result. The per-delivery OS lock keeps one active writer for that delivery.

## Select the customer edition

Receiving stages an edition. Use status to read the current `head.generation` and `head.delivery_id`, then make a named selection:

```bash
python3 receiving/receiver.py activate --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --expected-generation 0 --expected-delivery none --actor "Customer operator" --reason "Selected the reviewed source edition for the customer workspace" --operation-id finage-customer-selection-001
```

The engine saves the exact target, displayed head, actor, reason and stable operation ID in one transaction. Repeating the same operation returns its original result. An operation ID reused for different arguments yields `OPERATION_CONFLICT`; a stale displayed head yields `HEAD_CONFLICT`.

Receive the next original producer export, inspect it, and activate its delivery ID with the newly displayed head. To return to a previously selected edition, use `rollback` with the same arguments. Both editions and their complete rows remain in the warehouse.

The original assessment stays attached to the records. An explicit local selection can use an edition whose original `assessmentReady` is false; the receiving decision preserves that value. Source scope, capture coverage, entitlement declarations, reference status, time interpretation and the original exclusions also remain intact.

## Query exact values

```bash
python3 receiving/receiver.py inspect --warehouse /customer/finage-warehouse --delivery DELIVERY_ID
python3 receiving/receiver.py query --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --limit 50
python3 receiving/receiver.py query --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --after 50 --limit 50
```

Use the actual output label reported by inspect for a filter or index:

```bash
python3 receiving/receiver.py query --warehouse /customer/finage-warehouse --filters-json '[{"column":"symbol","op":"eq","value":"EURUSD","kind":"string"}]'
python3 receiving/receiver.py index --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --column symbol
```

The `symbol` label and `EURUSD` value above illustrate the command. Select labels and values from the received mapping and rows. The receiver does not add or rename producer columns.

Supported filter operators are `eq`, `prefix`, `contains` and `is-null`, combined with AND. Optional `kind` selects null, string, number, boolean, object or array. Comparisons use exact text. An original numeric token such as `1.2300` stays distinct from a string containing those characters, and a missing value stays distinct from an empty string.

The source processor controls interpretation. A producer mapping to `/raw/p` preserves the original number or string kind. Mapping to `/fields/p/text` deliberately produces a string. The receiver retains that choice, including zero or missing timestamps and the selected source's time interpretation.

For each row, query returns its original ordinal, exact JSON text, typed cells, original manifest identity and a continuation cursor. Pages contain at most1,000 records. Direct read-only SQLite consumers can use the retained column dictionary: `cN` stores exact text, `kN` its JSON kind and `_raw` the complete original NDJSON line.

## Export a complete or selected customer handoff

```bash
python3 receiving/receiver.py export --warehouse /customer/finage-warehouse --out /customer/finage-handoff
python3 receiving/receiver.py export --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --filters-json '[{"column":"symbol","op":"eq","value":"EURUSD","kind":"string"}]' --out /customer/finage-symbol-handoff
```

Open `receiving-overview.html`. It is a self-contained grayscale reading view for desktop and mobile, with the selected edition, exact filters, coverage, source identities, customer decision history and the first50 selected records. Links open the complete CSV and NDJSON, original manifest and receiving manifests.

An unfiltered export reproduces the original complete customer CSV and NDJSON bytes and checks their original SHA256 and count. A filtered export records its complete selected rows and exact filters, while preserving the original metadata under `provenance/`. The manifest lists every emitted file with its size and digest.

The exported head and decision history come from one brief SQLite read snapshot. Producer reviewer identities and private notes are not included. The customer's own named selection history travels with its customer handoff.

## Backup and reopen

```bash
python3 receiving/receiver.py backup --warehouse /customer/finage-warehouse --out /customer/finage-backup
python3 receiving/receiver.py restore --bundle /customer/finage-backup --out /customer/finage-restored
python3 receiving/receiver.py status --warehouse /customer/finage-restored
```

Backup uses SQLite's native online snapshot. It saves the complete warehouse, exact shared receiver source and a README, plus the backup manifest. The copied database determines the recorded head. Original rows, source documents, mappings, indexes, staged deliveries and named decisions move together.

The three-file bundle is independently usable. Run its bundled shared receiver with the explicit Finage profile:

```bash
python3 /customer/finage-backup/receiver.py --profile finage status --warehouse /customer/finage-backup
python3 /customer/finage-backup/receiver.py --profile finage restore --bundle /customer/finage-backup --out /customer/finage-restored-elsewhere
```

The bundled README includes these commands. Finage uses its own SQLite application identity and `tj.finage-customer-warehouse.v1` schema. A Databento command cannot open a Finage warehouse or restore its backup as a Databento warehouse.

Complete staged deliveries can be queried and exported from the backup without the producer workspace, original input directory, provider credentials or network access. A snapshot of an interrupted receiving operation preserves its committed prefix; continuing that incomplete operation still needs the same original complete delivery directory.

## Integration and complete operating program

`receiving/receiver.py` exports `Warehouse`, `ReceivingError`, `read_delivery`, `restore`, and the original query and exact-value helpers. The class keeps the existing create, receive, status, inspect, query, add_index, activate, export and backup interfaces. Close every opened warehouse. Use `readonly=True` for inspection, queries, export and backup.

The shared engine can also be called directly with `profile="finage"`. Its default profile and original public constants remain Databento-compatible. Profiles are fixed and immutable; no caller-defined producer schema or implicit data conversion is introduced.

For the complete resumable receiving operation over two actual producer exports, see [OPERATE.md](OPERATE.md) and `operate.py`. That program retains one intent and its actual original command results across interruption, customer selection, query/export, rollback, backup/restore and desktop/mobile reading. Its configuration names the exact source and delivery manifest identities. It creates no provider requests or payments.

Source acquisition remains in the original acquisition client and producer workbench. The receiving program consumes their completed exports. Source data and operator workspaces retain their existing private custody; this public source package contains no captured customer or provider payloads.
