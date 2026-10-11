# Merchant incident operations

Run the original SF93 collector continuously, retain an actionable incident, notify the configured operator, acknowledge it from another terminal, and bring its original baseline and recovery captures into the existing SF74 case desk. The watcher owns its process and private state. Existing seller, operations and SF98 delivery processes retain their own lifecycle.

## Register and start

Requirements are Node 22 or newer, Linux with util-linux `flock`, the original SF30 seller plus its operations listener, and a private directory on a local filesystem supporting file locks, atomic rename and fsync. Run the watcher as the same operating-system user as its private files. A foreground invocation can also be supervised by the deployment's existing process manager; configure it to send SIGTERM and allow current bounded requests/state writes to finish.

Start the original seller and operations launcher as usual. Its printed seller and operations ports are the registrations used below. For example, the original source example uses seller port 8423 and operations port 8424:

```bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json --port 8423
```

From another terminal, prepare a private configuration. Edit merchant IDs/labels and the exact original local ports. Up to eight merchants can share one watcher.

```bash
umask 077
mkdir -p /srv/stellar/operator
cp stellar/scf-starforge-20261009/sf93-seller-support-bundle/examples/watch.json \
  /srv/stellar/operator/watch.json
chmod 600 /srv/stellar/operator/watch.json

SF93=stellar/scf-starforge-20261009/sf93-seller-support-bundle
node "$SF93/incident-cli.mjs" init \
  --config /srv/stellar/operator/watch.json --state /srv/stellar/operator/incidents
node "$SF93/incident-cli.mjs" run --state /srv/stellar/operator/incidents
```

`init` creates a new private state directory and never overwrites one. Its parent must exist. `run` reopens that same directory. One watcher holds the original parent-owned kernel lease; a second watcher cannot start against the same state. SIGINT/SIGTERM cancels its pending HTTP reads, finishes its state write and releases its own lease. A crash releases the kernel lock without a PID-file override. The `lease.lock` files are permanent lock inodes: do not remove them.

Provide `SF93_NOTIFICATION_URL` and `SF93_NOTIFICATION_SECRET` through the process environment or existing secret manager. The signing secret must contain at least 32 UTF-8 bytes. Configuration/state retain environment variable names and the canonical endpoint's digest, never the resolved URL or signing secret. Set `notification: null` to use local incident operation without a hook. Missing or invalid hook configuration records a paused notification while local collection and incident work continue. The default endpoint must use HTTPS. Explicit `allowLoopback: true` additionally permits an HTTP receiver on `127.0.0.1:PORT` for local integration.

The original seller health, offers, operations snapshot and metrics are read through four fixed GET paths, with a two-million-byte response bound and a five-second absolute deadline per read. When a merchant has a `delivery` policy, the watcher also reads the original private `/api/delivery` projection. It never calls a merchant resource to check whether a purchase succeeds.

## Conditions and recovery

| Condition | Original observation | Clear condition |
|---|---|---|
| `ENDPOINT_UNAVAILABLE` | Failed required endpoint read, invalid original packet or same-session counter/clock discontinuity | A complete valid four-endpoint capture |
| `OBSERVER_INCOMPLETE` | Detached observer or nonzero original `observerErrors` | An attached native observer with zero errors |
| `HTTP_5XX` | Configured minimum and percentage of 5xx among responses in original minute buckets | A complete clean source window below the configured threshold |
| `DISCONNECTED` | Configured minimum and percentage of disconnected attempts among completions | A complete clean source window below the configured threshold |
| `DELIVERY_UNAVAILABLE` | Required original outbox projection unavailable or invalid | A valid available original projection |
| `DELIVERY_BACKLOG` | Original pending work has reached its configured oldest age | A valid projection with no qualifying old pending work |
| `DELIVERY_EXHAUSTED` | Original exhausted deliveries reach the configured count | A valid projection below that count |

`failurePolls` and `recoveryPolls` count consecutive usable observations. Unknown observations break a streak; an unavailable source cannot close its traffic/delivery incidents. Acknowledgment records human ownership but does not change whether the source is failing. A condition can open again as a new incident after a measured recovery.

`windowMinutes` selects the original collector's current minute bucket and preceding buckets. It preserves the original event clocks: completion counts can include requests started earlier. Counts are read directly from those buckets; this product maintains no parallel traffic collector. An observed positive failure can open an incident in a partial session. Clearing a traffic incident requires the observer to have been attached since the selected window began, with no observer errors. On a new session UUID, the watcher resets consecutive coverage state and retains existing incidents. It never subtracts the new counters from the old session. Same-session cumulative counters must not go backwards.

