# Install and operate the Groundwater Report Desk

The **Groundwater Report Desk** application opens the original report publication
and receiving workspace from a selected READY Starforge runtime. The same
interface retains frozen report selections, native file offers, prepared buyer
requests, exact saved response packages, attributed receiving decisions,
original Operations links, and complete desk exports.

Applications provides the managed process lifecycle. The Report Desk keeps its
own original request and result files. Scientific work stays in the original
Groundwater workspace; a managed Report Desk launch does not run a solver or
dispatch a buyer payment.

## Receive the complete selected product

The committed **groundwater-report** recipe includes the original runtime
installer and Applications controls, the complete Report Desk and browser, its
original Groundwater report reader, the maintained SF30 file-service and asset
closure, the SF88 buyer/Inbox workflow and merchant-provider tools. The original
scientific producer and its optional Tethys portal have separate source and
native operating guides. Existing reports retain their complete original
scientific package and provenance independently of the installed reader.

Use the existing **Build a product** screen in the
[runtime workspace](../../distribution/runtime-workspace/SOURCE_BUILDS.md):

1. Select the actual committed repository and resolve its full source commit.
2. Choose **groundwater-report**, review that complete source selection, and
   build the reviewed product through its original saved build request.
3. Select the resulting original package in **Source & profile**. Review the
   native payment runtime and **schema**, **openapi**, **mcp** and **Linux
   operator tools** selections required by this complete product.
4. Prepare the new runtime, then **Install / resume** and **Inspect runtime**.
   Preserve the original installation directory, archive, profile, dependency
   lock and receiving identity. **READY** must come from the original inspector.

The maintained builder is also available directly:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/committed-source \
  --ref EXACT_COMMIT \
  --selection groundwater-report \
  --out /absolute/private/report-product
~~~

The full source commit and original package SHA-256 come from the builder's
returned result. A repeated original build uses the same output and
**--resume**. A different commit or recipe is a distinct build.

Install that actual original archive using its returned path and SHA-256:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/groundwater-report \
  --archive /absolute/private/report-product/ACTUAL_PACKAGE.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

starforge runtime-install install \
  --dir /absolute/private/runtimes/groundwater-report

starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-workspace \
  --runtime /absolute/private/runtimes/groundwater-report \
  --label "Groundwater Report Desk"
~~~

The installation uses the original exact dependency profile. Optional cache and
offline settings belong to that installer. An older installed package remains
its actual older source until an original reviewed upgrade adopts the successor.
A browser refresh does not install newly merged source.

The host needs the selected runtime's supported Node, npm and Linux flock, and
an actual Python 3.11+ interpreter for the original report/package reader. The
Report Desk reader uses the installed original Python source. Native MODFLOW,
FloPy, a portal, and scientific model inputs are not prerequisites for reading
a previously completed report package. They remain the producer's dependencies
when an operator separately chooses the original scientific workflow.

## Initialize or receive one original desk

Choose a new private directory and initialize the original Report Desk once:

~~~sh
starforge groundwater-report init \
  --desk /absolute/private/report-desk \
  --python /absolute/python/bin/python3
~~~

The returned desk UUID, desk.json and operations/ are its original identity.
Reopening uses this directory. Applications refuses a missing, empty, linked or
replaced marker; it does not silently create another desk.

For an existing complete desk archive, use the original receiving command:

~~~sh
starforge groundwater-report restore \
  --desk /absolute/private/existing-report-desk \
  --request /absolute/private/restore-request.json \
  --python /absolute/python/bin/python3
~~~

The request is:

~~~json
{
  "archive": "/absolute/private/original/Groundwater_Report_Desk.zip",
  "destination": "/absolute/private/new-receiving",
  "expectedSha256": "ACTUAL_FULL_ARCHIVE_SHA256",
  "expectedBytes": 12345
}
~~~

Replace the example byte count and SHA with the actual original archive
descriptor. The command uses the existing desk only to open its original
reader. It receives into a new destination and returns the actual restored
**directory**, normally DESTINATION/desk. Select that returned directory in
Applications. It retains the archive's original desk UUID, requests, report
packages, receiving decisions and results. Do not run init on the restored
directory.

