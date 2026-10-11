# Continuous merchant delivery

The original SF98 outbox can now run continuously on a merchant's Linux host.
The worker discovers newly journaled events, sends the original signed webhook,
waits until persisted retries are due, and catches up after a restart. Manual
`drain` and `requeue` commands share the worker's exclusive delivery lock.
The existing seller keeps recording events independently of the sender.

## Run the original service

Requirements are Node 22+, Linux with util-linux `flock`, the complete original
source import closure, and the merchant's existing private SF98 outbox on a
**local filesystem**. The seller and worker need access through the same local
service account. Keep the directory at 0700 and journal files at 0600. Network
filesystems and multiple hosts sharing an outbox are outside this service's
ownership contract.

The original seller must already use `instrumentNativeSettlement` and record
its actual native successful payment results. Starting this worker creates no
payment, wallet, event, order or customer entitlement.

Supply an existing approved receiver URL, its exact hostname, and a shared
32–1024-byte HMAC key through private environment storage. Then start:

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/worker.mjs run \
  --state /var/lib/stellar-merchant/sf98 \
  --url https://merchant.example/internal/x402-events \
  --allow-host merchant.example \
  --secret-env SF98_WEBHOOK_SECRET
```

Replace the example host with the merchant's actual approved host. The key is
read from the named environment variable; its value never belongs in a command
argument, repository, webhook URL or output. The existing public-HTTPS, DNS
pinning, TLS hostname checks, HMAC payload and idempotency key remain in use.
The deadline covers DNS lookup, connection and response headers. Response
bodies are unnecessary for acceptance and their sockets are closed promptly.

| Option | Default | Meaning |
| --- | ---: | --- |
| `--limit` | 20 | Maximum eligible events in one pass, from 1 to 100 |
| `--concurrency` | 1 | Simultaneous distinct-event requests, from 1 to 16 |
| `--poll-ms` | 5000 | Maximum delay before observing new events, from 50 to 60000 ms |
| `--timeout-ms` | 7000 | Deadline per attempt, from 100 to 60000 ms |

Ready events continue in successive passes without waiting for the polling
interval. A future retry wakes the worker at the earlier of its due time or
the next poll. Retry attempts and their timestamps come from the original
delivery journal; restarting does not reset the eight-attempt budget or
30-second-to-30-minute exponential backoff. Exhausted events remain visible.
The worker stays active when the queue is empty and picks up the seller's next
original event.

Concurrency 1 preserves the original sender's request-start order. A higher
setting is useful for receivers that independently and atomically handle each
event ID. Concurrent events can finish in a different order. Events sharing a
business order still require the receiver's own transaction/entitlement rules.
All attempt appends are serialized even when HTTP requests run concurrently.

## Inspect, stop and recover

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/worker.mjs status \
  --state /var/lib/stellar-merchant/sf98
```

Status includes actual kernel lock occupancy, the current or previous owner,
the original queue totals, and the last worker checkpoint. The checkpoint
records process-level activity, counts, last update, next wake time and
RUNNING/STOPPED/FAILED. It contains neither the webhook key nor its URL. A
checkpoint marked RUNNING with `deliveryOwner.active: false` is a previous
interrupted run, not a live sender. `worker-state.json` is replaceable operating
state; `events.ndjson` and `deliveries.ndjson` remain authoritative.

SIGTERM and SIGINT stop new attempts and interrupt a sleeping or network-waiting
worker. An interrupted request that may have reached the receiver is persisted
as a normal retry. An operator stop during DNS, before sending, does not spend
an attempt. In-flight journal writes finish before releasing ownership. A
successful shutdown writes STOPPED and releases the kernel lock.

Node's OS-backed DNS lookup cannot cancel its underlying getaddrinfo call.
The worker stops awaiting it at the deadline, but a stalled OS call can keep
the process alive after STOPPED. The supplied systemd unit enforces a
20-second stop deadline for that case.

Linux releases the lock when the process dies, including SIGKILL. The next
worker can open the same outbox immediately and resume the retained journal.
No TTL, PID-age guess, lease stealing, manual lock deletion or queue reset is
needed. Never unlink `.sf98-delivery.lock` while a sender is active: its inode
is the shared synchronization point, and the service checks that it remains
the same file. See the Linux [flock(2) contract](https://man7.org/linux/man-pages/man2/flock.2.html)
for inherited open-file-description ownership.

A second worker, manual `drain`, or manual `requeue` fails with
`SF98_DELIVERY_BUSY`. `worker.mjs` exits 75 for this condition. Stop the current
worker before maintenance, then use the existing named-event command:

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/deliver.mjs requeue \
  --state /var/lib/stellar-merchant/sf98 \
  --id ORIGINAL_64_HEX_EVENT_ID
```

Requeue only after repairing the failed receiver or its enrolled order. Restart
the service to deliver that event. A successful HTTP response still means
receiver acceptance, not independently confirmed chain payment or completed
fulfillment. A crash after receiver acceptance and before the sender's durable
DELIVERED record can resend the same event ID. The receiver must retain its
idempotency and atomic order rules.

The exported `drainOnce(outbox, options)` automatically acquires the same lock.
Embedders that already own a lease can pass it as `options.lease`. Use
`withDeliveryLease(outbox.dir, operation, {purpose: 'requeue'})` for direct
programmatic maintenance. The low-level `outbox.requeue()` remains a journal
primitive; callers must enter that ownership boundary. Do not run unmodified
older sender copies against an active new worker.

## Install as a Linux service

`sf98-delivery.service` is an installable systemd unit. Adjust the existing
merchant service account, checkout path, Node executable and state directory
to the deployment. The supplied unit assumes:

- Source at `/opt/stellar-forge`, with Node 22+ at `/usr/bin/node`.
- Existing seller account `stellar-merchant` and outbox
  `/var/lib/stellar-merchant/sf98`, accessible to that account at 0700.
- A private `/etc/stellar-merchant/delivery.env` readable by the service, with
  `SF98_WEBHOOK_URL`, `SF98_WEBHOOK_HOST` and `SF98_WEBHOOK_SECRET` set to the
  approved receiver configuration. Restrict the file to 0600.

Install the reviewed unit through the merchant's existing deployment process,
then enable and start `sf98-delivery.service`. It runs unprivileged with a
read-only system, a private temporary directory, and writes limited to the
outbox. A crash restarts after five seconds. Lock conflict exits do not restart
in a loop. Inspect service logs and `worker.mjs status` together. The service
unit does not install packages, provision hosting, change the seller or incur
GitHub Actions usage.

For upgrades, stop this sender, retain the existing journals and key, update
the original source, and start it again. Keep seller event recording running
unless the separate seller/database migration requires a coordinated stop.
For backup and restoration, use the existing merchant recovery procedure and
quiesce the relevant writers; a sender checkpoint is not a payment backup.

## Connect the shipped merchant receivers

The same sender works with the original SF98 native receiver, SF101 private
file fulfillment receiver, and the WooCommerce order integration. Configure
the public reverse proxy for the receiver already selected by the merchant;
the worker does not open a new receiving port or change order enrollment.
The WooCommerce integration uses `/wp-json/stellar-forge/v1/settlement`.
A receiver's 202 acceptance and a 200 idempotent replay both count as accepted
HTTP delivery. Actual chain reconciliation, selected payment terms, order
binding, entitlement and release remain that original receiver's responsibility.

This service is pre-award operational software for the existing paid API/data
deployment workflow. Its local acceptance exercises the original outbox and
sender with a real TLS receiver, process contention, retry and restart; it
does not assert a real customer payment or a deployed commercial service.
