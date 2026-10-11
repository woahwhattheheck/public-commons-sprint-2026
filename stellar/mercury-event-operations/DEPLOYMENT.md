# Run the customer workspace as a service

The same Mercury application runs the HTTPS-facing webhook listener, operator interface and one delivery worker. The included [systemd unit](deploy/mercury-ops.service) connects that lifecycle to the host's service supervisor. It restarts after a worker failure, preserves the original workspace, and gives admitted HTTP requests and the current delivery a shared shutdown grace period.

## Place the existing source and private workspace

Use a Linux host with Python 3.11 or later, systemd and the customer's existing HTTPS reverse proxy. These example paths correspond to the supplied unit:

| Item | Path | Access |
| --- | --- | --- |
| Released application source | `/opt/mercury-event-operations` | Readable by the service; deployment identity owns changes |
| Selected Python environment | `/opt/mercury-runtime` | Readable by the service; optional PostgreSQL driver is installed here |
| Original configuration and operations database | `/var/lib/mercury-operations` | Private directory owned by `mercury` |
| Selected literal credential file | `/etc/mercury-operations/secrets.env` | Owned by `mercury`, mode `600` |
| Unit | `/etc/systemd/system/mercury-ops.service` | Deployment administrator |

Use the customer's existing service identity when available and update `User` and `Group` consistently. For a new installation, the deployment administrator can create the identity and directories:

```sh
useradd --system --home-dir /var/lib/mercury-operations --shell /usr/sbin/nologin mercury
install -d -o mercury -g mercury -m 700 /var/lib/mercury-operations
install -d -o mercury -g mercury -m 700 /etc/mercury-operations
```

Create the explicit Python environment used by the unit, using the host's Python 3.11 or later:

```sh
/usr/bin/python3 -m venv /opt/mercury-runtime
/opt/mercury-runtime/bin/python --version
```

Place the complete released application under `/opt/mercury-event-operations`. From that directory, initialize a **new** customer workspace with its original CLI:

```sh
runuser -u mercury -- /opt/mercury-runtime/bin/python -B -m mercury_ops init /var/lib/mercury-operations --network mainnet
mv /var/lib/mercury-operations/secrets.env /etc/mercury-operations/secrets.env
```

Retain the generated operator token in the customer's normal credential custody. Populate the actual Mercury JWT and webhook secret in that file; edit the actual provider account label, contracts, optional topic predicates and destination in the existing configuration. The application parses the selected credential file itself as literal `NAME=value` lines. Do not put credential values in the unit or command line.

For an already operating workspace, retain its existing files and source/destination binding. Update the unit's paths to that workspace instead of initializing it again. [Portable recovery](README.md#export-and-portable-recovery) is the existing way to relocate a retained workspace from its archive. PostgreSQL and external HTTP/SQLite destinations retain their original customer endpoint and separate backup procedure.

For PostgreSQL, apply the migration in [POSTGRES.md](POSTGRES.md) and install its optional driver in the exact same environment used by `ExecStart`:

```sh
/opt/mercury-runtime/bin/python -m pip install 'psycopg[binary]==3.3.6'
```

SQLite and HTTP do not need that package. If the customer already has a selected Python environment, use its exact executable consistently in these commands and the unit. If libpq uses a service file, set its explicit `PGSERVICEFILE` in the private environment and keep that file readable by the service. The unit makes home directories unavailable; use the selected credential/certificate paths rather than a developer's home directory.

## Attach the existing HTTPS endpoint

Edit `mercury-ops.example.com` in the supplied unit to the exact hostname the customer will use. Its listener remains on `127.0.0.1:8787`. The existing reverse proxy must forward that same `Host` and the original request path. It must preserve the webhook's body bytes, `X-Mercury-Signature`, optional `X-Mercury-Timestamp`, and the operator's bearer authorization.

Forward a known `Content-Length` to the application. Its original ingress deliberately rejects chunked or ambiguous lengths. A proxy that accepts streamed incoming bodies should buffer them and forward the resulting complete body with its length; JSON parsing or reserialization would change the bytes authenticated by Mercury. Set the proxy's body limit to the selected `max_body_bytes` and use its normal connection and request timeouts. The application serves one response per backend connection and sends `Connection: close` so idle keep-alive sockets do not reserve the complete handler capacity.

The public webhook route remains `/webhooks/mercury`; the operator UI remains `/`. `--allowed-host` and `--behind-https-proxy` bind the existing host/origin checks to the chosen HTTPS site. Provider and customer credentials remain in the service process.

Install the edited unit and start it:

```sh
install -m 644 deploy/mercury-ops.service /etc/systemd/system/mercury-ops.service
systemd-analyze verify /etc/systemd/system/mercury-ops.service
systemctl daemon-reload
systemctl enable --now mercury-ops.service
systemctl status mercury-ops.service
```

