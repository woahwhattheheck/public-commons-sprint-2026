# Retained merchant support through the original MCP operator

The merchant MCP can operate the same SF93 incidents, SF74 saved cases and SF77
workorders used by the merchant console. An agent can review saved registration
profiles, operate its own original watcher and notification recovery, read a recorded condition,
retain its original captures as a case, work through that case with the operator,
and produce a private support handoff and workorder. The original case directory
is shared with the support console; either interface can reopen the other's saved
versions.

These tools run through the existing authenticated HTTP or stdio provider.
Observation is explicit: `merchant_support_watch_start` runs the original SF93
watcher against its configured local merchant endpoints and delivers its configured
metadata-only notifications. The remaining source/case readers use retained data.
Acknowledgment and notification recovery use the same original transactions as
the terminal commands. Workorder preparation keeps customer acceptance and
external workorder delivery in the operator's existing commercial workflow.

## Register the existing support inputs on the host

Create a private case directory, or use the existing directory passed to the
original `support-console --cases-dir` command. Keep its original privacy modes:
directories `0700`, source files `0600`. Prepare a support connection file:

```json
{
  "schema": "stellar-forge.merchant-support-connection.v1",
  "casesDirectory": "/private/merchant/cases",
  "incidentsDirectory": "/private/merchant/incidents",
  "profiles": {
    "current-host": {
      "label": "Current local merchant registration",
      "file": "/private/merchant/intake/watch.json"
    }
  },
  "handoffs": {
    "retained-case": {
      "label": "Current retained merchant support case",
      "file": "/private/merchant/intake/merchant-support.json"
    }
  },
  "workspaces": {
    "merchant-mapping": {
      "label": "Operator's saved merchant mapping and owner terms",
      "file": "/private/merchant/intake/merchant-workspace.json"
    }
  }
}
```

`casesDirectory` is required and must already exist. `incidentsDirectory` is
optional; when provided it is the original initialized SF93 state directory.
`handoffs` contains complete original SF74 support files. `workspaces` contains
original SF74 workspace files that provide a reviewed mapping for an incident's
route. `profiles` contains original SF93 watch configuration files for deliberate
registration or threshold changes. Each of these alias maps is optional and allows
up to 32 entries. Relative
paths resolve beside this support connection file. MCP inputs never select a
filesystem path.

Add `"supportConnection": "/private/merchant/support-connection.json"` to the
existing `merchant-mcp.json`, then restart the MCP host. For a new merchant, add
`--support /private/merchant/support-connection.json` to the existing `serve.mjs
init` command. Its OpenAPI, saved-package, Python and DuckDB initialization modes all
support this option. The original source aliases, release history, running seller
and catalog connection retain their usual meanings. A support connection can
also be used with an existing host configuration whose source alias map is empty;
case operation does not require an active seller release.

The customer export root from `exportsDirectory` must be a real private directory.
Support exports use named new subdirectories there, alongside the existing
customer SDK exports. The connection stores references to the original inputs;
it does not copy an incident store. Applying a profile explicitly changes the
original capture configuration through SF93's existing transaction.

## Select the console's existing incident sources

The same Support provider accepts the original multi-source file already used by
the SF74 incident desk and managed Support application. Select that existing file
in the host connection:

```json
{
  "schema": "stellar-forge.merchant-support-connection.v1",
  "casesDirectory": "/private/merchant/cases",
  "incidentSourcesFile": "/private/merchant/incident-sources.json",
  "defaultIncidentSource": "main",
  "profiles": {
    "current-host": {
      "label": "Reviewed main registration",
      "file": "/private/merchant/intake/watch.json"
    }
  },
  "workspaces": {
    "merchant-mapping": {
      "label": "Original merchant workspace and owner terms",
      "file": "/private/merchant/intake/merchant-workspace.json"
    }
  }
}
```

Use the original source file format:

```json
{
  "schema": "stellar-forge.support-incident-sources.v1",
  "sources": [
    {"id":"main","label":"Main merchant","directory":"incidents"},
    {"id":"supplier","label":"Supplier merchant","directory":"supplier-incidents"}
  ]
}
```

Each source refers to an already initialized private SF93 store. The original
source parser checks the file, configured IDs and actual directory identity; it
allows at most eight sources and rejects duplicate bindings to the same store.
Relative incident directories resolve beside that source file. The source file
itself resolves beside the support connection.

