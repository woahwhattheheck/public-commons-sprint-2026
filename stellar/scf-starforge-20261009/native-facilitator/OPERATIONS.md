# Operate the original native facilitator

Use the same native facilitator configuration, original x402 SDK and merchant
runtime. The operating path adds a read-only RPC review, shared local signing
ownership, a readiness endpoint and admission based on recent observations.

## Review, probe and start

Add this optional section to the existing private facilitator JSON:

```json
{
  "operations": {
    "ownershipDirectory": "/srv/starforge/facilitator-owners",
    "rpcTimeoutMs": 10000,
    "readinessMaxAgeMs": 30000,
    "maxLedgerAgeSeconds": 120,
    "requireReady": true
  }
}
```

All cooperating native facilitator processes using the same signing accounts
on a host must use the **same ownership directory and operating-system user**.
The directory is shared across their configurations and networks. Each lock is
selected by the exact network and public account, so independent testnet and
pubnet accounts can run concurrently. Include a separately configured fee-bump
signer in the same policy; it is automatically covered by ownership.

The directory is created with mode `0700`; existing directories must be owned
by the current user and private. Lock files are regular single-link files with
mode `0600`. Linux and the standard util-linux `flock` command are required for
this operating mode. Put the directory on the host's local filesystem and retain
it through restart. Keep every process that uses these accounts on the same
host, or assign separate signing accounts to other hosts.

First inspect the complete configuration without loading keys:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --review --config /private/facilitator.json
```

Then obtain the real RPC observation, also without loading keys or taking a
signer lock:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --probe --config /private/facilitator.json
```

The command returns JSON and exits `0` when ready, `2` when the observation is
unavailable or unsuitable, and `1` for an invalid configuration. It calls only
the configured RPC's `getNetwork`, `getHealth` and `getLatestLedger` methods.
Their exact JSON-RPC response IDs and envelopes are checked. A positive result
requires the configured Stellar network passphrase, a healthy node, coherent
ledger metadata and a recent ledger close time. A clock more than 30 seconds
behind that ledger also prevents readiness. The printed RPC address is its
origin; any private path or query remains inside the process.

Start the original private HTTP backend:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --serve --config /private/facilitator.json --port 5101
```

For an existing configuration that has no `operations` section, these flags
select the operating mode explicitly:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --serve --config /private/facilitator.json --port 5101 \
  --state /srv/starforge/facilitator-owners --require-ready
```

The same flags apply to the existing `--seller SELLER_JSON` entrypoint. Startup
takes all configured signer locks in stable order, probes the RPC if readiness
is required, constructs the real SDK and opens the original server. Any startup
failure releases the acquired locks. A competing process exits with
`SIGNER_ALREADY_OWNED` before accepting payment work. Use `--probe` to inspect
the RPC while a service already owns its accounts; `--check` constructs an SDK
instance and therefore participates in configured ownership.

## Read the existing service's state

The private listener has two distinct operating endpoints:

| Endpoint | Result |
| --- | --- |
| `GET /healthz` | Original process state, active native work and counters, plus the last readiness observation and signer ownership |
| `GET /readyz` | A current or refreshed RPC observation; HTTP `200` when the process is accepting and the observation is ready, otherwise `503` |
| `GET /supported` | The original SDK's supported payment metadata |

Use the exact loopback address printed at startup. The existing Host and
browser-Origin checks apply to all three endpoints:

```sh
curl --fail http://127.0.0.1:5101/readyz
curl --fail http://127.0.0.1:5101/healthz
```

Readiness states explain the actual observed condition:

| State | Operating action |
| --- | --- |
| `NOT_PROBED` | Request `/readyz` or run the configuration's `--probe` command |
| `READY` | The recorded RPC network, health and recent ledger satisfy this policy |
| `STALE` | Refresh the observation; its configured age has elapsed |
| `NETWORK_MISMATCH` | Correct the configured RPC or network before using the service |
| `UNHEALTHY` | Inspect the configured RPC node's health |
| `STALE_LEDGER` | Inspect RPC synchronization and the host clock |
| `INVALID_RESPONSE` | Inspect that RPC's original method responses and compatibility |
| `UNAVAILABLE` | Read the per-method stable error codes and restore the configured transport |
| `DRAINING` | Let accepted work complete, then use the original shutdown result |

