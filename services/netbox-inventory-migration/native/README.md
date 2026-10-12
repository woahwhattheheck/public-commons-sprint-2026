# Original native NetBox receiving operation

Operation: **NETBOX-INVENTORY-RECEIVING-20261012-B9D2**

This packet runs the complete published migration product against a real NetBox4.7.2 API, its original Django models and ScriptJob, PostgreSQL transaction/ltree triggers, Redis/RQ queue and worker. The source contract is **251458b89a5eb2f5fe0d20ecd1140ba08f141a9c**. Use the same retained directory and operation after interruption.

## Receiver and source

The accepting runtime owner records the actual installed NetBox version/source, healthy API origin and worker, and the private receiving directory. Use an existing equipped instance or deploy the original [NetBox source](https://github.com/netbox-community/netbox/tree/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c) through its [maintained deployment instructions](https://github.com/netbox-community/netbox-docker). Select a disposable receiving instance; native_fixture.py creates a dedicated tenant, catalogues, locations, devices, component templates, a VRF and one named custom field.

Keep the API and original queue worker on the same actual application/database configuration. Preserve the entire original receiving directory between commands. Its source fixtures, source editions, submitted request bytes, native Jobs, receipt captures and final archive make continuation possible.

The local operator needs Python3.12+ and the three product modules. It uses the actual native HTTP API. The fixture runs in the server's configured Django environment via its own manage.py shell; it never supplies a replacement model layer or database.

## Source preparation on the receiving host

Obtain this complete published directory, including product modules, README, examples and native files. Set the exact absolute directory paths available inside the NetBox process and to the local operator. For a container, mount the original source and receiving output into the relevant server and operator namespaces.

Set:

```bash
export NETBOX_MIGRATION_SOURCE=/absolute/netbox-inventory-migration
export NETBOX_NATIVE_DIRECTORY=/private/netbox-native-b9d2
export NETBOX_NATIVE_URL=http://actual-netbox-host:8000
```

Use the actual NetBox source/venv and settings to run its original shell:

```bash
python manage.py shell --command \
'import os; from pathlib import Path; p=Path(os.environ["NETBOX_MIGRATION_SOURCE"])/"native"/"native_fixture.py"; exec(compile(p.read_text(), str(p), "exec"))'
```

The command checks the actual server version and writes fixture.json, connection.json, mapping.json and five CSV files with native IDs returned by the original models. If fixture.json already exists, it reopens that original tenant and preserves its moved or committed state.

Install the same source's inventory_migration.py through the original NetBox Scripts upload screen or the multipart upload described in the parent README. Use an original receiving account with native script, inventory, catalogue, journal and custom-field permissions. Its token stays in NETBOX_TOKEN; connection.json contains only the variable name. Use the current native v2 Bearer token format or set the original legacy Token scheme explicitly.

## Execute and continue the same original operation

Run from the ordinary operator environment:

```bash
python -B /absolute/netbox-inventory-migration/native/run_native.py \
  --directory /private/netbox-native-b9d2 \
  --config /private/netbox-native-b9d2/connection.json
```

The runner holds its original receiving lock, writes every completed stage durably and consumes retained original product requests on resume. A pending original Job remains in its existing workspace. If the carrier ends, reopen this exact directory with the same command after reconciling the original carrier; the completed stages and original requests stay authoritative.

The exact stages are:

| Stage | Actual product operation |
| --- | --- |
| 01–03 | Read the dedicated native baseline; prepare all original CSVs; run a real ScriptJob review; read back parent/child, device and IP rollback and absence of an applied receipt |
| 04–06 | Change one actual native custom-field default; apply the stale digest; retain the native correction; read back complete rollback |
| 07 | Run the new native review and inspect actual generated module bay M2M, inventory hierarchy, generic component reference and changed custom-field default |
| 08–09 | Submit the reviewed native apply; discard its actual returned HTTP response in the receiving client; recover the same transaction journal; verify original parent/child move, new device and primary IPv4/IPv6; reopen without another attempt |
| 10–11 | Create a corrected original source edition with every resolved native match ID; review/apply through the same original product; verify no replacement objects |
| 12 | Export the complete customer archive; cold-restore the same bytes; use the original API to reopen that exact committed journal |

The receiving client deliberately discards a returned successful native submission response and retains that observation. If its carrier ends after submission but before that observation is saved, the same directory recovers the original applied transaction from its journal and completes the stage with `ORIGINAL_APPLY_RECOVERED_WITHOUT_DISCARD_RECEIPT`. The stage and final result retain the actual outcome, original execution reference, available Job identity and transaction journal. Both paths continue the already applied inventory operation.

The changed native default stage requires the normal custom-field update API and original worker/cache behavior. If the actual native source returns a correction elsewhere, preserve its Job and complete error and fix the integration against that source.

## Complete returned material

Return the original native-result.json and the full steps/ and operator-calls/ material through the accepted operation. The final customer export is edition-002/exports/inventory-handover.zip, with exact size/hash in edition-002/delivery.json. Its original restored customer workspace is customer-restored/.

The full source/attempts/receipts remain in edition-001/ and edition-002/. Return actual job IDs, JournalEntry IDs, source/module hashes and the selected runtime source/version with the outcome. The original product's human-readable report is edition-002/exports/inventory-report.html.

A completed rerun reopens its existing native-result.json and validates the unchanged product source. New source that changes the accepted implementation belongs to a separately reviewed successor of this same project; preserve the original result.

## Source-level receiving states

The code and complete inputs are published before an equipped receiver accepts this operation. The current runtime acceptance and completed native-result.json are recorded in the original Muse/sales coordination thread. A published runnable packet and a completed actual NetBox operation are distinct stages in that original work.