Select either `incidentsDirectory` or `incidentSourcesFile` in one connection.
The existing single-directory configuration keeps its original tools and native
watcher behavior. The new file mode uses the existing SF74 source manager, its
original SF93 stores and its owned watchers.

Start with `merchant_support_incident_sources`. It returns the connection mode,
available source IDs and labels, bound source-file SHA-256 and default selection.
A configured `defaultIncidentSource` must name one of those sources. With exactly
one source it is selected automatically. Otherwise supply `incidentSource` on
every incident, profile, watcher or notification operation. This field is separate
from the existing handoff/workspace `source` alias.

```json
{"incidentSource":"supplier"}
```

This example opens the selected source through
`merchant_support_profiles` or `merchant_support_watch_status`. Every result
identifies its selected source. Listing, acknowledgment, reminder, notification
recovery and incident-to-case operations use that same selector.

The host binds the source file's bytes and original store identities at
configuration read, then the provider verifies them before opening the manager.
Changing that host mapping requires reviewing and restarting the merchant
configuration. Live incident updates and explicit watch-configuration revisions
do not change the host source binding. The source parser reads original state
without starting observation. A failed opening can be retried after the original
store recovers; each attempt still checks the same host-selected file and store
identities.

## Inspect the actual destination and retained route choices

`merchant_support_destination` takes the current configuration revision and
optional source selector:

```json
{"incidentSource":"main","expectedConfigRevision":2}
```

For Slack, it calls the existing destination inspector using the host's original
token environment reference and returns the actual authenticated workspace and
channel result. For a webhook, it reports whether the original environment
configuration resolves. The operation sends no incident message. A changed
configuration revision requires a new current inspection.

The original [Slack notification transport](../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/INCIDENT_OPERATIONS.md)
retains its exact attempted message, binding, same-thread parent, retry timing and
accepted delivery reference in the original event. The Support MCP reads the
sanitized queue through the same incident operations.

`merchant_incident_view` opens one original incident:

```json
{"incidentSource":"main","id":"<original incident UUID>"}
```

It returns the incident, integer revision, current configuration identity,
`latestNotificationId`, sanitized notification history, and actual advertised
`routes` from retained before/after capture files. Each route has its original
ID, method, optional path and the capture sides that advertise it. A capture read
or parse issue appears in `captureProblems`; the original capture remains in its
store. These readers are also available to the existing single-directory
connection by omitting `incidentSource`.

Use the returned route ID when calling `merchant_incident_case`. In source-file
mode, the provider calls the existing source manager's `prepareCase`, parses its
complete original SF74 handoff and saves it through the existing case store.
Before/after capture bytes are read under the original read-only transaction at
the expected incident revision. The template is the exact inspected host
workspace. This path keeps the original case format and source bytes while
avoiding an additional temporary incident export directory.

## Operate the original observer and notification recovery

Initialize the incident directory once on its host with the existing SF93 command
and a private watch configuration. The original
[incident operations guide](../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/INCIDENT_OPERATIONS.md)
describes local seller/operations origins, thresholds, capture retention and the
metadata-only webhook contract. For example, from the source checkout:

```sh
node stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-cli.mjs init \
  --state /private/merchant/incidents --config /private/merchant/intake/watch.json
```

Supply the notification URL and signing key using the original configuration's
environment references when starting the MCP host. Neither value is an MCP
argument, profile value or returned notification field. Profiles name those
environment references and retain the original local merchant origins and
thresholds, so the operator can inspect what a change will observe. Editing a
profile file alone does not change the running watcher.

| Tool | Operation |
| --- | --- |
| `merchant_support_incident_sources` | Read the configured source IDs, default, mode and bound source-file digest. |
| `merchant_support_profiles` | List declared profiles and the selected source's original configuration, or inspect one profile, its digest and concrete merchant/settings changes. |
| `merchant_support_destination` | Inspect the current original Slack destination or webhook configuration at its exact configuration revision. |
| `merchant_support_configure` | Apply the inspected profile with its exact file digest and current integer configuration revision. |
| `merchant_support_watch_status` | Read the saved original worker record, this MCP process's owned instance and its last completion/failure. |
| `merchant_support_watch_start` | Acquire the original worker lease and start observation for the exact inspected configuration revision/hash. |
| `merchant_support_watch_stop` | Abort and await only this MCP process's watcher, using its exact returned instance ID. |
| `merchant_notifications` | Inspect/filter/page original events, their attempts, delivery state and retry reason. |
| `merchant_incident_notify` | Queue a new reminder for the exact incident revision and latest observed notification ID using the currently configured destination. |
| `merchant_notification_update` | Retry an original paused/exhausted event, or cancel an unfinished event, with its exact attempt count and named operator. |