The complete desk archive contains private requests, original file packages and
review history. Give it only to its intended operator. An SF47 case export is a
separate original archive, and the scientific workspace backup remains with its
producer.

## Review, save, start and open

From the original runtime workspace's **Applications → New application**, choose
**Groundwater Report Desk**.

| Setting | Original selection |
| --- | --- |
| Existing Report Desk | The initialized or received directory containing desk.json and operations/. |
| Python interpreter | The actual Python 3.11+ executable; its resolved bytes and venv configuration are reviewed. |
| Original scientific workspace | Optional existing directory containing groundwater.sqlite. Choose it to browse and publish its frozen reports. Omit it for buyer receiving. |
| Private Operations access file | Optional private JSON or text file containing the current original Operations URL. The file remains on this host. |
| Native facilitator URL | Optional explicit HTTPS facilitator for operator-started native publication services. |
| Allow selected local facilitator | Explicitly permit the selected loopback HTTP facilitator. |
| Local port | 0 chooses a real available port. An explicit available port keeps the same browser origin across starts. |
| Private environment JSON | Original host configuration consumed through the runtime's existing private-environment handling. |

**Review application** reads the original desk marker, optional native
groundwater metadata and inode, Python selection, complete direct report source,
and current private access-file identity. It executes no scientific model, report
snapshot, payment or receiving action.

**Save application** retains the original Applications review and performs its
managed adoption. If the response is lost, reuse that save request ID or reopen
the saved application. The original application and managed-home records are the
authority.

**Review start → Start reviewed application** launches the exact managed command
with the original run UUID. Before opening a listener it compares the selected
runtime source with the source copy that actually executes. It validates the
existing desk and the optional scientific database again, and checks Python's
real version.

**Open application** appears only after the original serialized output observer
has accepted the schema-bound startup line and read that actual listener's
authenticated current desk state. The URL is the native server's private token
link. It is never inferred from the requested port, a past run, or an example.

A selected facilitator is configured for later operator action; startup makes no
facilitator call. Without one, the original publication service remains
**CHALLENGE_ONLY**. The operator must still explicitly choose a frozen report,
review offers, start its service and use the original authorized buyer workflow.

## Complete the original report workflow

Use the original [operator guide](OPERATOR.md) in the Report Desk.

- **Frozen reports** reads the selected existing scientific workspace and shows
  each actual report, original run/source/edition, technical review, units,
  time semantics and complete export identities.
- **File publication** freezes explicit formats and merchant terms against that
  original report. Native bundle recovery verifies its actual assets, routes
  and compiled offers against those reviewed choices.
- **Buyer preparation** retains an original SF88 configuration and intent for
  the selected offer. The existing buyer owns payment and execution.
- **Report receiving** binds the original catalog, selected saved job, exact
  response bytes and native package reader before an attributed decision.
- **Operations & recovery** reopens a selected original request. Optional case
  association uses the existing deployment, purchase and current native preview
  through the original SF47 command/CAS transaction.
- **Complete handover** exports and receives the same complete desk through the
  original packager and create-only restore.

A native software check, a technical report review, a paid purchase and customer
acceptance remain distinct records. The report's declared units, discrepancies
and findings are visible unchanged. In particular, native legacy and MF6 unit
metadata and the one steady-state solution do not become a silently harmonized
transient result through publication.

## Stop and reopen

Use **Stop** on the saved application's current original run. The managed worker
signals that process. The Report Desk closes admission, aborts and drains its
owned bounded helper work, waits for its pending HTTP requests, closes any native
publication services it started, and closes the listener. Repeated stop signals
join the same drain. The process does not force an early exit.

Closing the Applications browser is not Stop. Reopen the same runtime workspace
to inspect the original worker, output or stop record.

After Stop completes, **Review start → Start reviewed application** creates a
distinct managed run for the same saved application and desk. Open the current
run's private URL; the stopped process's token is no longer usable.

The browser's original drafts and pending report operations remain scoped to its
origin and desk UUID. Use the same explicit port when the browser origin must
remain stable. A different port opens another browser-origin storage scope;
the durable original desk operations remain available in either case.

