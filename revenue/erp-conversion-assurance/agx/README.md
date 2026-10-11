# Reconciliation over AGX

This adapter makes the existing [retained reconciliation service](../service/README.md)
callable through the published AGX transport. An operator stages the complete
source export, target export and mapping once, assigns the job to a specific AGX
peer, and returns a small request containing its job and bundle identities. That
peer can submit the job, follow its status and receive the complete exact report.
The original service also handles reviewer decisions, correction runs, recovery
and private replay exports.

The adapter uses `@nostr-agx/cli` **0.3.0** and its real encrypted task transport.
The same service and original `reconcile.mjs` run behind local operator commands
and remote capabilities. The complete report retains every discrepancy found by
the original fixed-point comparator.

## Install and run the complete local example

Use Linux, Node.js 22 or newer, npm, and the system `flock` command. Keep the
repository's source closure: this directory, `../service/`, `../reconcile.mjs`,
and `stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs`.
Install the pinned packages from this directory:

```sh
cd revenue/erp-conversion-assurance/agx
npm ci --ignore-scripts --no-audit --no-fund
node native-journey.mjs --out /absolute/private/new-agx-example
```

The output directory must be new and its parent must exist. The example starts
the original loopback relay on a free port, creates two disposable AGX profiles,
persists that relay in both profiles and allowlists the caller. It then:

1. Stages 120 fictional balances under the actual service and binds the job to
   the caller's authenticated public key.
2. Invokes `finance.reconcile` through the published CLI, follows the queued
   job, and downloads the complete discrepancy report in multiple encrypted
   chunks. All 120 one-cent differences must be present.
3. Records a named `changes_requested` review through the original operator.
4. Restarts the provider, repeats the same job, retrieves the same report bytes
   and checks that the service retained one engine attempt.
5. Stages the corrected target as a new bundle and job, receives its `PASS`
   report and records the example acceptance.
6. Submits two 50,000-row matched jobs together through the same native provider,
   reads an older completed job at the same time, and retrieves both completed
   reports. The journey records the actual admission states.
7. Exports the complete private replay package through the original operator.

The example retains `journey.json`, the two profiles, private relay/provider
logs, request files, original service state, downloaded reports and replay
package. It stops the relay and provider processes it started. The input files
are generated explicitly as fictional examples; replace them with the actual
authorized exports and agreed mapping for customer work.

The complete example executed successfully on October 11, 2026 with Node.js
24.19.0 and the pinned AGX 0.3.0 packages. It transferred a 29,508-byte report in
four chunks, preserved its digest across provider restart with one engine
attempt, completed the corrected `PASS` and both 50,000-row queued jobs, and
replayed the 14-file export with `matchesDeliveredReport: true`. The composed
service source for that run was Git blob
`47fd1520743212bb773ff0607742f22264073f9c`.

## Provider setup

Keep AGX identity state and customer data outside the source checkout, in
directories owned by the operating-system account running the service. The
commands below use absolute example paths; create their parent directory first.

```sh
umask 077
install -d -m 700 /absolute/private/agx-home
export AGX_HOME=/absolute/private/agx-home

./node_modules/.bin/agx identity new --profile provider
./node_modules/.bin/agx config set relays wss://YOUR_RELAY --profile provider
./node_modules/.bin/agx identity show --profile provider --json
```

Use the caller's actual AGX public identity. `identity show --json` emits `npub`
and `pubkey`; the adapter's local `--peer` argument uses the full 64-character
lowercase hexadecimal `pubkey`. The published CLI allowlist accepts its `npub`.
Existing profiles can be reused without generating another identity.

```sh
./node_modules/.bin/agx identity allow CALLER_NPUB --profile provider

node cli.mjs init \
  --root /absolute/private/reconciliation-agx \
  --peer CALLER_HEX

node cli.mjs stage \
  --root /absolute/private/reconciliation-agx \
  --peer CALLER_HEX \
  --job conversion-run-1 \
  --source /absolute/private/incoming/source.csv \
  --target /absolute/private/incoming/target.csv \
  --spec /absolute/private/incoming/mapping.json \
  --request-out /absolute/private/conversion-run-1.request.json
```

