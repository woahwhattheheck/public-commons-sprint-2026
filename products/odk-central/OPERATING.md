# ODK Central field reporting

Operate an existing Central field programme from its source agreement through
complete capture, source review, two reporting periods, approved datasets,
readable reports and a portable customer workspace. The application, command
line, SDK and 57 merchant tools share the same private workspace and original
operations.

This product includes the released Central host controller, complete service
backup and restore, and the source-to-report receiving programme. A field team
can commission the existing service, deliver its full reporting work, and hand
the service and the editable source workspace to another operator.

## Choose an entry point

| Work | Installed entry | Retained result |
| --- | --- | --- |
| Operate field data | Applications → ODK Central field reporting; starforge odk-central-workspace | Connections, plans, complete captures, reviews, reports and datasets |
| Commission two periods | Customer commissioning in the same application | Agreed source/measure definitions, source inspection, period plans, accepted outputs and handover |
| Receive approved periods in PostgreSQL | Reporting warehouse in the same application; starforge odk-central-workspace warehouse | Issued dataset approval, SQL review, immutable warehouse editions and full period comparison ZIP |
| Operate the Central service | starforge odk-central-host | Released service, original database/volumes/images, backup, restored service and host handover |
| Receive a selected field source | starforge odk-central-receive source | Original rows, repeat relationships, versions/media, source review, exports, archive and comparison after reopen |
| Receive the released forms on that service | starforge odk-central-receive released | Actual native project/form/submission IDs and the same complete field receiving result |
| Attach an agent | starforge merchant-providers init odk-workspaces | Original merchant configuration, declared source/runtime profiles and complete retained-file access |
| Continue on another host | Restore the complete workspace, then receive its publisher | The same workspace UUID, source history, original-to-local release mapping and continued authoring |

The complete source interfaces are documented in
[the field guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/README.md),
[Applications and typed tools](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/APPLICATIONS_MCP.md),
[commissioning](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/COMMISSIONING.md),
[publisher receiving](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/PUBLISHER_TRANSFER.md),
[approved-period warehousing](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/warehouse/README.md)
and [service operation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/central-host/HOST.md).
The installed commands below invoke those same implementations.

## Install the complete product

Use Linux with Node.js 24 or newer, Python 3.11 or newer, Git, npm and util-linux
flock. Keep the checkout, runtime installation, field workspace, merchant
configuration and complete deliveries in separate directories. The workspace
uses the original SQLite store, native file locks, atomic publication and fsync.

The Central service additionally uses the selected host's existing Docker Engine,
Docker Compose 2.24.4 or newer and OpenSSL. Its full backup needs room for the
actual database, persistent volumes and any selected native image export.

Build from the complete selected source commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace --ref ORIGINAL_COMMIT \
  --selection odk-central --out /absolute/releases/odk-central

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/starforge/runtimes/odk-central \
  --archive /absolute/releases/odk-central/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/starforge/runtimes/odk-central

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/starforge/runtimes/odk-central --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /srv/starforge/runtimes/odk-central -- registrations --source odk
~~~

Replace ORIGINAL_COMMIT with the selected full 40-character commit and use the
builder's returned archive path and SHA-256. Its package retains the recipe,
source inventory, original contribution and runtime dependency profile.

Select that installation for the remaining commands in this terminal:

~~~sh
starforge() {
  node /absolute/merchant-workspace/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /srv/starforge/runtimes/odk-central -- "$@"
}
~~~

The function uses the original installer and selected package, including its
Node dependencies. The ODK host entry finds the packaged Python controller.
The released receiving entry uses this selected Node executable when its
original Python launcher starts the receiver.

The selection includes the whole ODK and OData source directories, the native
dataset publishers, SF82 release lifecycle, SF88 buyer operations, SF100 complete
dataset receiving and shared merchant tools. Commissioning assets, original
Central source definitions and licenses, Python archive/host programs, the full
receiving programme and this guide travel in the same package.

Continue an interrupted build with its original output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace \
  --out /absolute/releases/odk-central --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/odk-central --status
~~~

