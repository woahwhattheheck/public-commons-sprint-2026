# Enforce an API's response contract before settlement

The existing OpenAPI import and SF30 upstream seller can now carry the original
operation's response promises into its delivery path. A merchant backend's JSON
can be syntactically valid while missing required fields, using the wrong value
types, or returning an undocumented successful status. With a response contract,
the existing upstream handler rejects that result before SF30 calls its native
post-handler settlement step.

This is an opt-in extension of the existing seller. It uses the same OpenAPI
reference resolver and 3.0 compatibility adapter, the original SF25 schema
validator, the same backend transport, and the unchanged SF30 payment lifecycle.

## Export a runnable merchant configuration

Prepare the existing OpenAPI JSON, explicit operation selections with merchant
payment terms, service bindings naming application handlers, and ordinary
[upstream bindings](../sf30-seller-sdk/UPSTREAM.md). Give distinct OpenAPI operations
distinct handler names. Then run:

```sh
I=stellar/scf-starforge-20261009/sf61-openapi-seller-import
S=stellar/scf-starforge-20261009/sf30-seller-sdk

node "$I/cli.mjs" \
  --spec /private/merchant/openapi.json \
  --config /private/merchant/selections.json \
  --service-bindings /private/merchant/service-bindings.json \
  --upstream-bindings /private/merchant/upstreams.json \
  --out /private/merchant/release-001

node "$S/upstream-serve.mjs" \
  --config /private/merchant/release-001/seller-service.json \
  --upstreams /private/merchant/release-001/upstreams.json --check

node "$S/upstream-serve.mjs" \
  --config /private/merchant/release-001/seller-service.json \
  --upstreams /private/merchant/release-001/upstreams.json
```

The export directory must be new. It contains the original offers and seller
configuration plus `upstreams.json`, with a compiled `responseContract` on each
selected upstream handler. The manifest records the exact OpenAPI bytes,
upstream input/output and response compiler/runtime hashes. The output retains
the merchant's backend mapping and environment-variable **names**; export never
reads environment credentials or calls the backend. Native `--check` performs
the existing transport, route and actual environment preflight.

Files use mode `0600` inside a `0700` directory. Keep the export private: it
contains API schemas and backend configuration. Existing `responseFile` assets
are bundled as before. Original offer metadata, request schemas, payment terms,
static responses and admission options are preserved. Export refuses unused or
missing upstream bindings and refuses to overwrite a manually supplied contract.

The last command starts the existing challenge-only service. Use the original
`--facilitator` setup when the merchant is ready to enable its native payment
runtime. `--allow-loopback-upstream` remains required for a same-machine HTTP
backend. These flags and their meanings are unchanged.

## Runtime behavior

| Backend result | Existing seller behavior with a contract |
| --- | --- |
| Declared successful status, JSON media type and matching schema | Returns the original decoded bytes to native SF30 settlement; releases them only after native success |
| JSON violates the matching schema | Sanitized HTTP 502 `UPSTREAM_RESPONSE_CONTRACT_SCHEMA`; original cancellation path |
| Successful status has no exact, `2XX`, or `default` definition | HTTP 502 `UPSTREAM_RESPONSE_CONTRACT_STATUS`; original cancellation path |
| JSON media type does not match the selected response definition | HTTP 502 `UPSTREAM_RESPONSE_CONTRACT_MEDIA_TYPE`; original cancellation path |
| Declared HEAD, 204 or 205 | Preserves bodyless HTTP semantics; no invented empty JSON response |
| Backend 4xx/5xx, redirect, timeout, malformed or oversized response | Existing SF30 upstream failure behavior |

Exact status definitions take precedence over `2XX`, which takes precedence over
`default`. A broad fallback cannot relax an explicit `200` schema. Media types
are compared without parameters and case-insensitively at runtime. The importer
accepts explicit lowercase `application/json` and concrete `application/...+json`
keys, such as `application/problem+json`; it does not treat a wildcard MIME range
as equivalent to a declared JSON representation.

Response validation occurs after the one backend invocation and before the
original seller's post-handler settlement call. Some native payment schemes may
have already performed a pre-handler settlement; cancellation/refund handling
remains the native SDK's responsibility. This feature does not promise that every
failure avoids every network payment, nor does it undo a mutating backend POST.
Use the existing [backend side-effect contract](../sf30-seller-sdk/UPSTREAM.md#failure-and-side-effect-contract).

Failures expose a stable error code and upstream status only. They do not return
the backend payload, private schema path, credentials or validation diagnostics.
Existing per-binding failure telemetry includes these ordinary handler failures.

## Supported contract

OpenAPI 3.0 and 3.1 local reference objects and schemas follow the original
importer's rules. In particular, 3.0 `nullable` and exclusive numeric bounds
retain their original meaning. Runtime uses SF25's supported JSON Schema 2020-12
vocabulary: object properties/required/additional properties, arrays/items,
types, enum/const, supported composition, string length and numeric bounds.
Unknown assertions fail export or startup. References are resolved before a
schema is embedded under the validator's response envelope.

All explicitly declared success responses and `default` are compiled. Error
status definitions remain the upstream adapter's existing failure path. Empty
content requires HEAD or explicit 204/205. HEAD/204/205 never acquire a payload
merely because OpenAPI describes a representation. Response header assertions,
links, callbacks, non-JSON encodings, recursive references and unsupported
schema assertions are outside this contract. It does not certify a backend,
seller identity, result accuracy, business transaction or chain settlement.

For programmatic use, pass `responseContract` to the existing
`createUpstreamHandler`, or place it on an original upstream binding. It requires
JSON mode; manually supplied unresolved schema references fail startup. Ordinary
bindings without this field retain their existing behavior.

## Focused native integration

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/response-contract-acceptance.mjs
```

One journey exports the real original source, starts an actual local backend and
the original SF30 seller, and exercises mismatch cancellation, byte-preserving
valid delivery, status/media rejection, bodyless responses and unchanged
challenge-only behavior. A controlled native-compatible collaborator makes the
existing cancellation/settlement calls observable. It is a runtime integration
check, not a Stellar network transaction. No hosted Actions are required.

Protocol sources: [OpenAPI 3.1.1 Responses Object](https://spec.openapis.org/oas/v3.1.1.html#responses-object),
[Response Object](https://spec.openapis.org/oas/v3.1.1.html#response-object),
and [OpenAPI 3.0.4 Schema Object](https://spec.openapis.org/oas/v3.0.4.html#schema-object).
MIT, matching the original public components.