Start with `merchant_support_profiles`, selecting `incidentSource` when the host has multiple sources and no default. Inspect a declared
profile when its original merchant registration, thresholds or notification
settings need changing:

```json
{"profile":"current-host"}
```

The result includes the compiled original `configuration`, `sourceSha256`,
`configHash`, `current.configRevision`, and changes to merchant registrations,
their order and other settings. Apply precisely that inspected source:

```json
{
  "profile":"current-host",
  "expectedSourceSha256":"<sourceSha256 from profile inspection>",
  "expectedConfigRevision":1
}
```

An unchanged profile retains its existing configuration revision. Use the
returned values instead of assuming the revision increased. Use that current
revision and configuration hash to call
`merchant_support_watch_start`:

```json
{"expectedConfigRevision":2,"expectedConfigHash":"<current original configHash>"}
```

The original startup transaction checks both expectations while it owns the
worker lease. A concurrently changed configuration is refused before replacing
the saved worker record or polling. Existing CLI/service launches remain
compatible. A worker already holding that directory's kernel lease remains its
owner; MCP reports the original lease conflict and cannot stop that worker.

Retain the returned `owned.instanceId`. `owned.startedConfiguration` records the
configuration accepted at this start; top-level `configRevision`/`configHash`
describe the current store, including a later explicit profile change. The
original worker notices configuration changes through its existing sweep logic.
Changes that retire a registration retain the original `RETIRED` distinction;
they do not become observed recovery.

After a lost start response, inspect `merchant_support_watch_status`. Its `owned`
field identifies this MCP process's actual watcher. The saved `worker` record is
also useful after a crash, but a saved `RUNNING` status alone does not establish
that a worker is still alive. A new process uses the original kernel lease when
it starts; it does not kill a saved PID or remove an ownership file. A startup or
background failure in single-directory mode is retained in `lastOwnedExit` with its original safe code. Source-file mode returns the original source manager's current `watcher.status`, `watcher.error` and actual ownership, while an explicitly drained stop is retained in `lastOwnedExit`.

Read `merchant_incidents` and `merchant_notifications` to work the actual observed
condition. An event with `EXHAUSTED` or `PAUSED` may be retried using its current
attempt count, for example through `merchant_notification_update`:

```json
{"id":"<original event UUID>","expectedAttempts":3,"action":"retry","by":"Merchant operator"}
```

This continues the same original event/body/destination. The original engine
refuses an in-flight or completed event, a stale attempt count, or a changed
destination/configuration. After repairing the existing destination, retry that
event when its original rules allow it. If intentionally selecting a new
destination, inspect the current incident revision and call
`merchant_incident_notify`; this queues a **new** original reminder. Cancel an
unfinished previous event with the same `merchant_notification_update` tool and
`action:"cancel"` when the operator intends that cancellation. Cancellation does
not erase the incident or report its merchant condition as recovered. To guard a new reminder, pass the last observed event ID from
`merchant_incident_view` in `expectedNotificationId`, or explicit `null` when the
incident has no notification. Source-file mode requires this field. The existing
single-directory call keeps omission compatible and accepts the same guard:

```json
{
  "incidentSource":"main",
  "id":"<original incident UUID>",
  "expectedRevision":3,
  "expectedNotificationId":"<last observed notification UUID>"
}
```

SF93 checks this selection inside its original reminder transaction. If a lost
response already created a new event, replaying the same previous ID is refused
with the original selection conflict. Read the current incident and queue to
reconcile that event. Change the guard to a newer ID only when deliberately
requesting another reminder. Retrying delivery of an existing event still uses
`merchant_notification_update` and its original attempt count.