A new source edition or different selection has its own release directory. A
completed build reopens its saved archive. For installed dependencies received
from another host, follow the original adoption and transfer commands in
[Runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
and [source selections](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md).

## Open the managed field workspace

Attach the installation to the existing Runtime workspace. Initialize that
operator workspace once when it is new:

~~~sh
starforge runtime-workspace init \
  --workspace /srv/starforge/operator \
  --runtime-home /srv/starforge/runtimes

starforge runtime-workspace attach \
  --workspace /srv/starforge/operator \
  --runtime /srv/starforge/runtimes/odk-central \
  --label "Central field reporting"

starforge runtime-workspace serve \
  --workspace /srv/starforge/operator --port 8465
~~~

Open the returned private operator URL and choose **Applications → ODK Central
field reporting**. Select the installed runtime and the private field workspace.
The optional commissioning connection and environment files bind the existing
Central host.

| Application input | Purpose |
| --- | --- |
| Workspace directory | Original field database, source bodies, plans, reviews and exports |
| Operator | Accountable name retained by the running field application |
| Commissioning connection | Existing Central URL, native connection ID and Authorization environment alias |
| Commissioning environment | Private JSON containing the selected alias's complete Authorization value |
| Reporting warehouse profiles | Private profile file naming the installed PostgreSQL operator, its private workspace, database environment alias and SQL schema |
| Private environment JSON | Existing host environment values used by the managed process, including the selected PostgreSQL DSN alias |
| Restore archive and SHA-256 | Complete received source workspace to restore before opening |
| Runtime and process selection | Original installed runtime and Applications process owner |

Applications verifies the startup record, selected directory identity, workspace
UUID, private connection file and actual authenticated listener. Customer
commissioning and Reporting warehouse open on that same listener and original Store.

For direct host operation, prepare the selected private parent directories and
start the original application:

~~~sh
umask 077

starforge odk-central-workspace serve \
  --workspace /srv/starforge/projects/field-reporting \
  --operator "Field operations" \
  --commissioning-connection /private/central-host/connection.json \
  --commissioning-environment /private/central-host/connection-secret.json
~~~

Use the returned private field and commissioning URLs. The running instance's
connection is saved at the workspace's odk.connection.json. CLI and SDK clients
attach to that listener; stopping the application closes its original workspace
owner. A replacement instance publishes a new descriptor for explicit client
reconnection.

For a Central service using a local CA, set NODE_EXTRA_CA_CERTS to the existing
host's returned CA path before Node starts. The selected Authorization value
stays in the private host environment. The connection and source agreement
record its alias.

## Prepare, operate and hand over the Central service

The complete host controller uses Central v2026.3.1, frontend commit
7d6de621955c5bb6a68e098ca10c9cbb92285cdf and backend commit
de0d2a07fd7c9ff698cbc312e550dd40ff058340. Its pinned
[upstream manifest](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/central-host/UPSTREAM.json)
identifies the actual Compose, account and backup interfaces.

Copy the packaged
[host selection](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/central-host/host.example.json)
into private host storage and enter the actual operation, directories, Compose
project, network route and administrator references. The checkout and private
runtime are separate. The original administrator-password and backup-passphrase
aliases use the host's existing secret environment.

~~~sh
starforge odk-central-host --config /private/central-host.json prepare
starforge odk-central-host --config /private/central-host.json build
starforge odk-central-host --config /private/central-host.json bootstrap
starforge odk-central-host --config /private/central-host.json handover
~~~

The original programme checks the selected checkouts, expanded Compose
configuration, native images, actual frontend/backend version, PostgreSQL-backed
public configuration endpoint and authenticated Central user. It retains the
actual command output and operation journal privately.

Choose the network mode already appropriate for the host:

| Mode | Service route |
| --- | --- |
| local | HTTPS localhost and the retained local CA, bound to the selected loopback port |
| customssl | Actual HTTPS hostname with the existing fullchain and private key |
| letsencrypt | Original Central certificate lifecycle on the selected DNS hostname |
| upstream | Existing HTTPS reverse proxy with Central's HTTP listener on loopback |

Bootstrap writes connection.json, its private connection-secret.json and the
actual handover. Record the source/status handover in Customer commissioning.
The full field programme then uses that existing service and native user.

Operate the same service throughout its life:

~~~sh
starforge odk-central-host --config /private/central-host.json status
starforge odk-central-host --config /private/central-host.json stop
starforge odk-central-host --config /private/central-host.json start
~~~

Create the complete native recovery package from that selected service:

~~~sh
starforge odk-central-host --config /private/central-host.json snapshot \
  --out /private/central-backups/field-service-01 --include-images
~~~

This retains the original encrypted database backup, every attached persistent
volume, selected image identities, runtime configuration and TLS material. It
restarts the services that were running and records the reopened original API.

For another receiving instance, copy the saved host selection into a new private
configuration, select its unused Compose project/runtime directory and intended
origin/ports, then restore:

~~~sh
starforge odk-central-host --config /private/central-restore.json restore \
  --snapshot /private/central-backups/field-service-01
~~~

The original controller validates all saved files and target bindings, restores
the same volume contents, starts the selected images and verifies the resulting
service and project population. Continue a partial restore with that same
snapshot and target. The complete service recovery package contains private
credentials and data; retain it with the selected private service backup.

The host guide explains preserved settings, deliberate reconfiguration, TLS
receiving, image-inclusive transfer and original service recovery. Its default
profile uses the bundled PostgreSQL and local attachment storage.

## Connect and capture an existing field programme

A Central Web User supplies the actual data-reading access. Select its existing
connection and inspect the accessible projects and forms:

~~~sh
starforge odk-central-workspace connect \
  --workspace /srv/starforge/projects/field-reporting \
  --input /private/field-inputs/central-connection.json

starforge odk-central-workspace projects \
  --workspace /srv/starforge/projects/field-reporting \
  --connection-id ORIGINAL_CONNECTION_ID

starforge odk-central-workspace forms \
  --workspace /srv/starforge/projects/field-reporting \
  --connection-id ORIGINAL_CONNECTION_ID --project-id ACTUAL_PROJECT_ID
~~~

The connection input has the original shape:

~~~json
{
  "id": "field-central",
  "name": "Field operations",
  "url": "https://central.example.org",
  "authEnv": "CENTRAL_AUTHORIZATION"
}
~~~

Replace the example URL and alias with the selected host binding. A source plan
records the returned native form IDs and exact reporting window. The following
illustrates the shape; use the agreed source and dates:

~~~json
{
  "id": "reporting-period-a",
  "name": "Reporting period A",
  "connectionId": "field-central",
  "forms": [
    {"projectId": "ACTUAL_PROJECT_ID", "formId": "ACTUAL_FORM_ID"}
  ],
  "scope": {
    "submittedFrom": "2026-09-01T00:00:00Z",
    "submittedBefore": "2026-10-01T00:00:00Z",
    "pageSize": 1000
  }
}
~~~

Save that complete input before dispatch and retain stable operation IDs:

~~~sh
starforge odk-central-workspace plan \
  --workspace /srv/starforge/projects/field-reporting \
  --input /private/field-inputs/period-a-plan.json

starforge odk-central-workspace capture \
  --workspace /srv/starforge/projects/field-reporting \
  --plan-id reporting-period-a --id edition-a

starforge odk-central-workspace status \
  --workspace /srv/starforge/projects/field-reporting --id edition-a

starforge odk-central-workspace quality \
  --workspace /srv/starforge/projects/field-reporting --id edition-a
~~~

Capture follows every advertised OData continuation page for each selected root
and repeat table. Page size controls individual requests. The capture also
retains published and observed form generations, original XML, advertised
XLS/XLSX, form attachments, submission version lists/XML and available media.

Use the edition's actual table IDs and returned cursors to inspect all rows and
resources. Continue a stopped acquisition with its original capture ID:

~~~sh
starforge odk-central-workspace resume \
  --workspace /srv/starforge/projects/field-reporting --id edition-a
~~~

Direct capture waits and closes its own original lease. An attached managed
listener can continue a capture after the CLI returns with --no-wait. The same
workspace and original ID retain the provider cursor and completed source.

## Review, compare and produce complete outputs

Inspect the native field dictionary, root/repeat keys, source counts, available
versions, media coverage and any changes observed during capture. Record the
current edition revision and the analyst's interpretation before accepting it.

The review input contains id, expectedRevision, decision, note and the optional
reviewer, findings and indicators. Use the returned current revision. Findings
retain their authored title/text, and indicators select an actual table, scalar
field where applicable, operation and optional equals value.

~~~sh
starforge odk-central-workspace review \
  --workspace /srv/starforge/projects/field-reporting \
  --input /private/field-inputs/period-a-review.json

starforge odk-central-workspace report \
  --workspace /srv/starforge/projects/field-reporting \
  --input /private/field-inputs/period-a-report.json

starforge odk-central-workspace export \
  --workspace /srv/starforge/projects/field-reporting \
  --input /private/field-inputs/period-a-dataset.json
~~~

A report input selects the capture id, a retained reportId, title, narrative and
its exact indicators. Add baselineId to compare another complete edition from
the same Central source. Operations are rows, nonempty, sum, mean, minimum,
maximum, distinct and frequency. Native Decimal and Int64 values retain exact
decimal arithmetic. Mean retains its exact sum and count, with a displayed value
rounded to twelve decimal places.

| Output | Complete saved contents |
| --- | --- |
| Report | HTML, editable Markdown, JSON, complete changes in JSONL and complete categorical frequency CSV |
| Dataset | Approved CSV fields with value/null/missing state columns, full original rows JSONL, native CSDL, field dictionary, source pages and capture manifest |
| Source files | Original form/submission XML, observed version definitions, available media and complete request/response receipts |
| Portable workspace | SQLite source/history, saved definitions, reviews, reports, datasets, publisher source and all retained file bodies |

The readable report shows the leading 25 frequency values; its CSV carries the
full distribution. Dataset projection supports up to 32 selected fields,
including the approved native row and repeat-parent keys.

The CSV projection and full source package serve different receiving needs.
Approved fields define that CSV. Full JSONL, source pages, XML/media and the
complete archive retain the selected capture's entire original source. Select
the recipient's agreed files while preserving their source rights and field
interpretation.

## Commission two reporting periods

Use **Customer commissioning** on the same authenticated application. The
complete agreement records the accountable project owner and technical
receiver, actual Central origin/project/forms, reporting timezone, two exact
UTC period boundaries, late-edit interpretation, review-state inclusion,
measures, cross-form identity rules, approved field projections and media
decisions.

Begin with the packaged
[agreement draft](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/commissioning/agreement.example.json)
and complete the actual customer's decisions in the editor. Incomplete drafts
remain editable and readiness identifies the specific unfinished decisions.

The complete sequence is:

1. Retain the actual host handover and inspect the selected native user,
   projects and forms.
2. Save the agreement with its original draft ID, request ID and current
   revision.
3. Prepare the exact draft revision and source inspection. This freezes the
   two native period plans and output/measure mappings.
4. Install those plans, then capture each period under its own retained
   request ID.
5. Inspect each completed capture and record its current source review.
6. Deliver the accepted pair with the original capture and review IDs. The
   saved handover joins reports, approved datasets, the complete agreement
   and full archive.

The SDK shares the original listener:

~~~js
import {connectCentralWorkspace} from '@tokenjunkielabs/starforge-merchant/seller/odk';

const client = await connectCentralWorkspace({
  directory: '/srv/starforge/projects/field-reporting',
  connectionFile: '/srv/starforge/projects/field-reporting/odk.connection.json',
});
try {
  const state = await client.commissioningState();
  console.log(JSON.stringify(state, null, 2));
} finally {
  client.close();
}
~~~

Use the current returned definitions, revisions, capture IDs and accepted review
IDs in the complete action inputs. Retain those inputs before dispatch. The
commissioning guide maps every SDK method to its exact input schema and typed
tool. The installed command also exposes the same operations:

~~~sh
starforge odk-central-workspace commissioning --help

starforge odk-central-workspace commissioning state \
  --operator-file /srv/starforge/projects/field-reporting/odk.connection.json
~~~

For corrected agreement fields that still select the same cohort, preparation
can use the two matching existingPlanIds. A completed capture or handover keeps
its original selection. Later source or review changes receive their own
appropriate capture/review and handover IDs; earlier complete outputs remain
available.

The saved processing interpretation is all review states,
current-state-at-capture for late edits and complete-selected-capture for
portability. The capture records the source actually observed during collection.
A period label does not reconstruct an earlier database state. Native repeat
IDs describe the original structure and can change after repeat reordering.

A kickoff records its selected working calendar, exclusions and proposed or
agreed references. The customer case carries the actual commercial scope and
calendar agreement.


## Receive the approved periods in PostgreSQL

The Reporting warehouse screen continues an issued commissioning delivery.
It uses the actual approved dataset exports, accepted Central reviews, original
root/repeat identifiers and the two agreed reporting scopes. The existing
PostgreSQL operator receives complete immutable editions and produces the full
period comparison.

### Prepare the selected warehouse host

Create the selected private Python environment from Python 3.11 or newer, then
install the included original buyer package with its declared PostgreSQL extra:

~~~sh
python3 -m venv /srv/starforge/venvs/buyer
/srv/starforge/venvs/buyer/bin/python -m pip install \
  '/absolute/merchant-workspace/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[postgres]'
~~~

Use the Python package from this same selected source release. Its `postgres`
extra installs `psycopg[binary]==3.3.6`; the selected receiving host supplies the
actual PostgreSQL server. The complete [PostgreSQL operating guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/POSTGRESQL.md)
describes server preparation, existing application connections and the native
receiving commands.

The interpreter selected below must import `stellar_forge_buyer.postgres_cli`
and the original maintained `processes.run_owned` supervisor. The source
selection includes the complete Python product, its Central intake and period
report modules.

Keep the connection settings in the existing host environment alias. Applications'
**Private environment JSON** can provide that alias to the managed process.
Create a private profile file such as `/srv/starforge/private/warehouse-profiles.json`:

~~~json
{
  "schema": "stellar-forge.central-warehouse-profiles.v1",
  "profiles": [{
    "id": "reporting",
    "name": "Reporting warehouse",
    "workspace": "/srv/starforge/postgres-reporting",
    "connectionEnv": "SF_BUYER_POSTGRES_DSN",
    "schema": "sf_received",
    "python": "/srv/starforge/venvs/buyer/bin/python",
    "timeoutSeconds": 3600
  }]
}
~~~

The profile names the actual installed interpreter and the original PostgreSQL
operator directory. The field workspace and PostgreSQL operator directory are
separate retained products. Keep this file mode0600 in a private directory.

For a newly selected dedicated SQL receiving schema, initialize the original
warehouse once:

~~~sh
/srv/starforge/venvs/buyer/bin/python -m stellar_forge_buyer.postgres_cli \
  --connection-env SF_BUYER_POSTGRES_DSN --schema sf_received init
~~~

An established warehouse uses its existing schema. Add its known identity as
`expectedWarehouse` when available. **Open existing warehouse** reads the actual
database identity and retains it against the chosen profile. Subsequent
inspection, review, import and report actions use that identity. The connection
value remains in the host environment.

Select the profile file in Applications, or start the existing managed entry
with its corresponding option:

~~~sh
starforge odk-central-workspace \
  --workspace /srv/starforge/central-field \
  --operator "Field reporting team" \
  --commissioning-connection /srv/starforge/central-host/connection.json \
  --commissioning-environment /srv/starforge/central-host/connection-secret.json \
  --warehouse-profiles /srv/starforge/private/warehouse-profiles.json \
  --port 0
~~~

The startup record includes `warehouseUrl` and the selected profile-file hash.
Applications verifies the reviewed file, original workspace UUID and actual
authenticated warehouse state before announcing the application as ready.
**Reporting warehouse** opens `/warehouse/` on that same private listener.
An installation without configured profiles can still inspect its retained
approvals, operations and report files.

### Complete the receiving and report

1. Select the host profile and choose **Open existing warehouse**. Review the
   returned warehouse ID and SQL schema.
2. Select the original commissioning delivery, approved table and reporting
   period. Choose **Retain approved export**. This verifies the issuing accepted
   review, exact source/table/period identity, original key fields and every
   complete native export member.
3. Choose **Inspect for SQL**. The original Python operator inspects the full
   approved CSV and dictionary. Open the retained complete inspection while
   reviewing the screen's source preview.
4. Review every SQL name, type and nullable setting. Keep every approved value
   and state column and the original nonnullable native row keys. Save the
   mapping with the accountable reviewer and interpretation note.
5. Choose **Import complete edition** for that saved review. The original native
   transaction and request journal retain the immutable warehouse version.
6. Repeat the same workflow for the other original reporting period and each
   agreed root/repeat output.
7. Select period0 and period1 imports for the same commissioning definition,
   table and warehouse. Enter the report title and choose **Create full period
   report**.
8. Download the complete report ZIP, then create the next complete Central
   workspace archive to carry the new warehouse records and retained files.

Each native Central field has a value column and its `_state` column. The
retained states distinguish value, null and missing. Int64 and Decimal retain
the source's exact text in the approved CSV. SQL type conversion is an explicit
reviewed mapping; the original operator checks every selected value.

The report reads both immutable versions from one consistent PostgreSQL snapshot.
Its ZIP contains both full datasets, every added/removed/changed row, the original
dictionaries, SQL mappings, manifests, query SQL and an offline HTML report.
The full file is retained in the Python operator and in the Central source
resource store with its bytes and SHA-256.

Period comparisons follow the actual native row keys. Different submission
cohorts can contain different row IDs. Their added/removed classifications
retain that source meaning. A business-entity comparison uses its agreed
cross-form identity definition and corresponding original outputs.

### Use the existing listener from the command line

The warehouse command accepts the managed workspace's original private
`odk.connection.json`:

~~~sh
starforge odk-central-workspace warehouse state \
  --operator-file /srv/starforge/central-field/odk.connection.json

starforge odk-central-workspace warehouse prepare \
  --operator-file /srv/starforge/central-field/odk.connection.json \
  --input /srv/starforge/private/approved-output-action.json
~~~

Create and retain the full action JSON before dispatch. Every warehouse
`requestId` is a caller-generated **32-character lowercase hexadecimal ID**.
Reuse that exact saved ID and input during recovery.

| Warehouse command | Complete input |
| --- | --- |
| `prepare` | `{requestId, deliveryId, datasetId, period}`, with period0 or1 |
| `connect` | `{requestId, profileId}` |
| `inspect` | `{requestId, approvalId, profileId}` |
| `review` | `{requestId, inspectionId, mapping, reviewer, note}`; note is optional |
| `import` | `{requestId, reviewId}` |
| `report` | `{requestId, previousImportId, currentImportId, title}` |
| `operation` | `{requestId}` |
| `approval` | `{requestId}` |
| `resume` | `{requestId}` for the saved original warehouse operation |

A preparation interrupted before its approval completed reuses the original
`prepare` input. An interrupted warehouse connect, inspect, review, import or
report uses `operation` to read its exact saved state, then `resume` for the
same native request. Completed operations return their retained result.

The same command accepts the original direct warehouse listener descriptor.
For a closed field workspace, the source CLI also supports `--workspace` and
`--profiles`. The operating application already owns the workspace, so its
clients attach through the existing connection file.

### Typed client and merchant tools

The main `./seller/odk` export and dedicated `./seller/odk/warehouse` export
include the complete warehouse types and original factories. A client attaches
to the original application:

~~~js
import { readFile } from 'node:fs/promises';
import { connectCentralWorkspace } from '@tokenjunkielabs/starforge-merchant/seller/odk';

const client = await connectCentralWorkspace({
  connectionFile: '/srv/starforge/central-field/odk.connection.json'
});
try {
  const state = await client.warehouseState();
  console.log(state);
  const input = JSON.parse(await readFile(
    '/srv/starforge/private/approved-output-action.json', 'utf8'
  ));
  const approval = await client.warehousePrepare(input);
  console.log(approval);
} finally {
  client.close();
}
~~~

Client methods are `warehouseState`, `warehousePrepare`, `warehouseConnect`,
`warehouseInspect`, `warehouseReview`, `warehouseImport`,
`warehousePeriodReport`, `warehouseOperation`, `warehouseApproval` and
`warehouseResume`. The generic `warehouseAction` uses those same original
action routes. The client rereads its saved connection identity before each
request and preserves the caller's original operation ID after an uncertain
response.

The 11 warehouse tools are part of this product's 57 ODK merchant tools:
`merchant_odk_warehouse_state`, `merchant_odk_warehouse_browser`,
`merchant_odk_warehouse_prepare`, `merchant_odk_warehouse_connect`,
`merchant_odk_warehouse_inspect`, `merchant_odk_warehouse_review`,
`merchant_odk_warehouse_import`, `merchant_odk_warehouse_period_report`,
`merchant_odk_warehouse_operation`, `merchant_odk_warehouse_approval` and
`merchant_odk_warehouse_resume`.

Warehouse state returns explicit pagination for profiles, deliveries, approvals
and operations. Use each array's returned `nextOffset` to continue. Complete
approval/operation records and original report-file downloads remain available
through the existing retained-file tools.

### Reopen the full delivery

The next Central archive contains the exact approval documents, issued native
exports, complete warehouse command output, request/result records and retained
period report ZIPs. Restore it through the original Applications archive input
or the original archive CLI.

Approval paths are relative to that received Central workspace. The new host
selects its actual PostgreSQL interpreter, private operator directory and
existing database/schema profile. Reopening an existing warehouse continues
its original identity and request journals. The warehouse's database backup
and native operator workspace accompany any database migration using the
existing PostgreSQL procedures.

Original report resources can be read from the received Central archive before
the PostgreSQL connection is reopened. Subsequent imports and period reports
continue with the selected original warehouse and retained request IDs.

## Publish the approved dataset and receive customer files

An accepted dataset export can include the original public origin, route and
reviewed payment terms. That prepares the existing SF30 seller configuration.
Keep the actual full dataset input and native package from that export.

Prepare and select the retained release through the original SF82 store:

~~~sh
starforge odk-central-workspace release-prepare \
  --workspace /srv/starforge/projects/field-reporting \
  --input /private/field-inputs/period-a-release.json

starforge odk-central-workspace release-status \
  --workspace /srv/starforge/projects/field-reporting

starforge odk-central-workspace release-activate \
  --workspace /srv/starforge/projects/field-reporting \
  --id ORIGINAL_RELEASE_ID --expected-generation CURRENT_GENERATION \
  --reason "Publish the reviewed field edition"
~~~

The preparation input binds exportId, releaseId, optional label and the original
dataset runtime. Runtime fields are port, facilitator and allowLocalFacilitator.
Use the current returned release generation for activation or rollback.

The selected installation includes the original buyer and buyer-dataset
commands. Customer purchases use the existing SF88 intent/approval process and
SF100 complete dataset receiver. Continue the original purchased-page IDs and
retained response hashes through those commands; the resulting customer files
keep the actual dataset schema, full received rows and source selection. Their
command help and the original customer guide are included in the package:

~~~sh
starforge buyer --help
starforge buyer-dataset --help
~~~

Merchant source inspection, publication preparation and customer paid requests
retain their own original native records in this shared workflow.

## Configure the merchant and attach typed tools

Save a private workspace configuration with the original aliases:

~~~json
{
  "schema": "stellar-forge.odk-workspace-connection.v1",
  "workspaces": {
    "field_reporting": {
      "label": "Field reporting",
      "directory": "/srv/starforge/projects/field-reporting",
      "connections": {
        "central": {
          "id": "field-central",
          "name": "Existing Central service",
          "url": "https://central.example.org",
          "authEnv": "CENTRAL_AUTHORIZATION"
        }
      },
      "merchants": {},
      "runtimes": {}
    }
  }
}
~~~

Use actual host values. Add reviewed merchant profiles with the original
origin, path, payment terms and optional limit settings. Runtime profiles use
the original dataset release options.

Save a separate initializer input:

~~~json
{
  "directory": "/srv/starforge/merchants/field-reporting",
  "connection": "/private/field-inputs/merchant-connections.json",
  "name": "Field reporting operator"
}
~~~

The merchant directory is separate from its original field workspace. Initialize
and inspect the same declared provider:

~~~sh
starforge merchant-providers init odk-workspaces \
  --options /private/field-inputs/merchant-setup.json

starforge merchant-providers inspect odk-workspaces
starforge merchant-mcp-client-config --help
starforge merchant-mcp-stdio --help
~~~

The initializer creates or verifies merchant-mcp.json, its original release
store and private customer-exports directory. Exact repeated setup reuses that
configuration. Use the returned configuration path with the installed merchant
MCP transport and its client configuration command.

The 46 original ODK tools cover listener attachment, source/project/form
selection, capture, complete row/resource inspection, reviews, reports,
datasets, releases, customer commissioning, publisher receiving and retained
file streaming. Each tool receives a configured workspace alias. The merchant
holds an attachment to the original Applications listener.

To receive a complete file, first select its original source/export descriptor,
then call merchant_odk_file_retain with a saved requestId, original relative
download path, SHA-256 and byte length. It streams the selected bytes into the
merchant's customer-exports/odk/<alias> directory. An interrupted receipt reopens
the same published file.

Use merchant_odk_file to read that file with its original fileId, expected hash,
offset and retained readId. Continue nextOffset until EOF. Chunks are at most
196,608 bytes; complete downloads support up to 8 GiB. Completed retained files
remain readable after the source application stops.

## Deliver and reopen the complete workspace

Create the complete archive with a retained operation ID:

~~~sh
starforge odk-central-workspace backup \
  --workspace /srv/starforge/projects/field-reporting \
  --id field-handover-a

starforge odk-central-workspace export-file \
  --workspace /srv/starforge/projects/field-reporting \
  --id field-handover-a --path central-workspace.tar.gz
~~~

Retain the returned path, full SHA-256, byte count and workspace identity with the
delivery. Open it in a selected new or empty destination:

~~~sh
starforge odk-central-workspace serve \
  --workspace /srv/starforge/projects/received-field-reporting \
  --operator "Receiving field operator" \
  --restore-archive /private/receiving/central-workspace.tar.gz \
  --restore-sha256 ORIGINAL_ARCHIVE_SHA256
~~~

The importer verifies and publishes the complete source workspace. Its received
archive record binds the source hash, UUID and revision. Repeating the same
restore selection preserves subsequent work in that received workspace.
Commissioning can use the actual received archive to report RECEIVED_PORTABLE.

New archives also retain the original publisher: dataset generations, prepared
packages, release history and partial preparations. Inspect the full transfer
state and receive the selected snapshot on the destination:

~~~sh
starforge odk-central-workspace publisher-transfers \
  --workspace /srv/starforge/projects/received-field-reporting

starforge odk-central-workspace publisher-receive \
  --workspace /srv/starforge/projects/received-field-reporting \
  --id field-publisher-receiving-a \
  --snapshot-id ORIGINAL_SNAPSHOT_ID
~~~

The receiver uses the original dataset-version and SF82 release APIs. It
retains every original-to-local release ID and digest, plus the receiving
host's actual dataset paths. Use the returned local release and current native
generation for intended activation.

COMPLETE_WITH_PENDING retains exact unfinished source, diagnostics and original
prepareRelease inputs beside the complete received components. Continue a
saved preparation with that same native request. A row-capacity failure can
resume the same publisher receiving ID and snapshot with a larger
--max-resident-rows on a host with the corresponding capacity. The native range
is 1 through 16,000,000 rows, with a default of 1,000,000.

A received host supplies its existing corresponding Authorization environment
alias when it should acquire more Central source. Saved source, reports and
complete received files remain available for offline inspection.

## Run the complete native receiving programme

For an existing selected Central source, prepare the exact input described in
[native receiving](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/RECEIVING.md).
It binds operationId, connection, plan, capture, authored review, datasets,
report, archiveId and source expectations. Its host environment supplies the
selected connection's existing authorization and CA trust.

~~~sh
starforge odk-central-receive source \
  --request /private/field-receiving/request.json \
  --directory /srv/starforge/receiving/field-original \
  --output /srv/starforge/receiving/field-results \
  --restore-directory /srv/starforge/receiving/field-reopened
~~~

The original, output and restored directories are separate. The programme
captures the whole selected cohort, records the authored source review, writes
complete datasets/report, archives the workspace and reopens the same source.
It compares original and received rows, submission history, media and every
export file.

For the released source forms on the already selected Central host:

~~~sh
starforge odk-central-receive released \
  --host-config /private/central-host.json \
  --work-directory /srv/central-receiving/field-product
~~~

Use the host's same operation_id. The original default operation is
SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012; --operation selects another retained
host operation when appropriate. The launcher reads that host's existing
connection.json and connection-secret.json, binds only the selected alias, and
sets its CA before Node starts.

This native source programme uses the actual released backend XML definitions,
recorded source version edits and named fixture media. It checks the running
frontend/backend pins, creates or recovers its journaled native project,
publishes the original forms and versions, submits their original root/repeat
records, receives the media/version bytes and invokes the same field receiver.
The exact source and Apache license travel with the package.

The released double-repeat source has 1 root, 3 child rows and 8 nested toy
rows; the original simple source has 3 records and a mean age of 34. These are
the declared released source expectations. The actual resulting provider IDs,
responses, rows and native calculation are retained by the running operation.

| Retained path | Contents |
| --- | --- |
| provider/fixture-operation.json | Original source/request selection, native project, dispatches and accepted responses |
| provider/inputs and provider/responses | Complete native request and observed response bodies |
| provider/receiving-request.json | Real project/form IDs and the original full field receiving input |
| provider/result.json | Source pins, actual provider IDs and joined receiving result |
| workspace | Complete original field workspace |
| receiving/receiving.json and receiving/result.json | Original operation journal, outputs, archive and full reopened comparison |
| restored-workspace | The complete received workspace with the same source identity |

Keep these same paths and input identities when continuing an interruption.
The fixture controller reconciles native form/version/submission uniqueness.
An ambiguous project creation is reconciled through its exact recorded unique
name. A completed provider operation and field receiving result are reused.

## Receiving handover

A complete delivery joins the agreed source and reporting interpretation,
actual host handover, selected periods/captures and current accepted reviews,
full reports and approved datasets, the archive's hash/size/UUID, publisher
receiving map and the receiving operator's results.

Keep the complete editable source and original operational history with the
retained workspace. Deliver the agreed reports, data projections and full
receiving package through the customer's existing channel. The next operator
can inspect the original source, amend the agreement or analysis, receive later
periods, publish the next dataset edition and create another complete handover.

## Source references

- [ODK Central API](https://docs.getodk.org/central-api/) and
  [OData API](https://docs.getodk.org/central-api-odata/).
- [Released Central source](https://github.com/getodk/central/tree/7d6de621955c5bb6a68e098ca10c9cbb92285cdf)
  and [released backend](https://github.com/getodk/central-backend/tree/de0d2a07fd7c9ff698cbc312e550dd40ff058340).
- [Provider source manifest](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/PROVIDER_SOURCES.md).
- [Released source provenance](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/RELEASED_FIXTURES.md)
  and [native receiving contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/RELEASED_RECEIVING.md).
- [Source-owned distribution contribution](../../stellar/scf-starforge-20261009/distribution/contributions/odk.json)
  and [complete selection](../../stellar/scf-starforge-20261009/distribution/selections/odk-central.json).