The original `observerErrors` count is cumulative. Any nonzero value keeps `OBSERVER_INCOMPLETE` active for that native session and prevents a traffic incident from claiming complete recovery. Restore a clean original observer/session, then allow its real window to fill. Waiting for an old error to age out of the request buckets does not clear the cumulative observer condition.

The attached original SF98 journal projection supplies the actual backlog counters and capture time. `delivery.required: false` permits a merchant without an attached outbox; a missing projection still cannot resolve an existing delivery incident. Set `delivery: null` to omit that merchant's delivery monitoring entirely. Payment challenges are normal 402 responses and do not trigger an incident. HTTP responses, notification acceptance and original delivery counters are distinct from independent on-chain payment confirmation.

## Acknowledge and follow through

Read actual IDs and revisions from the private status output:

```bash
node "$SF93/incident-cli.mjs" status --state /srv/stellar/operator/incidents
node "$SF93/incident-cli.mjs" ack --state /srv/stellar/operator/incidents \
  --incident ACTUAL_INCIDENT_UUID --revision 1 --by 'Merchant operator' \
  --note-file /srv/stellar/operator/repair-note.txt
```

The optional note file must be private and at most 2,000 bytes. Notes stay in private state/support handoffs. They are never put into hook payloads. The acknowledgment command holds a short original kernel transaction lease, so it works while the watcher is collecting. Its incident revision prevents accidentally acknowledging a different state after a concurrent recovery. The frequently changing overall directory revision is not the operator's concurrency token.

`status --details` includes retained incident signals and notes. The worker fields describe its last recorded process, start, sweep and stop times. A stale `RUNNING` record after a crash is a historical heartbeat, not evidence that its PID still owns a live process. Ownership comes from the kernel lease. If no recent sweep appears, inspect the actual watcher process/service before relying on alert freshness.

After repairing/restarting the original seller or delivery worker, leave the watcher running. Successful native observations close the incident as `RECOVERED`, attach the original follow-up capture and enqueue a recovery notification. The initial session, latest failing session and recovery session remain separate fields. Original traffic completeness rules continue to apply across a restart.

## Notification delivery and destination changes

Payload schema is `stellar-forge.seller-incident-notification.v1`. It contains stable event/incident IDs, the registered merchant ID, condition, transition, current incident status, timestamps, source session and explicitly selected numeric counts. It contains no merchant endpoint, full offer, amount/payee, URL/query/header/body, acknowledgment note or raw network error.

The receiver validates these headers against the exact received UTF-8 body:

```text
x-starforge-event-id: EVENT_UUID
x-starforge-timestamp: UNIX_SECONDS
x-starforge-signature: sha256=HEX_HMAC_SHA256
```

The HMAC input is `timestamp + "." + exactBody`, using the configured environment secret. Apply an appropriate timestamp tolerance and persist deduplication by event ID. Retries keep the same event ID and exact body, with a fresh timestamp/signature. HTTP 2xx records receiver acceptance; acknowledgment is a separate operator action. A lost response can cause a retry after the receiver already accepted the event, so delivery is at least once.

408, 425, 429, 5xx and network/timeout failures retry with bounded exponential delay and bounded `Retry-After`. Other HTTP statuses exhaust the attempt budget; redirects are not followed. Up to four notifications run concurrently after a sweep. Retries occur on an eligible later sweep, so poll cadence can make delivery later than its minimum retry delay. Responses are bounded to 64 KiB and each request has an absolute timeout. After a crash, an in-flight attempt waits out its recorded deadline, retains the unknown-outcome reason and reuses its identity.

Each event pins its original complete source-config digest, exact notification-config digest, environment-reference names, destination ID and resolved canonical endpoint digest. Source labels, poll cadence and merchant policy changes do not move an event to a different receiver. Automatic acknowledgment, retirement and recovery transitions retain the incident's selected destination scope. Changing the notification configuration or the URL behind its environment reference pauses older events. Restoring the same original destination permits an explicit retry. To select the current configured destination for an existing incident, use a new explicit `notify` operation:

```bash
node "$SF93/incident-cli.mjs" notify --state /srv/stellar/operator/incidents \
  --incident ACTUAL_INCIDENT_UUID --revision ACTUAL_CURRENT_REVISION
```

This creates a new reminder event and selects that exact notification scope for the incident's future transitions. It does not rewrite the destination of an older pending event. The command process must have the intended environment values; a missing destination cannot be silently filled later. Signing-key rotation under the same environment reference and destination is supported.

To retry a paused or exhausted event at its same destination, read its actual attempt count and use:

```bash
node "$SF93/incident-cli.mjs" retry --state /srv/stellar/operator/incidents \
  --event ACTUAL_EVENT_UUID --attempts ACTUAL_ATTEMPTS --by 'Merchant operator'
```