Stop an owned watcher with `merchant_support_watch_stop` and its exact
`instanceId`. It waits for the current original state write and lease release;
repeating that same completed stop in the same MCP process returns `unchanged`.
In source-file mode, one MCP provider can own watchers for several configured sources. Each Start/Stop selects its source, retains its actual instance and drains that original source manager. A concurrent lifecycle action on the same source returns its current busy conflict. Closing the MCP host performs the same owned-watch shutdown for all of its sources alongside its other
owned runtimes. It does not stop an independently run watcher, seller, notification
receiver or delivery worker. The incident store, captures, events and cases stay
available to the next MCP process and the original terminal/browser interfaces.

Once the native observer captures the active or recovered condition, continue
below with `merchant_incident_case`, using the exact incident revision, inspected
workspace template and original route ID. That creates the same versioned support
case used for owner terms, workorder and private handoff.

## Complete case and workorder workflow

| Tool | Use |
| --- | --- |
| `merchant_support_sources` | List configured aliases, or inspect a handoff/template with its exact source digest and mapping. |
| `merchant_incidents` | Read original condition, revision, captures, acknowledgment and notification state for the selected source. Filter by ID or status and page through the result. |
| `merchant_incident_view` | Open exact retained capture route choices, latest notification selection and sanitized event history for one incident. |
| `merchant_incident_ack` | Acknowledge an original open incident using its exact integer revision and named operator. |
| `merchant_incident_case` | Use an inspected workspace template and the original incident export to create a saved case. |
| `merchant_cases` | Find cases by text, work status or follow-up date. Archived cases appear when selected explicitly. |
| `merchant_case_import` | Import an inspected, complete original support handoff into a new case UUID. |
| `merchant_case_read` | Reopen the current or a retained revision, including actual source identities, runtime review and raw unfinished owner terms. |
| `merchant_case_history` | Page through the original immutable case versions. |
| `merchant_case_update` | Save owner metadata, terms or source selection against an exact current revision. |
| `merchant_case_restore` | Restore an earlier version as a new current version, retaining the intervening history. |
| `merchant_case_workorder` | Generate the original workorder from an exact saved revision and its selected sources. |
| `merchant_case_export` | Publish the original workspace, support handoff and readable review; optionally include the workorder documents. |
| `merchant_support_export_status` | Verify a retained export's completion manifest and original file hashes. |
| `merchant_support_export_manifest` | Inspect the retained completion manifest, its own exact digest, and this operator's read sessions. |
| `merchant_support_export_file` | Retrieve an original file with its manifest digest, file digest and byte offset. |
| `merchant_support_export_file_release` | Release only this operator's temporary read snapshot. |

### Open the actual retained source

First call `merchant_support_sources` without arguments. Inspect the chosen input:

```json
{"kind":"handoff","source":"retained-case"}
```

The response gives its actual `sourceSha256`, saved merchant mapping, source
coverage and original runtime review. To retain it as a case, call
`merchant_case_import` with that alias, the exact returned digest and a newly
chosen UUID in `id`. Import keeps the original workspace text, support text,
metadata, unfinished terms and source choice. A changed host file is rejected;
inspect it again before importing the new version.

Alternatively, read `merchant_incidents`. Its incident `revision` is an integer,
which differs from the SHA-256 revision of an SF74 case. An acknowledgment takes
`id`, `expectedRevision`, `by` and optional `notes`. An acknowledged incident stays
under the original watcher's recovery logic. MCP cannot mark it recovered.

For `merchant_incident_case`, supply a new case UUID in `id`, the original
`incidentId` and `expectedIncidentRevision`, a configured workspace alias in
`template`, its inspected `expectedTemplateSha256`, and the actual `routeId` in
the retained capture. In single-directory mode, SF93 exports the original
before/follow-up packets through its existing operator function. The importer retains its exact case metadata,
including incident identity, timestamps and acknowledgment, in the original SF74
store. It snapshots the inspected template before passing it to SF93, so a host
edit cannot silently change that mapping during export. The temporary SF93 export
is removed after the original case save; retained capture bytes live in the saved
case and remain available through its complete handoff.

### Recover an interrupted incident-to-case save

Retain the chosen case UUID before sending `merchant_incident_case`. If its reply
is interrupted, call `merchant_case_read` with that same UUID first. An identical
save can reuse the original first case version while the incident revision and
case inputs still match. A watcher observation, acknowledgment or recovery can
advance the incident before a retry; the original revision check then rejects
that old incident selection even when its case was already saved successfully.

