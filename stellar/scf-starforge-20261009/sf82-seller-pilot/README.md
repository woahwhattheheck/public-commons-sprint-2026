# SF82 — run an OpenAPI seller

For versioned configuration changes, exact price/application review, retained
rollback and a local operator console, use [Seller configuration releases](RELEASES.md).

Compile selected operations from an existing API, run their seller service, stop it, and restart the same compiled seller. This command uses the original [SF61 importer](../sf61-openapi-seller-import/README.md) and [SF30 server](../sf30-seller-sdk/README.md), including their schema checks, application handlers, admission callbacks and native x402 payment integration.

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

## What stays in the directory

| File | Purpose |
| --- | --- |
| `offers.json`, `seller-service.json`, `manifest.json` | Original SF61 output; never rewritten by resume. Their original SHA-256 identities are checked before handler import or listening. |
| `pilot-runtime.json` | Last requested runtime settings, including explicit overrides. Written before starting, so a failed launch can be corrected and resumed. |
| `runtime-readiness.json` | Last successful local observation, including the actual launch settings, listener and original offer identities. Updated atomically after each successful start. |

The original compiler creates a private `0700` directory and `0600` files. The two operational files are also `0600`; atomic replacement keeps their previous complete versions until an update succeeds. A failed restart may leave an older successful observation, so use `--status` for current availability. Source hashes bind the export together; they are not an independent signature of the directory. Keep the directory and application module under your control.

Changed spec, prices, route bindings or exported files require a **new** `--out` directory. Resume refuses altered compiled artifacts and tells you to restore the originals or compile changed inputs separately. It never overwrites the original source export to make a restart succeed.

This operation creates no wallet, customer account, deployment or payment. Readiness concerns the running local configuration, with no paid request, settlement or customer-adoption claim. The existing SF49 owner retains the merchant relationship. SF30 remains the only serving/payment engine; SF82 adds no router, verification policy or retry mechanism.
