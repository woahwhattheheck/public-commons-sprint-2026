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


## Receive the complete customer desk on a private Linux host

The same operation also has a complete foreground host receiver at
`native/receive_host.py`. It joins the original migration runner to the
merged customer desk. It uses the original PostgreSQL, Redis, Django/NetBox,
RQ/ScriptJob and browser applications. The selected instance, database,
tenant, source editions, API identity and customer projects are retained between
continuations.

This path is for the disposable native receiving instance. A customer's
production installation continues to use its approved NetBox deployment and
existing account; the receiving helper's dedicated administrative identity belongs
only to this private instance.

### Select the actual runtime

Use Linux x86_64 with Python3.12+ for the selected NetBox environment,
`dpkg-deb`, an existing Redis7.0.15 executable and its required shared libraries,
Node and an existing Playwright/Chromium installation. The host accepts
`--netbox-python` for an already-equipped actual NetBox4.7.2 environment.
Otherwise it creates one private venv and installs the pinned
`netbox==4.7.2` evaluation package. NetBox labels this Python package
installation experimental; the original versioned checkout can instead be
selected with `--netbox-source`. That route uses the exact pinned
requirements and its original `netbox/manage.py`.

The receiver verifies the installed CLI, settings, native Token,
ScriptModule, API script routes and file-storage source against
`251458b89a5eb2f5fe0d20ecd1140ba08f141a9c`.
The entire selected product must also match its own source manifest before
the host starts.

PostgreSQL comes from the already-maintained original package helper in the
same public repository:

`stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/ubuntu-native-demo.py`

Select its exact Git blob
`8d642424b872ee6a00b470a7f7bd0968ba391ef9`. The receiver calls that
helper's existing downloader, selected-member policy and safe extraction
functions. It selects only PostgreSQL17.11 server/client and libpq5 18.6 from
their original official package URLs and full SHA256 values. Completed
downloads are discarded after the selected runtime has been verified; the
retained selected-packages manifest identifies every installed runtime file.

The private receiving directory and the runtime directory are distinct.
When the host runs as root, PostgreSQL runs as uid/gid65534. Every ancestor of
the selected runtime must be traversable by that actual uid. The receiver
checks this before `initdb` and does not relax private ancestor permissions.
Choose an ordinary owned runtime directory under an already-traversable parent;
do not put it beneath the private receiving directory.

### Start the one original foreground

From the complete selected product directory, adapt only the actual absolute
runtime paths below:

```bash
python3 -B native/receive_host.py \
  --directory /private/netbox-native-b9d2 \
  --runtime-directory /traversable-owned-parent/netbox-native-b9d2-runtime \
  --postgres-helper /original-repository/stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/ubuntu-native-demo.py \
  --redis-server /actual-redis-runtime/usr/bin/redis-server \
  --redis-library-directory /actual-redis-libraries/usr/lib/x86_64-linux-gnu \
  --python /actual-python312-or-newer/bin/python \
  --node /actual-node/bin/node \
  --chromium /actual-browser-runtime/chrome-headless-shell
```

Set the existing `CODEX_PRIMARY_RUNTIME_NODE_MODULES` environment variable to
the actual dependency directory containing Playwright, or use the equivalent
installed runtime environment. The browser uses the explicit executable
above and a temporary profile inside this foreground's private
`/dev` mount. All durable projects and final files stay in the selected
receiving directory.

Run this foreground under the existing Commons native worker or the
accepted Muse receiver. Record that receiver's actual operation/carrier in the
original coordination thread. Retain one carrier for
`NETBOX-INVENTORY-RECEIVING-20261012-B9D2`.

The receiver performs the following whole operation:

1. Verify the product and actual runtime; retain the exact selected PostgreSQL
   packages, private application configuration and native database.
2. Start PostgreSQL and Redis, run the original NetBox migrations, and retain
   the dedicated native v2 Token identity before its original database save.
3. Create or reopen the original fixture and five CSVs through NetBox's own
   Django shell. Start the actual RQ worker and API.
4. Read the original ScriptModule storage and installed class. Upload the exact
   migration script through the native API only when that original source is
   absent; retain the request and verify the actual installed file.
5. Continue the existing twelve-stage migration operation, including both
   retained source editions and their actual native jobs/journals.
6. Start the current customer desk on its retained project directory. The
   browser imports the same five CSVs and selects the actual fixture tenant
   through NetBox's catalogue.
7. Receive the existing applied handover, create a corrected draft preserving
   native IDs, edit the mapping, and review the resulting edition against the
   real NetBox instance.
8. Apply that exact reviewed edition once. The browser discards an actual
   successful action response, reopens the saved action and waits for its
   original native journal recovery to complete.
9. Download the complete handover, readable report, native result, resolved
   IDs, request and mapping. A fresh customer browser project receives that
   actual archive and recovers the same native journal. Desktop and mobile
   screenshots retain the operator workflow.

### Continue the retained host and customer work

Repeat the exact same command and selected directories after the previous
carrier has ended and its owned processes have retired. The host takes its
original lock and reads `host.json` before starting services. Each command
has an actual retained process identity and a private member journal.
The host saves the original wrapper identity before admitting its command.
That wrapper remains a Linux session leader and child subreaper until its
command and owned descendants have exited, including browser and worker
descendants after a direct parent exits.

Cleanup uses actual retained process identities and kernel PID handles.
If any original session/member remains, restart keeps that ownership visible
and requires its existing cleanup to finish before another host can start.
A process ID alone is never authority to terminate an unrelated process.

Application progress remains in the original database and these directories:

| Retained path | Content |
| --- | --- |
| `host.json` | Original runtime/source binding, startup stages and final result references |
| `host-logs/` | Private command logs and actual process-member journals |
| `migration/` | Original fixture, API identity, five CSVs, two migration editions and twelve-stage receiving |
| `customer-desk/` | Original project drafts, source uploads, prepared/received editions and saved actions |
| `desk-output/desk-progress.json` | Same browser journey's completed stages and remaining continuation |
| `desk-output/desk-result.json` | Complete desktop/mobile receiving result |
| `desk-output/inventory-handover.zip` | New corrected customer edition and its native receipt |
| `desk-output/inventory-review.html` | Readable actual change report |
| `desk-output/native-inventory-result.json` | Original native receipt, resolved object IDs and journal |
| `desk-output/browser-response-discarded.json` | Actual original browser response deliberately discarded, when that stage returned before carrier loss |

If the carrier ends before the deliberate response-discard record is written,
the runner instead records the actual recovered-after-carrier-interruption
outcome. It preserves the original apply action, review digest, native receipt
and object IDs. It never applies a new transaction merely to recreate that
transport marker.

Keep the private Token, configuration secrets, database and saved project
directory under the receiver's existing access. Deliver the intended customer
archive and readable source-level handover through the original case. The full
native host directory contains private instance credentials and is not a
customer attachment.