The saved case remains independent of that later incident change. Inspect its
original incident identity in metadata, retained capture route and observation
times, and `workspaceSha256` against the inspected template digest. If a browser
or another agent has edited the case, page its existing `merchant_case_history`
and open the matching retained revision with `merchant_case_read`. Continue
from the actual current case rather than sending the create request again.
A same-ID case with different original inputs requires inspection; it is never
silently accepted as this request's result.

If the original case ID is absent, inspect the current incident and its retained
routes before preparing the still-needed case. Keep the existing intent and case
ID, but explicitly review any changed incident revision or template before
sending the corresponding new selection. This recovery uses the original saved
versions and source hashes shared by the browser and MCP.

### Record the owner's work and reopen it

`merchant_case_read` returns the current revision, selected source mode, raw
`termsText`, parsed terms where possible, and the original runtime review. It
returns original source hashes and findings; large source payloads stay in the
private store. The runtime review retains actual day/session/path variants,
source coverage and complete network/asset/amount/recipient option groups. The
case itself does not change when it is read.

Update a case with `id`, its exact `expectedRevision`, and any of these fields:

- `metadata`: a partial change to merchant, owner, work status, follow-up date,
  next action or notes. Other metadata stays unchanged.
- `terms`: the original SF77 owner terms document, including its explicit
  merchant-consent and commercial-proposal states. Delivery scope, deliverables
  and acceptance criteria are optional multiline text fields.
- `workorderSource`: `runtime` for attached original runtime sources, or
  `diagnostic` for the existing SF70/SF76 diagnosis workflow.
- `baselineOnly`: the existing diagnostic baseline selection.

For example, after reading the actual case revision, record an unfinished
internal scope using the same terms format as the support console:

```json
{
  "workOrderRef": "YOUR_WORK_REFERENCE",
  "sellerDisplayName": "YOUR_MERCHANT",
  "relationshipOwner": "YOUR_RELATIONSHIP_OWNER",
  "proposedWindow": "UNSCHEDULED",
  "delivery": {
    "scope": "Owner-entered scope and exclusions",
    "deliverables": "Owner-entered deliverables",
    "acceptanceCriteria": "Owner-entered review criteria"
  },
  "merchantConsent": {"status":"NOT_RECORDED","receiptUrl":null},
  "commercial": {
    "priceApproval":"NOT_APPROVED",
    "feeUsd":null,
    "costUsd":null,
    "approvalReceiptUrl":null
  }
}
```

Pass this document as `terms` in `merchant_case_update`. Actual existing consent
or owner approval uses the original SF77 states and receipt fields; the original
workorder assembler validates that proposal. No fee or approval is inferred from
a source report, a blank cost field or the case's work status. Incomplete drafts
can be saved and corrected before preparing a workorder. Omitted terms preserve
the exact prior raw form values, including hidden or unfinished entries.

The browser and MCP share the original terms document↔draft converter. Open the
same case directory in `support-console`; the merchant mapping, delivery text,
source selection and original captures appear in the existing form. Saving in
either interface creates the next original version. An agent reading a version
before a browser change cannot overwrite that change with stale terms.

`merchant_case_history` returns `nextBefore` for another page. To restore a
version, pass its `revision` and the currently selected `expectedRevision` to
`merchant_case_restore`. This adds a version containing the earlier original
workspace, support and metadata. It does not delete later history.

### Prepare and export the actual workorder

Call `merchant_case_workorder` with `id` and `expectedRevision`. It uses the same
original source assembler as `/api/workorder` in the support console. Runtime
mode uses the attached captures and recorded mapping; diagnostic mode uses the
saved before/after sources and baseline selection. Both paths retain the original
SF77 commercial and acceptance semantics. The packet identifies the exact case
revision and the hashes of its original workspace and support.

`merchant_case_export` takes the same selection and a new `exportId`. With
`includeWorkorder:true`, it writes:

- `case.json` and `merchant-workspace.json` for the selected original version;
- `merchant-support.json` and `support.html` when the case has runtime sources;
- `owner-terms.json`, `packet.json`, `seller-packet.html` and
  `acceptance-checklist.md` when the workorder is requested;
- `support-export.json`, written last, identifying the completed export and each
  original file's byte count and SHA-256.

The complete support handoff reopens directly in the existing SF74 console.
The original SF77 CLI can also consume `merchant-support.json` with
`owner-terms.json`. This MCP join introduces no new handoff or contract format.
Use the existing private business delivery workflow to provide the completed
files to the intended recipient.