`init` creates an independent original service at
`ROOT/peers/CALLER_HEX/service`. Each peer has its own configuration, HMAC key,
bundles, job queue and worker lease. It accepts the original service's
`--max-input-bytes`, `--max-report-bytes`, `--timeout-ms` and `--max-heap-mib`
settings. Reopening the same peer uses its retained configuration; different
explicit limits produce the service's configuration-mismatch error.

`stage` uses the service's own stable-file copy and hash validation. Its private,
create-only binding associates the caller, job ID and immutable bundle ID.
Repeating identical staging reuses the binding. Changed inputs require a new
job ID. The exact request file is:

```json
{
  "jobId": "conversion-run-1",
  "bundleId": "the-complete-lowercase-sha256-returned-by-stage"
}
```

Give the authorized caller this request file and the provider's public identity.
The operator retains the full inputs and original mapping. Start the provider
from this directory, with its output directed to a private log:

```sh
ERP_AGX_ROOT=/absolute/private/reconciliation-agx \
  ./node_modules/.bin/agx serve \
    --profile provider \
    --handler ./handler.mjs \
    --no-reply \
    > /absolute/private/provider.log 2>&1
```

The published CLI calls each custom handler as `handler(payload, task)` and
supplies authenticated `task.from`. It first applies the provider profile's peer
allowlist. The adapter then selects that peer's existing private service and
checks the explicit job/bundle binding. Payloads cannot select a filesystem path,
customer root, peer, engine, key, mapping or report destination. Unknown fields
are rejected.

AGX CLI 0.3.0 logs allowed task payloads and returned output, including report
chunks. The private log therefore has the same custody requirement as the full
report. Its `--advertise` option explicitly publishes an Agent Card and relay
list; the example and provider command above use ordinary configured relays.

## Caller: submit, follow and receive

The caller keeps its own AGX profile and configures a relay shared with the
provider. For the local example, both profiles store the same
`ws://127.0.0.1:PORT` relay. The adapter's child CLI process uses only its explicit
`AGX_HOME` and stored profile settings, so set relays on that profile rather than
relying on an inherited `AGX_RELAY` override.

```sh
AGX_HOME=/absolute/private/caller-agx-home \
  ./node_modules/.bin/agx config set relays wss://YOUR_RELAY --profile caller

node cli.mjs fetch \
  --peer PROVIDER_NPUB \
  --profile caller \
  --agx-home /absolute/private/caller-agx-home \
  --request /absolute/private/conversion-run-1.request.json \
  --out /absolute/private/new-conversion-run-1-delivery \
  --execute
```

`--execute` invokes the original queued service. The caller follows pending jobs
through `finance.reconcile.status` and retrieves the complete report through
`finance.report`. Omit `--execute` to reconnect to an already submitted job.
The new delivery directory contains:

| File | Meaning |
|---|---|
| `report.json` | The exact complete original report bytes |
| `result.json` | The original job result and input/report identities |
| `request.json` | The exact job/bundle request used |
| `delivery.json` | Provider identity, received byte count, complete SHA-256 and receipt time |

Every chunk is bound to the job, bundle, report SHA, requested byte offset and
recorded total size. The caller validates canonical base64, exact continuity and
the final SHA-256 before publishing `report.json`. A transfer error removes only
that invocation's newly created partial delivery directory. An existing output
directory is preserved and rejected; choose a new destination when reconnecting.

Per-request timeout defaults to 30,000 ms (`--timeout-ms`). The complete job wait
defaults to 180,000 ms (`--wait-ms`). A wait timeout returns the latest retained
job with `clientWait.timedOut: true`; reconnect with the same request. The
service's engine time and memory limits govern the actual computation.

## Capabilities and response meaning

| Capability | Exact payload | Result |
|---|---|---|
| `finance.reconcile` | `jobId`, `bundleId` | Original `erp-reconciliation.job.v1`; accepts/reuses the fixed job |
| `finance.reconcile.status` | `jobId`, `bundleId` | Same original job schema and its current state |
| `finance.report` | `jobId`, `bundleId`, `reportSha256`, optional `offset`, optional `length` | `erp-reconciliation.report-chunk.v1` with one authorized exact range |

