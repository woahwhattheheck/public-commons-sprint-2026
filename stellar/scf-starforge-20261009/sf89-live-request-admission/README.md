# SF89 | Live input admission for original Stellar x402 seller routes

**Product problem.** The accepted SF61 OpenAPI importer creates actual Draft 2020-12 schema assertions for a seller's selected operation, but publishing a 402 challenge is not enough to ensure a **live** request matches those assertions. Without a trusted admission callback, an invalid POST payload or mis-typed query can reach payment processing before the merchant rejects it. This module closes that gap without rebuilding x402 payment verification, the SF30 runtime, OpenAPI import, metadata validation or the active merchant console.

**What ships.** index.mjs exports createLiveRequestAdmission(originalOffer) and admissionForServiceRoute(originalConfig, routeId); their returned callbacks plug into the **existing** SF30 admit field. The original SF25 validateBazaarExtension checks the **actual** query/body/path instance against the imported offer's **original** schema. Seller-advertised example data are removed before validation. Route selection and URL normalization remain owned by the original SF30 source. No paid operation, signer, settlement, external API access or testnet transaction is introduced here.

## Use with an already imported application

First, use the existing **SF61 OpenAPI importer** to export the current seller-service.json with a real seller application binding. Do not use example payloads as the protected application's response.

For an exported route with id weather, create an application module:

~~~js
import { readFileSync } from 'node:fs';
import { admissionForServiceRoute } from './sf89-live-request-admission/index.mjs';

// Change the relative import above to the actual SF89 location in your checkout.
// Read the SAME original seller-service.json passed to serve.mjs.
const service = JSON.parse(readFileSync(new URL('./seller-service.json', import.meta.url)));
export const admitWeather = admissionForServiceRoute(service, 'weather');

export async function weather({ query, body, pathParams }) {
  // Replace with your REAL merchant application handler.
  return { status: 200, body: { city: pathParams.city, requested: query.days } };
}
~~~

Set the **existing** route's two callback fields:

~~~json
{
  "id": "weather",
  "path": "/api/v1/forecast/:city",
  "offer": {"...": "THE_UNMODIFIED_ACTUAL_SF61_COMPILED_OFFER"},
  "handler": "weather",
  "admit": "admitWeather"
}
~~~

Use the existing SF30 operator command:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /path/to/seller-service.json \
  --handlers /path/to/application.mjs \
  --facilitator https://your-operator-approved-facilitator.example/facilitator
~~~

The actual seller's HTTPS origin, network, payee, asset, price, application and real facilitator remain operator-controlled. Do not substitute illustrative markers into a paid service. The included code never creates or signs a wallet.

## Exact runtime ordering

1. SF30 selects the native HTTP route, decodes whole-segment path parameters and parses query/body using its original Node HTTP request adapter.
2. SF89 reads the **same imported Bazaar schema** for that selected operation, drops seller examples, and validates the real request. Query strings are interpreted as OpenAPI simple-form string, integer, number or boolean only when the original schema explicitly declares that scalar type. Duplicate query keys, undeclared keys, invalid numbers/booleans and out-of-range values are rejected rather than silently coerced.
3. An invalid request receives a nonpayment HTTP 422 JSON response; only schema paths/error codes appear, never the supplied request body or values.
4. A valid request returns boolean true to the **original SF30 admission engine**, which independently invokes the original native x402 verification, merchant handler and settlement/cancellation lifecycle.
5. Admission **does not transform** the request subsequently received by the native SDK or merchant handler. The merchant may still need to parse its original textual query values and apply application-specific validation.

SF30 CHALLENGE_ONLY (no native facilitator) behavior is unchanged: it returns its original HTTP 402 metadata without invoking merchant admission. A native x402 facility must be configured for live request admission to execute. Native SDK compatibility, network settlement and operator credentials remain governed by the existing SF30 product and its owner.

## Native original-source acceptance

From a complete public public-commons-sprint-2026 checkout with Node 22+:

~~~sh
node stellar/scf-starforge-20261009/sf89-live-request-admission/test/acceptance.mjs
~~~

This **single focused check** runs the **actual SF61 OpenAPI 3.1 weather importer** and **actual SF30 compiled route/resource handler** over loopback HTTP. Two schema-invalid original GET/POST requests must return 422 before even entering the controlled native collaborator; two valid requests must enter that collaborator and stop at its 402 payment refusal. No merchant handler can execute. Example payment markers are intentionally nonpayable. A passing check shows request admission behavior, **not** live testnet or grant acceptance.

## Supported and intentionally unsupported

- Supported: exactly the original SF61/SF30 imported GET, HEAD, DELETE and JSON POST/PUT/PATCH, whole-segment **string** path parameters, scalar query values, JSON body objects, declared Draft 2020-12 validation and strict source-instance parity. The original service binding can set `validateInput:true` to attach this admission directly, including alongside an existing application `admit` callback.
- Uses existing SF25 schema keyword coverage. This is **not** a new general JSON Schema runtime or a substitute for merchant authentication.
- Unsupported: custom/OpenAPI array query serialization, undocumented headers and cookies, coerced unknown properties, path numbers and upto payment execution. A merchant must supply its own trusted admission for these.
- Existing SF30 callback timeout, client-abort, decision-status, content size, no-redirect and native fail-closed behavior are unchanged.
- No GitHub Actions workflow, cloud spend, outbound marketing, SCF application, merchant charges or browser dependency.

The original sources remain authoritative: ../sf61-openapi-seller-import/importer.mjs, ../sf30-seller-sdk/resource-server.mjs, ../sf30-seller-sdk/ADMISSION.md and ../../../stellar-forge/payment-auto-catalog/schema-validation.mjs.

MIT. Original SCF SF30/SF61/SF25 and merchant/SF10 founder workstreams continue independently; this module is additive.