## Retrieve and reopen the private handoff

The same MCP service now returns the actual retained export bytes. The client
saves the original file names, case/workspace/support content, workorder documents
and completion manifest. It does not rerun an observer, seller, workorder or
export. Files from the original two-file diagnostic export, four-file runtime
export and their workorder additions use the same manifest format.

From the complete source checkout or a cumulative package containing this source,
start the existing merchant MCP listener with its usual host configuration and
bearer environment. On the receiving Linux machine, supply that endpoint's bearer
through `MCP_ACCESS_TOKEN` or an existing variable named with `--token-env`. Use the
original loopback listener, an operator-established SSH tunnel, or the host's
existing HTTPS endpoint. Tokens never appear in command arguments, progress,
download checkpoints or exported files. The client refuses redirects, URL
credentials and bearer transport over non-loopback HTTP.

```sh
starforge merchant-mcp download-support \
  --url http://127.0.0.1:3211 \
  --export-id recovered-incident \
  --out /private/received/recovered-incident
```

Before delivery, `starforge merchant-mcp inspect-support --url MCP_ENDPOINT
--export-id EXPORT_ID` returns `{manifest,manifestSha256}`. Pass the reviewed
digest to `download-support --manifest-sha256 REVIEWED_DIGEST` to require that
exact receipt before the client creates or changes local output. The embedding
API is `inspectSupportExport({url,exportId,tokenEnv,environment,signal})`;
`downloadSupportExport` accepts the optional `expectedManifestSha256`.

The source equivalent begins with
`node stellar-forge/mcp-merchant-operator/serve.mjs download-support` and takes
the same options. The output's parent directory must already exist. The command
creates its private output directory with mode `0700` and files with mode `0600`.
An existing output is accepted only as this same download; unrelated files and a
different endpoint/export/manifest are rejected without replacing them. Its
`download-state` directory retains the original manifest, per-file byte/hash
checkpoints and a Linux kernel lease. Install `flock` from util-linux on the
receiver, as used by the original merchant state stores. The lease prevents two
clients from writing the same output and is released automatically on process
exit, including an unexpected termination.

Each chunk is checked against the original export ID, manifest SHA-256, filename,
complete file SHA-256, byte count and offset. The default chunk is 196,608 bytes;
`--chunk-bytes` can select a smaller positive value for an existing constrained
transport. Progress is a JSON line on stderr. The final JSON on stdout reports
`COMPLETE`, the original case identity, exact manifest digest and completed file
counts. `support-export.json` appears at the output root only after all original
files have been checked and published there. Its publication is atomic, preserving
resume after a stopped completion write. The files remain directly usable by
the existing console and private business delivery workflow.

### Continue after a lost connection or process exit

Run the **same command with the same output directory**. Completed files are
rehash-checked locally and retained. A partial file resumes from its saved byte
offset after the durable prefix is verified. An uncheckpointed suffix left by a
killed write is discarded within that owned partial file; the verified prefix
is preserved. A changed completed or checkpointed file is reported instead of
being overwritten. Disk-full and connection errors leave the original partial
state available for the next invocation after the host issue is corrected.

Read IDs identify the server process's temporary snapshots. If the server restarted
or the read expired, the client opens the same original file at its saved offset
with both original digests. It cannot combine chunks from another manifest or
silently select a newer case revision. A graceful interruption releases its
current read; an abrupt client exit leaves that snapshot to the original idle
expiry. Closing the server releases its owned snapshots while retaining the
export. The client never shuts down the server or another operator's watcher.

### Reopen through the existing case desk

To save the downloaded source into a local original SF74 case directory, add
`--cases-dir /private/merchant/cases` to the download command. The private case
directory must already exist. For an already completed download, the same
continuation works offline:

```sh
starforge merchant-mcp reopen-support \
  --dir /private/received/recovered-incident \
  --cases-dir /private/merchant/cases

starforge support-console --cases-dir /private/merchant/cases
```