`length` is 1–8192 bytes; omitted values use the service's 8192-byte default.
`nextOffset` is always `offset + bytes`, including the final chunk. `done: true`
marks EOF. The encoded response fits the published core's 27,400-character
initial outbound message budget. The caller accepts complete reports up to
128 MiB; configure larger service report limits only with a delivery client that
supports that size.

The native CLI emits `{ok, capability, result}`. Its transport verifies sender
and task correlation before the adapter consumes that result. Protocol
completion means the queued submission, status lookup or report request
returned. The original job's `state` describes the computation:

| State | Meaning |
|---|---|
| `QUEUED`, `RUNNING` | Retained request is awaiting or using its original worker |
| `COMPLETED` | Complete report retained; `result.status` is `PASS` or `FAIL` |
| `FAILED`, `INTERRUPTED`, `CANCELLED` | Inspect the original error/state and use the operator workflow |

An adapter rejection uses `erp-reconciliation.agx-error.v1`, `state: REJECTED`
and a concise error code. A service execution failure and a completed discrepancy
report remain distinct. `fetch` exits 0 for `PASS`, 2 for a completed `FAIL`, and
1 for transfer errors, failed jobs or an unfinished wait.

The provider retains four recent peer service handles. Each uses the original
service's one-report verification cache, so sequential chunks reuse verified
bytes. The bindings and private directory/configuration checks are still read
for each authorized request. Each customer root processes one original job at a
time; different peers share the host's available CPU, memory and disk.

## Review, corrections and full private handoff

Use `operate --` to address the same peer's original operator. It forwards
arguments directly to `service/operator.mjs` with the selected service directory.

```sh
node cli.mjs operate \
  --root /absolute/private/reconciliation-agx --peer CALLER_HEX -- \
  status --job-id conversion-run-1 --wait

node cli.mjs operate \
  --root /absolute/private/reconciliation-agx --peer CALLER_HEX -- \
  review --job-id conversion-run-1 \
  --report-sha256 EXACT_REPORT_SHA256 \
  --reviewer "Actual reviewer name" \
  --decision changes_requested \
  --note "Describe the reviewed differences and required correction."
```

Correct the actual source export, target export or mapping, then stage a new
job such as `conversion-run-2` and send its new request. The first job, complete
report and review remain available. Record `accepted` against the corrected
report's exact digest when the authorized reviewer has completed their review.

```sh
node cli.mjs operate \
  --root /absolute/private/reconciliation-agx --peer CALLER_HEX -- \
  export-replay --job-id conversion-run-2 \
  --destination /absolute/private/new-complete-replay

node cli.mjs operate \
  --root /absolute/private/reconciliation-agx --peer CALLER_HEX -- \
  reviews --job-id conversion-run-2
```

The original operator's [guide](../service/README.md) documents the complete
replay export, local report-only export, pagination, cancellation and recovery.
The replay package includes the original inputs, mapping, retained engine,
HMAC custody and completed report/review relationships needed to reproduce the
comparison. A new engine invocation records a new `generated_at`; the original
delivered report SHA remains its exact delivery identity.

## Original sources

- [AGX official guide](https://docs.ellaworks.ai/agx)
- [Original cross-organization example](https://docs.ellaworks.ai/agx-elladex-example)
- [Original exchange security documentation](https://docs.ellaworks.ai/agx-elladex-security)
- [Official AGX repository](https://github.com/ellavox-ai/nostr-agx)
- [Published CLI 0.3.0 archive](https://registry.npmjs.org/@nostr-agx/cli/-/cli-0.3.0.tgz)
- [Published core 0.3.0 archive](https://registry.npmjs.org/@nostr-agx/core/-/core-0.3.0.tgz)

`package-lock.json` retains the published package integrity checks. The original
comparator was adopted unchanged at Git blob
`fb145c272372727f06bd5cfa6e6595a4716d33e7`; the service snapshots those engine
bytes inside each staged bundle, along with the actual input and mapping hashes.
