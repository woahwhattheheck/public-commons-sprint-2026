# Incident sources in the merchant support console

The SF74 console operates the existing SF93 incident stores. Select a registered
source to review its incidents, run or stop a watcher owned by this console,
acknowledge the work, manage its original notification queue, and carry retained
captures into the existing merchant case.

## Connect existing stores

Use Node 22 or newer on Linux with util-linux `flock`. Run the console as the
operating-system user that owns the incident directories and notification
environment. Each source must already be initialized by the original SF93
`incident-cli.mjs init` command. The existing
[incident operating guide](../sf93-seller-support-bundle/INCIDENT_OPERATIONS.md)
covers merchant registration, seller/operations startup, capture retention and
backup.

Create a private configuration outside the repository, for example
`/srv/stellar/operator/incident-sources.json`:

```json
{
  "schema": "stellar-forge.support-incident-sources.v1",
  "sources": [
    {
      "id": "merchant-operations",
      "label": "Merchant operations",
      "directory": "incidents"
    },
    {
      "id": "partner-operations",
      "label": "Partner operations",
      "directory": "/srv/stellar/partner/incidents"
    }
  ]
}
```

The file must be owned by the console user, be a regular file with no group or
other permissions, and fit within 65,536 bytes. Use mode `0600`; original state
directories use `0700`. Relative directories resolve beside this configuration
file. Each configured directory is checked by the original private store
opener, including its existing state and lock directories.

Configure up to eight sources. IDs start with a lowercase letter or digit and
contain at most 64 lowercase letters, digits, underscores or hyphens.
`profiles`, `constructor` and `prototype` are reserved. Labels contain at most
120 UTF-8 bytes. Two IDs cannot select the same canonical store directory.
Source IDs remain stable across a console restart; edits to this source list
take effect when the console reopens the configuration.

Start the existing console from the repository root:

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --incident-sources /srv/stellar/operator/incident-sources.json \
  --cases-dir /srv/stellar/operator/cases \
  --port 8784
