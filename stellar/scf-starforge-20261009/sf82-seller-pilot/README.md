# SF82 — run an OpenAPI seller

For versioned configuration changes, exact price/application review, retained
rollback and a local operator console, use [Seller configuration releases](RELEASES.md).
To change its configured native facilitator while retaining the prepared merchant,
use [Retained facilitator review and release](FACILITATORS.md). The CLI, console
and MCP share the same saved review and original startup/rollback lifecycle.

Compile selected operations from an existing API, run their seller service, stop it, and restart the same compiled seller. Supply declarative bindings for an existing HTTP backend, a trusted JavaScript application, or static responses. This command uses the original [SF61 importer](../sf61-openapi-seller-import/README.md) and [SF30 server](../sf30-seller-sdk/README.md), including their schema checks, application handlers, admission callbacks and native x402 payment integration.

## Start

From a full checkout with Node 22+:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/pilot.mjs \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-selections.example.json \
  --bindings stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-bindings.example.json \
  --out /tmp/my-seller --port 0
```

The illustrative weather API uses deliberately **nonpayable** example terms. The command prints its actual local base URL, health and offers endpoints, route list, and copyable restart/status commands. It stays in the foreground. **Ctrl-C stops it.** Port `0` chooses an available local port; omit it to use `8423`.

In another terminal, use the printed port:

```sh
curl -i -X POST http://127.0.0.1:PORT/api/v2/forecast \
  -H 'content-type: application/json' -d '{"latitude":38.25,"longitude":-85.76}'
```

The original service returns a real HTTP `402` in `CHALLENGE_ONLY` mode. Application handlers do not run in that mode. The listener binds to `127.0.0.1`; the advertised offers retain the API's declared public HTTPS origin. Use your own HTTPS reverse proxy when deploying.

## Stop, inspect, restart

Keep the output directory. Once the process has stopped, restart without the original input files or recompilation:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/pilot.mjs --resume /tmp/my-seller
```

Resume restores the last requested port, absolute trusted handler path and facilitator settings. `--port 0` stays `0`, so each restart selects a free port and prints its new URL. Explicit runtime flags override saved values and become the settings for the next restart:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/pilot.mjs \
  --resume /tmp/my-seller --port 8424 --handlers ./merchant-handlers.mjs
```

Use `--challenge-only` to explicitly remove a saved facilitator. Status makes a fresh local health/offers request without starting a server or importing application handlers:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/pilot.mjs --status /tmp/my-seller
```

Its JSON reports `RUNNING` with the current matched routes, `NOT_STARTED` if launch has never completed, or `UNAVAILABLE` when the last listener cannot be reached or no longer matches this seller. `lastSuccessfulRuntime` contains recorded launch settings; health does not independently expose handler paths or facilitator configuration. An old readiness file alone is never treated as a running service. Operate one foreground process per directory; this command is not a process supervisor, and status does not stop a process.

If startup fails, compiled files remain intact. For an occupied port, the error includes the exact `--resume ... --port 0` correction. Fix a missing application file by supplying `--handlers /path/to/correct-module.mjs`. You can resume an older SF82 or SF61 service export too: supply its runtime flags on the first resume. A prior native pilot without saved settings requires an explicit facilitator or `--challenge-only` choice.

## Run your application

Supply your OpenAPI document, explicit selections with your accepted payment terms, route bindings, and trusted ESM handler module. Handler paths supplied on the command line resolve from your current directory and are saved as absolute paths. Resume will import that trusted module again in the new process after checking the compiled files.

For the original facilitator-backed server, add `--facilitator https://YOUR_ACTUAL_FACILITATOR` on first launch or resume. SF30 loads its installed `@x402/core/server` and original native implementation; SF82 installs no packages. `--allow-local-facilitator` forwards the existing SF30 option for an explicitly supplied loopback development facilitator. Health reports `NATIVE_X402` only after the original native server starts. This mode alone does not establish that a request has settled.

## Connect an existing HTTP API

Use `--upstreams BINDINGS_JSON` instead of `--handlers`. Each imported service
route names a `handler`, and that exact name selects an original SF30 upstream
binding. A merchant can use the OpenAPI compile, restart, status and operations
workflow without writing an ESM wrapper or replacing the backend.

Run the existing local dataset backend in one terminal:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/examples/upstream-backend.mjs
```

In another terminal, compile and start the included API example:

```sh
P=stellar/scf-starforge-20261009/sf82-seller-pilot
node "$P/pilot.mjs" \
  --spec "$P/examples/upstream-openapi.json" \
  --config "$P/examples/upstream-selections.json" \
  --bindings "$P/examples/upstream-route-bindings.json" \
  --upstreams "$P/examples/upstreams.json" --allow-loopback-upstream \
  --out /tmp/my-upstream-seller --port 0
