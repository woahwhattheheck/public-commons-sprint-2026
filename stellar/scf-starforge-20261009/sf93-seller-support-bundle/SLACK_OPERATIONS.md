# Merchant incident delivery to Slack

Send original merchant incidents into a selected Slack channel and keep opening,
acknowledgment and recovery messages together. The existing SF93 watcher owns
the seller observations, delivery conditions, incident IDs, attempts, private
state and support handoff.

## Configure the existing watcher

Use an existing Slack application in the selected workspace with `chat:write`
and access to the selected conversation. Use actual workspace and channel IDs;
the transport accepts channel, private-group and existing DM IDs.

Replace only `notification` in the original private watcher configuration:

```json
{
  "id": "merchant-operations",
  "transport": "slack",
  "teamId": "T0123456789",
  "channelId": "C0123456789",
  "tokenEnv": "STARFORGE_SLACK_TOKEN",
  "timeoutMs": 5000,
  "maxAttempts": 8,
  "retryMs": 1000,
  "maxRetryMs": 3600000,
  "minIntervalMs": 1100
}
```

Replace both example IDs. Keep the original schema, merchant registrations,
conditions and retention. Supply the actual token to the watcher's private
process environment through the host credential facility. The configuration
retains its reference name; the token stays in memory and the HTTPS
Authorization header.

Create a new watcher with its original `init` command, or update an existing
watcher using its current configuration revision:

```sh
starforge support-watch status --state /srv/starforge/merchant-watch
starforge support-watch configure \
  --state /srv/starforge/merchant-watch \
  --config /srv/starforge/private/merchant-watch.json \
  --config-revision CURRENT_CONFIGURATION_REVISION
starforge support-watch destination --state /srv/starforge/merchant-watch
starforge support-watch run --state /srv/starforge/merchant-watch
```

`destination` reads Slack's `auth.test` and prints the returned actor/workspace
plus the selected channel. This command sends no message. The token must
resolve to the configured workspace. Delivery performs the same check and
reuses it for at most five minutes in that process. Changing the token
selects a new identity check. The actual message response establishes posting
access and contributes the channel/timestamp receipt.

From a source checkout, replace `starforge support-watch` with
`node stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-cli.mjs`.
The maintained distribution includes this whole original component.

## Follow the original incident

The first accepted transition becomes a channel message. It includes the
original merchant ID, incident ID, condition, state, source times and selected
numeric observations. Later acknowledgment, recovery and reminder transitions
use that incident's retained parent timestamp.

Messages use plain text with markup and link previews disabled. Only the
original notification's selected metadata is formatted; merchant URLs, request
bodies, payment terms, raw errors, credentials and private acknowledgment notes
remain in their original private records.

Acknowledge the actual incident using its original operator controls:

```sh
starforge support-watch status --state /srv/starforge/merchant-watch --details
starforge support-watch ack \
  --state /srv/starforge/merchant-watch \
  --incident ORIGINAL_INCIDENT_ID \
  --revision CURRENT_INCIDENT_REVISION \
  --by 'On-call operator'
```

A Slack reaction or ordinary reply leaves the private incident state unchanged.
The original acknowledgment records accountable ownership; the watcher posts
that transition and its later observed recovery. Its existing SF74 handoff
retains the original before and after captures. See
[Incident operations](INCIDENT_OPERATIONS.md) for export and receiving.

## Ordering, receipts and recovery

The fixed delivery endpoint is
`https://slack.com/api/chat.postMessage`. The sender checks the JSON `ok`
value and returned channel/timestamp. HTTP 200 with a Slack error remains a
failed attempt. A saved `providerReceipt` contains the authenticated actor,
workspace, channel, message timestamp and parent timestamp. Both original
status views expose it with the event ID, attempt count and delivery reason.

One Slack request is admitted for the selected channel at a time, with at
least one second between admissions. The private state retains the channel's
next allowed send time. Later transitions for an incident wait behind its
earlier unfinished event. Delivery, explicit cancellation or exhaustion of
that event allows the next transition to proceed.

HTTP 429, Slack rate-limit errors, transient provider errors and interrupted
responses reuse the original event and retry schedule. The channel retains
the full provider `Retry-After`, including after restart. `maxRetryMs` caps
the ordinary exponential delay; a longer provider wait is preserved.
Authentication, workspace, permission and invalid-channel failures exhaust the
affected event. Correct the actual configuration/access, inspect that event,
and use the original explicit `retry` operation when its original destination
is selected.

Each event pins its thread before its first request. An uncertain response
or restart reuses the same thread, event ID, `client_msg_id` and message
body. Delivery is at least once: a connection can fail after Slack accepts
a message. The visible event ID identifies repeats, and the original event
remains the unit for retry or cancellation.

The incident retains its parent receipt after older completed notifications
are pruned. A long-running incident therefore keeps its original thread.
Existing incident and capture retention continue to apply.

## Change destinations

Workspace/channel IDs, token reference name, notification settings and resolved
destination participate in the original destination binding. Changing them
keeps older events attached to their original selection. The existing queue
pauses an older event when that selection is unavailable.

To notify an existing incident at a newly selected destination, use the original
`notify` command with the current incident revision. That explicit event starts
its thread in the selected channel; subsequent automatic transitions follow
that scope. A late response from an already-started old request retains its old
receipt and cannot replace the current thread selection.

A token rotation through the same environment reference retains the selected
workspace and channel. The new token undergoes the actual identity check.

## Existing Linux service manager

Update an existing watcher service's credential environment and command. For
a new host service, this example runs the original foreground watcher; replace
its account and absolute source paths with the selected installation:

```ini
[Unit]
Description=Stellar Forge merchant incident notifications
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=starforge
WorkingDirectory=/srv/starforge
EnvironmentFile=/srv/starforge/private/merchant-watch.env
ExecStart=/usr/bin/node /srv/starforge/source/stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-cli.mjs run --state /srv/starforge/merchant-watch
Restart=on-failure
RestartSec=10
TimeoutStopSec=45
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Select the actual installed source entry from the original release manifest.
Restrict the credential file to its responsible service account. The original
kernel lease protects the watcher state from a second owner. SIGTERM finishes
the active state write and releases that lease. Reopening the same directory
continues its queued attempts, channel wait, incident threads and receipts.

## First-party interfaces

- [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/): JSON messages, channel IDs, thread parents, response and errors.
- [Slack auth.test](https://docs.slack.dev/reference/methods/auth.test/): authenticated actor and workspace.
- [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/): channel pacing and `Retry-After`.

These interfaces were read on October 12, 2026.