Current request/result files, receiving work and ordinary scientific database
writes do not change the saved immutable workspace identity. Replacing a desk
marker/directory or scientific database is a new source selection that must be
reviewed. Rotating an Operations access file is visible in the next start review.

If a launch response is lost, select the saved run and **Recover original
operation**. The original runtime worker checks that same process identity and
lease. It does not create a new model, desk, report, buyer request or case to
recover a missing reply.

## Original runtime CLI

The same lifecycle is available through the maintained command. A review request:

~~~json
{
  "runtimeId": "ACTUAL_RUNTIME_ID",
  "providerId": "groundwater-reports",
  "kind": "groundwater-report-desk",
  "label": "Groundwater Report Desk",
  "settings": {
    "deskDirectory": "/absolute/private/report-desk",
    "python": "/absolute/python/bin/python3",
    "port": 8879
  }
}
~~~

~~~sh
starforge runtime-workspace application-review \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/report-application-review.json

starforge runtime-workspace application-save \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/report-application-save.json

starforge runtime-workspace application-connect \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID

starforge runtime-workspace application-start-review \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID

starforge runtime-workspace application-start \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/report-application-start.json

starforge runtime-workspace application-output \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID --operation-id ACTUAL_ORIGINAL_RUN_UUID

starforge runtime-workspace application-stop \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID --operation-id ACTUAL_ORIGINAL_RUN_UUID

starforge runtime-workspace application-recover \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID --operation-id ACTUAL_ORIGINAL_RUN_UUID
~~~

Save uses {requestId, reviewId}. Start uses
{applicationId, requestId, reviewId}. Use the returned original review ID and a
distinct UUID for a distinct save or start; an uncertain reply retains that same
UUID and body.

## Installed receiving continuation

The complete **groundwater-report-managed-native** command consumes an existing
READY runtime, its original runtime workspace and a selected real Report Desk.
It creates the original reviewed application, launches and verifies its native
authenticated UI, stops it, reopens the same desk, freezes the complete desk
export, receives that exact archive into a separate directory, then reviews and
opens the received copy through the same Applications lifecycle. Every owned
process is stopped before a complete result is published.

~~~sh
starforge groundwater-report-managed-native \
  /absolute/private/managed-report-receiving.json
~~~

The input schema is [managed-receiving.schema.json](managed-receiving.schema.json).
Use the actual runtime source commit, desk UUID, original operation IDs and
private receiving paths. Optional browser paths select an existing equipped
Playwright/Chromium pair; this command installs no browser. It records actual UI
history and handover observations without saving internal screenshots.

The retained input, save/start requests, original run UUIDs, observed listener
identity, stop results, full export, receiving result and terminal handoff stay
in the supplied output directory. An interrupted invocation continues these
same original IDs. It does not replace a stopped run whose live observation was
never completed; that run's concrete output remains available for an explicit
operator decision.

A completed replay verifies the original frozen archive and original request/
result identities and reads the retained stopped managed runs. Missing or
changed output is an availability error, not permission to produce a different
current export under an old completion.

This continuation does not dispatch a model, buy a report, run a payment, or
invent an accepted report. Supply the actual existing report desk and buyer
receiving records from their respective original workflows.

## Integration surface

| Interface | Purpose |
| --- | --- |
| application-provider.mjs | The source-owned groundwater-reports Applications registration. |
| inspectReportDesk | Read the original private marker and immutable desk identity. |
| inspectScientificWorkspace | Read the native existing database metadata and inode without constructing a model. |
| inspectReportLaunchSource | Bind all direct adapter and original reader source to the selected and executed copies. |
| inspectReportPython | Bind the selected executable, resolved bytes and original venv configuration. |
| reportStartup | Verify the same retained run and the actual authenticated listener. |
| startManagedReportDesk | Start and drain the original Report Desk under the managed lifecycle. |
| runManagedReportReceiving | Complete original managed launch, reopen, export and independent receiving. |

The Applications provider does not introduce a deployment journal, payment
engine, scientific parser or case store. The original source selection,
installer, SF46 adoption, worker, Report Desk, Groundwater reader, SF30 service,
SF88 buyer and SF47 Operations retain those responsibilities.