```

Use the actual listener printed by startup:

```sh
curl -i 'http://127.0.0.1:PORT/api/dataset?region=north'
```

The compiled public path `/api/dataset` comes from the OpenAPI server and selected
operation. The separate backend binding targets `/v1/dataset` on the existing
example server. The original seller returns HTTP `402` in challenge-only mode;
it does not invoke the backend or return its rows. The example uses deliberately
nonpayable terms. To operate a payable merchant API, replace those terms and
public origin with the merchant's accepted values and supply the original
facilitator configuration described above.

`--upstreams` resolves from the current working directory. Before a listener or
facilitator starts, SF82 validates the original seller config and uses SF30's
`compileUpstreamBindings` and `validateUpstreamService`. Missing handler bindings,
method/path mismatches, undeclared fields, missing credential variables and
unsupported admission callbacks fail with a correction/resume command. The
original upstream launcher then owns request forwarding, native payment and
response release. Static routes may coexist with upstream routes. Custom `admit`
callbacks continue to use a trusted `--handlers` module.

### Saved bindings and credential rotation

The first successful validation copies the exact upstream JSON bytes into a
private `pilot-upstreams-SHA256.json` in the compiled seller directory. The
saved runtime refers to this local file and its digest, so moving or changing
the original input file cannot silently change a restart. Completed snapshots
are installed atomically without overwriting an existing snapshot. The original
compiled offers, service and manifest are unchanged.

Stop with Ctrl-C and resume without the initial spec, selections, route bindings
or upstream input file:

```sh
node "$P/pilot.mjs" --resume /tmp/my-upstream-seller
node "$P/pilot.mjs" --status /tmp/my-upstream-seller
```

Resume verifies the stored digest before starting the original upstream seller.
Status verifies the last successful upstream snapshot and the live original
health/offers without reading environment credentials or invoking a backend.
The snapshot proves which saved configuration was used for the last successful
launch; health does not independently expose the backend binding or its credentials.

For credentials, use original SF30 `headerEnv` mappings containing environment
variable **names**. Credential values are resolved freshly on each launch and
are never written into runtime files, snapshots, readiness or output. Restart
after rotating a secret through the merchant's deployment mechanism. Missing
variables stop startup even in challenge-only mode; status remains available.
See [SF30 upstream configuration](../sf30-seller-sdk/UPSTREAM.md) for the exact
header, origin, response limit and side-effect contract.

To deliberately change a backend origin, path, credential variable name or
response limit, pass `--upstreams` again with the intended replacement. Native
validation must pass before the saved runtime switches to its new snapshot:

```sh
node "$P/pilot.mjs" --resume /tmp/my-upstream-seller \
  --upstreams /private/merchant-upstreams.json --disallow-loopback-upstream
```

Earlier snapshots remain intact. Existing running processes keep their own
launch-time configuration; stop the prior process before restarting. A changed
saved snapshot is refused rather than silently trusted. Restore its original
bytes or explicitly select a valid replacement file. Changed **offers or payment
terms** still require a new compiled `--out` directory.

`--allow-loopback-upstream` permits only the original explicit
`http://127.0.0.1:PORT` development backend and is saved for resume.
`--disallow-loopback-upstream` removes that saved permission and requires public
HTTPS bindings. An explicit `--handlers FILE` switches back to the original ESM
launcher and removes the saved upstream selection; an explicit `--upstreams FILE`
switches to the upstream launcher. Passing both in one invocation is an error.

### Use the same merchant with operations and support

The existing [SF96 pilot operations command](../sf96-seller-pilot-ops/README.md)
forwards these options directly to SF82. Keep its original `start -- ...` shape
and place `--upstreams` and `--allow-loopback-upstream` after the separator during
first launch. Resume uses just `--resume` as usual. The same native session feeds
the live operations dashboard and original SF93 private support capture; no
separate seller process or second payment configuration is required.

## What stays in the directory

| File | Purpose |
| --- | --- |
| `offers.json`, `seller-service.json`, `manifest.json` | Original SF61 output; never rewritten by resume. Their original SHA-256 identities are checked before handler import or listening. |
| `pilot-runtime.json` | Last requested runtime settings, including explicit overrides. Written before starting, so a failed launch can be corrected and resumed. |
| `pilot-upstreams-SHA256.json` | Original declarative backend JSON snapshot, when upstream mode is selected. Private, digest checked, and create only; contains environment variable names, not their values. |
| `runtime-readiness.json` | Last successful local observation, including the actual launch settings, listener and original offer identities. Updated atomically after each successful start. |

The original compiler creates a private `0700` directory and `0600` files. The two operational files are also `0600`; atomic replacement keeps their previous complete versions until an update succeeds. A failed restart may leave an older successful observation, so use `--status` for current availability. Source hashes bind the export together; they are not an independent signature of the directory. Keep the directory and application module under your control.

Changed spec, prices, route bindings or exported files require a **new** `--out` directory. Resume refuses altered compiled artifacts and tells you to restore the originals or compile changed inputs separately. It never overwrites the original source export to make a restart succeed.

This operation creates no wallet, customer account, deployment or payment. Readiness concerns the running local configuration, with no paid request, settlement or customer-adoption claim. The existing SF49 owner retains the merchant relationship. SF30 remains the only serving/payment engine; SF82 adds no router, verification policy or retry mechanism.
