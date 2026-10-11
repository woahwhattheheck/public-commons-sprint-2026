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
| `merchant_support_profiles` | List declared profiles and the current original configuration, or inspect one profile, its digest and concrete merchant/settings changes. |
| `merchant_support_configure` | Apply the inspected profile with its exact file digest and current integer configuration revision. |
| `merchant_support_watch_status` | Read the saved original worker record, this MCP process's owned instance and its last completion/failure. |
| `merchant_support_watch_start` | Acquire the original worker lease and start observation for the exact inspected configuration revision/hash. |
| `merchant_support_watch_stop` | Abort and await only this MCP process's watcher, using its exact returned instance ID. |
| `merchant_notifications` | Inspect/filter/page original events, their attempts, delivery state and retry reason. |
| `merchant_incident_notify` | Queue a new reminder for the exact incident revision using the currently configured destination. |
| `merchant_notification_update` | Retry an original paused/exhausted event, or cancel an unfinished event, with its exact attempt count and named operator. |

Start with `merchant_support_profiles` without arguments. Inspect a declared
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
background failure is retained in `lastOwnedExit` with its original safe code.

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
not erase the incident or report its merchant condition as recovered. After an
interrupted notification mutation, inspect the original events before issuing
another reminder; reminders create new event identities.

Stop an owned watcher with `merchant_support_watch_stop` and its exact
`instanceId`. It waits for the current original state write and lease release;
repeating that same completed stop in the same MCP process returns `unchanged`.
Closing the MCP host performs the same owned-watch shutdown alongside its other
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
| `merchant_incidents` | Read original condition, revision, captures, acknowledgment and notification state. Filter by ID or status and page through the result. |
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
the retained capture. SF93 exports the original before/follow-up packets through
its existing operator function. The importer retains its exact case metadata,
including incident identity, timestamps and acknowledgment, in the original SF74
store. It snapshots the inspected template before passing it to SF93, so a host
edit cannot silently change that mapping during export. The temporary SF93 export
is removed after the original case save; retained capture bytes live in the saved
case and remain available through its complete handoff.

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