Reopening verifies the saved files, invokes the original SF74 handoff importer
and saves through its original case writer. Diagnostic-only exports reuse their
original workspace and case metadata. A new local case UUID is recorded before
the save, so an interrupted reply resumes the same import. Subsequent invocations
reopen that local case and preserve later browser/MCP edits. If the initial save
completed before its download checkpoint and the local case was subsequently
edited, reopening traverses the original case history, verifies its first imported
revision and keeps the current edited head. The result identifies
both the original exported case and the local case/revision; it does not overwrite
an existing case using the remote UUID. One download retains one local case-directory
binding, while the original files remain portable through the normal console
import. Original case writer recovery remains in [CASE_DESK.md](../../stellar/scf-starforge-20261009/sf74-merchant-support-console/CASE_DESK.md).

Open the returned case in the existing console to continue its source comparison,
follow-up, recorded fees, acceptance text and workorder. Reopening changes neither
the retained observation times nor the commercial approval state. No MCP server,
merchant endpoint, observer, payment adapter or notification receiver is contacted
by `reopen-support`.

### Use the retained-file tools from an existing MCP client

Call `merchant_support_export_manifest` with `exportId`. `MANIFEST_RETAINED`
means that the original completion manifest exists and parses; it does not reread
all payloads. The response's `manifestFile` gives the exact original manifest
name, bytes and SHA-256. The existing `merchant_support_export_status` remains
the explicit full-file verification operation and returns its unchanged
`COMPLETE`, `NOT_FOUND` or `INCOMPLETE_OR_OTHER_EXPORT` meanings.

Retrieve `support-export.json` or a filename present in that original manifest:

```json
{
  "exportId":"recovered-incident",
  "file":"merchant-support.json",
  "expectedManifestSha256":"<manifestFile.sha256>",
  "expectedSha256":"<that original file's sha256>",
  "offset":0,
  "limit":65536
}
```

The result contains `readId`, `file`, `offset`, `bytesRead`, `nextOffset`,
`encoding:"base64"` and `data`, plus the pinned export/manifest identity. Continue
with that same `readId`, both digests and `nextOffset`. `nextOffset:null` completes
and releases the snapshot. A resumed offset or read ID requires `expectedSha256`.
After `SUPPORT_READ_NOT_FOUND`, omit the old read ID and retain the original
digests/offset. `merchant_support_export_file_release` takes the `exportId` and
`readId` when the client deliberately abandons a read.

Support, accounting and customer SDK exports share the original accounting reader
implementation; each
native owner retains its own lifecycle. Each owner permits four concurrent
verified snapshots totaling 256,000,000 bytes, retains up to 32 KiB in memory per
small file, and uses an immediately unlinked private descriptor for larger files.
Later chunks reuse the snapshot without rereading the entire source. Original
files stay in their existing export/workspace, and unfinished snapshots expire
after 120 seconds idle. Support's manifest view reports original loader counts
and active snapshot metadata without host paths. Accounting's tool names,
selectors, result fields, original-read counts and workspace-close behavior
remain unchanged.

## Concurrent edits, interruption and private state

All mutating support calls use the existing merchant operator's serialization.
The original SF74 writer lock and expected revision also protect against another
console process. Import and a repeated identical case update/restore use the
original store's retry semantics; read the actual saved case after an interrupted
reply. A stale request with different content is rejected. Incident acknowledgment
uses the original SF93 integer revision and transaction lease. A stale incident
or changed input file requires a fresh inspection.

Exports are exclusive: an existing ID is never replaced. If the reply is lost,
call `merchant_support_export_status` with that ID. `COMPLETE` means the final
manifest and all referenced original file bytes match. `NOT_FOUND` means that
named directory is absent. `INCOMPLETE_OR_OTHER_EXPORT` means the directory has
no completed support manifest; inspect it locally and choose a new ID for a new
export. Source/manifest disagreement is reported explicitly. The operator does
not silently republish over a partial export or a customer SDK delivery.

Private filesystem errors omit host paths in MCP tool responses. The host retains
its original incident/case files, existing locks and export permissions. The
original support CLI remains the explicit mechanism for stopped-process writer
recovery. Closing or restarting MCP changes no case source, incident observation
or completed customer export.

## Original implementations

- [SF93 incident operations](../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/INCIDENT_OPERATIONS.md)
- [SF74 saved case desk](../../stellar/scf-starforge-20261009/sf74-merchant-support-console/CASE_DESK.md)
- [SF74 runtime and retained periods](../../stellar/scf-starforge-20261009/sf74-merchant-support-console/RUNTIME_SUPPORT.md)
- [SF77 workorders](../../stellar/scf-starforge-20261009/sf77-merchant-workorder/README.md)
