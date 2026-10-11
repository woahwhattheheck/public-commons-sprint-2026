# Merchant route availability

Pause selected products while the rest of a merchant keeps serving requests.
The original seller checks availability before the payment and backend path.
New requests to a paused route receive `503 SELLER_ROUTE_PAUSED`; work already
admitted to the original handler is allowed to finish. The operator desk shows
which routes are paused and how many requests are still finishing.

The private policy persists across restarts. The original route IDs, methods,
offers, prices and discovery metadata remain visible, so a temporary pause does
not require editing the product catalog. Resume the same IDs when they are ready.

## Start the seller and its operator desk

Use the maintained operations launcher and add `--availability-dir` to the
original seller options after the separator:

```bash
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" --operations-port 8424 -- \
  --config /srv/merchant-a/seller.json --port 8423 \
  --availability-dir /srv/merchant-a/availability
```

For an existing API merchant, select the original upstream launcher:

```bash
node "$S/operations/launch.mjs" --upstream --operations-port 8424 -- \
  --config /srv/merchant-a/seller.json \
  --upstreams /srv/merchant-a/upstreams.json --port 8423 \
  --availability-dir /srv/merchant-a/availability
```

Retain the merchant's usual facilitator, handler and runtime options. Both
original seller launchers accept this availability option. The policy directory
must be a private absolute path with mode `0700`; a new directory is created
with that mode. Use one directory per merchant and reuse it when restarting the
same service origin. Its policy and writer lock use private files.

For production or a restart that changes the listening port, retain a stable
`publicOrigin` in the seller configuration. A local configuration without
`publicOrigin` binds its policy to the actual listener origin, so reuse the
same explicit `--port` on restart; `--port 0` selects a different origin and
cannot reopen that existing policy.

Availability is opt-in and requires Linux `flock`. The running seller keeps the
writer lease through its normal request drain. A second seller opening the same
directory receives `AVAILABILITY_ALREADY_OWNED`, so operator commands always go
through the active service. A service-origin mismatch also requires the correct
merchant directory rather than silently importing another service's pauses.

Startup prints `availability`, the local desk URL, and `availabilityControl`,
the private control URL. Opening the latter enables the desk's pause/resume
controls. `startSellerOperations()` exposes these as `availabilityUrl` and
`availabilityControlUrl`; controls are enabled when the attached seller has
availability configured. No additional launcher control flag is needed.

## Inspect, pause, and resume from the command line

First read the route IDs, current revision and request counts:

```bash
node "$S/availability/cli.mjs" status --url http://127.0.0.1:8424
```

Set `SELLER_AVAILABILITY_URL` in the operator environment to this session's
startup `availabilityControl` value. The CLI extracts its fragment into the
control header and sends requests only to the local operations API. It does not
print the fragment. `--url-env` keeps the private URL out of the command itself.

After reviewing the displayed revision and selected routes, issue the change:

```bash
node "$S/availability/cli.mjs" pause --url-env SELLER_AVAILABILITY_URL \
  --revision 0 --route catalog_read --route export_download \
  --reason 'Upstream maintenance'
```

Replace the example revision and route IDs with those in the actual status
response. A successful change returns the newly saved revision and current
route state. Refresh status to see admitted work finish. Resume uses the same
explicit revision check:

```bash
node "$S/availability/cli.mjs" resume --url-env SELLER_AVAILABILITY_URL \
  --revision 1 --route catalog_read --route export_download \
  --reason 'Service restored'
```

One change accepts up to **100 distinct route IDs** and one action. Reasons are
optional, apply to the entire selected change, and allow up to 160 characters.
The CLI also accepts a local base URL with `--token-env NAME` when the dedicated
control token is already available separately in the operator environment.
Use exactly one token source.

`--json` produces structured output for shell tools. `--timeout-ms` changes the
request deadline from its 10-second default to a value from 1 through 30,000 ms.
The client accepts canonical `http://127.0.0.1:PORT` or
`http://localhost:PORT` URLs, pins localhost connections to IPv4 loopback,
rejects redirects, and limits a JSON response to 1 MiB.

## Concurrent changes and restart behavior

Every pause/resume requires the revision that the operator reviewed. If another
operator changes availability first, the service returns HTTP 409. The CLI
prints the latest available snapshot and exits with code 3. Review that state
and explicitly issue the desired change with its revision. The rejected change
is never replayed automatically.

After a network interruption or request timeout, inspect status before issuing
another change: the seller may have saved a revision before the response was
lost. A successful policy update is written, flushed, atomically renamed and
flushed to its private directory before normal completion. Each revision keeps
a compact recent change history containing the action, IDs, time and reason.

Saved pauses survive restarts. If a paused route is removed from the current
catalog, the operator view lists its retained pause separately. That ID stays
paused if the product returns later. To deliberately clear it, use `resume`
with the retained ID and current revision. A new pause always requires a route
in the current merchant.

| State | Meaning for the operator |
| --- | --- |
| `selling` | New requests enter the original route handler. |
| `pausing` | The route rejects new requests while previously admitted work finishes. |
| `paused` | The route rejects new requests and has no in-flight work. |
| `storage_unavailable` | The private policy encountered a storage error; new route requests stay closed while the operator restores storage. |

`inFlight`, `admitted` and `rejected` count the route's HTTP admission lifecycle.
In-flight work remains counted until both the response and its native handler
finish. These counters reset with the seller process; the saved pause policy
and change revisions persist. The existing seller shutdown grace period still
governs process drain.

## API and embedding

The operations service owns these endpoints:

| Method and path | Input and result |
| --- | --- |
| `GET /api/availability` | Current `stellar-forge.seller-availability.v1` snapshot, including `controlsEnabled`. An unconfigured seller returns `available:false`. |
| `GET /api/availability/export` | Download of the current snapshot from the private operator service. |
| `POST /api/availability/change` | JSON `{expectedRevision, action, routeIds, reason?}`; returns the saved snapshot. Requires the current loopback `Origin` and `x-merchant-availability-token`. |

Programmatic seller startup accepts `availabilityDirectory` in
`startSellerService()`. The resulting `session.availability` supplies
`snapshot()`, `update({expectedRevision, action, routeIds, reason?})` and
`close()`, and is composed by the original request dispatcher. The normal
`session.close()` closes availability after native work drains. Attach the
existing `startSellerOperations(session)` to give the same policy its private
operator desk and command API.

The CLI exports
`runAvailabilityCLI(argv, {env, stdout, stderr, signal})`, returning a numeric
exit code. Importing it sends no request. Exit codes are `0` for a completed
command, `1` for service or transport failure, `2` for invalid command input,
`3` for a revision conflict, `4` for an unconfigured availability service, and
`130` for an interrupted request.
