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
`dpkg-deb`, a C compiler, Python development headers and the actual PostgreSQL
client development headers/`pg_config` required by NetBox's pinned
`psycopg[c,pool]` dependency, an existing Redis7.0.15 executable and its required shared libraries,
Node and an existing Playwright/Chromium installation. The host accepts
`--netbox-python` for an already-equipped actual NetBox4.7.2 environment.
Otherwise it creates one private venv and installs the pinned
`netbox==4.7.2` evaluation package. NetBox labels this Python package
installation experimental; the original versioned checkout can instead be
selected with `--netbox-source`. That route uses the exact pinned
requirements and its original `netbox/manage.py`.

The original [NetBox installation instructions](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/docs/installation/3-netbox.md)
and [Psycopg local-build requirements](https://www.psycopg.org/psycopg3/docs/basic/install.html#local-installation)
identify these system build prerequisites. On a prepared Linux image they are
normally provided by its compiler, Python development and libpq development
packages. Select an existing private `pg_config` with `--pg-config` when it is not
in PATH. The receiver verifies its reported `libpq-fe.h` before preparing a new
venv. An already verified saved application reopens from its original files
without another package installation.

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


## Continue the same instance with network commissioning

The network phase extends this completed receiving operation through the
original customer desk. Select the complete reviewed network successor source
and its own source manifest, then run the same `native/receive_host.py` command
and original directory/runtime arguments with **`--phase network`**:

```bash
python3 -B /absolute/network-successor/native/receive_host.py \
  --phase network \
  --directory /private/netbox-native-b9d2 \
  --runtime-directory /traversable-owned-parent/netbox-native-b9d2-runtime \
  --postgres-helper /original-repository/stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/ubuntu-native-demo.py \
  --redis-server /actual-redis-runtime/usr/bin/redis-server \
  --redis-library-directory /actual-redis-libraries/usr/lib/x86_64-linux-gnu \
  --python /actual-python312-or-newer/bin/python \
  --node /actual-node/bin/node \
  --chromium /actual-browser-runtime/chrome-headless-shell
```

Keep any original `--netbox-source` and dependency-selection arguments. The
receiver selects the completed instance's original NetBox Python environment,
including its actual virtual-environment executable path. The original host
must have completed both its twelve-stage migration and customer desk, with
its owned processes retired. This phase shares the same host lock and actual
PostgreSQL database, Redis state, private configuration, API user/token, tenant
and customer-project store.

The following source edition has its own `network-host.json`, logs and
customer output. The original `host.json`, migration results, applied receipt,
source-install receipt, API identity and original customer result remain
byte-for-byte bound in that state. A completed network phase reopens its same
source manifest and saved result. An interrupted phase continues only its
remaining work under those same bindings.

### Adopt the reviewed native source in the original module

The receiver first reads the installed `inventory_migration.py` and its
original ScriptModule and Script IDs. It retains both the original and target
source files, the exact multipart request and its hashes before updating
the same native module through
`PUT /api/extras/scripts/upload/<original-module-id>/`.
The original filename and `InventoryMigration` class remain selected.
This is the update route implemented by the pinned
[NetBox4.7.2 ScriptModule serializer](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/netbox/extras/api/serializers_/scripts.py)
and its
[script upload view](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/netbox/extras/api/views.py).

After each invocation, the same Django application reads the actual stored
file and native class. A lost successful HTTP reply is resolved by that
readback. An interrupted file write can be completed only when its current
bytes are an exact prefix of this retained target and this operation already
has a saved invocation. Other current source remains visible for review.
The source-adoption receipt binds the original module/script IDs, original
and target source digests, request intent and selected product manifest.

The receiving host then starts a fresh NetBox HTTP process and original RQ
worker from the adopted class before preparing network data. Its normal
process wrapper keeps ownership through descendant retirement.

### Receive complete source data

The native fixture reads the existing
`migration/edition-002/applied.json` and the exact tenant JournalEntry.
It uses the committed native IDs from that receipt to join the original
sites, racks, devices, management interface and primary IP addresses.

The fixture also creates dedicated receiving hardware through the original
Django models: two initially unused peer interfaces, an existing physical
channelized interface and its convention-named channel child. The first
source capture retains those actual IDs; subsequent calls reopen the saved
source instead of recreating its baseline.

The customer intake contains ten original CSV families and **26 source
objects**, of which **16 are new objects** in the first reviewed network
edition:

| Original source file | Rows | Customer purpose |
| --- | ---: | --- |
| `sites.csv` | 2 | Retained Site identities and explicit destination scope |
| `network-route_targets.csv` | 2 | Production and guest route targets |
| `network-vrfs.csv` | 2 | Independent routing tables, route distinguishers and import/export memberships |
| `network-vlans.csv` | 3 | Production, guest and transit VLANs at the selected Site |
| `network-prefixes.csv` | 4 | Parent/child IPv4, IPv6 and an overlapping IPv4 prefix in the other VRF |
| `racks.csv` | 2 | Existing native rack identities |
| `devices.csv` | 2 | Existing chassis and switch identities |
| `network-interfaces.csv` | 4 | Management, tagged uplink, guest access and the existing channelized parent |
| `network-ip_addresses.csv` | 4 | Original management IPv4/IPv6 and new guest/uplink addresses |
| `network-cables.csv` | 1 | A new cable joining a source-key interface to an existing native peer ID |

The same source directory includes `network-mapping.json`. The fixture
retains every CSV and mapping byte, plus the exact compiler-produced
`ipam-expected-source.json`, before publishing `ipam-fixture.json`.
That final fixture binds the original inventory receipt, actual NetBox
origin/tenant, reviewed migration source, native peer and channel IDs, and
every source file's byte count and SHA256.

### Review and correct the network through the original desk

The browser opens **Network commissioning · b9d2**, uploads the ten exact
CSVs and configures all ten mappings through the normal source editor.
Existing native IDs and Site/VRF/VLAN links use the same catalogue and
source-key controls available to an operator. The prepared packet must
contain exactly the fixture's reviewed source objects.

The first native review shows complete route-target and tagged-VLAN
memberships, original Cable termination/path effects, and normalized
prefixes. For example, `192.0.2.99/24` becomes `192.0.2.0/24` through
the original prefix normalization. Production management belongs to the
selected `192.0.2.0/28`; the production uplink belongs to the parent
`192.0.2.0/24`. A guest address in that same numeric interval belongs to
the separate guest VRF. Site scope remains explicit on each prefix.
This makes the address-plan report useful when separate routing tables
reuse the same address space.

After the original reviewed Apply, the browser deliberately discards its
actual successful action response, then opens the saved action and native
journal. It retains one Apply action, one reviewed digest and the actual
committed IDs. A carrier interruption before the discard observation is
saved continues by reading that same action and native result.

The customer then selects **Start a corrected draft**. Its mappings retain
all committed IDs, and the source editor applies a substantive correction:

- Production imports only its production route target; the guest export
  membership becomes an explicit empty list.
- The uplink changes from tagged mode to access mode. Removing its tagged
  membership mapping allows the original `Interface.save` behavior to
  clear the existing membership; the review retains both old and final values.
- The Cable's B side moves from the first existing peer to the second,
  selected through the normal native-object picker.
- The existing channelized parent is renamed. The original NetBox
  `InterfaceChannelRenameMixin._rename_channel_subinterfaces` completes
  its convention-named child's rename before the retained final review.
  The result includes the child's full original/final name and actual
  parent binding.

The next native review and Apply operate on the same 26 committed IDs, with
zero new source objects. Fresh native catalogue reads check the released old
peer, connected new peer, actual uplink memberships, route-target changes
and the post-commit parent/child names. The result must agree with the
retained original native side effects.

Membership mapping uses the same product semantics throughout:
`{key}` and `{id}` references preserve their distinct meanings;
semicolon-separated CSV values are explicit lists; a configured empty list
clears membership; an omitted membership leaves it to the original
mapped/native behavior. The corrected draft demonstrates both an explicit
route-target clear and the native tagged-membership clear caused by its
changed interface mode.

### Complete stages and saved receiving requests

The network browser keeps the following stages in
`network-desk-output/network-progress.json`:

| Stage | Saved original workflow |
| --- | --- |
| N01–N02 | Open the customer project; retain ten exact CSVs; author all mappings and catalogue selections |
| N03–N04 | Prepare the saved source and run the complete native network review |
| N05 | Apply once; lose the returned browser reply; reopen the original action and journal |
| N06–N07 | Create the corrected draft with committed IDs; save the changes; prepare its exact source |
| N08–N09 | Review and apply the corrected native edition without replacement objects |
| N10 | Read actual old/new endpoints, memberships, route targets and channel names after commit |
| N11 | Build and download the complete native report and portable handover |
| N12 | Receive the same archive in a fresh customer project and reopen its original native journal |

Preparation, corrected-draft creation and Apply retain the original browser
request body and request ID **before dispatch**. If preparation published
an edition header before its native preparation finished, the continuation
repeats that same saved command to complete the original edition. A saved
corrected draft is identified by all its original committed-ID mappings.
An uncertain Apply reuses its saved request and original action; the browser
does not create a new transaction to recreate a lost reply.

Re-run the same reviewed `--phase network` command after the original
carrier and its owned services have retired. Keep the selected source,
receiving directory and runtime unchanged. The phase checks retained
request/source/receipt bindings before continuing.

### Full customer handover

The native result and customer reports keep the complete original
before/after values, source-key/native-ID links, operation and receipt
identity, selected prefixes, and native endpoint/path/channel effects.

| Network receiving path | Delivered or retained content |
| --- | --- |
| `network-host.json` | Phase binding, actual host stages and complete result references |
| `migration/network-source-upgrade/` | Original/target script, multipart intent, invocation history, native readback and adoption receipt |
| `migration/ipam-fixture.json` | Original tenant/source/receipt identity and all reviewed file hashes |
| `migration/ipam-input/` | Ten original network CSVs and source mapping |
| `migration/ipam-expected-source.json` | The exact original compiler output selected for receiving |
| `network-desk-output/network-progress.json` | Retained browser stages and continuation identity |
| `network-desk-output/network-result.json` | Complete network receiving result, actual native IDs and observations |
| `network-desk-output/inventory-handover.zip` | Corrected source edition and full original native transaction material |
| `network-desk-output/network-commissioning.html` | Searchable, printable network commissioning report |
| `network-desk-output/network-commissioning.csv` | Complete source/native IDs and original/final JSON values |
| `network-desk-output/network-commissioning.json` | Structured full network projection |
| `network-desk-output/native-inventory-result.json` | Exact native result and tenant JournalEntry |
| `network-desk-output/network-001-native-result.json` and `network-002-native-result.json` | Both actual reviewed/applied network editions |
| `network-desk-output/*.png` | Desktop and 390px source, review, delivery and fresh receiving views |

The fresh **Received network handover · b9d2** project restores that exact
archive and observes the same journal. Its full network projection must
match the delivered JSON, and its actions contain no new Apply. The original
v1 customer result and original inventory archive are checked unchanged
when the network phase completes.

### Fixture and browser handoff for the existing host owner

The receiving host provides these values to its own configured Django shell:

```text
NETBOX_MIGRATION_SOURCE=<complete reviewed network successor>
NETBOX_NATIVE_DIRECTORY=<original receiving root>/migration
NETBOX_NATIVE_URL=<same actual NetBox API origin>
NETBOX_NATIVE_IPAM=1
NETBOX_NATIVE_IPAM_RECEIPT=<original migration>/edition-002/applied.json
```

It executes the same `native/native_fixture.py` entry point. The normal
invocation without `NETBOX_NATIVE_IPAM=1` remains the original inventory
fixture. The browser takes its usual private `NETBOX_DESK_ENTRY` JSON,
with the existing desk URL/token and these additional selected paths:

```json
{
  "fixture": "<original migration>/fixture.json",
  "receipt": "<original migration>/edition-002/applied.json",
  "archive": "<original migration>/edition-002/exports/inventory-handover.zip",
  "output": "<same receiving root>/network-desk-output",
  "network": {
    "fixture": "<original migration>/ipam-fixture.json",
    "original_desk_result": "<same receiving root>/desk-output/desk-result.json"
  }
}
```

The host adds its actual `url`, `token` and `chromium` fields. Network
mode derives its ten input paths from the verified fixture. The entry file,
source-upgrade invocation material and native host configuration remain
within the original private receiving operation; the intended customer
archive and readable reports are the handover products.