The unit uses `Type=exec`: executable startup is separate from application readiness. Check the original listener with the selected hostname:

```sh
curl --fail --silent --show-error -H 'Host: mercury-ops.example.com' http://127.0.0.1:8787/healthz
```

A running owned worker returns `200` with `{"ready":true,"worker":"running"}`. This endpoint reports only process readiness and needs no operator token. It does not assert that external provider credentials or a customer database currently work. The authenticated `/api/status` and operator Overview retain those configured readiness flags and actual task/delivery states. HTTP status also includes admitted connection count, maximum and whether the listener is draining. An application that embeds the existing `make_server` without the CLI reports its worker as `externally_managed`.

## Admission, failure and shutdown

The service options describe actual process resource and shutdown behavior:

| Option | Default | Behavior |
| --- | --- | --- |
| `--max-connections` | `16` | Maximum simultaneous HTTP handler connections, from 1 to 128 |
| `--http-timeout` | `30` seconds | Timeout for a socket read or write, from 1 to 600 seconds |
| `--shutdown-timeout` | `60` seconds | Shared grace for HTTP handlers and the current worker operation, from 1 to 600 seconds |

The handler bound applies before allocating a request thread or parsing credentials. When all slots are occupied, or shutdown has begun, a newly accepted connection receives `503` with `Retry-After: 1` and is closed. No webhook is acknowledged or queued through that rejected connection. The sender can retry the same original request. Use the customer's existing retained ledger catch-up workflow to reconcile its delivery interval when recovering a longer outage.

Choose connection capacity together with `max_body_bytes`, expected exports and available memory. For example, 16 simultaneous maximum-size 1 MiB bodies can hold roughly 16 MiB of body bytes in addition to JSON objects, responses, Python and database memory. A socket timeout is an I/O wait bound, not an overall request duration; configure the public proxy's corresponding request deadline.

If the owned worker raises an unhandled error or exits unexpectedly, the listener stops admitting work, existing handlers drain, and the process exits unsuccessfully. `Restart=on-failure` restarts that same source/configuration after five seconds. Normal provider/customer failures continue through the engine's existing retained task retry behavior; they do not cause a service restart. Five failed starts within a minute trigger systemd's configured start limit, preserving the last error for the operator to correct.

`SIGTERM`, `SIGINT` and `systemctl stop` stop admission and allow the current operations to finish. The HTTP handlers and worker share the selected grace period. At its deadline the application closes its remaining sockets, reports the unfinished work and exits unsuccessfully instead of hanging indefinitely. The next startup calls the original engine recovery: accepted webhook transactions remain committed, original delivery keys are reused, and an ambiguous non-idempotent customer outcome remains in its existing reconciliation state.

The unit's `TimeoutStopSec=75` gives the application's 60-second grace time to complete. Keep the supervisor's termination timeout longer than the selected application grace. `KillMode=control-group` keeps the complete service process group attached to that lifecycle. A normal administrator-requested stop does not restart the unit.

## Operate, update and recover

Read the original process output and operator view together:

```sh
journalctl -u mercury-ops.service --since today
systemctl show mercury-ops.service -p ActiveState -p SubState -p ExecMainStatus -p NRestarts
```

The application prints its sanitized configuration and stable worker error classification; it does not log incoming request headers or bodies. The retained workspace continues to hold the original provider observations, event envelopes, attempts and customer results. Inspect or retry those through the existing operator UI/CLI.

Before replacing released source, stop this service, create the existing joined workspace backup with the same configuration and credentials, and retain the prior source revision. Place the new complete revision at the configured source path, then start the same unit and read `/healthz` plus its original delivery state. Rolling source back uses the prior compatible application revision and the same retained workspace; do not erase queued tasks or initialize a replacement customer binding.

The supplied unit permits writes under `/var/lib/mercury-operations`, including the default internal SQLite customer table and operator export spool. Put service-created exports there or add the customer's explicit export directory to `ReadWritePaths`. An external SQLite destination also needs its configured parent directory allowed for its database and journal files. Provider/customer network access remains available; source and other system paths remain read-only to the service.

After fixing a repeated startup error, restart the original unit:

```sh
systemctl reset-failed mercury-ops.service
systemctl start mercury-ops.service
```

Keep the original credentials, source scope and delivery destination with that workspace throughout recovery. A separately configured customer workflow gets its own workspace and service instance.

## Runtime references

- [Python server lifecycle and request handling](https://docs.python.org/3/library/socketserver.html)
- [systemd service startup, restart and termination](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [systemd execution directories and filesystem access](https://www.freedesktop.org/software/systemd/man/systemd.exec.html)
- [Original Mercury setup and recovery](README.md)
- [Original task and delivery recovery](ENGINE-OPERATIONS.md)