A manual retry grants another bounded attempt budget without resetting the total attempt count, event ID or payload. An event already in flight cannot be retried or canceled. Use `cancel` with the same arguments to retire an unwanted pending/paused/exhausted notification, such as an old destination's event after selecting the replacement. An accepted notification is immutable; a deliberate additional message uses `notify`.

## Original support case handoff

The watcher retains an original SF93 four-file packet at a configured cadence and on incident open/recovery. For a complete outage, the baseline is the most recent retained successful capture, with its original timestamp; it is not an invented capture of the unavailable process. Recovery is a fresh original packet. If the watcher had never observed a usable process before the outage, the recovered incident can have only its actual follow-up capture.

Export against an existing private SF74 `.merchant-workspace.json` file and explicitly select one of the captured original route IDs whose method matches that workspace:

```bash
node "$SF93/incident-cli.mjs" export --state /srv/stellar/operator/incidents \
  --incident ACTUAL_INCIDENT_UUID --revision ACTUAL_CURRENT_REVISION \
  --workspace /srv/stellar/operator/merchant.merchant-workspace.json \
  --route dataset --out /srv/stellar/operator/incident-handoff-01
```

The new private directory contains `support-handoff.json`, `support.html`, `runtime-support.json`, the selected `incident.json`, and exact original `before/` and/or `after/` packet files. The existing original SF74 intake validates all packet hashes and scope. Distinct native sessions remain `SEPARATE_SESSIONS`; the handoff does not subtract them or manufacture a combined interval. Incident ID, registration, acknowledgment and dates travel through existing case metadata/notes, preserving the original handoff format.

In the existing SF74 Runtime stage, expand **Open a complete support handoff**, choose `support-handoff.json`, then **Open handoff as new case**. Use the existing **Save case** action to retain it in that application's case directory. No new incident dashboard or second case store is needed.

## Configuration, retention and backup

```bash
node "$SF93/incident-cli.mjs" configure --state /srv/stellar/operator/incidents \
  --config /srv/stellar/operator/watch.json --config-revision ACTUAL_CONFIG_REVISION
node "$SF93/incident-cli.mjs" prune --state /srv/stellar/operator/incidents
```

Configuration changes publish atomically. Results already being collected against an older configuration are discarded. Changes to a merchant's source ports or condition policy retire that registration's active incidents with `CONFIGURATION_CHANGED`, keeping their original captures. Retirement is not measured recovery. Same-source label/capture-cadence changes preserve active incident ownership. An unchanged notification registration can receive the retirement event at the same incident-selected endpoint.

Completed incidents follow the configured day/count retention; active incidents and incidents referenced by unfinished notifications are retained. Terminal notifications have their own retained-count limit. The unfinished queue is capped at 1,024 events. If full, incident work still records its state and exposes `notificationIssue: QUEUE_CAPACITY` plus the cumulative capacity counter; cancel obsolete events or let delivery finish, then explicitly notify the incident. Paused events already occupy a slot, so retrying one does not reserve a second slot.

Capture storage has a configured byte cap, 128 MiB by default. Referenced baseline, follow-up and latest merchant packets are preserved. Unreferenced packets and abandoned writes are collected under the same transaction lease. If a new packet cannot fit, the merchant reports `captureState: STORAGE_LIMIT`; the incident and its metadata still record the failure/recovery, and the missing packet is explicit. Increase the cap or reduce completed-case retention before collecting more evidence. Neither packet bytes nor state are silently truncated.

The private store exclusively owns `state.json`, reserved `state-UUID.tmp` files, its lock subdirectories and the `captures/` namespace (`capture-HASH.json`, `stage-capture-UUID.tmp`). Keep unrelated files elsewhere. Captures and state publish through file fsync, atomic rename and directory fsync; committed references publish before old captures are collected. Referenced capture reads verify content hashes and exact packet encoding. Export reads hold the same transaction lease so collection cannot remove their source mid-read.

For a consistent backup, stop this watcher and pause its operator commands, copy its entire private directory, and preserve file permissions. Reopen the same copied configuration with its original environment references and runtime endpoints. Pending notifications retain their original destination identity. State and exported support files are private merchant operational records.

## Native integration result

The complete operating journey passed on Node 24.19.0 using the original SF30 challenge-only seller, original operations listener and attached empty SF98 outbox. A real seller/ops outage opened one incident; a signed HTTP 503→204 retry retained identical event/body bytes; a separate CLI process acknowledged it. Killing the watcher during an actual hook request and reopening it at a changed receiver paused the old event. Only an explicitly selected new event reached that receiver. Restarting the original seller on the same ports created a second native session and recovered the incident. Clean watcher reopen retained its acknowledgment, and the original SF74 case store imported, saved and reopened both captures as `SEPARATE_SESSIONS`. There were no receiver errors, chain calls or hosted Actions.