The probe keeps one request group in flight. Concurrent callers share it;
successful and unsuccessful observations are cached for `readinessMaxAgeMs`.
Once an observation expires, status marks it stale instead of continuing to
advertise readiness. The module API allows a deliberate `probe({force:true})`
to refresh earlier. The RPC timeout covers response-body consumption, bodies
are capped at 1 MiB, redirects are refused, and provider error strings are
replaced with stable codes.

With `requireReady:true`, verification and settlement each require a recent
positive observation before entering the original SDK. A stale observation
causes a coalesced refresh. An unsuitable observation returns
`FACILITATOR_RPC_NOT_READY` with HTTP `503`. A changed observation affects new
admission; an already accepted SDK settlement continues under the existing
drain and reconciliation behavior. This service's single-settlement capacity
is checked again after an awaited probe, preserving source-account sequencing.

RPC readiness describes the configured node and ledger. Review payment assets,
recipient balances, sponsorship capacity and original transaction outcomes
through their existing merchant/account and reconciliation workflows.

## Stop, restart and recover

SIGINT and SIGTERM use the existing combined lifecycle. For a self-facilitated
merchant, its accepted merchant work finishes first; the facilitator then
finishes its accepted SDK work. The RPC probe is cancelled during drain.
Signer locks are released when all accepted native calls finish.

If the grace period expires while an SDK operation is still active,
`drained:false` and held ownership remain visible. Another cooperating service
cannot take the same signer until that operation finishes or the original
process exits. In shared-ownership mode, the CLI prints
`WAITING_FOR_ACCEPTED_NATIVE_WORK` and keeps the parent descriptor alive until
that work finishes. It then reports `ACCEPTED_NATIVE_WORK_FINISHED` and exits
with code `2`, retaining the original unsuccessful shutdown outcome. Reconcile
the original transaction with the existing SF86/accounting workflow before
repeating that purchase. New service startup performs no payment replay.

The operating-system lock follows the parent process's open file description.
It survives the short `flock` helper, and the kernel releases it when the parent
exits. After a crash, the existing lock file can be reused normally. Its JSON
records public account, network, process ID, owner ID and start time for private
diagnosis; the lock itself determines ownership. Do not delete or replace lock
files while any facilitator might have them open. Keeping the same inode avoids
two processes locking different files for the same account.

Place the existing CLI invocation in the host's normal service manager and load
its existing named signing variables through that manager's private environment.
Give orderly shutdown at least the configured drain grace before terminating
the process, and let a reported accepted native operation finish. Direct the
public deployment to the existing SF58 frontdoor or
merchant ingress; the native listener and operating endpoints remain loopback.

## Compose with existing applications

The original exports keep their call signatures:

```js
const native = await createNativeFacilitator(facilitatorConfig, { environment });
const readiness = await native.probeReadiness();
const status = native.status();
// status.readiness and status.ownership are additional operating fields.
const outcome = await native.drain();
if (!outcome.drained) await native.waitForIdle();
```

`createRpcReadiness(config)` is separately importable from `readiness.mjs` for a
key-free operator review. It provides `probe({force})`, `status()` and `close()`.
`acquireSignerOwnership(config)` is the existing native runtime's shared local
ownership component; its `release()` is idempotent. Existing configurations
without operating options retain process-local admission and on-demand probing.

The accepted native payment baseline remains the original x402 implementation.
The operating changes are exercised as one focused lifecycle: real SDK startup,
same-account conflict, independent-account admission, listener startup failure,
RPC readiness/expiry/refusal and clean release/restart. The latest original
native testnet payment result is retained in the existing simulation thread.

Protocol references:
[getNetwork](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork),
[getHealth](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth),
[getLatestLedger](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLatestLedger).