```

Open the printed `127.0.0.1` URL. The Incident sources control lists only the
configured IDs and labels. The browser chooses those IDs; the server resolves
their already configured private directories. A missing `--incident-sources`
option keeps the incident panel disabled.

Supply Slack or webhook values through the console process environment using
the names in the original watcher configuration. The source-list file selects
stores. Their existing watcher configuration selects merchants, thresholds and
notification destinations. The
[Slack operating guide](../sf93-seller-support-bundle/SLACK_OPERATIONS.md)
describes workspace/channel IDs and the token environment reference.

## Operate the original watcher and queue

Opening the console reads retained state. **Start watcher here** starts the
original SF93 watcher against the displayed configuration revision and digest.
An intervening configuration change returns a conflict so the operator can
refresh and select the current registration.

The worker panel identifies a watcher started by this console and displays
the original recorded process, sweep and stop metadata. **Stop this watcher**
aborts and drains the worker that this console started. Closing the server
with SIGINT or SIGTERM also drains its owned watchers. The original kernel
lease decides whether another watcher currently owns a source; a historical
`RUNNING` heartbeat can remain after a crash. An active external watcher can
continue collecting while this console performs acknowledgments, queue
operations and configuration changes.

The list supports search, status, merchant and condition filters through the
API, with a default page of 20 incidents and a maximum of 100. The interface
refreshes active operations every five seconds while visible. Counts include
open and acknowledged incidents, pending deliveries, paused deliveries,
exhausted deliveries and the original notification capacity counter.

Open an incident to see its retained observations, before/after capture
references, acknowledgment and notification history. Notification rows use
the original sanitized status projection and retain accepted Slack message
and thread timestamps. The original queue owns the attempt identity,
destination, retry body, provider cooldown and acceptance receipt.

**Acknowledge incident** uses the incident revision that was displayed, records
the named operator and note, and queues the original acknowledgment transition.
If the source recovers or another operator changes the incident first, refresh
the current record before acting again.

**Send an operator reminder** selects the current configured destination through
the original queue. The console sends both the displayed incident revision and
latest notification ID. The original `remindIncident` transaction checks both
before queuing another event. Repeating a request after a lost response cannot
silently create another reminder against the same displayed selection.
Existing CLI callers that omit the additional notification expectation retain
their original behavior.

Use **Retry delivery** for a paused or exhausted event at its retained destination.
Use **Cancel delivery** for an unfinished event that no longer needs delivery.
Both operations use the displayed attempt count and named operator. The original
queue rejects changes to in-flight or completed events. A new configured
destination is selected with an operator reminder; existing queued events keep
their retained destination binding.

**Apply configuration** delegates to the original configuration compiler and
revision check. The original model handles registration changes, incident
retirement and notification scope. **Verify Slack workspace** invokes the
original read-only actor/workspace check and displays its current result;
channel message acceptance appears separately in actual delivery receipts.

## Continue an incident as a merchant case

Load or edit the current merchant workspace and choose the advertised route
from the incident's original capture choices. Each choice records its original
route ID and method, its path when provided by the original packet, and the
before/after side where it appeared. Choose a route whose method matches the
current workspace and that exists in every capture being attached.

The route choices are obtained through the original `inspectRuntimeFiles`
parser. Successful projections are cached by immutable capture hash, with a
maximum of 64 entries per source, so routine detail refreshes reuse already
validated route metadata. A damaged or unavailable retained capture is shown
as a capture problem while incident ownership and delivery history remain
available.

**Prepare incident case** holds the original read-only state transaction while
selecting the displayed incident revision and reading its exact retained
capture files. It then uses the original runtime support parser and handoff
exporter with the current serialized workspace and explicit route mapping.
Capture content hashes are checked again during preparation. Original before
and after sessions retain their own identities and comparison behavior.

Download the original support handoff and readable review, or select
**Open prepared case**. The existing case desk imports the original handoff's
workspace, support text and metadata. Incident ID, registration, condition,
timestamps and acknowledgment travel in the original case notes. Use
**Save case** to retain the continued work in the existing case directory.

## Embedded backend contract

`openIncidentSources({configPath, environment})` exposes the operations below.
HTTP routes belong to the existing local console server, which checks its exact
loopback Host, same-origin requests, route syntax and bounded JSON bodies.

| Method | Arguments after source ID | Result |
|---|---|---|
| `profiles()` | None | Source-list schema and `sources: [{id,label}]` |
| `list(sourceId, filters)` | `q,status,merchant,kind,offset,limit` | Source, directory/config revisions, config digest/config, worker, counters, merchants, filters, page, incident summaries |
| `view(sourceId, incidentId)` | Original incident UUID | Original incident, sanitized event history, latest notification ID, worker, revisions, route choices and per-side capture problems |
| `configure(sourceId, input)` | `config,expectedConfigRevision` | Original new configuration revision/digest |
| `acknowledge(sourceId, incidentId, input)` | `expectedRevision,by,notes` | Original updated incident |
| `notify(sourceId, incidentId, input)` | `expectedRevision,expectedNotificationId` | Original incident/event ID and event status |
| `notification(sourceId, eventId, input)` | `expectedAttempts,action,by` | Original event status and attempt counters |
| `inspectDestination(sourceId, input)` | `expectedConfigRevision` | Original destination inspection plus source and observed configuration identity |
| `start(sourceId, input)` | `expectedConfigRevision,expectedConfigHash` | Source and current worker state after the original watcher becomes ready |
| `stop(sourceId)` | None | Source and worker state after this console's worker drains |
| `prepareCase(sourceId, incidentId, input)` | `expectedRevision,workspaceText,routeId` | `source,incidentId,revision,handoff,html,report` |
| `close()` | None | Idempotent promise that drains all console-owned workers |

The `expectedNotificationId` property is required by the console method.
Use the latest displayed event UUID, or explicit `null` when the incident has
no retained event. Configuration revisions and incident revisions are distinct
from the frequently changing whole-directory revision.

Worker results have `ownership` (`console`, `external`, or `none`),
`status` (`STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, or `FAILED`),
`canStart`, `canStop`, original `recorded` metadata and a stable `error` code.
Route results have `id,method,path?,sides`; `captureProblems` is keyed by
`before` or `after` and contains stable `error,detail` fields.

`incidentProblem(error)` returns `{status,error,detail}` for the local API.
Input errors use 400 or 422, missing selections use 404, stale revisions and
original ownership/queue conflicts use 409, and unavailable storage uses 503.
Refresh a stale selection, correct the indicated input or storage condition,
then continue the same original incident operation.

