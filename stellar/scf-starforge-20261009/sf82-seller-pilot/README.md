# SF82 — one-command native OpenAPI seller pilot

An actual merchant can now compile **and serve** a selected OpenAPI API in one operator command, without copying the native seller protocol or writing a second server. This is a thin operational composition over the **original** [SF61 importer](../sf61-openapi-seller-import/README.md) and [SF30 service](../sf30-seller-sdk/README.md). It preserves real OpenAPI 3.0/3.1 schema acceptance, explicit offers, live route methods/path parameters, no-clobber manifest export, existing trusted application handlers and the native x402 payment implementation when configured.

## From an existing API to a running seller

In the original full repository checkout, Node 22+:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/pilot.mjs \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-selections.example.json \
  --bindings stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-bindings.example.json \
  --out /tmp/new-scoped-seller-pilot --port 0
```

This uses the unchanged illustrative weather spec and deliberately **nonpayable** example terms. The command creates a private `0700` folder with original `offers.json`, `manifest.json`, `seller-service.json` (each `0600`), starts the original SF30 HTTP seller on `127.0.0.1`, reads back its **real** `/_seller/health` and `/_seller/offers` endpoints without whitespace, compares original exported offer identities with the live server and writes `runtime-readiness.json` at mode `0600`. It prints the actual ephemeral listening URL and route count. In a second terminal, use the printed port:

```sh
curl -i -X POST http://127.0.0.1:PORT/api/v2/forecast \
  -H 'content-type: application/json' -d '{"latitude":38.25,"longitude":-85.76}'
```

This is a real HTTP `402` in **CHALLENGE_ONLY** mode; it is **not** a successful payment. The original application code is not invoked or charged. Ctrl-C ends the original Node listener. This does not create a wallet, merchant account, grant application or deployment. Keep the durable compiled directory as a source-bound handoff; supply a new output directory for every distinct run.

## Real seller application and facilitator

Supply the **merchant's** existing OpenAPI spec, exact route selections and accepted payment terms, explicit `--bindings`, and the existing trusted ESM `--handlers` file. For a real facilitator-backed seller, add `--facilitator https://YOUR_ACTUAL_FACILITATOR` to the **same command**. The original SF30 implementation then loads its installed native `@x402/core/server` and creates the original NATIVE_X402 server. No packages are installed by SF82. The handler file path is resolved from the operator's current directory before invoking the original service, avoiding the generated-output-directory relative-import trap. Use the merchant's own HTTPS proxy and ownership/authorization, not a public deployment from this script.

Use `--allow-local-facilitator` only with the original SF30 loopback development facilitator; this simply forwards the existing flag, not a new bypass. The `--facilitator` URL, app bindings, original headers and settlement are interpreted exclusively by the original modules. SF82 adds **no approval gate**, payment verification, key management, policy or external network request of its own. Unlike the existing compile-only tool, it creates one running real HTTP service and checks its readback.

## Delivery boundary

`runtime-readiness.json` proves **only** that the original compiled terms match the running local seller's original health and offer endpoints at that observation instant. The compile-time SHA-256 manifest remains byte-for-byte the SF61 output. No application handler, paid request, transaction, wallet, remote facilitator, onchain settlement, customer consent or grant invitation is proved by this readiness file. Native payment acceptance and seller-owned business validation require their established separate flows. On failed readback, the wrapper shuts down the actual listener rather than announcing readiness; compiled files remain recoverable for debugging. It never overwrites an existing output directory or emits GitHub Actions.

This is SF49 seller-onboarding usability, not a replacement for SF80 buyer input composition, SF81 operator execution, SF77 commercial work orders or SF30 prepayment application admission. The existing owner retains the customer relationship and commercial decision.